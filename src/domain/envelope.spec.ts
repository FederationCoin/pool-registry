import { describe, expect, it } from 'vitest';
import { payloadHashHex } from './jcs';
import { assertEnvelope, decodeCompactSig } from './envelope';
import { signEnvelope, testKey } from '../test-support';
import { RegistryProblem } from './types';
import { censorTagForDisplay } from './text';
import { pushSample } from './metrics';

describe('envelope and text', () => {
  it('verifies a Sparrow compact signature over payloadHash', () => {
    const { priv, wallet } = testKey();
    const command = { commandKind: 'heartbeatListing', poolId: '01HZX' };
    const env = signEnvelope({
      priv,
      wallet,
      chain: 'testnet',
      commandKind: 'heartbeatListing',
      command,
      signingBlockHash: 'ab'.repeat(32),
      signingBlockHeight: 1,
    });
    expect(env.payloadHash).toBe(payloadHashHex(command));
    expect(() => assertEnvelope(env, 'testnet', 'heartbeatListing', command)).not.toThrow();
  });

  it('rejects a commandKind mismatch and a mutated hash', () => {
    const { priv, wallet } = testKey();
    const command = { commandKind: 'heartbeatListing', poolId: '01HZX' };
    const env = signEnvelope({
      priv,
      wallet,
      chain: 'testnet',
      commandKind: 'heartbeatListing',
      command,
      signingBlockHash: 'ab'.repeat(32),
      signingBlockHeight: 1,
    });
    expect(() => assertEnvelope(env, 'testnet', 'registerListing', command)).toThrow(RegistryProblem);
    env.payloadHash = '00'.repeat(32);
    expect(() => assertEnvelope(env, 'testnet', 'heartbeatListing', command)).toThrow(RegistryProblem);
  });

  it('rejects chain mismatch and bad compact sig', () => {
    const { priv, wallet } = testKey();
    const command = { commandKind: 'heartbeatListing', poolId: '01HZX' };
    const env = signEnvelope({
      priv,
      wallet,
      chain: 'testnet',
      commandKind: 'heartbeatListing',
      command,
      signingBlockHash: 'ab'.repeat(32),
      signingBlockHeight: 1,
    });
    env.chain = 'main';
    expect(() => assertEnvelope(env, 'main', 'heartbeatListing', command)).toThrow(RegistryProblem);
    env.chain = 'testnet';
    env.messageVersion = 2;
    expect(() => assertEnvelope(env, 'testnet', 'heartbeatListing', command)).toThrow(RegistryProblem);
    env.messageVersion = 1;
    env.signature = 'AAAA';
    expect(() => assertEnvelope(env, 'testnet', 'heartbeatListing', command)).toThrow(RegistryProblem);
  });

  it('rejects BIP137 headers 39-42 as not compact Electrum', () => {
    const compact = Buffer.alloc(65, 1);
    compact[0] = 39;
    const b64 = compact.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(() => decodeCompactSig(b64)).toThrow(RegistryProblem);
    compact[0] = 27;
    expect(() => decodeCompactSig(compact.toString('base64url'))).not.toThrow();
  });

  it('censors flagged words on read only', () => {
    expect(censorTagForDisplay('/nigger/')).toBe('/****/');
  });

  it('caps metric samples', () => {
    let m = undefined;
    for (let i = 0; i < 50; i++) {
      m = pushSample(m, { at: new Date(i).toISOString(), blocksFound: 1, hashrate: 10 + (i % 3) });
    }
    expect(m?.samples?.length).toBe(48);
    expect(m?.volatility).toBeGreaterThan(0);
  });
});
