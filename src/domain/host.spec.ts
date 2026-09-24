import { describe, expect, it } from 'vitest';
import {
  assertAttestConnect,
  assertBrandAndConnect,
  assertPoolConnections,
  assertPublicAdvertiseHost,
  assertWebsiteUrl,
  listingConnections,
  registrableDomain,
} from './host';
import { RegistryProblem } from './types';

describe('host', () => {
  it('rejects loopback, RFC1918, metadata, cluster DNS', () => {
    for (const h of [
      '127.0.0.1',
      'localhost',
      '10.0.0.1',
      '192.168.1.1',
      '172.16.0.2',
      '169.254.169.254',
      'node-a.federationcoin.svc.cluster.local',
      '::1',
    ]) {
      expect(() => assertPublicAdvertiseHost(h), h).toThrow(RegistryProblem);
    }
  });

  it('accepts a public DNS name', () => {
    expect(() => assertPublicAdvertiseHost('stratum.example.com')).not.toThrow();
  });

  it('rejects http website and userinfo', () => {
    expect(() => assertWebsiteUrl('http://example.com')).toThrow(RegistryProblem);
    expect(() => assertWebsiteUrl('https://user:pass@example.com')).toThrow(RegistryProblem);
    expect(() => assertWebsiteUrl('https://example.com/pool')).not.toThrow();
  });

  it('rejects RPC port on connect', () => {
    expect(() =>
      assertPoolConnections([{ kind: 'stratum', url: 'pool.example.com:35332' }]),
    ).toThrow(RegistryProblem);
    expect(
      assertPoolConnections([
        { kind: 'datumPrime', url: 'datum.example.com:28916' },
        { kind: 'stratumWs', url: 'wss://wss.example.com/stratum' },
      ])[0]!.kind,
    ).toBe('datumPrime');
    expect(() =>
      assertPoolConnections([{ kind: 'stratum', url: 'pool.example.com:6379' }]),
    ).toThrow(RegistryProblem);
    expect(() => assertPoolConnections([{ kind: 'nope', url: 'x.example.com:1' }])).toThrow(RegistryProblem);
    expect(() =>
      assertPoolConnections([{ kind: 'stratumWs', url: 'ws://wss.example.com/stratum' }]),
    ).toThrow(RegistryProblem);
  });

  it('requires https websiteUrl and same registrable domain for brand and connect', () => {
    expect(() => assertWebsiteUrl(undefined)).toThrow(RegistryProblem);
    expect(registrableDomain('stratum.example.com')).toBe('example.com');
    expect(registrableDomain('pool.co.uk')).toBe('pool.co.uk');
    expect(registrableDomain('a.pool.co.uk')).toBe('pool.co.uk');
    expect(
      assertBrandAndConnect('https://example.com/pool', [
        { kind: 'stratum', url: 'stratum.example.com:23334' },
        { kind: 'datumPrime', url: 'datum.example.com:28916' },
      ]),
    ).toBe('example.com');
    expect(() =>
      assertBrandAndConnect('https://example.com', [{ kind: 'stratum', url: 'stratum.other.com:23334' }]),
    ).toThrow(RegistryProblem);
  });

  it('accepts AttestConnect only for a currently advertised endpoint', () => {
    const listing = [
      { kind: 'stratum' as const, url: 'stratum.example.com:23334' },
      { kind: 'datumPrime' as const, url: 'datum.example.com:28916' },
    ];
    expect(assertAttestConnect(listing, { kind: 'stratum', url: 'Stratum.example.com:23334' }).kind).toBe('stratum');
    expect(() => assertAttestConnect(listing, { kind: 'stratum', url: 'stratum.example.com:1' })).toThrow(
      RegistryProblem,
    );
    expect(() =>
      assertAttestConnect([{ kind: 'stratum', url: 'stratum.example.com:23334' }], {
        kind: 'datumPrime',
        url: 'datum.example.com:28916',
      }),
    ).toThrow(RegistryProblem);
  });

  it('keeps a DATUM Prime identity pin and rejects it on Stratum', () => {
    const pub = 'ab'.repeat(64);
    const folded = assertPoolConnections([
      {
        kind: 'datumPrime',
        url: 'Datum.example.com:28916',
        identityPubkey: pub.toUpperCase(),
        keysUrl: 'https://pool.example.com/.well-known/prime-keys.json',
      },
    ]);
    expect(folded[0]).toEqual({
      kind: 'datumPrime',
      url: 'datum.example.com:28916',
      identityPubkey: pub,
      keysUrl: 'https://pool.example.com/.well-known/prime-keys.json',
    });
    expect(() =>
      assertPoolConnections([{ kind: 'datumPrime', url: 'datum.example.com:28916', identityPubkey: 'aa' }]),
    ).toThrow(/128 hex/);
    expect(() =>
      assertPoolConnections([{ kind: 'stratum', url: 'stratum.example.com:23334', identityPubkey: pub }]),
    ).toThrow(/only for DATUM Prime/);
    expect(() =>
      assertPoolConnections([{ kind: 'datumPrime', url: 'datum.example.com:28916', keysUrl: 'http://pool.example.com/keys.json' }]),
    ).toThrow(/https/);
  });

  it('maps a legacy connect blob to connections', () => {
    expect(
      listingConnections({
        connect: {
          kind: 'stratumAndDatum',
          stratum: { host: 'stratum.example.com', port: 23334 },
          datum: { host: 'datum.example.com', port: 28916 },
          wss: { host: 'pool.example.com', path: '/stratum' },
        },
      }),
    ).toEqual([
      { kind: 'stratum', url: 'stratum.example.com:23334' },
      { kind: 'datumPrime', url: 'datum.example.com:28916' },
      { kind: 'stratumWs', url: 'wss://pool.example.com/stratum' },
    ]);
  });

  it('caps connections at twelve and three per kind', () => {
    const three = [
      { kind: 'stratum' as const, url: 'a.example.com:1' },
      { kind: 'stratum' as const, url: 'b.example.com:2' },
      { kind: 'stratum' as const, url: 'c.example.com:3' },
    ];
    expect(assertPoolConnections(three)).toHaveLength(3);
    expect(() => assertPoolConnections([...three, { kind: 'stratum', url: 'd.example.com:4' }])).toThrow(
      RegistryProblem,
    );
    const twelve = (['stratum', 'stratumWs', 'datumPrime', 'datumPrimeWs'] as const).flatMap((kind) =>
      [1, 2, 3].map((n) => ({
        kind,
        url: kind.endsWith('Ws') ? `wss://${kind}${n}.example.com/x` : `${kind}${n}.example.com:${20000 + n}`,
      })),
    );
    expect(assertPoolConnections(twelve)).toHaveLength(12);
    expect(() => assertPoolConnections([...twelve, { kind: 'stratum', url: 'extra.example.com:9' }])).toThrow(
      RegistryProblem,
    );
  });
});
