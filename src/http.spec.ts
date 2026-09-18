import { Test } from '@nestjs/testing';
import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TokenChainView,
  TokenEnvelopeLog,
  TokenListingStore,
  TokenPublicReadLimiter,
  TokenReviewStore,
  TokenStakeCache,
  TokenStakedWriteLimiter,
  TokenUnstakedWriteLimiter,
} from './domain/constants';
import { ProblemFilter } from './http/problem.filter';
import { ListingsController } from './http/listings.controller';
import { DocsController, HealthController } from './http/health.controller';
import { ListingsService } from './listings/listings.service';
import { MemoryListingStore } from './infra/memory/listing-store';
import { MemoryReviewStore } from './infra/memory/review-store';
import { MemoryRateAdapters } from './infra/memory/rate';
import { MemoryChainView } from './infra/memory/chain-view';
import { bearer, signEnvelope, testKey } from './test-support';
import { AdminOverlayService } from './cli/admin-overlay.service';
import { ObservationService } from './observation/observation.service';
import type { RegisterBody } from './listings/listings.service';

async function appWith(chain = new MemoryChainView()) {
  const listings = new MemoryListingStore();
  const reviews = new MemoryReviewStore();
  const rates = new MemoryRateAdapters();
  const moduleRef = await Test.createTestingModule({
    controllers: [ListingsController, HealthController, DocsController],
    providers: [
      ListingsService,
      ObservationService,
      AdminOverlayService,
      { provide: TokenListingStore, useValue: listings },
      { provide: TokenReviewStore, useValue: reviews },
      { provide: TokenStakeCache, useValue: rates },
      { provide: TokenPublicReadLimiter, useValue: rates },
      { provide: TokenUnstakedWriteLimiter, useValue: rates },
      { provide: TokenStakedWriteLimiter, useValue: rates },
      { provide: TokenEnvelopeLog, useValue: rates },
      { provide: TokenChainView, useValue: chain },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ProblemFilter());
  await app.init();
  return { app, listings, reviews, chain, rates, observation: moduleRef.get(ObservationService), admin: moduleRef.get(AdminOverlayService) };
}

function registerCmd(): RegisterBody {
  return {
    commandKind: 'registerListing',
    name: 'Example Pool',
    connect: { kind: 'stratumAndDatum', stratum: { host: 'stratum.example.com', port: 23334 }, datum: { host: 'datum.example.com', port: 28916 } },
  };
}

describe('http registry', () => {
  let app: INestApplication;
  let chain: MemoryChainView;
  let admin: AdminOverlayService;
  let observation: ObservationService;
  let reviews: MemoryReviewStore;

  beforeAll(async () => {
    const built = await appWith();
    app = built.app;
    chain = built.chain;
    admin = built.admin;
    observation = built.observation;
    reviews = built.reviews;
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves health and openapi', async () => {
    await request(app.getHttpServer()).get('/v1/healthz').expect(200);
    await request(app.getHttpServer()).get('/v1/readyz').expect(200);
    await request(app.getHttpServer()).get('/v1/docs').expect(200);
    const spec = await request(app.getHttpServer()).get('/v1/openapi.json').expect(200);
    expect(spec.body.info.version).toBe('0.1.0');
    expect(spec.body.paths['/v1/listings']).toBeTruthy();
  });

  it('rejects missing and main chain headers', async () => {
    await request(app.getHttpServer()).get('/v1/listings').expect(400);
    const res = await request(app.getHttpServer()).get('/v1/listings').set('X-FederationCoin-Chain', 'main').expect(400);
    expect(res.body.code).toBe('unknownChain');
  });

  it('registers, finds, heartbeats, reviews, and hides after expiry', async () => {
    const { priv, wallet } = testKey();
    chain.state.balances.set(wallet, 10n ** 18n);
    const cmd = registerCmd();
    const env = signEnvelope({
      priv,
      wallet,
      chain: 'testnet',
      commandKind: 'registerListing',
      command: cmd,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    const created = await request(app.getHttpServer())
      .post('/v1/listings')
      .set('X-FederationCoin-Chain', 'testnet')
      .set('Authorization', bearer(env))
      .send(cmd)
      .expect(201);
    expect(created.body.poolId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i);
    expect(created.headers.location).toContain(created.body.poolId);

    const found = await request(app.getHttpServer()).get('/v1/listings').set('X-FederationCoin-Chain', 'testnet').expect(200);
    expect(found.body.inactiveMatchHint).toBe(false);
    expect(found.body.items[0].name).toBe('Example Pool');
    expect(found.body.items[0].hasHostileFlag).toBe(false);

    const one = await request(app.getHttpServer())
      .get(`/v1/listings/${created.body.poolId}`)
      .set('X-FederationCoin-Chain', 'testnet')
      .expect(200);
    expect(one.body.poolId).toBe(created.body.poolId);

    const preview = await request(app.getHttpServer())
      .get('/v1/stake-preview')
      .query({ wallet })
      .set('X-FederationCoin-Chain', 'testnet')
      .expect(200);
    expect(preview.body.kind).toBe('stakeReady');

    const hb = { commandKind: 'heartbeatListing' as const, poolId: created.body.poolId };
    const hbEnv = signEnvelope({
      priv,
      wallet,
      chain: 'testnet',
      commandKind: 'heartbeatListing',
      command: hb,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await request(app.getHttpServer())
      .post(`/v1/listings/${created.body.poolId}/heartbeat`)
      .set('X-FederationCoin-Chain', 'testnet')
      .set('Authorization', bearer(hbEnv))
      .send(hb)
      .expect(204);

    const review = { commandKind: 'postReview' as const, starRating: 5, text: 'honest work' };
    const rEnv = signEnvelope({
      priv,
      wallet,
      chain: 'testnet',
      commandKind: 'postReview',
      command: review,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await request(app.getHttpServer())
      .post(`/v1/listings/${created.body.poolId}/reviews`)
      .set('X-FederationCoin-Chain', 'testnet')
      .set('Authorization', bearer(rEnv))
      .send(review)
      .expect(201);

    const rebut = { commandKind: 'postRebuttal' as const, text: 'thanks' };
    const bEnv = signEnvelope({
      priv,
      wallet,
      chain: 'testnet',
      commandKind: 'postRebuttal',
      command: rebut,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await request(app.getHttpServer())
      .post(`/v1/listings/${created.body.poolId}/reviews/${wallet}/rebuttal`)
      .set('X-FederationCoin-Chain', 'testnet')
      .set('Authorization', bearer(bEnv))
      .send(rebut)
      .expect(201);

    await admin.setHostileFlag(wallet, created.body.poolId, 'attacked the reviewer');
    const flagged = await request(app.getHttpServer())
      .get(`/v1/listings/${created.body.poolId}`)
      .set('X-FederationCoin-Chain', 'testnet')
      .expect(200);
    expect(flagged.body.hasHostileFlag).toBe(true);
    await admin.withdrawHostileFlag(wallet, created.body.poolId, 'disputed on X');

    chain.state.coinbases.set(chain.state.height, { tag: '/Example Pool/', addresses: [wallet] });
    await observation.observe('testnet');

    const upd = {
      commandKind: 'updateListing' as const,
      name: 'Example Pool',
      connect: { kind: 'stratumOnly' as const, stratum: { host: 'stratum.example.com', port: 23334 } },
    };
    const uEnv = signEnvelope({
      priv,
      wallet,
      chain: 'testnet',
      commandKind: 'updateListing',
      command: upd,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await request(app.getHttpServer())
      .patch(`/v1/listings/${created.body.poolId}`)
      .set('X-FederationCoin-Chain', 'testnet')
      .set('Authorization', bearer(uEnv))
      .send(upd)
      .expect(200);

    const del = { commandKind: 'deregisterListing' as const, poolId: created.body.poolId };
    const dEnv = signEnvelope({
      priv,
      wallet,
      chain: 'testnet',
      commandKind: 'deregisterListing',
      command: del,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await request(app.getHttpServer())
      .delete(`/v1/listings/${created.body.poolId}`)
      .set('X-FederationCoin-Chain', 'testnet')
      .set('Authorization', bearer(dEnv))
      .send(del)
      .expect(204);
  });

  it('rejects private hosts and duplicate envelopes', async () => {
    const { priv, wallet } = testKey();
    chain.state.balances.set(wallet, 10n ** 18n);
    const cmd: RegisterBody = {
      commandKind: 'registerListing',
      name: 'Bad',
      connect: { kind: 'stratumOnly', stratum: { host: '127.0.0.1', port: 23334 } },
    };
    const env = signEnvelope({
      priv,
      wallet,
      chain: 'testnet',
      commandKind: 'registerListing',
      command: cmd,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    const bad = await request(app.getHttpServer())
      .post('/v1/listings')
      .set('X-FederationCoin-Chain', 'testnet')
      .set('Authorization', bearer(env))
      .send(cmd)
      .expect(400);
    expect(bad.body.code).toBe('badHost');
  });

  it('rejects missing bearer and unknown chain tokens', async () => {
    await request(app.getHttpServer())
      .post('/v1/listings')
      .set('X-FederationCoin-Chain', 'testnet')
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .post('/v1/listings')
      .set('X-FederationCoin-Chain', 'testnet')
      .set('Authorization', 'Bearer not-base64url!!!')
      .send({})
      .expect(400);
    await request(app.getHttpServer()).get('/v1/listings').set('X-FederationCoin-Chain', 'regtest').expect(400);
    await request(app.getHttpServer()).get('/v1/listings/nope').set('X-FederationCoin-Chain', 'testnet').expect(404);
    await request(app.getHttpServer()).get('/v1/stake-preview').set('X-FederationCoin-Chain', 'testnet').query({ wallet: 'x' }).expect(401);
    await request(app.getHttpServer())
      .get('/v1/listings')
      .set('X-FederationCoin-Chain', 'testnet')
      .set('X-Forwarded-For', '203.0.113.9, 10.0.0.1')
      .expect(200);
  });
});
