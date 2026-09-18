export interface AdminOverlay {
  setHostileFlag(reviewerWallet: string, poolId: string, justification: string): Promise<void>;
  withdrawHostileFlag(reviewerWallet: string, poolId: string, note: string): Promise<void>;
}
