const MUTABLE_IDENTITY_BINDING = /(?<field>\battempt_id\b|\battemptId\b|\bATTEMPT_ID\b|\bcapability_snapshot_id\b|\bsnapshotId\b|\bCAPABILITY_SNAPSHOT_ID\b)\s*(?:!==?|===?|==?|:)\s*["'`]?\s*(?<uuid>[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})/i;

/**
 * A GAN contract is authored before Generator/Evaluator/Judge Attempts exist.
 * UUID literals assigned to those mutable fields therefore can only name an
 * authoring Attempt (Planner/Proposer/Reviewer) or stale evidence. Validation
 * identity must be read from the executing role's server-issued runtime values.
 */
export function evaluateValidationIdentityPolicy(contractContent) {
  const violations = [];
  for (const [index, line] of String(contractContent ?? '').split('\n').entries()) {
    const binding = line.match(MUTABLE_IDENTITY_BINDING);
    if (!binding?.groups) continue;
    violations.push(Object.freeze({
      code: 'premature_validation_identity_binding',
      line: index + 1,
      field: binding.groups.field,
      value: binding.groups.uuid,
    }));
  }
  return Object.freeze({
    ok: violations.length === 0,
    violations: Object.freeze(violations),
  });
}
