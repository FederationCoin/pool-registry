import { RejectedAdvertisePort } from './constants';
import { RegistryProblem, type AttestConnect, type HostPort, type ListingConnect, type StratumWssAdvertise } from './types';

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

export function advertiseHosts(connect: ListingConnect): string[] {
  const hosts: string[] = [];
  if (connect.kind === 'stratumOnly' || connect.kind === 'stratumAndDatum') {
    hosts.push(connect.stratum.host);
  }
  if (connect.kind === 'datumOnly' || connect.kind === 'stratumAndDatum') {
    hosts.push(connect.datum.host);
  }
  if (connect.wss) {
    hosts.push(connect.wss.host);
  }
  return hosts;
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

export function assertBrandAndConnect(websiteUrl: string, connect: ListingConnect): string {
  const websiteHost = new URL(websiteUrl).hostname;
  const domains = new Set([registrableDomain(websiteHost), ...advertiseHosts(connect).map(registrableDomain)]);
  if (domains.size !== 1) {
    throw new RegistryProblem(400, 'mixedDomain', MixedRegistrableDomainTitle, MixedRegistrableDomainDetail);
  }
  return [...domains][0];
}

function assertHostPort(hp: HostPort): void {
  assertPublicAdvertiseHost(hp.host);
  assertAdvertisePort(hp.port);
}

function assertWss(wss?: StratumWssAdvertise): void {
  if (!wss) {
    return;
  }
  if (wss.path.length > 128 || !wss.path.startsWith('/')) {
    throw new RegistryProblem(400, 'badConnect', 'WSS path is invalid');
  }
  assertPublicAdvertiseHost(wss.host);
}

export function assertListingConnect(connect: unknown): ListingConnect {
  if (!connect || typeof connect !== 'object') {
    throw new RegistryProblem(400, 'badConnect', 'ListingConnect is required');
  }
  const c = connect as ListingConnect;
  if (c.kind === 'stratumOnly') {
    if (!c.stratum) {
      throw new RegistryProblem(400, 'badConnect', 'Stratum is required');
    }
    assertHostPort(c.stratum);
    assertWss(c.wss);
    return c;
  }
  if (c.kind === 'datumOnly') {
    if (!c.datum) {
      throw new RegistryProblem(400, 'badConnect', 'DATUM is required');
    }
    assertHostPort(c.datum);
    assertWss(c.wss);
    return c;
  }
  if (c.kind === 'stratumAndDatum') {
    if (!c.stratum || !c.datum) {
      throw new RegistryProblem(400, 'badConnect', 'Stratum and DATUM are required');
    }
    assertHostPort(c.stratum);
    assertHostPort(c.datum);
    assertWss(c.wss);
    return c;
  }
  throw new RegistryProblem(400, 'badConnect', 'ListingConnect kind is invalid');
}

export function hasDatum(connect: ListingConnect): boolean {
  return connect.kind === 'datumOnly' || connect.kind === 'stratumAndDatum';
}

export function advertisedAttestConnect(
  connect: ListingConnect,
  kind: AttestConnect['kind'],
): AttestConnect | undefined {
  if (kind === 'stratum') {
    if (connect.kind === 'datumOnly') {
      return undefined;
    }
    return { kind: 'stratum', host: connect.stratum.host, port: connect.stratum.port };
  }
  if (connect.kind === 'stratumOnly') {
    return undefined;
  }
  return { kind: 'datum', host: connect.datum.host, port: connect.datum.port };
}

function foldHost(host: string): string {
  return host.trim().toLowerCase();
}

export function attestConnectEquals(a: AttestConnect, b: AttestConnect): boolean {
  return a.kind === b.kind && foldHost(a.host) === foldHost(b.host) && a.port === b.port;
}

export function attestConnectMatchesListing(recorded: AttestConnect | undefined, listing: ListingConnect): boolean {
  if (!recorded) {
    return false;
  }
  const current = advertisedAttestConnect(listing, recorded.kind);
  return !!current && attestConnectEquals(recorded, current);
}

export function assertAttestConnect(listing: ListingConnect, connect: unknown): AttestConnect {
  if (!connect || typeof connect !== 'object') {
    throw new RegistryProblem(
      400,
      'connectChanged',
      'That Stratum or DATUM host is not what this listing advertises now.',
    );
  }
  const c = connect as AttestConnect;
  if (c.kind !== 'stratum' && c.kind !== 'datum') {
    throw new RegistryProblem(
      400,
      'connectChanged',
      'That Stratum or DATUM host is not what this listing advertises now.',
    );
  }
  if (typeof c.host !== 'string' || !Number.isInteger(c.port)) {
    throw new RegistryProblem(
      400,
      'connectChanged',
      'That Stratum or DATUM host is not what this listing advertises now.',
    );
  }
  const current = advertisedAttestConnect(listing, c.kind);
  if (!current || !attestConnectEquals({ kind: c.kind, host: c.host, port: c.port }, current)) {
    throw new RegistryProblem(
      400,
      'connectChanged',
      'That Stratum or DATUM host is not what this listing advertises now.',
    );
  }
  return { kind: c.kind, host: current.host, port: current.port };
}
