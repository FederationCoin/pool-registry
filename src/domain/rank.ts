import { hasDatum } from './host';
import type { FindGroup, ListingPublic } from './types';

function datumRank(connections: ListingPublic['connections']): number {
  return hasDatum(connections) ? 0 : 1;
}

function volatilityKey(v: number | undefined): number {
  return v === undefined ? Number.POSITIVE_INFINITY : v;
}

export function compareFind(a: ListingPublic, b: ListingPublic): number {
  const d = datumRank(a.connections) - datumRank(b.connections);
  if (d !== 0) {
    return d;
  }
  if (b.attestationCount !== a.attestationCount) {
    return b.attestationCount - a.attestationCount;
  }
  if (a.listerConfirmedCoinbasePayee !== b.listerConfirmedCoinbasePayee) {
    return a.listerConfirmedCoinbasePayee ? -1 : 1;
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

export function groupFind(items: ListingPublic[]): FindGroup[] {
  const map = new Map<string, ListingPublic[]>();
  for (const item of items) {
    const cur = map.get(item.listingDomain) ?? [];
    cur.push(item);
    map.set(item.listingDomain, cur);
  }
  const groups: FindGroup[] = [];
  for (const [domain, listings] of map) {
    listings.sort(compareFind);
    groups.push({
      domain,
      listings,
      multipleClaims: listings.length > 1,
    });
  }
  groups.sort((a, b) => {
    const ac = Math.max(0, ...a.listings.map((l) => l.attestationCount));
    const bc = Math.max(0, ...b.listings.map((l) => l.attestationCount));
    if (bc !== ac) {
      return bc - ac;
    }
    return a.domain.localeCompare(b.domain);
  });
  return groups;
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
