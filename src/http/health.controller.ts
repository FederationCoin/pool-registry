import { Controller, Get, Header, Inject } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { PACKAGE_VERSION, TokenChainView, TokenListingStore, type ChainId } from '../domain/constants';
import { RegistryProblem } from '../domain/types';
import type { ChainView } from '../ports/chain-view';
import type { ListingStore } from '../ports/listing-store';

@Controller()
export class HealthController {
  constructor(
    @Inject(TokenListingStore) private readonly listings: ListingStore,
    @Inject(TokenChainView) private readonly chain: ChainView,
  ) {}

  @Get('healthz')
  healthz() {
    return { status: 'ok', version: PACKAGE_VERSION };
  }

  @Get('readyz')
  async readyz() {
    try {
      await this.listings.countLive('testnet');
      await this.chain.getTip('testnet' as ChainId);
    } catch {
      throw new RegistryProblem(503, 'notReady', 'Store, cache, or chain tip is not ready');
    }
    return { status: 'ready' };
  }
}

@Controller()
export class DocsController {
  @Get('openapi.json')
  @Header('content-type', 'application/json')
  openapi() {
    const p = process.env.OPENAPI_PATH ?? join(process.cwd(), 'openapi/registry.yaml');
    return yaml.load(readFileSync(p, 'utf8'));
  }

  @Get('docs')
  @Header('content-type', 'text/html; charset=utf-8')
  docs() {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Pool registry</title></head><body><h1>FederationCoin pool registry</h1><p>OpenAPI at <a href="/v1/openapi.json">/v1/openapi.json</a>. Dummy MAIN is not live.</p></body></html>`;
  }
}
