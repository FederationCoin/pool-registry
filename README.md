# FederationCoin pool registry

Public NestJS directory of pools. Mill Find at `mine.federationcoin.org`
talks to whichever `registryBaseUrl` it is configured with (origin default
`https://pools.federationcoin.org`). This process is **not**
`federation-pool` (Stratum / DATUM WSS).

MIT. `"private": true` — GitHub must not `npm publish` or `docker push`.
Runtime images are laptop `scripts/deploy/push-images.sh` to private ECR.

OpenAPI `/v1` is [`openapi/registry.yaml`](openapi/registry.yaml). Version
here **must** equal `package.json` `version`.

## Run locally

Copy `settings.example.json` to `settings.local.json` (never commit
secrets). Then:

```bash
npm ci
npm test
REGISTRY_SETTINGS_FILE=./settings.local.json npm run start:dev
```

Writes are a Sparrow Sign/Verify of the 64-hex `payloadHash` (message
magic `FederationCoin Signed Message:\\n`). Dummy MAIN is not a live
tenant.

## Helm

Chart: `deploy/chart`. Connection strings come from a SecretStore / K8s
Secret named by values. Do not put AWS account ids in this repo.
