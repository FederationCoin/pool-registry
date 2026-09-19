import { describe, expect, it } from 'vitest';
import { MemoryListingStore } from '../infra/memory/listing-store';
import { MemoryReviewStore } from '../infra/memory/review-store';
import { MemoryAttestationStore } from '../infra/memory/attestation-store';
import { MemoryRateAdapters } from '../infra/memory/rate';
import { MemoryChainView } from '../infra/memory/chain-view';
import { ListingsService, type RegisterBody, type UpdateBody } from './listings.service';
import { signEnvelope, testKey } from '../test-support';
import { HiddenAfterMs } from '../domain/constants';

function svc(chain = new MemoryChainView()) {
  const listings = new MemoryListingStore();
  const reviews = new MemoryReviewStore();
  const attestations = new MemoryAttestationStore();
  const rates = new MemoryRateAdapters();
  const api = new ListingsService(listings, reviews, attestations, rates, rates, rates, rates, rates, rates, chain);
  return { api, listings, reviews, attestations, rates, chain };
}

function registerCmd(name: string, connect: RegisterBody['connect']): RegisterBody {
  return {
    commandKind: 'registerListing',
    name,
    websiteUrl: 'https://example.com',
    coinbaseTag: `/${name}/`,
    connect,
  };
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
    const cmd = registerCmd('Old', { kind: 'stratumOnly', stratum: { host: 'pool.example.com', port: 23334 } });
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
    const cmd = registerCmd('Dup', { kind: 'stratumOnly', stratum: { host: 'pool.example.com', port: 23334 } });
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

  it('rejects a second listing from the same operator wallet', async () => {
    const { api, chain } = svc();
    const { priv, wallet } = testKey();
    chain.state.balances.set(wallet, 10n ** 18n);
    const cmd = registerCmd('One', { kind: 'stratumOnly', stratum: { host: 'pool.example.com', port: 23334 } });
    const env = signEnvelope({
      priv,
      wallet,
      chain: 'testnet',
      commandKind: 'registerListing',
      command: cmd,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await api.register('testnet', env, cmd, '8.8.8.8');
    const cmd2 = registerCmd('Two', { kind: 'stratumOnly', stratum: { host: 'pool.example.com', port: 23334 } });
    const env2 = signEnvelope({
      priv,
      wallet,
      chain: 'testnet',
      commandKind: 'registerListing',
      command: cmd2,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await expect(api.register('testnet', env2, cmd2, '8.8.8.8')).rejects.toMatchObject({ code: 'duplicateListing' });
  });

  it('rejects a non-operator update', async () => {
    const { api, chain } = svc();
    const a = testKey();
    const b = testKey();
    chain.state.balances.set(a.wallet, 10n ** 18n);
    chain.state.balances.set(b.wallet, 10n ** 18n);
    const cmd = registerCmd('Op', { kind: 'datumOnly', datum: { host: 'datum.example.com', port: 28916 } });
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
      websiteUrl: 'https://example.com',
      coinbaseTag: '/Op/',
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

  it('attests a proven coinbase payee and rejects a duplicate attestation', async () => {
    const { api, chain } = svc();
    const operator = testKey();
    const attester = testKey();
    chain.state.balances.set(operator.wallet, 10n ** 18n);
    chain.state.balances.set(attester.wallet, 10n ** 18n);
    const cmd = registerCmd('AttestMe', { kind: 'stratumOnly', stratum: { host: 'pool.example.com', port: 23334 } });
    const env = signEnvelope({
      priv: operator.priv,
      wallet: operator.wallet,
      chain: 'testnet',
      commandKind: 'registerListing',
      command: cmd,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    const { poolId } = await api.register('testnet', env, cmd, '5.5.5.5');
    chain.state.coinbases.set(chain.state.height, { tag: '/AttestMe/', addresses: [attester.wallet] });
    chain.state.coinbases.set(chain.state.height - 1, { tag: '/AttestMe/', addresses: [attester.wallet] });
    const attest = { commandKind: 'attestListing' as const, poolId, height: chain.state.height };
    const aEnv = signEnvelope({
      priv: attester.priv,
      wallet: attester.wallet,
      chain: 'testnet',
      commandKind: 'attestListing',
      command: attest,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await api.attestListing('testnet', poolId, aEnv, attest, '5.5.5.5');
    const pub = await api.getOne('testnet', poolId, '5.5.5.5');
    expect(pub.attestationCount).toBe(1);
    await expect(api.attestListing('testnet', poolId, aEnv, attest, '5.5.5.5')).rejects.toMatchObject({
      code: 'duplicateEnvelope',
    });
    const attest2 = { commandKind: 'attestListing' as const, poolId, height: chain.state.height - 1 };
    const aEnv2 = signEnvelope({
      priv: attester.priv,
      wallet: attester.wallet,
      chain: 'testnet',
      commandKind: 'attestListing',
      command: attest2,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await expect(api.attestListing('testnet', poolId, aEnv2, attest2, '5.5.5.5')).rejects.toMatchObject({
      code: 'duplicateAttestation',
    });
  });
});
