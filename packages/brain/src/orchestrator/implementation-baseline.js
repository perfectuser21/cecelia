import { z } from 'zod';

import { parseTaskBundle } from './execution-contract.js';
import { parseBaseRepo } from './github-pr-discovery.js';
import { WORKSPACE_REPOSITORIES } from './workspace-spec.js';

const CANONICAL_SHA = /^[a-f0-9]{40}$/;

const implementationBaselineSchema = z.object({
  repo: z.enum(WORKSPACE_REPOSITORIES),
  base_sha: z.string().regex(CANONICAL_SHA),
  source: z.enum(['task_payload', 'initial_workspace']),
  frozen: z.boolean(),
}).strict();

export const IMPLEMENTATION_BASELINE_INSTRUCTION = [
  'The authoritative implementation baseline is inputs.implementation_baseline.',
  'Its base_sha stays unchanged across roles and GAN rounds;',
  'workspace_spec.base_sha only selects this role checkout and must never replace the implementation baseline.',
].join(' ');

export function parseImplementationBaseline(value) {
  return Object.freeze(implementationBaselineSchema.parse(value));
}

export function implementationBaselineFromTaskPayload(payload = {}) {
  if (!CANONICAL_SHA.test(String(payload.base_sha ?? ''))) return null;
  const repo = payload.base_repo == null || payload.base_repo === ''
    ? 'perfectuser21/cecelia'
    : parseBaseRepo(payload.base_repo);
  return parseImplementationBaseline({
    repo,
    base_sha: payload.base_sha,
    source: 'task_payload',
    frozen: true,
  });
}

export function implementationBaselineFromWorkspace(workspaceSpec) {
  return parseImplementationBaseline({
    repo: workspaceSpec.repo,
    base_sha: workspaceSpec.base_sha,
    source: 'initial_workspace',
    frozen: workspaceSpec.frozen_baseline === true,
  });
}

export function resolveImplementationBaseline({
  taskPayload = {},
  attemptRows = [],
  runId,
  taskId,
} = {}) {
  const explicit = implementationBaselineFromTaskPayload(taskPayload);
  if (explicit) return explicit;

  const earliestFirst = [...attemptRows].sort((left, right) => (
    Number(left.hop ?? Number.MAX_SAFE_INTEGER) - Number(right.hop ?? Number.MAX_SAFE_INTEGER)
    || String(left.created_at ?? '').localeCompare(String(right.created_at ?? ''))
    || String(left.id ?? '').localeCompare(String(right.id ?? ''))
  ));
  if (earliestFirst.length === 0) return null;

  const initialAttempt = earliestFirst[0];
  try {
    const bundle = parseTaskBundle(initialAttempt.task_bundle);
    if (
      bundle.run_id !== runId
      || bundle.attempt_id !== initialAttempt.id
      || bundle.inputs.task_id !== taskId
      || !bundle.inputs.workspace_spec
    ) {
      throw new Error('implementation_baseline_identity_mismatch');
    }
    return implementationBaselineFromWorkspace(bundle.inputs.workspace_spec);
  } catch {
    // Once a Run has history, rebuilding from a later role checkout would turn
    // a Reviewer contract SHA or Evaluator PR SHA into a moving baseline.
    throw new Error('implementation_baseline_unrecoverable');
  }
}

export function objectiveWithImplementationBaseline(objective, baseline) {
  if (!baseline || objective.includes(IMPLEMENTATION_BASELINE_INSTRUCTION)) return objective;
  return `${objective} ${IMPLEMENTATION_BASELINE_INSTRUCTION}`;
}

export const __test__ = { implementationBaselineSchema };
