import { describe, expect, it } from 'vitest';
import { MemoryListingStore } from '../infra/memory/listing-store';
import { MemoryReviewStore } from '../infra/memory/review-store';
import { MemoryAttestationStore } from '../infra/memory/attestation-store';
import { MemoryRateAdapters } from '../infra/memory/rate';
import { MemoryChainView } from '../infra/memory/chain-view';
import { ListingsService, type RegisterBody, type UpdateBody } from './listings.service';
import { signEnvelope, testKey } from '../test-support';
import { HiddenAfterMs } from '../domain/constants';
import type { PoolConnection } from '../domain/types';

const matchingConnections: PoolConnection[] = [
  { kind: 'stratum', url: 'stratum.example.com:23334' },
  { kind: 'datumPrime', url: 'datum.example.com:28916' },
];

function registerCmd(overrides: Partial<RegisterBody> = {}): RegisterBody {
  return {
    commandKind: 'registerListing',
    name: 'Example Pool',
    websiteUrl: 'https://example.com',
    coinbaseTag: '/Example Pool/',
    connections: matchingConnections,
    ...overrides,
  };
}

function updateCmd(connections: PoolConnection[], overrides: Partial<UpdateBody> = {}): UpdateBody {
  return {
    commandKind: 'updateListing',
    name: 'Example Pool',
    websiteUrl: 'https://example.com',
    coinbaseTag: '/Example Pool/',
    connections,
    ...overrides,
  };
}

function svc(chain = new MemoryChainView()) {
  const listings = new MemoryListingStore();
  const reviews = new MemoryReviewStore();
  const attestations = new MemoryAttestationStore();
  const rates = new MemoryRateAdapters();
  const api = new ListingsService(listings, reviews, attestations, rates, rates, rates, rates, rates, rates, chain);
  return { api, listings, reviews, attestations, rates, chain };
}

