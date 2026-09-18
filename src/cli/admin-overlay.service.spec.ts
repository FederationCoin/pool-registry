import { describe, expect, it } from 'vitest';
import { MemoryReviewStore } from '../infra/memory/review-store';
import { AdminOverlayService } from './admin-overlay.service';

describe('AdminOverlay', () => {
  it('rejects empty justification and missing rebuttal', async () => {
    const reviews = new MemoryReviewStore();
    const admin = new AdminOverlayService(reviews);
    await expect(admin.setHostileFlag('w', 'p', '  ')).rejects.toMatchObject({ code: 'unknownField' });
    await expect(admin.setHostileFlag('w', 'p', 'because')).rejects.toMatchObject({ code: 'notFound' });
    await expect(admin.withdrawHostileFlag('w', 'p', 'n')).rejects.toMatchObject({ code: 'notFound' });
  });
});
