import { describe, expect, it } from 'vitest';
import { assertListingConnect, assertPublicAdvertiseHost, assertWebsiteUrl } from './host';
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
});