describe('ListingsService', () => {
  it('returns stakeInsufficient below the 3090 Ti floor', async () => {
    const { api, chain } = svc();
    const { wallet } = testKey();
    chain.state.balances.set(wallet, 0n);
    const preview = await api.stakePreview('testnet', wallet, '1.1.1.1');
    expect(preview.kind).toBe('stakeInsufficient');
  });

  it('re-reads chain balance after a cached zero at the same height', async () => {
    const { api, chain } = svc();
    const { wallet } = testKey();
    chain.state.balances.set(wallet, 0n);
    expect((await api.stakePreview('testnet', wallet, '1.1.1.1')).kind).toBe('stakeInsufficient');
    chain.state.balances.set(wallet, 10n ** 18n);
    expect((await api.stakePreview('testnet', wallet, '1.1.1.1')).kind).toBe('stakeReady');
  });

  it('hides then reaps stale rows', async () => {
    const { api, listings, chain } = svc();
    const { priv, wallet } = testKey();
    chain.state.balances.set(wallet, 10n ** 18n);
    const cmd = registerCmd({ name: 'Old' });
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

  it('rejects duplicate envelopes before a second listing', async () => {
    const { api, chain } = svc();
    const { priv, wallet } = testKey();
    chain.state.balances.set(wallet, 10n ** 18n);
    const cmd = registerCmd({ name: 'Dup' });
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

  it('rejects a second listing from the same wallet', async () => {
    const { api, chain } = svc();
    const { priv, wallet } = testKey();
    chain.state.balances.set(wallet, 10n ** 18n);
    const first = registerCmd({ name: 'One' });
    const env = signEnvelope({
      priv,
      wallet,
      chain: 'testnet',
      commandKind: 'registerListing',
      command: first,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await api.register('testnet', env, first, '4.4.4.5');
    const second = registerCmd({ name: 'Two' });
    const env2 = signEnvelope({
      priv,
      wallet,
      chain: 'testnet',
      commandKind: 'registerListing',
      command: second,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await expect(api.register('testnet', env2, second, '4.4.4.5')).rejects.toMatchObject({ code: 'duplicateListing' });
  });

  it('rejects a non-operator update', async () => {
    const { api, chain } = svc();
    const a = testKey();
    const b = testKey();
    chain.state.balances.set(a.wallet, 10n ** 18n);
    chain.state.balances.set(b.wallet, 10n ** 18n);
    const cmd = registerCmd({
      name: 'Op',
      connections: [{ kind: 'datumPrime', url: 'datum.example.com:28916' }],
    });
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
    const upd = updateCmd([{ kind: 'datumPrime', url: 'datum.example.com:28916' }], { name: 'Hijack' });
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

  it('rejects mixed registrable domains', async () => {
    const { api, chain } = svc();
    const { priv, wallet } = testKey();
    chain.state.balances.set(wallet, 10n ** 18n);
    const cmd = registerCmd({
      websiteUrl: 'https://brand.example.com',
      connections: [{ kind: 'stratum', url: 'stratum.other.com:23334' }],
    });
    const env = signEnvelope({
      priv,
      wallet,
      chain: 'testnet',
      commandKind: 'registerListing',
      command: cmd,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await expect(api.register('testnet', env, cmd, '8.8.8.8')).rejects.toMatchObject({ code: 'mixedDomain' });
  });

  it('drops then restores attestationCount when advertised host:port changes and reverts', async () => {
    const { api, chain } = svc();
    const lister = testKey();
    const attester = testKey();
    chain.state.balances.set(lister.wallet, 10n ** 18n);
    chain.state.balances.set(attester.wallet, 10n ** 18n);
    const cmd = registerCmd();
    const env = signEnvelope({
      priv: lister.priv,
      wallet: lister.wallet,
      chain: 'testnet',
      commandKind: 'registerListing',
      command: cmd,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    const { poolId } = await api.register('testnet', env, cmd, '5.5.5.5');
    chain.state.coinbases.set(chain.state.height, { tag: '/Example Pool/', addresses: [attester.wallet] });
    const attest = {
      commandKind: 'attestListing' as const,
      poolId,
      height: chain.state.height,
      connect: { kind: 'stratum', url: 'stratum.example.com:23334' },
    };
    const aEnv = signEnvelope({
      priv: attester.priv,
      wallet: attester.wallet,
      chain: 'testnet',
      commandKind: 'attestListing',
      command: attest,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await api.attestListing('testnet', poolId, aEnv, attest, '5.5.5.6');
    const counted = await api.getOne('testnet', poolId, '5.5.5.7');
    expect(counted.attestationCount).toBe(1);

    const moved = updateCmd([
      { kind: 'stratum', url: 'stratum.example.com:23335' },
      { kind: 'datumPrime', url: 'datum.example.com:28916' },
    ]);
    const uEnv = signEnvelope({
      priv: lister.priv,
      wallet: lister.wallet,
      chain: 'testnet',
      commandKind: 'updateListing',
      command: moved,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    const afterMove = await api.update('testnet', poolId, uEnv, moved, '5.5.5.5');
    expect(afterMove.attestationCount).toBe(0);
    const findAfterMove = await api.findActive('testnet', undefined, undefined, '5.5.5.8');
    expect(findAfterMove.items[0].attestationCount).toBe(0);

    const reverted = updateCmd(matchingConnections);
    const rEnv = signEnvelope({
      priv: lister.priv,
      wallet: lister.wallet,
      chain: 'testnet',
      commandKind: 'updateListing',
      command: reverted,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    const afterRevert = await api.update('testnet', poolId, rEnv, reverted, '5.5.5.5');
    expect(afterRevert.attestationCount).toBe(1);
  });

  it('rejects DATUM attest on a stratum-only listing and a second attest from the same wallet', async () => {
    const { api, chain, attestations } = svc();
    const lister = testKey();
    const attester = testKey();
    chain.state.balances.set(lister.wallet, 10n ** 18n);
    chain.state.balances.set(attester.wallet, 10n ** 18n);
    const cmd = registerCmd({
      connections: [{ kind: 'stratum', url: 'stratum.example.com:23334' }],
    });
    const env = signEnvelope({
      priv: lister.priv,
      wallet: lister.wallet,
      chain: 'testnet',
      commandKind: 'registerListing',
      command: cmd,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    const { poolId } = await api.register('testnet', env, cmd, '6.6.6.6');
    chain.state.coinbases.set(chain.state.height, { tag: '/Example Pool/', addresses: [attester.wallet] });
    const datumAttest = {
      commandKind: 'attestListing' as const,
      poolId,
      height: chain.state.height,
      connect: { kind: 'datumPrime', url: 'datum.example.com:28916' },
    };
    const badEnv = signEnvelope({
      priv: attester.priv,
      wallet: attester.wallet,
      chain: 'testnet',
      commandKind: 'attestListing',
      command: datumAttest,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await expect(api.attestListing('testnet', poolId, badEnv, datumAttest, '6.6.6.7')).rejects.toMatchObject({
      code: 'connectChanged',
    });

    const ok = {
      commandKind: 'attestListing' as const,
      poolId,
      height: chain.state.height,
      connect: { kind: 'stratum', url: 'stratum.example.com:23334' },
    };
    const okEnv = signEnvelope({
      priv: attester.priv,
      wallet: attester.wallet,
      chain: 'testnet',
      commandKind: 'attestListing',
      command: ok,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await api.attestListing('testnet', poolId, okEnv, ok, '6.6.6.8');
    chain.state.coinbases.set(chain.state.height - 1, { tag: '/Example Pool/', addresses: [attester.wallet] });
    const again = {
      commandKind: 'attestListing' as const,
      poolId,
      height: chain.state.height - 1,
      connect: { kind: 'stratum', url: 'stratum.example.com:23334' },
    };
    const againEnv = signEnvelope({
      priv: attester.priv,
      wallet: attester.wallet,
      chain: 'testnet',
      commandKind: 'attestListing',
      command: again,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await expect(api.attestListing('testnet', poolId, againEnv, again, '6.6.6.9')).rejects.toMatchObject({
      code: 'duplicateAttestation',
    });
    expect((await attestations.listByPool(poolId)).length).toBe(1);
  });

  it('does not count legacy rows missing connect', async () => {
    const { api, chain, listings, attestations, rates } = svc();
    const lister = testKey();
    chain.state.balances.set(lister.wallet, 10n ** 18n);
    const cmd = registerCmd();
    const env = signEnvelope({
      priv: lister.priv,
      wallet: lister.wallet,
      chain: 'testnet',
      commandKind: 'registerListing',
      command: cmd,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    const { poolId } = await api.register('testnet', env, cmd, '7.7.7.7');
    await attestations.put({
      attesterWallet: lister.wallet,
      poolId,
      chain: 'testnet',
      height: 1,
      createdAt: new Date().toISOString(),
      envelope: env,
    } as never);
    await rates.bustTrust('testnet', poolId);
    expect((await listings.get(poolId))?.poolId).toBe(poolId);
    const row = await api.getOne('testnet', poolId, '7.7.7.8');
    expect(row.attestationCount).toBe(0);
  });

  it('annotates attestedByYou only for the attester wallet', async () => {
    const { api, chain } = svc();
    const lister = testKey();
    const attester = testKey();
    chain.state.balances.set(lister.wallet, 10n ** 18n);
    chain.state.balances.set(attester.wallet, 10n ** 18n);
    const cmd = registerCmd();
    const env = signEnvelope({
      priv: lister.priv,
      wallet: lister.wallet,
      chain: 'testnet',
      commandKind: 'registerListing',
      command: cmd,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    const { poolId } = await api.register('testnet', env, cmd, '8.8.8.8');
    chain.state.coinbases.set(chain.state.height, { tag: '/Example Pool/', addresses: [attester.wallet] });
    const attest = {
      commandKind: 'attestListing' as const,
      poolId,
      height: chain.state.height,
      connect: { kind: 'stratum' as const, url: 'stratum.example.com:23334' },
    };
    const aEnv = signEnvelope({
      priv: attester.priv,
      wallet: attester.wallet,
      chain: 'testnet',
      commandKind: 'attestListing',
      command: attest,
      signingBlockHash: chain.state.hash,
      signingBlockHeight: chain.state.height,
    });
    await api.attestListing('testnet', poolId, aEnv, attest, '8.8.8.9');
    const mine = await api.findActive('testnet', undefined, undefined, '8.8.8.10', attester.wallet);
    expect(mine.items[0].attestedByYou).toEqual({ kind: 'stratum', url: 'stratum.example.com:23334' });
    const other = await api.findActive('testnet', undefined, undefined, '8.8.8.11', lister.wallet);
    expect(other.items[0].attestedByYou).toBeUndefined();
    const anon = await api.findActive('testnet', undefined, undefined, '8.8.8.12');
    expect(anon.items[0].attestedByYou).toBeUndefined();
    const ctx = await api.signContext('testnet', '8.8.8.13');
    expect(ctx.holdBlocks).toBe(0);
  });
});
