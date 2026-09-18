import { Logger } from '@nestjs/common';
import type { ChainId } from '../../domain/constants';
import type { BlockHeader, ChainView, WalletTx } from '../../ports/chain-view';

export type MemoryChainState = {
  height: number;
  hash: string;
  nBits: number;
  subsidySats: bigint;
  headers: Map<string, BlockHeader>;
  balances: Map<string, bigint>;
  txs: Map<string, WalletTx[]>;
  spacing?: number;
  hashps: number;
  coinbases: Map<number, { tag?: string; addresses: string[] }>;
};

export function emptyChainState(): MemoryChainState {
  const hash = 'ab'.repeat(32);
  const headers = new Map<string, BlockHeader>([
    [hash, { hash, height: 10, nBits: 0x1d00ffff, time: Math.floor(Date.now() / 1000) }],
  ]);
  return {
    height: 10,
    hash,
    nBits: 0x1d00ffff,
    subsidySats: 50n * 100_000_000n,
    headers,
    balances: new Map(),
    txs: new Map(),
    hashps: 5e9,
    coinbases: new Map(),
  };
}

export class MemoryChainView implements ChainView {
  readonly log = new Logger(MemoryChainView.name);

  constructor(readonly state: MemoryChainState = emptyChainState()) {}

  async getTip(_chain: ChainId) {
    return {
      height: this.state.height,
      hash: this.state.hash,
      nBits: this.state.nBits,
      subsidySats: this.state.subsidySats,
    };
  }

  async getBlockHeader(_chain: ChainId, hash: string) {
    return this.state.headers.get(hash);
  }

  async getBalance(_chain: ChainId, wallet: string) {
    return this.state.balances.get(wallet) ?? 0n;
  }

  async iterWalletTx(_chain: ChainId, wallet: string, fromHeight: number, toHeight: number) {
    return (this.state.txs.get(wallet) ?? []).filter((t) => t.height >= fromHeight && t.height <= toHeight);
  }

  async lastRetargetMedianSpacingSeconds() {
    return this.state.spacing;
  }

  async networkHashps() {
    return this.state.hashps;
  }

  async inspectCoinbase(_chain: ChainId, height: number) {
    return this.state.coinbases.get(height) ?? { addresses: [] };
  }
}
