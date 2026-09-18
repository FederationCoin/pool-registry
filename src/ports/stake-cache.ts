import type { ChainId } from '../domain/constants';
import type { StakeCacheRow } from '../domain/types';

export interface StakeCache {
  get(chain: ChainId, wallet: string): Promise<StakeCacheRow | undefined>;
  put(row: StakeCacheRow): Promise<void>;
}
