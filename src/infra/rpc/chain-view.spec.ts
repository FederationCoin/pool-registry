import { afterEach, describe, expect, it, vi } from 'vitest';
import { RpcChainView } from './chain-view';
import { testKey } from '../../test-support';

const rpcSettings = {
  hosts: ['http://node.test/'],
  username: 'u',
  password: 'p',
};

function rpcOk(result: unknown) {
  return {
    ok: true,
    json: async () => ({ result, error: null }),
  };
}

describe('RpcChainView.getBalance', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses scantxoutset when explorer is unset', async () => {
    const { wallet } = testKey();
    const rpc = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.method).toBe('scantxoutset');
      expect(body.params).toEqual(['start', [`addr(${wallet})`]]);
      return rpcOk({ success: true, total_amount: 12.34 });
    });
    vi.stubGlobal('fetch', rpc);
    const view = new RpcChainView({ testnet: rpcSettings });
    await expect(view.getBalance('testnet', wallet)).resolves.toBe(1_234_000_000n);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('prefers esplora chain_stats when the explorer has them', async () => {
    const { wallet } = testKey();
    vi.stubGlobal('fetch', async (url: string) => {
      expect(String(url)).toContain(`/api/address/${wallet}`);
      return {
        ok: true,
        json: async () => ({ chain_stats: { funded_txo_sum: 500, spent_txo_sum: 40 } }),
      };
    });
    const view = new RpcChainView({
      testnet: { ...rpcSettings, explorerBaseUrl: 'https://esplora.test' },
    });
    await expect(view.getBalance('testnet', wallet)).resolves.toBe(460n);
  });

  it('falls back to scantxoutset when explorer has no address index', async () => {
    const { wallet } = testKey();
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (!init?.body) {
        return {
          ok: true,
          json: async () => ({ error: 'Address lookups cannot be used with bitcoind as backend.' }),
        };
      }
      const body = JSON.parse(String(init.body));
      expect(body.method).toBe('scantxoutset');
      return rpcOk({ success: true, total_amount: '2993.40552346' });
    });
    const view = new RpcChainView({
      testnet: { ...rpcSettings, explorerBaseUrl: 'https://mempool.test' },
    });
    await expect(view.getBalance('testnet', wallet)).resolves.toBe(299_340_552_346n);
  });

  it('returns 0 for a non-bech32 wallet without calling rpc', async () => {
    const rpc = vi.fn();
    vi.stubGlobal('fetch', rpc);
    const view = new RpcChainView({ testnet: rpcSettings });
    await expect(view.getBalance('testnet', 'not an address')).resolves.toBe(0n);
    expect(rpc).not.toHaveBeenCalled();
  });
});
