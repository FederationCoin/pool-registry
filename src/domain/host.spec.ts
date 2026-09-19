import { describe, expect, it } from 'vitest';
import {
  assertAttestConnect,
  assertBrandAndConnect,
  assertListingConnect,
  assertPublicAdvertiseHost,
  assertWebsiteUrl,
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
      assertListingConnect({ kind: 'stratumOnly', stratum: { host: 'pool.example.com', port: 35332 } }),
    ).toThrow(RegistryProblem);
    expect(
      assertListingConnect({
        kind: 'datumOnly',
        datum: { host: 'datum.example.com', port: 28916 },
        wss: { host: 'wss.example.com', path: '/stratum' },
      }).kind,
    ).toBe('datumOnly');
    expect(() =>
      assertListingConnect({ kind: 'stratumOnly', stratum: { host: 'pool.example.com', port: 6379 } }),
    ).toThrow(RegistryProblem);
    expect(() => assertListingConnect({ kind: 'nope' })).toThrow(RegistryProblem);
    expect(() =>
      assertListingConnect({
        kind: 'stratumOnly',
        stratum: { host: 'pool.example.com', port: 23334 },
        wss: { host: 'wss.example.com', path: 'no-slash' },
      }),
    ).toThrow(RegistryProblem);
  });

  it('requires https websiteUrl and same registrable domain for brand and connect', () => {
    expect(() => assertWebsiteUrl(undefined)).toThrow(RegistryProblem);
    expect(registrableDomain('stratum.example.com')).toBe('example.com');
    expect(registrableDomain('pool.co.uk')).toBe('pool.co.uk');
    expect(registrableDomain('a.pool.co.uk')).toBe('pool.co.uk');
    expect(
      assertBrandAndConnect('https://example.com/pool', {
        kind: 'stratumAndDatum',
        stratum: { host: 'stratum.example.com', port: 23334 },
        datum: { host: 'datum.example.com', port: 28916 },
      }),
    ).toBe('example.com');
    expect(() =>
      assertBrandAndConnect('https://example.com', {
        kind: 'stratumOnly',
        stratum: { host: 'stratum.other.com', port: 23334 },
      }),
    ).toThrow(RegistryProblem);
  });

  it('accepts AttestConnect only for a currently advertised host:port', () => {
    const listing = {
      kind: 'stratumAndDatum' as const,
      stratum: { host: 'stratum.example.com', port: 23334 },
      datum: { host: 'datum.example.com', port: 28916 },
    };
    expect(assertAttestConnect(listing, { kind: 'stratum', host: 'Stratum.example.com', port: 23334 }).kind).toBe(
      'stratum',
    );
    expect(() => assertAttestConnect(listing, { kind: 'stratum', host: 'stratum.example.com', port: 1 })).toThrow(
      RegistryProblem,
    );
    expect(() =>
      assertAttestConnect(
        { kind: 'stratumOnly', stratum: { host: 'stratum.example.com', port: 23334 } },
        { kind: 'datum', host: 'datum.example.com', port: 28916 },
      ),
    ).toThrow(RegistryProblem);
  });
});
