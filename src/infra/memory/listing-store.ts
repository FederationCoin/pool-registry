import { FindPageSize, HiddenAfterMs, type ChainId } from '../../domain/constants';
import { decodeCursor, encodeCursor } from '../../domain/rank';
import { isLiveAt } from '../../domain/stake';
import { normalizeName } from '../../domain/text';
import type { ListingRecord } from '../../domain/types';
import type { ListingQueryPage, ListingStore } from '../../ports/listing-store';

function matchesQ(row: ListingRecord, q?: string): boolean {
  if (!q) {
    return true;
  }
  const needle = q.toLowerCase();
  return (
    row.name.toLowerCase().includes(needle) ||
    row.poolId.toLowerCase().includes(needle) ||
    (row.coinbaseTag ?? '').toLowerCase().includes(needle)
  );
}

export class MemoryListingStore implements ListingStore {
  private readonly rows = new Map<string, ListingRecord>();

  async put(row: ListingRecord): Promise<void> {
    this.rows.set(row.poolId, { ...row, nameNormalized: normalizeName(row.name) });
  }

  async get(poolId: string): Promise<ListingRecord | undefined> {
    const row = this.rows.get(poolId);
    return row ? { ...row } : undefined;
  }

  async getByOperator(chain: ChainId, wallet: string): Promise<ListingRecord | undefined> {
    const row = [...this.rows.values()].find((r) => r.chain === chain && r.operatorWallet === wallet);
    return row ? { ...row } : undefined;
  }

  async delete(poolId: string): Promise<void> {
    this.rows.delete(poolId);
  }

  private filtered(chain: ChainId, live: boolean, q?: string): ListingRecord[] {
    const now = Date.now();
    return [...this.rows.values()]
      .filter((r) => r.chain === chain)
      .filter((r) => isLiveAt(r.createdAt, r.lastAttributedBlockAt, now) === live)
      .filter((r) => matchesQ(r, q))
      .sort((a, b) => a.poolId.localeCompare(b.poolId));
  }

  async queryActive(chain: ChainId, q?: string, cursor?: string): Promise<ListingQueryPage> {
    return this.page(this.filtered(chain, true, q), cursor);
  }

  async queryInactive(chain: ChainId, q?: string, cursor?: string): Promise<ListingQueryPage> {
    return this.page(this.filtered(chain, false, q), cursor);
  }

  async countLive(chain: ChainId): Promise<number> {
    return this.filtered(chain, true).length;
  }

  async listAll(chain: ChainId): Promise<ListingRecord[]> {
    return [...this.rows.values()].filter((r) => r.chain === chain).map((r) => ({ ...r }));
  }

  private page(items: ListingRecord[], cursor?: string): ListingQueryPage {
    const decoded = decodeCursor(cursor);
    const after = typeof decoded?.poolId === 'string' ? decoded.poolId : '';
    const sliced = after ? items.filter((r) => r.poolId > after) : items;
    const page = sliced.slice(0, FindPageSize);
    const next =
      sliced.length > FindPageSize ? encodeCursor({ poolId: page[page.length - 1].poolId }) : undefined;
    return { items: page.map((r) => ({ ...r })), nextCursor: next };
  }

  hiddenCutoff(): number {
    return Date.now() - HiddenAfterMs;
  }
}
