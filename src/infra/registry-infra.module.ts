import { Global, Module } from '@nestjs/common';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import Redis from 'ioredis';
import {
  TokenAdminOverlay,
  TokenChainView,
  TokenEnvelopeLog,
  TokenListingStore,
  TokenPublicReadLimiter,
  TokenReviewStore,
  TokenSecretStore,
  TokenSettings,
  TokenStakeCache,
  TokenStakedWriteLimiter,
  TokenUnstakedWriteLimiter,
} from '../domain/constants';
import { AdminOverlayService } from '../cli/admin-overlay.service';
import { DynamoListingStore } from './dynamo/listing-store';
import { DynamoReviewStore } from './dynamo/review-store';
import { MemoryChainView } from './memory/chain-view';
import { MemoryListingStore } from './memory/listing-store';
import { MemoryRateAdapters } from './memory/rate';
import { MemoryReviewStore } from './memory/review-store';
import { RedisRateAdapters } from './redis/rate';
import { RpcChainView } from './rpc/chain-view';
import { AwsSecretsManagerSecretStore } from './secrets/aws-sm';
import { EnvFileSecretStore, StaticSecretStore } from './secrets/env-file';
import type { RegistrySettings, SecretStore } from '../ports/secret-store';

export function secretStoreFromEnv(): SecretStore {
  if (process.env.REGISTRY_SETTINGS_FILE) {
    return new EnvFileSecretStore(process.env.REGISTRY_SETTINGS_FILE);
  }
  if (process.env.REGISTRY_SECRET_ARN || process.env.REGISTRY_SECRET_NAME) {
    return new AwsSecretsManagerSecretStore(process.env.REGISTRY_SECRET_ARN ?? process.env.REGISTRY_SECRET_NAME!);
  }
  return new StaticSecretStore({
    listingStore: { kind: 'memory' },
    cacheStore: { kind: 'memory' },
    chainRpc: {},
    corsOrigins: ['https://mine.federationcoin.org'],
    trustedProxyHops: 1,
  });
}

@Global()
@Module({
  providers: [
    {
      provide: TokenSecretStore,
      useFactory: secretStoreFromEnv,
    },
    {
      provide: TokenSettings,
      useFactory: async (store: SecretStore): Promise<RegistrySettings> => store.load(),
      inject: [TokenSecretStore],
    },
    {
      provide: TokenListingStore,
      useFactory: (settings: RegistrySettings) => {
        if (settings.listingStore.kind === 'dynamo') {
          const client = new DynamoDBClient({ region: settings.listingStore.region });
          return new DynamoListingStore(settings.listingStore.poolsTable, client);
        }
        return new MemoryListingStore();
      },
      inject: [TokenSettings],
    },
    {
      provide: TokenReviewStore,
      useFactory: (settings: RegistrySettings) => {
        if (settings.listingStore.kind === 'dynamo') {
          const client = new DynamoDBClient({ region: settings.listingStore.region });
          return new DynamoReviewStore(settings.listingStore.reviewsTable, client);
        }
        return new MemoryReviewStore();
      },
      inject: [TokenSettings],
    },
    {
      provide: 'RateBundle',
      useFactory: (settings: RegistrySettings) => {
        if (settings.cacheStore.kind === 'redis') {
          const redis = new Redis(settings.cacheStore.url, { password: settings.cacheStore.password });
          return new RedisRateAdapters(redis);
        }
        return new MemoryRateAdapters();
      },
      inject: [TokenSettings],
    },
    { provide: TokenStakeCache, useExisting: 'RateBundle' },
    { provide: TokenPublicReadLimiter, useExisting: 'RateBundle' },
    { provide: TokenUnstakedWriteLimiter, useExisting: 'RateBundle' },
    { provide: TokenStakedWriteLimiter, useExisting: 'RateBundle' },
    { provide: TokenEnvelopeLog, useExisting: 'RateBundle' },
    {
      provide: TokenChainView,
      useFactory: (settings: RegistrySettings) => {
        if (settings.chainRpc.testnet?.hosts?.length) {
          return new RpcChainView(settings.chainRpc);
        }
        return new MemoryChainView();
      },
      inject: [TokenSettings],
    },
    AdminOverlayService,
    { provide: TokenAdminOverlay, useExisting: AdminOverlayService },
  ],
  exports: [
    TokenListingStore,
    TokenReviewStore,
    TokenStakeCache,
    TokenPublicReadLimiter,
    TokenUnstakedWriteLimiter,
    TokenStakedWriteLimiter,
    TokenEnvelopeLog,
    TokenChainView,
    TokenSecretStore,
    TokenSettings,
    TokenAdminOverlay,
  ],
})
export class RegistryInfraModule {}
