import { describe, expect, it } from 'vitest';
import { MemoryListingStore } from '../infra/memory/listing-store';
import { MemoryReviewStore } from '../infra/memory/review-store';
import { MemoryRateAdapters } from '../infra/memory/rate';
import { MemoryChainView } from '../infra/memory/chain-view';
import { ListingsService } from './listings.service';
import { signEnvelope, testKey } from '../test-support';
import { RegistryProblem } from '../domain/types';
import { HiddenAfterMs } from '../domain/constants';

function svc(chain = new MemoryChainView()) {
  const listings = new MemoryListingStore();
  const reviews = new MemoryReviewStore();
  const rates = new MemoryRateAdapters();
  const api = new ListingsService(listings, reviews, rates, rates, rates, rates, rates, chain);
  return { api, listings, reviews, rates, chain };
}

describe('ListingsService', () => {
  it('returns stakeInsufficient below the 3090 Ti floor', async () => {
    const { api, chain } = svc();
    const { wallet } = testKey();
    chain.state.balances.set(wallet, 0n);
    const preview = await api.stakePreview('testnet', wallet, '1.1.1.1');
    expect(preview.kind).toBe('stakeInsufficient');
  });

  it('hides then reaps stale rows', async () => {
    const { api, listings, chain } = svc();
    const { priv, wallet } = testKey();
    chain.state.balances.set(wallet, 10n ** 18n);
    const cmd = {
      commandKind: 'registerListing' as const,
      name: 'Old',
      connect: { kind: 'stratumOnly' as const, stratum: { host: 'pool.example.com', port: 23334 } },
    };
    const env = signEnvelope({
      priv,
      wallet,
      chain: 'testnet',
      commandKind: 'registerListing',
      command: cmd,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    const { poolId } = await api.register('testnet', env, cmd, '2.2.2.2');
    const row = await listings.get(poolId);
    expect(row).toBeTruthy();
    await api.hideExpired('testnet', Date.parse(row!.createdAt) + HiddenAfterMs + 1);
    const hidden = await listings.get(poolId);
    expect(hidden?.hiddenAt).toBeTruthy();
    expect(hidden?.lastAttributedBlockAt).toBeUndefined();
    await api.hideExpired('testnet', Date.parse(row!.createdAt) + 2016 * 600 * 1000 + 1);
    expect(await listings.get(poolId)).toBeUndefined();
  });

  it('rejects duplicate envelopes', async () => {
    const { api, chain } = svc();
    const { priv, wallet } = testKey();
    chain.state.balances.set(wallet, 10n ** 18n);
    const cmd = {
      commandKind: 'registerListing' as const,
      name: 'Dup',
      connect: { kind: 'stratumOnly' as const, stratum: { host: 'pool.example.com', port: 23334 } },
    };
    const env = signEnvelope({
      priv,
      wallet,
      chain: 'testnet',
      commandKind: 'registerListing',
      command: cmd,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await api.register('testnet', env, cmd, '4.4.4.4');
    await expect(api.register('testnet', env, cmd, '4.4.4.4')).rejects.toMatchObject({ code: 'duplicateEnvelope' });
  });

  it('rejects a non-operator update', async () => {
    const { api, chain } = svc();
    const a = testKey();
    const b = testKey();
    chain.state.balances.set(a.wallet, 10n ** 18n);
    chain.state.balances.set(b.wallet, 10n ** 18n);
    const cmd = {
      commandKind: 'registerListing' as const,
      name: 'Op',
      connect: { kind: 'datumOnly' as const, datum: { host: 'datum.example.com', port: 28916 } },
    };
    const env = signEnvelope({
      priv: a.priv,
      wallet: a.wallet,
      chain: 'testnet',
      commandKind: 'registerListing',
      command: cmd,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    const { poolId } = await api.register('testnet', env, cmd, '3.3.3.3');
    const upd: UpdateBody = {
      commandKind: 'updateListing',
      name: 'Hijack',
      connect: { kind: 'datumOnly', datum: { host: 'datum.example.com', port: 28916 } },
    };
    const bad = signEnvelope({
      priv: b.priv,
      wallet: b.wallet,
      chain: 'testnet',
      commandKind: 'updateListing',
      command: upd,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await expect(api.update('testnet', poolId, bad, upd, '3.3.3.3')).rejects.toMatchObject({ code: 'notOperator' });
  });
});
