import { describe, expect, it } from 'vitest';
import { MemoryRateAdapters } from './rate';

describe('memory rate adapters', () => {
  it('rate limits then allows after window logic', async () => {
    const r = new MemoryRateAdapters();
    for (let i = 0; i < 60; i++) {
      expect((await r.hitPublicRead('9.9.9.9')).allowed).toBe(true);
    }
    expect((await r.hitPublicRead('9.9.9.9')).allowed).toBe(false);
    const un = await r.hitUnstakedWrite('1.1.1.1', 'w');
    expect(un.allowed).toBe(true);
    await r.clearUnstaked('1.1.1.1', 'w');
    await r.put({
      chain: 'testnet',
      wallet: 'w',
      asOfHeight: 2,
      balanceSats: '1',
      holdOk: true,
      stakeRequiredSats: '1',
    });
    await r.put({
      chain: 'testnet',
      wallet: 'w',
      asOfHeight: 1,
      balanceSats: '9',
      holdOk: true,
      stakeRequiredSats: '1',
    });
    const got = await r.get('testnet', 'w');
    expect(got?.asOfHeight).toBe(2);
    await r.putTrust({
      chain: 'testnet',
      poolId: 'p',
      asOfHeight: 10,
      attestationCount: 1,
      listerConfirmedCoinbasePayee: false,
    });
    expect((await r.getTrust('testnet', 'p'))?.attestationCount).toBe(1);
    await r.bustTrust('testnet', 'p');
    expect(await r.getTrust('testnet', 'p')).toBeUndefined();
  });
});
