import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { ripemd160 } from '@noble/hashes/legacy';
import * as secp from '@noble/secp256k1';

secp.etc.hmacSha256Sync = (k, ...msgs) => {
  const h = hmac.create(sha256, k);
  for (const m of msgs) {
    h.update(m);
  }
  return h.digest();
};
import { RegistrySignedMessageMagic } from './constants';
import { payloadHashHex } from './jcs';
import { RegistryProblem, type CommandKind, type SigningEnvelope } from './types';
import { assertP2wpkh, encodeP2wpkh } from './wallet';
import type { ChainId } from './constants';

function compactSize(n: number): Uint8Array {
  if (n < 0xfd) {
    return Uint8Array.of(n);
  }
  if (n <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = 0xfd;
    b.writeUInt16LE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = 0xfe;
  b.writeUInt32LE(n, 1);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function sparrowMessageBytes(inner: string): Uint8Array {
  const magic = new TextEncoder().encode(RegistrySignedMessageMagic);
  const msg = new TextEncoder().encode(inner);
  return concat([compactSize(magic.length), magic, compactSize(msg.length), msg]);
}

export function sparrowMessageHash(inner: string): Uint8Array {
  return sha256(sha256(sparrowMessageBytes(inner)));
}

export function decodeCompactSig(signature: string): { recId: number; compact: Uint8Array } {
  const pad = signature.replace(/-/g, '+').replace(/_/g, '/');
  const buf = Buffer.from(pad, 'base64');
  if (buf.length !== 65) {
    throw new RegistryProblem(401, 'badSignature', 'Signature is not compact');
  }
  let header = buf[0];
  if (header < 27 || header > 34) {
    throw new RegistryProblem(401, 'badSignature', 'Signature is not compact');
  }
  if (header >= 31) {
    header -= 4;
  }
  const recId = header - 27;
  return { recId, compact: buf.subarray(1) };
}

export function verifyEnvelopeSignature(env: SigningEnvelope): void {
  const prog = assertP2wpkh(env.wallet, env.chain);
  const hash = sparrowMessageHash(env.payloadHash.toLowerCase());
  const { recId, compact } = decodeCompactSig(env.signature);
  let pub: Uint8Array;
  try {
    const point = secp.Signature.fromCompact(compact).addRecoveryBit(recId).recoverPublicKey(hash);
    pub = point.toRawBytes(true);
  } catch {
    throw new RegistryProblem(401, 'badSignature', 'Signature does not match wallet');
  }
  const got = ripemd160(sha256(pub));
  for (let i = 0; i < 20; i++) {
    if (got[i] !== prog[i]) {
      throw new RegistryProblem(401, 'badSignature', 'Signature does not match wallet');
    }
  }
}

export function assertEnvelope(
  env: SigningEnvelope,
  chain: ChainId,
  commandKind: CommandKind,
  command: unknown,
): void {
  if (env.messageVersion !== 1) {
    throw new RegistryProblem(400, 'badEnvelope', 'messageVersion must be 1');
  }
  if (env.chain !== chain) {
    throw new RegistryProblem(400, 'chainMismatch', 'Envelope chain does not match header');
  }
  if (env.commandKind !== commandKind) {
    throw new RegistryProblem(400, 'commandKindMismatch', 'commandKind does not match this route');
  }
  const expected = payloadHashHex(command);
  if (env.payloadHash.toLowerCase() !== expected) {
    throw new RegistryProblem(400, 'payloadHashMismatch', 'payloadHash does not match command');
  }
  verifyEnvelopeSignature(env);
}

export function recoveredAddress(env: SigningEnvelope): string {
  const prog = assertP2wpkh(env.wallet, env.chain);
  return encodeP2wpkh(env.chain, prog);
}
