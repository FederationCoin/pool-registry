import type { ChainId } from '../domain/constants';

export type BlockHeader = {
  hash: string;
  height: number;
  nBits: number;
  time: number;
  previousblockhash?: string;
};

export type WalletTx = {
  height: number;
  balanceAfterSats: bigint;
};

export type CoinbaseInspect = {
  height: number;
  tag?: string;
  addresses: string[];
};

export interface ChainView {
  getTip(chain: ChainId): Promise<{ height: number; hash: string; nBits: number; subsidySats: bigint }>;
  getBlockHeader(chain: ChainId, hash: string): Promise<BlockHeader | undefined>;
  getBalance(chain: ChainId, wallet: string): Promise<bigint>;
  iterWalletTx(chain: ChainId, wallet: string, fromHeight: number, toHeight: number): Promise<WalletTx[]>;
  lastRetargetMedianSpacingSeconds(chain: ChainId): Promise<number | undefined>;
  networkHashps(chain: ChainId): Promise<number>;
  inspectCoinbase(chain: ChainId, height: number): Promise<{ tag?: string; addresses: string[] }>;
  inspectCoinbaseWindow(chain: ChainId, fromHeight: number, toHeight: number): Promise<CoinbaseInspect[]>;
}
