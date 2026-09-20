import { RejectedAdvertisePort } from './constants';
import {
  MaxPoolConnections,
  MaxPoolConnectionsPerKind,
  RegistryProblem,
  type ConnectionKind,
  type HostPort,
  type LegacyListingConnect,
  type PoolConnection,
} from './types';

const CLUSTER_DNS = /\.svc\.cluster\.local$/i;
const V4 =
  /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.|0\.|255\.)/;
const V6_LOCAL =
  /^(?:::1$|fe80:|fc|fd|::ffff:(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.))/i;

export function assertPublicAdvertiseHost(host: string): void {
  const h = host.trim().toLowerCase();
  if (!h || h.length > 253) {
    throw new RegistryProblem(400, 'badHost', 'Advertised host is not public');
  }
  if (h === 'localhost' || h.endsWith('.localhost') || h === 'metadata' || h === 'metadata.google.internal') {
    throw new RegistryProblem(400, 'badHost', 'Advertised host is not public');
  }
  if (CLUSTER_DNS.test(h) || h === 'kubernetes' || h.endsWith('.internal')) {
    throw new RegistryProblem(400, 'badHost', 'Advertised host is not public');
  }
  if (h === '169.254.169.254' || h === '[::1]' || h === '::1') {
    throw new RegistryProblem(400, 'badHost', 'Advertised host is not public');
  }
  const bare = h.replace(/^\[|\]$/g, '');
  if (V4.test(bare) || V6_LOCAL.test(bare)) {
    throw new RegistryProblem(400, 'badHost', 'Advertised host is not public');
  }
}

export function assertAdvertisePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RegistryProblem(400, 'rejectedPort', 'Advertised port is not allowed');
  }
  if (RejectedAdvertisePort.has(port)) {
    throw new RegistryProblem(400, 'rejectedPort', 'Advertised port is not allowed');
  }
}

export const MixedRegistrableDomainTitle =
  "Brand, Stratum, and DATUM must share one domain so a listing cannot point your brand at someone else's pool";
export const MixedRegistrableDomainDetail =
  'The leftover risk is a dead hostname or wrong port on a domain you already control, not a hijack onto a foreign pool.';

const MULTI_PART_PUBLIC_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'co.jp',
  'com.br',
  'com.mx',
  'co.za',
]);

export function registrableDomain(host: string): string {
  const h = host.trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!h) {
    throw new RegistryProblem(400, 'mixedDomain', MixedRegistrableDomainTitle, MixedRegistrableDomainDetail);
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || h.includes(':')) {
    return h;
  }
  const parts = h.split('.').filter(Boolean);
  if (parts.length < 2) {
    throw new RegistryProblem(400, 'mixedDomain', MixedRegistrableDomainTitle, MixedRegistrableDomainDetail);
  }
  const last2 = parts.slice(-2).join('.');
  if (parts.length >= 3 && MULTI_PART_PUBLIC_SUFFIXES.has(last2)) {
    return parts.slice(-3).join('.');
  }
  return last2;
}

export function assertWebsiteUrl(url: string | undefined): string {
  if (!url) {
    throw new RegistryProblem(400, 'badHost', 'websiteUrl is required');
  }
  if (url.length > 256) {
    throw new RegistryProblem(400, 'badHost', 'websiteUrl is too long');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RegistryProblem(400, 'badHost', 'websiteUrl must be https');
  }
  if (parsed.protocol !== 'https:') {
    throw new RegistryProblem(400, 'badHost', 'websiteUrl must be https');
  }
  if (parsed.username || parsed.password) {
    throw new RegistryProblem(400, 'badHost', 'websiteUrl must not include userinfo');
  }
  assertPublicAdvertiseHost(parsed.hostname);
  return url;
}

function badConnect(title = 'Connection list is invalid'): never {
  throw new RegistryProblem(400, 'badConnect', title);
}

function parseHostPort(url: string): HostPort {
  const t = url.trim();
  if (!t || t.includes('://') || t.includes('/')) {
    badConnect('TCP connect is host:port');
  }
  const idx = t.lastIndexOf(':');
  if (idx <= 0 || idx === t.length - 1) {
    badConnect('TCP connect is host:port');
  }
  const host = t.slice(0, idx);
  const port = Number(t.slice(idx + 1));
  assertPublicAdvertiseHost(host);
  assertAdvertisePort(port);
  return { host, port };
}

function parseWssUrl(url: string): { host: string; path: string } {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    badConnect('WebSocket URL must be wss://host/path');
  }
  if (parsed.protocol !== 'wss:') {
    badConnect('WebSocket URL must be wss://');
  }
  if (parsed.username || parsed.password) {
    badConnect('WebSocket URL must not include userinfo');
  }
  const path = parsed.pathname || '/';
  if (path.length > 128 || !path.startsWith('/')) {
    badConnect('WSS path is invalid');
  }
  assertPublicAdvertiseHost(parsed.hostname);
  return { host: parsed.hostname, path };
}

export function connectionHost(c: PoolConnection): string {
  if (c.kind === 'stratumWs' || c.kind === 'datumPrimeWs') {
    return parseWssUrl(c.url).host;
  }
  return parseHostPort(c.url).host;
}

