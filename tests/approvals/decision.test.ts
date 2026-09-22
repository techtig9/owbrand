import { describe, it, expect } from 'vitest';
import { resolveDecision, type ApprovalDecision } from '@/lib/approvals/decision';

/**
 * The approval gate.
 *
 * `requiresFindingResolution` is the only thing standing between a generated
 * claim the factuality guard flagged as blocking and a published one. It is
 * asserted from every direction because losing it in a refactor would be
 * silent — the UI would still look right.
 */

describe('resolveDecision', () => {
  it('blocks approval while blocking findings are unresolved', () => {
    const outcome = resolveDecision('approve', 2, false);
    expect(outcome.requiresFindingResolution).toBe(true);
  });

  it('allows approval once the reviewer resolves the findings', () => {
    const outcome = resolveDecision('approve', 2, true);
    expect(outcome.requiresFindingResolution).toBe(false);
    expect(outcome.assetStatus).toBe('approved');
  });

  it('allows approval outright when nothing is blocking', () => {
    expect(resolveDecision('approve', 0, false).requiresFindingResolution).toBe(false);
  });

  it('never gates reject or request_edits — neither publishes anything', () => {
    // Gating these would trap flagged content in the queue with no way out.
    for (const decision of ['reject', 'request_edits'] as ApprovalDecision[]) {
      expect(resolveDecision(decision, 5, false).requiresFindingResolution).toBe(false);
    }
  });

  it('maps decisions to asset and audit statuses', () => {
    expect(resolveDecision('approve', 0, true)).toMatchObject({
      assetStatus: 'approved',
      approvalStatus: 'approved',
    });
    expect(resolveDecision('reject', 0, true)).toMatchObject({
      assetStatus: 'failed',
      approvalStatus: 'rejected',
    });
    // Sending back for edits returns the asset to draft and leaves the
    // approval row pending — it is not a verdict.
    expect(resolveDecision('request_edits', 0, true)).toMatchObject({
      assetStatus: 'draft',
      approvalStatus: 'pending',
    });
  });

  it('is total over the decision union', () => {
    for (const decision of ['approve', 'reject', 'request_edits'] as ApprovalDecision[]) {
      const outcome = resolveDecision(decision, 1, true);
      expect(['approved', 'failed', 'draft']).toContain(outcome.assetStatus);
      expect(['approved', 'rejected', 'pending']).toContain(outcome.approvalStatus);
    }
  });
});
