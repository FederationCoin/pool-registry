import { describe, expect, it } from 'vitest';
import { compareFind, decodeCursor, encodeCursor, groupFind } from './rank';
import type { ListingPublic } from './types';

function listing(partial: Partial<ListingPublic> & Pick<ListingPublic, 'poolId' | 'connections'>): ListingPublic {
  return {
    chain: 'testnet',
    operatorWallet: 'tgfcn1qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    name: 'n',
    websiteUrl: 'https://example.com',
    listingDomain: 'example.com',
    coinbaseTag: '/n/',
    attestationCount: 0,
    listerConfirmedCoinbasePayee: false,
    reviewScore: 0,
    hasHostileFlag: false,
    ...partial,
  };
}

describe('rank', () => {
  it('orders DATUM before Stratum-only, then score, volatility, hashrate, hostile last', () => {
    const a = listing({
      poolId: 'a',
      connections: [{ kind: 'stratum', url: 'a.example:1' }],
      reviewScore: 5,
    });
    const b = listing({
      poolId: 'b',
      connections: [{ kind: 'datumPrime', url: 'b.example:1' }],
      reviewScore: 0,
    });
    expect(compareFind(b, a)).toBeLessThan(0);
    const c = listing({
      poolId: 'c',
      connections: [{ kind: 'datumPrime', url: 'c.example:1' }],
      reviewScore: 5,
      hasHostileFlag: true,
    });
    const d = listing({
      poolId: 'd',
      connections: [{ kind: 'datumPrime', url: 'd.example:1' }],
      reviewScore: 5,
      hasHostileFlag: false,
    });
    const e = listing({
      poolId: 'e',
      connections: [{ kind: 'datumPrime', url: 'e.example:1' }],
      reviewScore: 5,
      metrics: { hashrate: 10, volatility: 0.2 },
    });
    const f = listing({
      poolId: 'f',
      connections: [{ kind: 'datumPrime', url: 'f.example:1' }],
      reviewScore: 5,
      metrics: { hashrate: 1, volatility: 0.1 },
    });
    expect(compareFind(f, e)).toBeLessThan(0);
  });

  it('ranks by attestation count then groups by listing domain', () => {
    const a = listing({
      poolId: 'a',
      listingDomain: 'a.com',
      connections: [{ kind: 'datumPrime', url: 'a.example:1' }],
      attestationCount: 0,
    });
    const b = listing({
      poolId: 'b',
      listingDomain: 'a.com',
      connections: [{ kind: 'datumPrime', url: 'b.example:1' }],
      attestationCount: 3,
    });
    const c = listing({
      poolId: 'c',
      listingDomain: 'c.com',
      connections: [{ kind: 'datumPrime', url: 'c.example:1' }],
      attestationCount: 1,
    });
    expect(compareFind(b, a)).toBeLessThan(0);
    const groups = groupFind([a, b, c]);
    expect(groups[0].domain).toBe('a.com');
    expect(groups[0].multipleClaims).toBe(true);
    expect(groups[0].listings[0].poolId).toBe('b');
    expect(groups[1].domain).toBe('c.com');
    expect(groups[1].multipleClaims).toBe(false);
  });

  it('round-trips an opaque cursor', () => {
    const c = encodeCursor({ poolId: '01' });
    expect(c).not.toMatch(/LastEvaluatedKey/);
    expect(decodeCursor(c)?.poolId).toBe('01');
    expect(decodeCursor('%%%')).toBeUndefined();
  });
});
