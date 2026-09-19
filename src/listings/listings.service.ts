import { Inject, Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import {
  CommandBodyCapBytes,
  DifficultyPeriodBlocks,
  FindPageSize,
  HiddenAfterMs,
  LiveTenants,
  TargetSpacingSeconds,
  TokenAttestationStore,
  TokenChainView,
  TokenEnvelopeLog,
  TokenListingStore,
  TokenPublicReadLimiter,
  TokenReviewStore,
  TokenStakeCache,
  TokenStakedWriteLimiter,
  TokenTrustCache,
  TokenUnstakedWriteLimiter,
  type ChainId,
} from '../domain/constants';
import { assertEnvelope } from '../domain/envelope';
import { assertAttestConnect, assertBrandAndConnect, assertListingConnect, assertWebsiteUrl, attestConnectMatchesListing } from '../domain/host';
import { assertP2wpkh } from '../domain/wallet';
import { compareFind, decodeCursor, encodeCursor, groupFind } from '../domain/rank';
import { assertTipWindow, evaluateStake, isLiveAt, stakeMineSeconds, stakeRequiredSats, tipWindow } from '../domain/stake';
import { assertCoinbaseTag, assertListingNameAllowed, censorTagForDisplay, coinbaseHasDeclaredTag, normalizeName } from '../domain/text';
import { jcs, sha256Hex } from '../domain/jcs';
import {
  RegistryProblem,
  type AttestConnect,
  type CommandKind,
  type FindGroup,
  type ListingConnect,
  type ListingPublic,
  type ListingRecord,
  type ListingTrustRow,
  type SigningEnvelope,
  type StakePreviewResult,
} from '../domain/types';
import type { AttestationStore } from '../ports/attestation-store';
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
import type { TrustCache } from '../ports/trust-cache';

export type RegisterBody = {
  commandKind: 'registerListing';
  name: string;
  websiteUrl: string;
  coinbaseTag: string;
  distributionAlgo?: string;
  templateWriteup?: string;
  feeText?: string;
  connect: ListingConnect;
};

export type UpdateBody = {
  commandKind: 'updateListing';
  name: string;
  websiteUrl: string;
  coinbaseTag: string;
  distributionAlgo?: string;
  templateWriteup?: string;
  feeText?: string;
  connect: ListingConnect;
};

export type AttestBody = {
  commandKind: 'attestListing';
  poolId: string;
  height: number;
  connect: AttestConnect;
};

@Injectable()
export class ListingsService {
  constructor(
    @Inject(TokenListingStore) private readonly listings: ListingStore,
    @Inject(TokenReviewStore) private readonly reviews: ReviewStore,
    @Inject(TokenAttestationStore) private readonly attestations: AttestationStore,
    @Inject(TokenStakeCache) private readonly stakeCache: StakeCache,
    @Inject(TokenPublicReadLimiter) private readonly publicLimit: PublicReadRateLimiter,
    @Inject(TokenUnstakedWriteLimiter) private readonly unstaked: UnstakedWriteRateLimiter,
    @Inject(TokenStakedWriteLimiter) private readonly staked: StakedWriteRateLimiter,
    @Inject(TokenEnvelopeLog) private readonly envelopes: EnvelopeLog,
    @Inject(TokenTrustCache) private readonly trust: TrustCache,
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

  async refreshTrust(row: ListingRecord): Promise<ListingTrustRow> {
    const tip = await this.chain.getTip(row.chain);
    const from = Math.max(0, tip.height - DifficultyPeriodBlocks + 1);
    const window = await this.chain.inspectCoinbaseWindow(row.chain, from, tip.height);
    const listerConfirmedCoinbasePayee = window.some(
      (cb) => coinbaseHasDeclaredTag(cb.tag, row.coinbaseTag) && cb.addresses.includes(row.operatorWallet),
    );
    const attestationCount = (await this.attestations.listByPool(row.poolId)).filter((a) =>
      attestConnectMatchesListing(a.connect, row.connect),
    ).length;
    const next: ListingTrustRow = {
      chain: row.chain,
      poolId: row.poolId,
      asOfHeight: tip.height,
      attestationCount,
      listerConfirmedCoinbasePayee,
    };
    await this.trust.putTrust(next);
    return next;
  }

  async toPublic(row: ListingRecord): Promise<ListingPublic> {
    const revs = await this.reviews.listByPool(row.poolId);
    const scores = revs.map((r) => r.starRating);
    const reviewScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const hasHostileFlag = revs.some((r) => r.rebuttal?.hostileFlag && !r.rebuttal.hostileFlag.withdrawnAt);
    const tip = await this.chain.getTip(row.chain);
    let trust = await this.trust.getTrust(row.chain, row.poolId);
    if (!trust || trust.asOfHeight !== tip.height) {
      trust = await this.refreshTrust(row);
    }
    return {
      poolId: row.poolId,
      chain: row.chain,
      operatorWallet: row.operatorWallet,
      name: row.name,
      websiteUrl: row.websiteUrl,
      ...(row.distributionAlgo ? { distributionAlgo: row.distributionAlgo } : {}),
      ...(row.templateWriteup ? { templateWriteup: row.templateWriteup } : {}),
      ...(row.feeText ? { feeText: row.feeText } : {}),
      connect: row.connect,
      coinbaseTag: censorTagForDisplay(row.coinbaseTag),
      listingDomain: row.listingDomain,
      attestationCount: trust.attestationCount,
      listerConfirmedCoinbasePayee: trust.listerConfirmedCoinbasePayee,
      ...(row.metrics ? { metrics: row.metrics } : {}),
      reviewScore,
      hasHostileFlag,
      ...(row.heartbeatAt ? { heartbeatAt: row.heartbeatAt } : {}),
      createdAt: row.createdAt,
    };
  }

  private pageGroups(groups: FindGroup[], cursor: string | undefined) {
    const decoded = decodeCursor(cursor);
    const start = typeof decoded?.i === 'number' ? decoded.i : 0;
    const page = groups.slice(start, start + FindPageSize);
    const next = start + FindPageSize < groups.length ? encodeCursor({ i: start + FindPageSize }) : undefined;
    return { groups: page, items: page.flatMap((g) => g.listings), cursor: next };
  }

  async findActive(chain: ChainId, q: string | undefined, cursor: string | undefined, ip: string) {
    this.assertLiveTenant(chain);
    await this.ratePublic(ip);
    const now = Date.now();
    let rows = (await this.listings.listAll(chain)).filter(
      (r) => !r.hiddenAt && isLiveAt(r.createdAt, r.lastAttributedBlockAt, now),
    );
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(needle) ||
          r.poolId.toLowerCase().includes(needle) ||
          r.coinbaseTag.toLowerCase().includes(needle),
      );
    }
    const items = (await Promise.all(rows.map((r) => this.toPublic(r)))).sort(compareFind);
    const paged = this.pageGroups(groupFind(items), cursor);
    const inactive = await this.listings.queryInactive(chain, q);
    return { ...paged, inactiveMatchHint: inactive.items.length > 0 };
  }

  async findInactive(chain: ChainId, q: string | undefined, cursor: string | undefined, ip: string) {
    this.assertLiveTenant(chain);
    await this.ratePublic(ip);
    const now = Date.now();
    let rows = (await this.listings.listAll(chain)).filter(
      (r) => !!r.hiddenAt || !isLiveAt(r.createdAt, r.lastAttributedBlockAt, now),
    );
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(needle) ||
          r.poolId.toLowerCase().includes(needle) ||
          r.coinbaseTag.toLowerCase().includes(needle),
      );
    }
    const items = (await Promise.all(rows.map((r) => this.toPublic(r)))).sort(compareFind);
    return this.pageGroups(groupFind(items), cursor);
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

  async signContext(chain: ChainId, ip: string) {
    this.assertLiveTenant(chain);
    await this.ratePublic(ip);
    const tip = await this.chain.getTip(chain);
    const mineSeconds = stakeMineSeconds(chain);
    const required = stakeRequiredSats(tip.nBits, tip.subsidySats, mineSeconds);
    return {
      signingBlockHeight: tip.height,
      signingBlockHash: tip.hash,
      stakeRequiredSats: required.toString(),
      mineSeconds,
    };
  }

  private prepareListingFields(body: RegisterBody | UpdateBody) {
    assertListingNameAllowed(body.name);
    const websiteUrl = assertWebsiteUrl(body.websiteUrl);
    const connect = assertListingConnect(body.connect);
    const listingDomain = assertBrandAndConnect(websiteUrl, connect);
    const coinbaseTag = assertCoinbaseTag(body.coinbaseTag);
    return { websiteUrl, connect, listingDomain, coinbaseTag };
  }

  async register(chain: ChainId, env: SigningEnvelope, body: RegisterBody, ip: string) {
    this.assertLiveTenant(chain);
    this.assertCommandSize(body);
    assertEnvelope(env, chain, 'registerListing', body);
    const fields = this.prepareListingFields(body);
    await this.gateWrite(chain, env, ip);
    const existing = await this.listings.getByOperator(chain, env.wallet);
    if (existing) {
      throw new RegistryProblem(409, 'duplicateListing', 'This wallet already has a listing');
    }
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
      websiteUrl: fields.websiteUrl,
      ...(body.distributionAlgo ? { distributionAlgo: body.distributionAlgo } : {}),
      ...(body.templateWriteup ? { templateWriteup: body.templateWriteup } : {}),
      ...(body.feeText ? { feeText: body.feeText } : {}),
      connect: fields.connect,
      coinbaseTag: fields.coinbaseTag,
      listingDomain: fields.listingDomain,
      lastAttributedBlockAt: createdAt,
      createdAt,
      stakeCheck: check,
      registrationEnvelope: env,
    };
    await this.listings.put(row);
    await this.refreshTrust(row);
    return { poolId };
  }

  async update(chain: ChainId, poolId: string, env: SigningEnvelope, body: UpdateBody, ip: string) {
    this.assertLiveTenant(chain);
    this.assertCommandSize(body);
    assertEnvelope(env, chain, 'updateListing', body);
    const fields = this.prepareListingFields(body);
    await this.gateWrite(chain, env, ip);
    const row = await this.requireOperator(chain, poolId, env.wallet);
    const next: ListingRecord = {
      ...row,
      name: body.name.trim(),
      nameNormalized: normalizeName(body.name),
      websiteUrl: fields.websiteUrl,
      distributionAlgo: body.distributionAlgo,
      templateWriteup: body.templateWriteup,
      feeText: body.feeText,
      connect: fields.connect,
      coinbaseTag: fields.coinbaseTag,
      listingDomain: fields.listingDomain,
    };
    await this.listings.put(next);
    await this.trust.bustTrust(chain, poolId);
    await this.refreshTrust(next);
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

  async postRebuttal(chain: ChainId): Promise<never> {
    this.assertLiveTenant(chain);
    throw new RegistryProblem(403, 'rebuttalDisabled', 'Rebuttals are disabled');
  }

  async attestListing(chain: ChainId, poolId: string, env: SigningEnvelope, body: AttestBody, ip: string) {
    this.assertLiveTenant(chain);
    this.assertCommandSize(body);
    assertEnvelope(env, chain, 'attestListing', body);
    await this.gateWrite(chain, env, ip);
    if (body.poolId !== poolId) {
      throw new RegistryProblem(400, 'unknownField', 'poolId does not match');
    }
    if (!Number.isInteger(body.height) || body.height < 0) {
      throw new RegistryProblem(400, 'unknownField', 'height is invalid');
    }
    const listing = await this.listings.get(poolId);
    if (!listing || listing.chain !== chain) {
      throw new RegistryProblem(404, 'notFound', 'Listing was not found');
    }
    const connect = assertAttestConnect(listing.connect, body.connect);
    const tip = await this.chain.getTip(chain);
    const from = Math.max(0, tip.height - DifficultyPeriodBlocks + 1);
    if (body.height < from || body.height > tip.height) {
      throw new RegistryProblem(400, 'attestationUnproven', 'Coinbase height is outside the last difficulty window');
    }
    const cb = await this.chain.inspectCoinbase(chain, body.height);
    if (!coinbaseHasDeclaredTag(cb.tag, listing.coinbaseTag) || !cb.addresses.includes(env.wallet)) {
      throw new RegistryProblem(
        400,
        'attestationUnproven',
        'Coinbase at that height does not show this listing tag paying the attester',
      );
    }
    const existing = await this.attestations.get(env.wallet, poolId);
    if (existing) {
      throw new RegistryProblem(409, 'duplicateAttestation', 'This wallet already attested this listing');
    }
    await this.attestations.put({
      attesterWallet: env.wallet,
      poolId,
      chain,
      height: body.height,
      createdAt: new Date().toISOString(),
      envelope: env,
      connect,
    });
    await this.refreshTrust(listing);
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
      throw new RegistryProblem(401, 'notOperator', 'Wallet does not own this listing');
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
    const required = stakeRequiredSats(header.nBits, tip.subsidySats, stakeMineSeconds(chain));
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
      const attr = Date.parse(row.lastAttributedBlockAt ?? row.createdAt);
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
