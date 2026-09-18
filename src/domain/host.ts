import { RejectedAdvertisePort } from './constants';
import { RegistryProblem, type HostPort, type ListingConnect, type StratumWssAdvertise } from './types';

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

export function assertWebsiteUrl(url: string | undefined): void {
  if (url === undefined) {
    return;
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