export function foldConnection(c: PoolConnection): PoolConnection {
  const kind = c.kind;
  const url = c.url.trim();
  if (kind === 'stratum' || kind === 'datumPrime') {
    const hp = parseHostPort(url);
    return { kind, url: `${hp.host.trim().toLowerCase()}:${hp.port}` };
  }
  const wss = parseWssUrl(url);
  return { kind, url: `wss://${wss.host}${wss.path}` };
}

export function advertiseHosts(connections: PoolConnection[]): string[] {
  return connections.map(connectionHost);
}

export function assertBrandAndConnect(websiteUrl: string, connections: PoolConnection[]): string {
  const websiteHost = new URL(websiteUrl).hostname;
  const domains = new Set([registrableDomain(websiteHost), ...advertiseHosts(connections).map(registrableDomain)]);
  if (domains.size !== 1) {
    throw new RegistryProblem(400, 'mixedDomain', MixedRegistrableDomainTitle, MixedRegistrableDomainDetail);
  }
  return [...domains][0]!;
}

function isConnectionKind(v: unknown): v is ConnectionKind {
  return v === 'stratum' || v === 'stratumWs' || v === 'datumPrime' || v === 'datumPrimeWs';
}

export function assertPoolConnections(raw: unknown): PoolConnection[] {
  if (!Array.isArray(raw) || raw.length < 1) {
    badConnect('At least one connection is required');
  }
  if (raw.length > MaxPoolConnections) {
    badConnect('At most 12 connections');
  }
  const counts: Record<ConnectionKind, number> = {
    stratum: 0,
    stratumWs: 0,
    datumPrime: 0,
    datumPrimeWs: 0,
  };
  const out: PoolConnection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      badConnect();
    }
    const rec = item as { kind?: unknown; url?: unknown };
    if (!isConnectionKind(rec.kind) || typeof rec.url !== 'string') {
      badConnect();
    }
    counts[rec.kind] += 1;
    if (counts[rec.kind] > MaxPoolConnectionsPerKind) {
      badConnect('At most 3 of each connection type');
    }
    out.push(foldConnection({ kind: rec.kind, url: rec.url }));
  }
  return out;
}

export function connectionsFromLegacy(connect: LegacyListingConnect): PoolConnection[] {
  const out: PoolConnection[] = [];
  if (connect.kind === 'stratumOnly' || connect.kind === 'stratumAndDatum') {
    out.push({ kind: 'stratum', url: `${connect.stratum.host}:${connect.stratum.port}` });
  }
  if (connect.kind === 'datumOnly' || connect.kind === 'stratumAndDatum') {
    out.push({ kind: 'datumPrime', url: `${connect.datum.host}:${connect.datum.port}` });
  }
  if (connect.wss) {
    out.push({ kind: 'stratumWs', url: `wss://${connect.wss.host}${connect.wss.path}` });
  }
  return out;
}

function isLegacyConnect(v: unknown): v is LegacyListingConnect {
  if (!v || typeof v !== 'object') {
    return false;
  }
  const kind = (v as { kind?: unknown }).kind;
  return kind === 'stratumOnly' || kind === 'datumOnly' || kind === 'stratumAndDatum';
}

export function listingConnections(row: { connections?: unknown; connect?: unknown }): PoolConnection[] {
  if (Array.isArray(row.connections) && row.connections.length > 0) {
    return assertPoolConnections(row.connections);
  }
  if (isLegacyConnect(row.connect)) {
    return connectionsFromLegacy(row.connect);
  }
  badConnect('At least one connection is required');
}

export function hasDatum(connections: PoolConnection[]): boolean {
  return connections.some((c) => c.kind === 'datumPrime' || c.kind === 'datumPrimeWs');
}

function foldUrl(url: string): string {
  return url.trim().toLowerCase();
}

export function connectionEquals(a: PoolConnection, b: PoolConnection): boolean {
  return a.kind === b.kind && foldUrl(a.url) === foldUrl(b.url);
}

export function attestConnectMatchesListing(
  recorded: PoolConnection | undefined,
  connections: PoolConnection[],
): boolean {
  if (!recorded) {
    return false;
  }
  return connections.some((c) => connectionEquals(c, recorded));
}

export function assertAttestConnect(connections: PoolConnection[], connect: unknown): PoolConnection {
  if (!connect || typeof connect !== 'object') {
    throw new RegistryProblem(
      400,
      'connectChanged',
      'That endpoint is not what this listing advertises now.',
    );
  }
  const rec = connect as { kind?: unknown; url?: unknown };
  if (!isConnectionKind(rec.kind) || typeof rec.url !== 'string') {
    throw new RegistryProblem(
      400,
      'connectChanged',
      'That endpoint is not what this listing advertises now.',
    );
  }
  const want = foldConnection({ kind: rec.kind, url: rec.url });
  const current = connections.find((c) => connectionEquals(c, want));
  if (!current) {
    throw new RegistryProblem(
      400,
      'connectChanged',
      'That endpoint is not what this listing advertises now.',
    );
  }
  return current;
}
