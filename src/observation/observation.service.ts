import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LiveTenants, TokenChainView, TokenListingStore, type ChainId } from '../domain/constants';
import { pushSample } from '../domain/metrics';
import type { ChainView } from '../ports/chain-view';
import type { ListingStore } from '../ports/listing-store';
import { ListingsService } from '../listings/listings.service';

@Injectable()
export class ObservationService {
  private readonly log = new Logger(ObservationService.name);

  constructor(
    @Inject(TokenListingStore) private readonly listings: ListingStore,
    @Inject(TokenChainView) private readonly chain: ChainView,
    private readonly listingsApi: ListingsService,
  ) {}

  @Cron('0 * * * *')
  async tick(): Promise<void> {
    for (const chain of LiveTenants) {
      await this.observe(chain);
      await this.listingsApi.hideExpired(chain);
    }
  }

  async observe(chain: ChainId): Promise<void> {
    const tip = await this.chain.getTip(chain);
    const rows = await this.listings.listAll(chain);
    const hashps = await this.chain.networkHashps(chain);
    const coinbase = await this.chain.inspectCoinbase(chain, tip.height);
    const now = new Date().toISOString();
    for (const row of rows) {
      const tagHit = row.name && coinbase.tag && coinbase.tag.includes(row.name.slice(0, 8));
      const addrHit = coinbase.addresses.includes(row.operatorWallet);
      if (!tagHit && !addrHit) {
        continue;
      }
      const next = {
        ...row,
        coinbaseTag: coinbase.tag,
        lastAttributedBlockAt: now,
      };
      delete next.hiddenAt;
      const attributed = rows.filter((r) => r.poolId === row.poolId).length;
      void attributed;
      next.metrics = pushSample(row.metrics, {
        at: now,
        blocksFound: 1,
        hashrate: hashps,
      });
      await this.listings.put(next);
    }
  }
}
