import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { RegistrySettings, SecretStore } from '../../ports/secret-store';

export class AwsSecretsManagerSecretStore implements SecretStore {
  constructor(
    private readonly secretId: string,
    private readonly client = new SecretsManagerClient({}),
  ) {}

  async load(): Promise<RegistrySettings> {
    const out = await this.client.send(new GetSecretValueCommand({ SecretId: this.secretId }));
    if (!out.SecretString) {
      throw new Error('Registry secret is empty');
    }
    const raw = JSON.parse(out.SecretString) as RegistrySettings;
    if (!raw.listingStore || !raw.cacheStore || !Array.isArray(raw.corsOrigins)) {
      throw new Error('Registry secret is incomplete');
    }
    return { ...raw, trustedProxyHops: raw.trustedProxyHops ?? 1 };
  }
}
