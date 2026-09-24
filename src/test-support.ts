import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { ripemd160 } from '@noble/hashes/legacy';
import * as secp from '@noble/secp256k1';
import { signedPayloadHash } from './domain/jcs';
import { sparrowMessageHash } from './domain/envelope';
import { encodeP2wpkh } from './domain/wallet';
import type { ChainId } from './domain/constants';
import type { CommandKind, SigningEnvelope } from './domain/types';

secp.etc.hmacSha256Sync = (k, ...msgs) => {
  const h = hmac.create(sha256, k);
  for (const m of msgs) {
    h.update(m);
  }
  return h.digest();
};

export function testKey(chain: ChainId = 'testnet'): { priv: Uint8Array; wallet: string } {
  const priv = secp.utils.randomPrivateKey();
  const pub = secp.getPublicKey(priv, true);
  const hash160 = ripemd160(sha256(pub));
  return { priv, wallet: encodeP2wpkh(chain, hash160) };
}

export function signEnvelope(args: {
  priv: Uint8Array;
  wallet: string;
  chain: ChainId;
  commandKind: CommandKind;
  command: unknown;
  signingBlockHash: string;
  signingBlockHeight: number;
}): SigningEnvelope {
  const payloadHash = signedPayloadHash(args.command, args.signingBlockHeight, args.signingBlockHash);
  const hash = sparrowMessageHash(payloadHash);
  const sig = secp.sign(hash, args.priv);
  const rec = sig.recovery ?? 0;
  const header = 27 + 4 + rec;
  const compact = Buffer.concat([Buffer.from([header]), Buffer.from(sig.toCompactRawBytes())]);
  return {
    messageVersion: 1,
    commandKind: args.commandKind,
    chain: args.chain,
    wallet: args.wallet,
    payloadHash,
    signature: compact.toString('base64url'),
    signingBlockHash: args.signingBlockHash,
    signingBlockHeight: args.signingBlockHeight,
  };
}

export function bearer(env: SigningEnvelope): string {
  return 'Bearer ' + Buffer.from(JSON.stringify(env), 'utf8').toString('base64url');
}
