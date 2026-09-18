import type { ReviewRecord } from '../../domain/types';
import type { ReviewStore } from '../../ports/review-store';

export class MemoryReviewStore implements ReviewStore {
  private readonly rows = new Map<string, ReviewRecord>();

  private key(reviewerWallet: string, poolId: string): string {
    return `${reviewerWallet}\0${poolId}`;
  }

  async put(row: ReviewRecord): Promise<void> {
    this.rows.set(this.key(row.reviewerWallet, row.poolId), { ...row });
  }

  async get(reviewerWallet: string, poolId: string): Promise<ReviewRecord | undefined> {
    const row = this.rows.get(this.key(reviewerWallet, poolId));
    return row ? { ...row } : undefined;
  }

  async listByPool(poolId: string): Promise<ReviewRecord[]> {
    return [...this.rows.values()].filter((r) => r.poolId === poolId).map((r) => ({ ...r }));
  }
}
