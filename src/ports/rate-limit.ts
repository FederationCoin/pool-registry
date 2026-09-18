export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export interface PublicReadRateLimiter {
  hitPublicRead(ip: string): Promise<RateLimitResult>;
}

export interface UnstakedWriteRateLimiter {
  hitUnstakedWrite(ip: string, wallet: string): Promise<RateLimitResult>;
  clearUnstaked(ip: string, wallet: string): Promise<void>;
}

export interface StakedWriteRateLimiter {
  hitStakedWrite(wallet: string): Promise<RateLimitResult>;
}

export interface EnvelopeLog {
  seen(hashHex: string): Promise<boolean>;
  remember(hashHex: string): Promise<void>;
}
