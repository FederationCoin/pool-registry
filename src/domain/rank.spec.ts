import { describe, expect, it } from 'vitest';
import { compareFind, decodeCursor, encodeCursor, groupFind } from './rank';
import type { ListingPublic } from './types';

function listing(partial: Partial<ListingPublic> & Pick<ListingPublic, 'poolId' | 'connect'>): ListingPublic {
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
      connect: { kind: 'stratumOnly', stratum: { host: 'a.example', port: 1 } },
      reviewScore: 5,
    });
    const b = listing({
      poolId: 'b',
      connect: { kind: 'datumOnly', datum: { host: 'b.example', port: 1 } },
      reviewScore: 0,
    });
    expect(compareFind(b, a)).toBeLessThan(0);
    const c = listing({
      poolId: 'c',
      connect: { kind: 'datumOnly', datum: { host: 'c.example', port: 1 } },
      reviewScore: 5,
      hasHostileFlag: true,
    });
    const d = listing({
      poolId: 'd',
      connect: { kind: 'datumOnly', datum: { host: 'd.example', port: 1 } },
      reviewScore: 5,
      hasHostileFlag: false,
    });
    const e = listing({
      poolId: 'e',
      connect: { kind: 'datumOnly', datum: { host: 'e.example', port: 1 } },
      reviewScore: 5,
      metrics: { hashrate: 10, volatility: 0.2 },
    });
    const f = listing({
      poolId: 'f',
      connect: { kind: 'datumOnly', datum: { host: 'f.example', port: 1 } },
      reviewScore: 5,
      metrics: { hashrate: 1, volatility: 0.1 },
    });
    expect(compareFind(f, e)).toBeLessThan(0);
  });

  it('ranks by attestation count then groups by listing domain', () => {
    const a = listing({
      poolId: 'a',
      listingDomain: 'a.com',
      connect: { kind: 'datumOnly', datum: { host: 'a.example', port: 1 } },
      attestationCount: 0,
    });
    const b = listing({
      poolId: 'b',
      listingDomain: 'a.com',
      connect: { kind: 'datumOnly', datum: { host: 'b.example', port: 1 } },
      attestationCount: 3,
    });
    const c = listing({
      poolId: 'c',
      listingDomain: 'c.com',
      connect: { kind: 'datumOnly', datum: { host: 'c.example', port: 1 } },
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
