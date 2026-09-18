import { Inject, Injectable } from '@nestjs/common';
import { TokenReviewStore } from '../domain/constants';
import { RegistryProblem } from '../domain/types';
import type { AdminOverlay } from '../ports/admin-overlay';
import type { ReviewStore } from '../ports/review-store';

@Injectable()
export class AdminOverlayService implements AdminOverlay {
  constructor(@Inject(TokenReviewStore) private readonly reviews: ReviewStore) {}

  async setHostileFlag(reviewerWallet: string, poolId: string, justification: string): Promise<void> {
    if (!justification.trim() || justification.length > 2000) {
      throw new RegistryProblem(400, 'unknownField', 'justification is required');
    }
    const review = await this.reviews.get(reviewerWallet, poolId);
    if (!review?.rebuttal) {
      throw new RegistryProblem(404, 'notFound', 'Rebuttal was not found');
    }
    review.rebuttal.hostileFlag = {
      justification: justification.trim(),
      setAt: new Date().toISOString(),
    };
    await this.reviews.put(review);
  }

  async withdrawHostileFlag(reviewerWallet: string, poolId: string, note: string): Promise<void> {
    const review = await this.reviews.get(reviewerWallet, poolId);
    if (!review?.rebuttal?.hostileFlag) {
      throw new RegistryProblem(404, 'notFound', 'Hostile flag was not found');
    }
    review.rebuttal.hostileFlag.withdrawnAt = new Date().toISOString();
    review.rebuttal.hostileFlag.withdrawNote = note;
    await this.reviews.put(review);
  }
}
