export const PACKAGE_VERSION = '0.2.3';

/** Sparrow Standard (Electrum) and node signmessage. */
export const BitcoinSignedMessageMagic = 'Bitcoin Signed Message:\n';

/** Optional FederationCoin prefix. Verify tries Bitcoin first, then this. */
export const RegistrySignedMessageMagic = 'FederationCoin Signed Message:\n';

export const SignedMessageMagics = [BitcoinSignedMessageMagic, RegistrySignedMessageMagic] as const;

export const Rtx3090TiBlake2bHashesPerSecond = 5_000_000_000;

export const RejectedAdvertisePort = new Set([35332, 6379, 3306]);

export const EnvelopeBodyCapBytes = 8192;
export const CommandBodyCapBytes = 8192;

export const OpenSeasonLiveCap = 100;
export const LaunchTipWindow = 48;
export const SteadyTipWindow = 2;
export const TargetSpacingSeconds = 600;
export const SpacingSlack = 0.2;
export const DifficultyPeriodBlocks = 2016;
export const HiddenAfterMs = 24 * 60 * 60 * 1000;
export const SampleCap = 48;
export const FindPageSize = 20;

export const LiveTenants = ['testnet'] as const;
export type ChainId = 'testnet' | 'main';

export const HrpByChain: Record<ChainId, string> = {
  testnet: 'tgfcn',
  main: 'gfcn',
};

export const TokenWallet = 'WALLET';
export const TokenChain = 'CHAIN';
export const TokenEnvelope = 'ENVELOPE';
export const TokenListingStore = 'ListingStore';
export const TokenReviewStore = 'ReviewStore';
export const TokenAttestationStore = 'AttestationStore';
export const TokenTrustCache = 'TrustCache';
export const TokenStakeCache = 'StakeCache';
export const TokenPublicReadLimiter = 'PublicReadRateLimiter';
export const TokenUnstakedWriteLimiter = 'UnstakedWriteRateLimiter';
export const TokenStakedWriteLimiter = 'StakedWriteRateLimiter';
export const TokenChainView = 'ChainView';
export const TokenSecretStore = 'SecretStore';
export const TokenAdminOverlay = 'AdminOverlay';
export const TokenEnvelopeLog = 'EnvelopeLog';
export const TokenSettings = 'RegistrySettings';
