import type { ChainId } from '../domain/constants';
import type { ListingRecord } from '../domain/types';

export type ListingQueryPage = {
  items: ListingRecord[];
  nextCursor?: string;
};

export interface ListingStore {
  put(row: ListingRecord): Promise<void>;
  get(poolId: string): Promise<ListingRecord | undefined>;
  delete(poolId: string): Promise<void>;
  queryActive(chain: ChainId, q?: string, cursor?: string): Promise<ListingQueryPage>;
  queryInactive(chain: ChainId, q?: string, cursor?: string): Promise<ListingQueryPage>;
  countLive(chain: ChainId): Promise<number>;
  listAll(chain: ChainId): Promise<ListingRecord[]>;
}
