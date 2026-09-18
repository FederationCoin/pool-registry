import { readFile } from 'node:fs/promises';
import type { RegistrySettings, SecretStore } from '../../ports/secret-store';

export class EnvFileSecretStore implements SecretStore {
  constructor(private readonly path: string) {}

  async load(): Promise<RegistrySettings> {
    const raw = JSON.parse(await readFile(this.path, 'utf8')) as RegistrySettings;
    if (!raw.listingStore || !raw.cacheStore || !Array.isArray(raw.corsOrigins)) {
      throw new Error('Registry settings file is incomplete');
    }
    return {
      ...raw,
      trustedProxyHops: raw.trustedProxyHops ?? 1,
    };
  }
}

export class StaticSecretStore implements SecretStore {
  constructor(private readonly settings: RegistrySettings) {}
  async load(): Promise<RegistrySettings> {
    return this.settings;
  }
}
