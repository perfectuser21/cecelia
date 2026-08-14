import { randomUUID } from 'node:crypto';

export function createSmokeIdentity(sourceRevision, invocationId = randomUUID()) {
  const revision = String(sourceRevision ?? '').trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error('smoke_source_revision_invalid');
  }
  const runId = String(invocationId).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 12);
  if (!runId) throw new Error('smoke_invocation_id_invalid');
  return {
    titlePrefix: `[uwr-smoke-${revision.slice(0, 12)}-${runId}]`,
    sourceNamespace: `uwr-smoke:${revision}:${runId}`,
  };
}
