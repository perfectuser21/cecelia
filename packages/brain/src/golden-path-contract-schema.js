import { createHash } from 'node:crypto';

import { z } from 'zod';


export const GP_CONTRACT_SCHEMA_VERSION = 1;

export const GP_CONTRACT_KEYS = Object.freeze([
  'fr_summary',
  'lifelines_and_nfr',
  'yield_order',
  'external_commitment_changes',
  'release_and_blast_radius',
  'success_and_close',
  'budget_guard',
]);

export const DEFAULT_GP_YIELD_ORDER = Object.freeze([
  '安全/资金正确性',
  '数据一致性',
  '功能完整',
  '性能',
  '体验顺滑',
]);

const nonEmptyText = z.string().trim().min(1);
const nonEmptyTextList = z.array(nonEmptyText).min(1);

const GoldenPathContractSchema = z.object({
  fr_summary: z.object({
    statements: nonEmptyTextList,
  }).strict(),
  lifelines_and_nfr: z.object({
    items: z.array(z.object({
      statement: nonEmptyText,
      class: z.enum(['lifeline', 'best_effort']),
      verification: nonEmptyText,
      rationale: nonEmptyText,
    }).strict()),
  }).strict(),
  yield_order: z.object({
    order: nonEmptyTextList,
    override_reason: z.string().trim().min(1).nullable(),
  }).strict().superRefine((value, context) => {
    const usesDefault = (
      value.order.length === DEFAULT_GP_YIELD_ORDER.length
      && value.order.every((item, index) => item === DEFAULT_GP_YIELD_ORDER[index])
    );
    if (!usesDefault && value.override_reason === null) {
      context.addIssue({
        code: 'custom',
        path: ['override_reason'],
        message: 'non_default_yield_order_requires_override_reason',
      });
    }
  }),
  external_commitment_changes: z.object({
    changes: z.array(nonEmptyText),
    none: z.boolean(),
  }).strict().superRefine((value, context) => {
    const consistent = (
      (value.none && value.changes.length === 0)
      || (!value.none && value.changes.length > 0)
    );
    if (!consistent) {
      context.addIssue({
        code: 'custom',
        path: ['changes'],
        message: 'external_commitment_none_must_match_changes',
      });
    }
  }),
  release_and_blast_radius: z.object({
    stages: nonEmptyTextList,
    blast_radius: nonEmptyText,
    rollback_triggers: nonEmptyTextList,
  }).strict(),
  success_and_close: z.object({
    metrics: nonEmptyTextList,
    observation_window: nonEmptyText,
    close_conditions: nonEmptyTextList,
    shutdown_conditions: nonEmptyTextList,
  }).strict(),
  budget_guard: z.object({
    total_cost_cap_usd: z.number().finite().positive(),
    atom_cost_cap_usd: z.number().finite().positive(),
    atom_runtime_sec: z.number().int().positive(),
    atom_parallelism: z.number().int().positive(),
  }).strict(),
}).strict();

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

export function validateGoldenPathContract(value) {
  return GoldenPathContractSchema.parse(value);
}

export function hashGoldenPathContract(value) {
  const parsed = validateGoldenPathContract(value);
  return createHash('sha256')
    .update(JSON.stringify(sortJson(parsed)))
    .digest('hex');
}

export class GoldenPathContractError extends Error {
  constructor(code, message, status = 409, details = undefined) {
    super(message);
    this.name = 'GoldenPathContractError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
