import type { AttestationRecord } from '../../domain/types';
import type { AttestationStore } from '../../ports/attestation-store';

export class MemoryAttestationStore implements AttestationStore {
  private readonly rows = new Map<string, AttestationRecord>();

  private key(attesterWallet: string, poolId: string): string {
    return `${attesterWallet}\0${poolId}`;
  }

  async put(row: AttestationRecord): Promise<void> {
    this.rows.set(this.key(row.attesterWallet, row.poolId), row);
  }

  async get(attesterWallet: string, poolId: string): Promise<AttestationRecord | undefined> {
    return this.rows.get(this.key(attesterWallet, poolId));
  }

  async listByPool(poolId: string): Promise<AttestationRecord[]> {
    return [...this.rows.values()].filter((row) => row.poolId === poolId);
  }
}
