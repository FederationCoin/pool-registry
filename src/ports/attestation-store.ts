import type { AttestationRecord } from '../domain/types';

export interface AttestationStore {
  put(row: AttestationRecord): Promise<void>;
  get(attesterWallet: string, poolId: string): Promise<AttestationRecord | undefined>;
  listByPool(poolId: string): Promise<AttestationRecord[]>;
}
