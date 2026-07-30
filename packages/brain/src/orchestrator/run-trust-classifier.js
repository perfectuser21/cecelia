/**
 * Classify only evidence that is directly attached to a run.
 *
 * This deliberately does not use recency, UUID prefixes, or initiative equality:
 * those heuristics caused historical runs to be associated with the wrong task.
 */
export function classifyRunTrust({
  run,
  taskReferenceCount = 0,
  matchingAttemptCount = 0,
  batchCollisionCount = 1,
}) {
  if (run?.record_trust_status === 'trusted') {
    return {
      status: 'trusted',
      reason: 'canonical_trusted_marker',
    };
  }
  if (Number(batchCollisionCount) > 1) {
    return {
      status: 'untrusted',
      reason: 'batch_mutation_suspected',
    };
  }
  if (!run?.current_task_id) {
    return {
      status: 'untrusted',
      reason: 'missing_task_identity',
    };
  }
  if (Number(taskReferenceCount) === 0) {
    return {
      status: 'untrusted',
      reason: 'dangling_task_identity',
    };
  }
  if (
    Number(taskReferenceCount) !== 1
    || Number(matchingAttemptCount) > 1
  ) {
    return {
      status: 'untrusted',
      reason: 'ambiguous_identity',
    };
  }
  if (Number(matchingAttemptCount) === 1) {
    return {
      status: 'reconstructed',
      reason: 'direct_task_and_attempt',
    };
  }
  return {
    status: 'reconstructed',
    reason: 'direct_task_reference',
  };
}
