import type { ChainId } from './constants';

export type CommandKind =
  | 'registerListing'
  | 'updateListing'
  | 'heartbeatListing'
  | 'deregisterListing'
  | 'postReview'
  | 'postRebuttal'
  | 'attestListing';

export type HostPort = { host: string; port: number };
export type StratumWssAdvertise = { host: string; path: string };

export type StratumOnlyAdvertise = {
  kind: 'stratumOnly';
  stratum: HostPort;
  wss?: StratumWssAdvertise;
};
export type DatumOnlyAdvertise = {
  kind: 'datumOnly';
  datum: HostPort;
  wss?: StratumWssAdvertise;
};
export type StratumAndDatumAdvertise = {
  kind: 'stratumAndDatum';
  stratum: HostPort;
  datum: HostPort;
  wss?: StratumWssAdvertise;
};
export type ListingConnect = StratumOnlyAdvertise | DatumOnlyAdvertise | StratumAndDatumAdvertise;

export type AttestConnect =
  | { kind: 'stratum'; host: string; port: number }
  | { kind: 'datum'; host: string; port: number };

export type SigningEnvelope = {
  messageVersion: number;
  commandKind: CommandKind;
  chain: ChainId;
  wallet: string;
  payloadHash: string;
  signature: string;
  signingBlockHash: string;
  signingBlockHeight: number;
};

export type OpenSeasonStakeCheck = {
  kind: 'openSeason';
  metMinBalance: boolean;
  stakeRequiredSats: string;
};
export type SeasonedStakeCheck = {
  kind: 'seasoned';
  metMinBalance: boolean;
  stakeRequiredSats: string;
  holdOk: boolean;
};
export type StakeCheck = OpenSeasonStakeCheck | SeasonedStakeCheck;

export type MetricSample = { at: string; blocksFound: number; hashrate: number };
export type MetricsOverlay = {
  blocksFound?: number;
  hashrate?: number;
  volatility?: number;
  samples?: MetricSample[];
};

export type HostileFlag = {
  justification: string;
  setAt: string;
  withdrawnAt?: string;
  withdrawNote?: string;
};

export type ReviewRebuttal = {
  text: string;
  envelope: SigningEnvelope;
  hostileFlag?: HostileFlag;
};

export type ReviewRecord = {
  reviewerWallet: string;
  poolId: string;
  chain: ChainId;
  starRating: number;
  text: string;
  createdAt: string;
  confirmedMiner?: boolean;
  rebuttal?: ReviewRebuttal;
};

export type AttestationRecord = {
  attesterWallet: string;
  poolId: string;
  chain: ChainId;
  createdAt: string;
  height: number;
  envelope: SigningEnvelope;
  connect?: AttestConnect;
};

export type ListingRecord = {
  poolId: string;
  chain: ChainId;
  operatorWallet: string;
  name: string;
  nameNormalized: string;
  websiteUrl: string;
  listingDomain: string;
  distributionAlgo?: string;
  templateWriteup?: string;
  feeText?: string;
  connect: ListingConnect;
  coinbaseTag: string;
  lastAttributedBlockAt?: string;
  hiddenAt?: string;
  heartbeatAt?: string;
  createdAt: string;
  stakeCheck: StakeCheck;
  metrics?: MetricsOverlay;
  registrationEnvelope: SigningEnvelope;
};

export type ListingTrustRow = {
  chain: ChainId;
  poolId: string;
  asOfHeight: number;
  attestationCount: number;
  listerConfirmedCoinbasePayee: boolean;
};

export type ListingPublic = {
  poolId: string;
  chain: ChainId;
  operatorWallet: string;
  name: string;
  websiteUrl: string;
  listingDomain: string;
  distributionAlgo?: string;
  templateWriteup?: string;
  feeText?: string;
  connect: ListingConnect;
  coinbaseTag: string;
  metrics?: MetricsOverlay;
  reviewScore: number;
  hasHostileFlag: boolean;
  heartbeatAt?: string;
  createdAt?: string;
  attestationCount: number;
  listerConfirmedCoinbasePayee: boolean;
};

export type FindGroup = {
  domain: string;
  listings: ListingPublic[];
  multipleClaims: boolean;
};

export type StakeCacheRow = {
  chain: ChainId;
  wallet: string;
  asOfHeight: number;
  balanceSats: string;
  holdOk: boolean;
  stakeRequiredSats: string;
};

export type StakePreviewResult =
  | { kind: 'stakeReady' }
  | { kind: 'stakeWaiting'; qualifiesAtHeight: number }
  | { kind: 'stakeInsufficient' };

export type RegistryErrorCode =
  | 'missingChain'
  | 'unknownChain'
  | 'chainMismatch'
  | 'badEnvelope'
  | 'badWallet'
  | 'commandKindMismatch'
  | 'payloadHashMismatch'
  | 'badSignature'
  | 'tipWindow'
  | 'stakeInsufficient'
  | 'notOperator'
  | 'badHost'
  | 'rejectedPort'
  | 'badConnect'
  | 'connectChanged'
  | 'unknownField'
  | 'duplicateEnvelope'
  | 'duplicateReview'
  | 'duplicateListing'
  | 'duplicateAttestation'
  | 'notFound'
  | 'rateLimited'
  | 'notReady'
  | 'mixedDomain'
  | 'attestationUnproven';

export type ProblemBody = {
  type: string;
  title: string;
  status: number;
  code: RegistryErrorCode;
  detail?: string;
};

export class RegistryProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: RegistryErrorCode,
    readonly title: string,
    readonly detail?: string,
  ) {
    super(title);
    this.name = 'RegistryProblem';
  }

  toBody(): ProblemBody {
    return {
      type: `https://pools.federationcoin.org/problems/${this.code}`,
      title: this.title,
      status: this.status,
      code: this.code,
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }
}
