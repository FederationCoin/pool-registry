import Redis from 'ioredis';
import type { ChainId } from '../../domain/constants';
import type { ListingTrustRow, StakeCacheRow } from '../../domain/types';
import type { StakeCache } from '../../ports/stake-cache';
import type { TrustCache } from '../../ports/trust-cache';
import type {
  EnvelopeLog,
  PublicReadRateLimiter,
  RateLimitResult,
  StakedWriteRateLimiter,
  UnstakedWriteRateLimiter,
} from '../../ports/rate-limit';
import { DifficultyPeriodBlocks, TargetSpacingSeconds } from '../../domain/constants';

export class RedisRateAdapters
  implements
    PublicReadRateLimiter,
    UnstakedWriteRateLimiter,
    StakedWriteRateLimiter,
    EnvelopeLog,
    StakeCache,
    TrustCache
{
  constructor(private readonly redis: Redis) {}

  private async hit(key: string, limit: number, ttlSec: number): Promise<RateLimitResult> {
    const n = await this.redis.incr(key);
    if (n === 1) {
      await this.redis.expire(key, ttlSec);
    }
    const ttl = await this.redis.ttl(key);
    if (n > limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, ttl) };
    }
    return { allowed: true, retryAfterSeconds: Math.max(1, ttl) };
  }

  async hitPublicRead(ip: string): Promise<RateLimitResult> {
    return this.hit(`rl:pub:${ip}`, 60, 60);
  }

  async hitUnstakedWrite(ip: string, wallet: string): Promise<RateLimitResult> {
    return this.hit(`rl:un:${ip}:${wallet}`, 3, 600);
  }

  async clearUnstaked(ip: string, wallet: string): Promise<void> {
    await this.redis.del(`rl:un:${ip}:${wallet}`);
  }

  async hitStakedWrite(wallet: string): Promise<RateLimitResult> {
    return this.hit(`rl:st:${wallet}`, 6, 60);
  }

  async seen(hashHex: string): Promise<boolean> {
    return (await this.redis.exists(`env:${hashHex}`)) === 1;
  }

  async remember(hashHex: string): Promise<void> {
    await this.redis.set(`env:${hashHex}`, '1', 'EX', DifficultyPeriodBlocks * TargetSpacingSeconds);
  }

  async get(chain: ChainId, wallet: string): Promise<StakeCacheRow | undefined> {
    const raw = await this.redis.get(`st:${chain}:${wallet}`);
    return raw ? (JSON.parse(raw) as StakeCacheRow) : undefined;
  }

  async put(row: StakeCacheRow): Promise<void> {
    const key = `st:${row.chain}:${row.wallet}`;
    const prevRaw = await this.redis.get(key);
    if (prevRaw) {
      const prev = JSON.parse(prevRaw) as StakeCacheRow;
      if (prev.asOfHeight > row.asOfHeight) {
        return;
      }
      if (prev.asOfHeight === row.asOfHeight && prevRaw !== JSON.stringify(row)) {
        return;
      }
    }
    await this.redis.set(key, JSON.stringify(row), 'EX', DifficultyPeriodBlocks * TargetSpacingSeconds);
  }

  async getTrust(chain: ChainId, poolId: string): Promise<ListingTrustRow | undefined> {
    const raw = await this.redis.get(`tr:${chain}:${poolId}`);
    return raw ? (JSON.parse(raw) as ListingTrustRow) : undefined;
  }

  async putTrust(row: ListingTrustRow): Promise<void> {
    await this.redis.set(
      `tr:${row.chain}:${row.poolId}`,
      JSON.stringify(row),
      'EX',
      DifficultyPeriodBlocks * TargetSpacingSeconds,
    );
  }
}
