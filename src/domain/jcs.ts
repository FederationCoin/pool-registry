import canonicalize from 'canonicalize';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

export function jcs(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) {
    throw new Error('cannot canonicalize');
  }
  return out;
}

export function payloadHashHex(command: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(jcs(command))));
}

export function signedPayloadHash(
  command: unknown,
  signingBlockHeight: number,
  signingBlockHash: string,
): string {
  return payloadHashHex({ command, signingBlockHeight, signingBlockHash });
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(text)));
}
