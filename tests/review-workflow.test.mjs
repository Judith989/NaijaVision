import assert from 'node:assert/strict';
import test from 'node:test';
import { adminReviewStatuses, reviewStage } from '../src/app/lib/reviewWorkflow.ts';

test('returned and rejected submissions remain visible to administrators', () => {
  for (const status of ['changes_requested', 'rejected', 'withdrawn']) assert.ok(adminReviewStatuses.includes(status));
  assert.equal(reviewStage({status:'changes_requested'}), 'participant');
  assert.equal(reviewStage({status:'changes_requested',recommendation:'approved',recommendation_status:'pending'}), 'participant');
  assert.equal(reviewStage({status:'rejected',recommendation:'rejected',recommendation_status:'pending'}), 'closed');
});
test('handoffs distinguish reviewer work, participant returns and resubmissions', () => {
  assert.equal(reviewStage({status:'awaiting_review'}), 'reviewer');
  assert.equal(reviewStage({status:'awaiting_review',recommendation:'approved',recommendation_status:'pending'}), 'admin');
  assert.equal(reviewStage({status:'awaiting_review',recommendation:'approved',recommendation_status:'returned'}), 'reviewer_correction');
  assert.equal(reviewStage({status:'resubmitted',recommendation:'changes_requested',recommendation_status:'participant_returned'}), 'reviewer');
  for (const status of ['paid','approved']) assert.equal(reviewStage({status,recommendation_status:'returned'}), 'completed');
  assert.equal(reviewStage({status:'payment_eligible'}), 'payment');
});
