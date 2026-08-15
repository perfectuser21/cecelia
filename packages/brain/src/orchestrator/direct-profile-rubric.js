const DIRECT_ARTIFACT_PATH = /^direct-contracts\/[^/]+\/tests\/impact-contract\.md$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function invalid(reason) {
  const error = new Error(`DIRECT_PROFILE_JUDGE_RUBRIC_INVALID:${reason}`);
  error.code = 'DIRECT_PROFILE_JUDGE_RUBRIC_INVALID';
  return error;
}

function parseFrozenJson(content) {
  if (typeof content !== 'string') throw invalid('content_missing');
  const match = /^# Frozen impact assertions\n\n```json\n([\s\S]+)\n```$/.exec(content);
  if (!match) throw invalid('frozen_json_missing');
  try {
    return JSON.parse(match[1]);
  } catch {
    throw invalid('frozen_json_invalid');
  }
}

function normalizeAssertions(payload) {
  if (
    !payload
    || typeof payload !== 'object'
    || Array.isArray(payload)
    || typeof payload.impact_contract_id !== 'string'
    || !DIGEST_PATTERN.test(payload.impact_contract_hash ?? '')
    || !Array.isArray(payload.required_assertions)
    || payload.required_assertions.length === 0
  ) throw invalid('payload_shape');

  const identities = new Set();
  return payload.required_assertions.map((assertion) => {
    if (
      !assertion
      || typeof assertion !== 'object'
      || Array.isArray(assertion)
      || typeof assertion.assertion_id !== 'string'
      || assertion.assertion_id.trim() !== assertion.assertion_id
      || assertion.assertion_id.length === 0
      || identities.has(assertion.assertion_id)
      || typeof assertion.command !== 'string'
      || assertion.command.trim() !== assertion.command
      || assertion.command.length === 0
      || !Array.isArray(assertion.covers_capability_ids)
      || assertion.covers_capability_ids.length === 0
      || !assertion.covers_capability_ids.every((capability) => (
        typeof capability === 'string'
        && capability.trim() === capability
        && capability.length > 0
      ))
      || new Set(assertion.covers_capability_ids).size
        !== assertion.covers_capability_ids.length
    ) throw invalid('assertion_shape');
    identities.add(assertion.assertion_id);
    return assertion;
  });
}

/**
 * Parse only the server-generated direct profile test artifact. The returned
 * strings are the exact rubric identity Judge coverage must echo, so one broad
 * file-level PASS cannot satisfy multiple trusted assertions.
 */
export function parseDirectProfileAssertionRubric(artifacts) {
  const directArtifacts = (Array.isArray(artifacts) ? artifacts : [])
    .filter((artifact) => DIRECT_ARTIFACT_PATH.test(artifact?.path ?? ''));
  if (directArtifacts.length === 0) return { matched: false, steps: [] };
  if (directArtifacts.length !== 1) throw invalid('artifact_count');

  const assertions = normalizeAssertions(parseFrozenJson(directArtifacts[0].content));
  return {
    matched: true,
    steps: assertions.map((assertion) => (
      `required_assertion:${assertion.assertion_id}`
      + ` | command:${assertion.command}`
      + ` | capabilities:${assertion.covers_capability_ids.join(',')}`
    )),
  };
}
