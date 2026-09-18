import { hasDatum } from './host';
import type { ListingConnect, ListingPublic } from './types';

function datumRank(connect: ListingConnect): number {
  return hasDatum(connect) ? 0 : 1;
}

function volatilityKey(v: number | undefined): number {
  return v === undefined ? Number.POSITIVE_INFINITY : v;
}

export function compareFind(a: ListingPublic, b: ListingPublic): number {
  const d = datumRank(a.connect) - datumRank(b.connect);
  if (d !== 0) {
    return d;
  }
  if (b.reviewScore !== a.reviewScore) {
    return b.reviewScore - a.reviewScore;
  }
  const va = volatilityKey(a.metrics?.volatility);
  const vb = volatilityKey(b.metrics?.volatility);
  if (va !== vb) {
    return va - vb;
  }
  const ha = a.metrics?.hashrate ?? 0;
  const hb = b.metrics?.hashrate ?? 0;
  if (ha !== hb) {
    return ha - hb;
  }
  if (a.hasHostileFlag !== b.hasHostileFlag) {
    return a.hasHostileFlag ? 1 : -1;
  }
  return a.poolId.localeCompare(b.poolId);
}

export function encodeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  if (!cursor) {
    return undefined;
  }
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const v = JSON.parse(json) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      return undefined;
    }
    return v as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
