import { bech32 } from 'bech32';
import { HrpByChain, type ChainId } from './constants';
import { RegistryProblem } from './types';

export function assertP2wpkh(wallet: string, chain: ChainId): Uint8Array {
  const trimmed = wallet.trim();
  if (trimmed.length > 90 || !trimmed) {
    throw new RegistryProblem(401, 'badWallet', 'Wallet must be P2WPKH');
  }
  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32.decode(trimmed);
  } catch {
    throw new RegistryProblem(401, 'badWallet', 'Wallet must be P2WPKH');
  }
  if (decoded.prefix !== HrpByChain[chain]) {
    throw new RegistryProblem(401, 'badWallet', 'Wallet must be P2WPKH');
  }
  if (decoded.words[0] !== 0) {
    throw new RegistryProblem(401, 'badWallet', 'Taproot wallets are not accepted');
  }
  const prog = Uint8Array.from(bech32.fromWords(decoded.words.slice(1)));
  if (prog.length !== 20) {
    throw new RegistryProblem(401, 'badWallet', 'Wallet must be P2WPKH');
  }
  return prog;
}

export function encodeP2wpkh(chain: ChainId, hash160: Uint8Array): string {
  const words = [0, ...bech32.toWords(Buffer.from(hash160))];
  return bech32.encode(HrpByChain[chain], words);
}
