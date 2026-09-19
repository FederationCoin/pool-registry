import type { ChainId } from '../domain/constants';
import type { ListingTrustRow } from '../domain/types';

export interface TrustCache {
  getTrust(chain: ChainId, poolId: string): Promise<ListingTrustRow | undefined>;
  putTrust(row: ListingTrustRow): Promise<void>;
  bustTrust(chain: ChainId, poolId: string): Promise<void>;
}
