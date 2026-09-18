import type { ChainId } from '../../domain/constants';
import type { StakeCacheRow } from '../../domain/types';
import type { StakeCache } from '../../ports/stake-cache';
import type {
  EnvelopeLog,
  PublicReadRateLimiter,
  RateLimitResult,
  StakedWriteRateLimiter,
  UnstakedWriteRateLimiter,
} from '../../ports/rate-limit';

type Counter = { n: number; resetAt: number };

export class MemoryRateAdapters
  implements PublicReadRateLimiter, UnstakedWriteRateLimiter, StakedWriteRateLimiter, EnvelopeLog, StakeCache
{
  private readonly counters = new Map<string, Counter>();
  private readonly envelopes = new Set<string>();
  private readonly stake = new Map<string, StakeCacheRow>();

  private hit(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const cur = this.counters.get(key);
    if (!cur || now >= cur.resetAt) {
      this.counters.set(key, { n: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
    }
    if (cur.n >= limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
    }
    cur.n += 1;
    return { allowed: true, retryAfterSeconds: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
  }

  async hitPublicRead(ip: string): Promise<RateLimitResult> {
    return this.hit(`pub:${ip}`, 60, 60_000);
  }

  async hitUnstakedWrite(ip: string, wallet: string): Promise<RateLimitResult> {
    return this.hit(`un:${ip}:${wallet}`, 3, 10 * 60_000);
  }

  async clearUnstaked(ip: string, wallet: string): Promise<void> {
    this.counters.delete(`un:${ip}:${wallet}`);
  }

  async hitStakedWrite(wallet: string): Promise<RateLimitResult> {
    return this.hit(`st:${wallet}`, 6, 60_000);
  }

  async seen(hashHex: string): Promise<boolean> {
    return this.envelopes.has(hashHex);
  }

  async remember(hashHex: string): Promise<void> {
    this.envelopes.add(hashHex);
  }

  async get(chain: ChainId, wallet: string): Promise<StakeCacheRow | undefined> {
    return this.stake.get(`${chain}:${wallet}`);
  }

  async put(row: StakeCacheRow): Promise<void> {
    const key = `${row.chain}:${row.wallet}`;
    const prev = this.stake.get(key);
    if (prev && prev.asOfHeight > row.asOfHeight) {
      return;
    }
    if (prev && prev.asOfHeight === row.asOfHeight && JSON.stringify(prev) !== JSON.stringify(row)) {
      return;
    }
    this.stake.set(key, { ...row });
  }
}
