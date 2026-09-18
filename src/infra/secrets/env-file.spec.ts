import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnvFileSecretStore, StaticSecretStore } from './env-file';

describe('secret stores', () => {
  it('loads a settings file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reg-'));
    const path = join(dir, 'settings.json');
    await writeFile(
      path,
      JSON.stringify({
        listingStore: { kind: 'memory' },
        cacheStore: { kind: 'memory' },
        chainRpc: {},
        corsOrigins: ['https://mine.federationcoin.org'],
      }),
    );
    const s = await new EnvFileSecretStore(path).load();
    expect(s.listingStore.kind).toBe('memory');
    expect(s.trustedProxyHops).toBe(1);
  });

  it('returns static settings', async () => {
    const s = await new StaticSecretStore({
      listingStore: { kind: 'memory' },
      cacheStore: { kind: 'memory' },
      chainRpc: {},
      corsOrigins: [],
      trustedProxyHops: 2,
    }).load();
    expect(s.trustedProxyHops).toBe(2);
  });
});
