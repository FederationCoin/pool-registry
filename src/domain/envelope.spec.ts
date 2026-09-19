import { describe, expect, it } from 'vitest';
import { signedPayloadHash } from './jcs';
import { assertEnvelope, decodeCompactSig, verifyEnvelopeSignature } from './envelope';
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
    expect(env.payloadHash).toBe(signedPayloadHash(command, 1, 'ab'.repeat(32)));
    expect(() => assertEnvelope(env, 'testnet', 'heartbeatListing', command)).not.toThrow();
  });

  it('binds signing height and hash into the payload hash', () => {
    const command = { commandKind: 'heartbeatListing', poolId: '01HZX' };
    const hash = 'ab'.repeat(32);
    expect(signedPayloadHash(command, 1, hash)).not.toBe(signedPayloadHash(command, 2, hash));
    expect(signedPayloadHash(command, 1, hash)).not.toBe(signedPayloadHash(command, 1, 'cd'.repeat(32)));
  });

  it('rejects an envelope whose tip no longer matches the signed hash', () => {
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
    env.signingBlockHeight = 2;
    try {
      assertEnvelope(env, 'testnet', 'heartbeatListing', command);
      expect.fail('expected payloadHashMismatch');
    } catch (e) {
      expect(e).toBeInstanceOf(RegistryProblem);
      expect((e as RegistryProblem).code).toBe('payloadHashMismatch');
    }
  });

  it('accepts a Sparrow Electrum signature hashed with Bitcoin Signed Message', () => {
    expect(() =>
      verifyEnvelopeSignature({
        messageVersion: 1,
        commandKind: 'registerListing',
        chain: 'testnet',
        wallet: 'tgfcn1q3q3s7s9f76049j7uyp5sgrw96wnearh9md8wh6',
        payloadHash: '16ba6415324032c9320d0ba6e65d6f0a4b4565cfda731721275ee524da9bdbd6',
        signature: 'H20kCjSQSRurJdzD7BPUirWfyG635CXiKtOqAKcptjxtfcD3KeheYODrlJA4nLTgn1luacrWS0bJYrm3fNqTngM=',
        signingBlockHash: '00'.repeat(32),
        signingBlockHeight: 1,
      }),
    ).not.toThrow();
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
