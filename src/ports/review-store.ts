import type { ReviewRecord } from '../domain/types';

export interface ReviewStore {
  put(row: ReviewRecord): Promise<void>;
  get(reviewerWallet: string, poolId: string): Promise<ReviewRecord | undefined>;
  listByPool(poolId: string): Promise<ReviewRecord[]>;
}
