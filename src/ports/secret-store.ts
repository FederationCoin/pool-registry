import type { ChainId } from '../domain/constants';

export type DynamoListingSettings = {
  kind: 'dynamo';
  region: string;
  poolsTable: string;
  reviewsTable: string;
};

export type MemoryListingSettings = {
  kind: 'memory';
};

export type RedisCacheSettings = {
  kind: 'redis';
  url: string;
  password: string;
};

export type MemoryCacheSettings = {
  kind: 'memory';
};

export type RpcChainSettings = {
  hosts: string[];
  username: string;
  password: string;
  explorerBaseUrl?: string;
};

export type RegistrySettings = {
  listingStore: DynamoListingSettings | MemoryListingSettings;
  cacheStore: RedisCacheSettings | MemoryCacheSettings;
  chainRpc: Partial<Record<ChainId, RpcChainSettings>>;
  corsOrigins: string[];
  trustedProxyHops: number;
};

export interface SecretStore {
  load(): Promise<RegistrySettings>;
}
