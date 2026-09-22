/**
 * What a reviewer's decision means.
 *
 * Extracted from the route so the rule that matters can be tested without a
 * database: approving content that still carries BLOCKING factuality findings
 * requires explicitly resolving them. That is the one piece of friction
 * standing between a generated medical claim and a published one, and it must
 * not be possible to lose it in a refactor.
 */

export type ApprovalDecision = 'approve' | 'reject' | 'request_edits';

/** Terminal states on `content_assets`. */
export type AssetStatus = 'approved' | 'failed' | 'draft';

export interface DecisionOutcome {
  /** Status to write to the asset. */
  assetStatus: AssetStatus;
  /** Status to record on the approvals audit row. */
  approvalStatus: 'approved' | 'rejected' | 'pending';
  /** True when the caller must resolve blocking findings before this is allowed. */
  requiresFindingResolution: boolean;
}

export function resolveDecision(
  decision: ApprovalDecision,
  blockingCount: number,
  resolveFindings: boolean
): DecisionOutcome {
  return {
    assetStatus: decision === 'approve' ? 'approved' : decision === 'reject' ? 'failed' : 'draft',
    approvalStatus:
      decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'pending',
    // Only approval is gated. Rejecting or sending back for edits does not
    // publish anything, so blocking findings are no obstacle to either — and
    // requiring resolution there would trap flagged content in the queue.
    requiresFindingResolution: decision === 'approve' && blockingCount > 0 && !resolveFindings,
  };
}
