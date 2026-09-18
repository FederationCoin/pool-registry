import { Logger } from '@nestjs/common';
import type { ChainId } from '../../domain/constants';
import { DifficultyPeriodBlocks } from '../../domain/constants';
import type { BlockHeader, ChainView, WalletTx } from '../../ports/chain-view';
import type { RpcChainSettings } from '../../ports/secret-store';

type RpcOk = { result: unknown; error: null | { message: string } };

export class RpcChainView implements ChainView {
  private readonly log = new Logger(RpcChainView.name);

  constructor(private readonly byChain: Partial<Record<ChainId, RpcChainSettings>>) {}

  private settings(chain: ChainId): RpcChainSettings {
    const s = this.byChain[chain];
    if (!s) {
      throw new Error('chain rpc is not configured');
    }
    return s;
  }

  private async rpc(chain: ChainId, method: string, params: unknown[] = []): Promise<unknown> {
    const s = this.settings(chain);
    let last: unknown;
    for (const host of s.hosts) {
      try {
        const res = await fetch(host, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Basic ' + Buffer.from(`${s.username}:${s.password}`).toString('base64'),
          },
          body: JSON.stringify({ jsonrpc: '1.0', id: 'registry', method, params }),
        });
        const body = (await res.json()) as RpcOk;
        if (body.error) {
          last = body.error.message;
          continue;
        }
        return body.result;
      } catch (e) {
        last = e;
        this.log.warn('node rpc failed; trying next host');
      }
    }
    throw new Error(typeof last === 'string' ? last : 'chain rpc failed');
  }

  async getTip(chain: ChainId) {
    const info = (await this.rpc(chain, 'getblockchaininfo')) as {
      blocks: number;
      bestblockhash: string;
    };
    const header = (await this.rpc(chain, 'getblockheader', [info.bestblockhash])) as {
      bits: string;
      height: number;
    };
    let subsidySats = 50n * 100_000_000n;
    try {
      const stats = (await this.rpc(chain, 'getblockstats', [info.blocks])) as { subsidy?: number };
      if (typeof stats.subsidy === 'number') {
        subsidySats = BigInt(stats.subsidy);
      }
    } catch {
      const halvings = Math.floor(info.blocks / 210_000);
      subsidySats = (50n * 100_000_000n) >> BigInt(halvings);
    }
    return {
      height: info.blocks,
      hash: info.bestblockhash,
      nBits: Number.parseInt(header.bits, 16),
      subsidySats,
    };
  }

  async getBlockHeader(chain: ChainId, hash: string): Promise<BlockHeader | undefined> {
    try {
      const h = (await this.rpc(chain, 'getblockheader', [hash])) as {
        hash: string;
        height: number;
        bits: string;
        time: number;
        previousblockhash?: string;
      };
      return {
        hash: h.hash,
        height: h.height,
        nBits: Number.parseInt(h.bits, 16),
        time: h.time,
        previousblockhash: h.previousblockhash,
      };
    } catch {
      return undefined;
    }
  }

  private async explorer(chain: ChainId, path: string): Promise<unknown> {
    const s = this.settings(chain);
    if (!s.explorerBaseUrl) {
      return undefined;
    }
    const res = await fetch(`${s.explorerBaseUrl.replace(/\/$/, '')}${path}`);
    if (!res.ok) {
      return undefined;
    }
    return res.json();
  }

  async getBalance(chain: ChainId, wallet: string): Promise<bigint> {
    const data = (await this.explorer(chain, `/api/address/${wallet}`)) as
      | { chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number } }
      | undefined;
    if (!data?.chain_stats) {
      return 0n;
    }
    return BigInt(data.chain_stats.funded_txo_sum ?? 0) - BigInt(data.chain_stats.spent_txo_sum ?? 0);
  }

  async iterWalletTx(chain: ChainId, wallet: string, fromHeight: number, toHeight: number): Promise<WalletTx[]> {
    const data = (await this.explorer(chain, `/api/address/${wallet}/txs`)) as
      | Array<{ status?: { block_height?: number }; vin?: unknown[]; vout?: Array<{ value?: number; scriptpubkey_address?: string }> }>
      | undefined;
    if (!Array.isArray(data)) {
      return [];
    }
    let running = 0n;
    const out: WalletTx[] = [];
    for (const tx of [...data].reverse()) {
      const h = tx.status?.block_height ?? 0;
      const received = (tx.vout ?? [])
        .filter((o) => o.scriptpubkey_address === wallet)
        .reduce((n, o) => n + BigInt(o.value ?? 0), 0n);
      running += received;
      if (h >= fromHeight && h <= toHeight) {
        out.push({ height: h, balanceAfterSats: running });
      }
    }
    return out;
  }

  async lastRetargetMedianSpacingSeconds(chain: ChainId): Promise<number | undefined> {
    const tip = await this.getTip(chain);
    if (tip.height < DifficultyPeriodBlocks) {
      return undefined;
    }
    const start = tip.height - (tip.height % DifficultyPeriodBlocks);
    const header = (await this.rpc(chain, 'getblockheader', [await this.rpc(chain, 'getblockhash', [start])])) as {
      time: number;
    };
    const prev = (await this.rpc(chain, 'getblockheader', [
      await this.rpc(chain, 'getblockhash', [start - DifficultyPeriodBlocks]),
    ])) as { time: number };
    return (header.time - prev.time) / DifficultyPeriodBlocks;
  }

  async networkHashps(chain: ChainId): Promise<number> {
    const n = await this.rpc(chain, 'getnetworkhashps');
    return typeof n === 'number' ? n : 0;
  }

  async inspectCoinbase(chain: ChainId, height: number) {
    const hash = (await this.rpc(chain, 'getblockhash', [height])) as string;
    const block = (await this.rpc(chain, 'getblock', [hash, 2])) as {
      tx: Array<{ vin: Array<{ coinbase?: string }>; vout: Array<{ scriptpubkey_address?: string; value?: number }> }>;
    };
    const cb = block.tx[0];
    const hex = cb.vin[0]?.coinbase ?? '';
    const tag = Buffer.from(hex, 'hex').toString('utf8').replace(/[^\x20-\x7e]/g, '').slice(0, 80);
    const addresses = cb.vout.map((o) => o.scriptpubkey_address).filter((a): a is string => !!a);
    return { tag: tag || undefined, addresses };
  }
}
