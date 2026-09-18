import { Inject, Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import {
  CommandBodyCapBytes,
  DifficultyPeriodBlocks,
  HiddenAfterMs,
  LiveTenants,
  TargetSpacingSeconds,
  TokenChainView,
  TokenEnvelopeLog,
  TokenListingStore,
  TokenPublicReadLimiter,
  TokenReviewStore,
  TokenStakeCache,
  TokenStakedWriteLimiter,
  TokenUnstakedWriteLimiter,
  type ChainId,
} from '../domain/constants';
import { assertEnvelope } from '../domain/envelope';
import { assertListingConnect, assertWebsiteUrl } from '../domain/host';
import { assertP2wpkh } from '../domain/wallet';
import { compareFind } from '../domain/rank';
import { assertTipWindow, evaluateStake, stakeRequiredSats, tipWindow } from '../domain/stake';
import { assertListingNameAllowed, censorTagForDisplay, normalizeName } from '../domain/text';
import { jcs, sha256Hex } from '../domain/jcs';
import {
  RegistryProblem,
  type CommandKind,
  type ListingConnect,
  type ListingPublic,
  type ListingRecord,
  type SigningEnvelope,
  type StakePreviewResult,
} from '../domain/types';
import type { ChainView } from '../ports/chain-view';
import type { ListingStore } from '../ports/listing-store';
import type {
  EnvelopeLog,
  PublicReadRateLimiter,
  StakedWriteRateLimiter,
  UnstakedWriteRateLimiter,
} from '../ports/rate-limit';
import type { ReviewStore } from '../ports/review-store';
import type { StakeCache } from '../ports/stake-cache';

export type RegisterBody = {
  commandKind: 'registerListing';
  name: string;
  websiteUrl?: string;
  distributionAlgo?: string;
  templateWriteup?: string;
  feeText?: string;
  connect: ListingConnect;
};

export type UpdateBody = {
  commandKind: 'updateListing';
  name: string;
  websiteUrl?: string;
  distributionAlgo?: string;
  templateWriteup?: string;
  feeText?: string;
  connect: ListingConnect;
};

@Injectable()
export class ListingsService {
  constructor(
    @Inject(TokenListingStore) private readonly listings: ListingStore,
    @Inject(TokenReviewStore) private readonly reviews: ReviewStore,
    @Inject(TokenStakeCache) private readonly stakeCache: StakeCache,
    @Inject(TokenPublicReadLimiter) private readonly publicLimit: PublicReadRateLimiter,
    @Inject(TokenUnstakedWriteLimiter) private readonly unstaked: UnstakedWriteRateLimiter,
    @Inject(TokenStakedWriteLimiter) private readonly staked: StakedWriteRateLimiter,
    @Inject(TokenEnvelopeLog) private readonly envelopes: EnvelopeLog,
    @Inject(TokenChainView) private readonly chain: ChainView,
  ) {}

  assertLiveTenant(chain: ChainId): void {
    if (!(LiveTenants as readonly string[]).includes(chain)) {
      throw new RegistryProblem(400, 'unknownChain', 'This chain is not a live tenant');
    }
  }

  async ratePublic(ip: string): Promise<void> {
    const r = await this.publicLimit.hitPublicRead(ip);
    if (!r.allowed) {
      throw new RegistryProblem(429, 'rateLimited', 'Too many requests', String(r.retryAfterSeconds));
    }
  }

  async toPublic(row: ListingRecord): Promise<ListingPublic> {
    const revs = await this.reviews.listByPool(row.poolId);
    const scores = revs.map((r) => r.starRating);
    const reviewScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const hasHostileFlag = revs.some((r) => r.rebuttal?.hostileFlag && !r.rebuttal.hostileFlag.withdrawnAt);
    return {
      poolId: row.poolId,
      chain: row.chain,
      operatorWallet: row.operatorWallet,
      name: row.name,
      ...(row.websiteUrl ? { websiteUrl: row.websiteUrl } : {}),
      ...(row.distributionAlgo ? { distributionAlgo: row.distributionAlgo } : {}),
      ...(row.templateWriteup ? { templateWriteup: row.templateWriteup } : {}),
      ...(row.feeText ? { feeText: row.feeText } : {}),
      connect: row.connect,
      ...(row.coinbaseTag ? { coinbaseTag: censorTagForDisplay(row.coinbaseTag) } : {}),
      ...(row.metrics ? { metrics: row.metrics } : {}),
      reviewScore,
      hasHostileFlag,
      ...(row.heartbeatAt ? { heartbeatAt: row.heartbeatAt } : {}),
      createdAt: row.createdAt,
    };
  }

  async findActive(chain: ChainId, q: string | undefined, cursor: string | undefined, ip: string) {
    this.assertLiveTenant(chain);
    await this.ratePublic(ip);
    const page = await this.listings.queryActive(chain, q, cursor);
    const items = (await Promise.all(page.items.map((r) => this.toPublic(r)))).sort(compareFind);
    const inactive = await this.listings.queryInactive(chain, q);
    return { items, cursor: page.nextCursor, inactiveMatchHint: inactive.items.length > 0 };
  }

  async findInactive(chain: ChainId, q: string | undefined, cursor: string | undefined, ip: string) {
    this.assertLiveTenant(chain);
    await this.ratePublic(ip);
    const page = await this.listings.queryInactive(chain, q, cursor);
    const items = (await Promise.all(page.items.map((r) => this.toPublic(r)))).sort(compareFind);
    return { items, cursor: page.nextCursor };
  }

  async getOne(chain: ChainId, poolId: string, ip: string): Promise<ListingPublic> {
    this.assertLiveTenant(chain);
    await this.ratePublic(ip);
    const row = await this.listings.get(poolId);
    if (!row || row.chain !== chain) {
      throw new RegistryProblem(404, 'notFound', 'Listing was not found');
    }
    return this.toPublic(row);
  }

  async stakePreview(chain: ChainId, wallet: string, ip: string): Promise<StakePreviewResult> {
    this.assertLiveTenant(chain);
    await this.ratePublic(ip);
    assertP2wpkh(wallet, chain);
    const { preview } = await this.computeStake(chain, wallet);
    return preview;
  }

  async register(chain: ChainId, env: SigningEnvelope, body: RegisterBody, ip: string) {
    this.assertLiveTenant(chain);
    this.assertCommandSize(body);
    assertEnvelope(env, chain, 'registerListing', body);
    await this.gateWrite(chain, env, ip);
    assertListingNameAllowed(body.name);
    assertWebsiteUrl(body.websiteUrl);
    const connect = assertListingConnect(body.connect);
    const createdAt = new Date().toISOString();
    const { check } = await this.computeStake(chain, env.wallet, env.signingBlockHeight, env.signingBlockHash);
    if (check.kind === 'openSeason' && !check.metMinBalance) {
      throw new RegistryProblem(401, 'stakeInsufficient', 'Stake is insufficient');
    }
    if (check.kind === 'seasoned' && (!check.metMinBalance || !check.holdOk)) {
      throw new RegistryProblem(401, 'stakeInsufficient', 'Stake is insufficient');
    }
    const poolId = ulid();
    const row: ListingRecord = {
      poolId,
      chain,
      operatorWallet: env.wallet,
      name: body.name.trim(),
      nameNormalized: normalizeName(body.name),
      ...(body.websiteUrl ? { websiteUrl: body.websiteUrl } : {}),
      ...(body.distributionAlgo ? { distributionAlgo: body.distributionAlgo } : {}),
      ...(body.templateWriteup ? { templateWriteup: body.templateWriteup } : {}),
      ...(body.feeText ? { feeText: body.feeText } : {}),
      connect,
      lastAttributedBlockAt: createdAt,
      createdAt,
      stakeCheck: check,
      registrationEnvelope: env,
    };
    await this.listings.put(row);
    return { poolId };
  }

  async update(chain: ChainId, poolId: string, env: SigningEnvelope, body: UpdateBody, ip: string) {
    this.assertLiveTenant(chain);
    this.assertCommandSize(body);
    assertEnvelope(env, chain, 'updateListing', body);
    await this.gateWrite(chain, env, ip);
    const row = await this.requireOperator(chain, poolId, env.wallet);
    assertListingNameAllowed(body.name);
    assertWebsiteUrl(body.websiteUrl);
    const connect = assertListingConnect(body.connect);
    const next: ListingRecord = {
      ...row,
      name: body.name.trim(),
      nameNormalized: normalizeName(body.name),
      websiteUrl: body.websiteUrl,
      distributionAlgo: body.distributionAlgo,
      templateWriteup: body.templateWriteup,
      feeText: body.feeText,
      connect,
    };
    if (!body.websiteUrl) {
      delete next.websiteUrl;
    }
    await this.listings.put(next);
    return this.toPublic(next);
  }

  async heartbeat(chain: ChainId, poolId: string, env: SigningEnvelope, body: { commandKind: 'heartbeatListing'; poolId: string }, ip: string) {
    this.assertLiveTenant(chain);
    assertEnvelope(env, chain, 'heartbeatListing', body);
    await this.gateWrite(chain, env, ip);
    if (body.poolId !== poolId) {
      throw new RegistryProblem(400, 'unknownField', 'poolId does not match');
    }
    const row = await this.requireOperator(chain, poolId, env.wallet);
    row.heartbeatAt = new Date().toISOString();
    await this.listings.put(row);
  }

  async deregister(chain: ChainId, poolId: string, env: SigningEnvelope, body: { commandKind: 'deregisterListing'; poolId: string }, ip: string) {
    this.assertLiveTenant(chain);
    assertEnvelope(env, chain, 'deregisterListing', body);
    await this.gateWrite(chain, env, ip);
    if (body.poolId !== poolId) {
      throw new RegistryProblem(400, 'unknownField', 'poolId does not match');
    }
    await this.requireOperator(chain, poolId, env.wallet);
    await this.listings.delete(poolId);
  }

  async postReview(
    chain: ChainId,
    poolId: string,
    env: SigningEnvelope,
    body: { commandKind: 'postReview'; starRating: number; text: string },
    ip: string,
  ) {
    this.assertLiveTenant(chain);
    assertEnvelope(env, chain, 'postReview', body);
    await this.gateWrite(chain, env, ip);
    const listing = await this.listings.get(poolId);
    if (!listing || listing.chain !== chain) {
      throw new RegistryProblem(404, 'notFound', 'Listing was not found');
    }
    if (body.starRating < 0 || body.starRating > 5 || !Number.isInteger(body.starRating)) {
      throw new RegistryProblem(400, 'unknownField', 'starRating must be 0 through 5');
    }
    const { assertReviewTextAllowed } = await import('../domain/text');
    assertReviewTextAllowed(body.text);
    const existing = await this.reviews.get(env.wallet, poolId);
    if (existing) {
      throw new RegistryProblem(409, 'duplicateReview', 'This wallet already reviewed this pool');
    }
    await this.reviews.put({
      reviewerWallet: env.wallet,
      poolId,
      chain,
      starRating: body.starRating,
      text: body.text,
      createdAt: new Date().toISOString(),
    });
  }

  async postRebuttal(
    chain: ChainId,
    poolId: string,
    reviewerWallet: string,
    env: SigningEnvelope,
    body: { commandKind: 'postRebuttal'; text: string },
    ip: string,
  ) {
    this.assertLiveTenant(chain);
    assertEnvelope(env, chain, 'postRebuttal', body);
    await this.gateWrite(chain, env, ip);
    await this.requireOperator(chain, poolId, env.wallet);
    const { assertReviewTextAllowed } = await import('../domain/text');
    assertReviewTextAllowed(body.text);
    const review = await this.reviews.get(reviewerWallet, poolId);
    if (!review) {
      throw new RegistryProblem(404, 'notFound', 'Review was not found');
    }
    if (review.rebuttal) {
      throw new RegistryProblem(409, 'duplicateReview', 'A rebuttal already exists');
    }
    review.rebuttal = { text: body.text, envelope: env };
    await this.reviews.put(review);
  }

  private assertCommandSize(body: unknown): void {
    if (Buffer.byteLength(jcs(body), 'utf8') > CommandBodyCapBytes) {
      throw new RegistryProblem(400, 'unknownField', 'Command is too large');
    }
  }

  private async requireOperator(chain: ChainId, poolId: string, wallet: string): Promise<ListingRecord> {
    const row = await this.listings.get(poolId);
    if (!row || row.chain !== chain) {
      throw new RegistryProblem(404, 'notFound', 'Listing was not found');
    }
    if (row.operatorWallet !== wallet) {
      throw new RegistryProblem(401, 'notOperator', 'Wallet does not operate this listing');
    }
    return row;
  }

  private async gateWrite(chain: ChainId, env: SigningEnvelope, ip: string): Promise<void> {
    const hash = sha256Hex(jcs(env));
    if (await this.envelopes.seen(hash)) {
      throw new RegistryProblem(409, 'duplicateEnvelope', 'Envelope was already used');
    }
    const cached = await this.stakeCache.get(chain, env.wallet);
    if (!cached) {
      const un = await this.unstaked.hitUnstakedWrite(ip, env.wallet);
      if (!un.allowed) {
        throw new RegistryProblem(429, 'rateLimited', 'Too many requests', String(un.retryAfterSeconds));
      }
    } else {
      const st = await this.staked.hitStakedWrite(env.wallet);
      if (!st.allowed) {
        throw new RegistryProblem(429, 'rateLimited', 'Too many requests', String(st.retryAfterSeconds));
      }
    }
    const { preview } = await this.computeStake(chain, env.wallet, env.signingBlockHeight, env.signingBlockHash);
    if (preview.kind === 'stakeInsufficient') {
      throw new RegistryProblem(401, 'stakeInsufficient', 'Stake is insufficient');
    }
    if (preview.kind === 'stakeWaiting') {
      throw new RegistryProblem(401, 'stakeInsufficient', 'Stake hold is not complete');
    }
    await this.unstaked.clearUnstaked(ip, env.wallet);
    await this.envelopes.remember(hash);
  }

  async computeStake(
    chain: ChainId,
    wallet: string,
    signingHeight?: number,
    signingHash?: string,
  ): Promise<{ preview: StakePreviewResult; check: ReturnType<typeof evaluateStake>['check'] }> {
    const tip = await this.chain.getTip(chain);
    const spacing = await this.chain.lastRetargetMedianSpacingSeconds(chain);
    const window = tipWindow({ height: tip.height, lastRetargetMedianSpacingSeconds: spacing });
    const height = signingHeight ?? tip.height;
    const hash = signingHash ?? tip.hash;
    assertTipWindow(height, tip.height, window);
    const header = await this.chain.getBlockHeader(chain, hash);
    if (!header || header.height !== height) {
      throw new RegistryProblem(400, 'tipWindow', 'Signing block was not found');
    }
    const required = stakeRequiredSats(header.nBits, tip.subsidySats);
    const cached = await this.stakeCache.get(chain, wallet);
    let balance = cached?.balanceSats ? BigInt(cached.balanceSats) : await this.chain.getBalance(chain, wallet);
    let holdOk = cached?.holdOk ?? true;
    const from = cached ? cached.asOfHeight + 1 : Math.max(0, height - DifficultyPeriodBlocks);
    if (!cached || tip.height > cached.asOfHeight) {
      const txs = await this.chain.iterWalletTx(chain, wallet, from, height);
      if (txs.length) {
        balance = txs[txs.length - 1].balanceAfterSats;
        holdOk = txs.every((t) => t.balanceAfterSats >= required);
      } else if (!cached) {
        holdOk = balance >= required;
      }
      await this.stakeCache.put({
        chain,
        wallet,
        asOfHeight: height,
        balanceSats: balance.toString(),
        holdOk,
        stakeRequiredSats: required.toString(),
      });
    }
    const liveCount = await this.listings.countLive(chain);
    return evaluateStake({ liveCount, balanceSats: balance, requiredSats: required, holdOk });
  }

  async hideExpired(chain: ChainId, now = Date.now()): Promise<void> {
    const rows = await this.listings.listAll(chain);
    for (const row of rows) {
      const attr = row.coinbaseTag ? Date.parse(row.lastAttributedBlockAt ?? row.createdAt) : Date.parse(row.createdAt);
      const age = now - attr;
      if (row.lastAttributedBlockAt && !row.hiddenAt && age >= HiddenAfterMs) {
        const next = { ...row, hiddenAt: new Date(now).toISOString() };
        delete next.lastAttributedBlockAt;
        await this.listings.put(next);
      }
      if (age >= DifficultyPeriodBlocks * TargetSpacingSeconds * 1000) {
        await this.listings.delete(row.poolId);
      }
    }
  }
}

export type { CommandKind };
