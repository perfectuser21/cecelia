/**
 * contract-schema.js — Impact Contract Schema（FR-2）
 *
 * 使用 Zod 定义并验证 Impact Contract 的 schema。
 * 合同是不可变版本记录，代表某次任务开工前声明的影响范围。
 *
 * sprint: 08110022-relay-d96c9fa0 ws2
 */

import { z } from 'zod';
import { CHANGE_KINDS } from './change-kind.js';

// ---------- 子 schema ----------

/** 受影响 Capability 条目 */
const AffectedCapabilitySchema = z.object({
  capability_id: z.string().min(1),
  capability_name: z.string().optional(),
  impact_level: z.enum(['direct', 'indirect', 'unknown']).optional(),
});

/** 必跑断言条目 */
const RequiredAssertionSchema = z.object({
  assertion_id: z.string().min(1),
  command: z.string().min(1),
  covers_capability_ids: z.array(z.string().min(1)).min(1),
  journey_step_link_id: z.string().uuid(),
  assertion_revision: z.number().int().positive(),
  assertion_digest: z.string().regex(/^[0-9a-f]{64}$/),
  owner: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

/** 不适用项条目（声明本次变更为何不影响某 Capability） */
const InapplicableItemSchema = z.object({
  capability_id: z.string().min(1),
  reason: z.string().min(1),
});

/** freshness 证据（MJ5 前为可选字段，可为 null） */
const FreshnessEvidenceSchema = z
  .object({
    status: z.enum(['fresh', 'stale', 'unknown']),
    reason_code: z.string().optional(),
    checked_at: z.string().datetime().optional(),
    mapper_revision: z.string().optional(),
  })
  .nullable()
  .optional();

// ---------- 主 schema ----------

/**
 * ImpactContractSchema — Impact Contract 合同 Zod schema（版本 1）
 *
 * 必填字段：
 *   - task_id: 关联任务 UUID
 *   - change_kind: 四档枚举
 *   - base_revision: 40 位 hex commit hash
 *   - affected_capabilities: 非空数组
 *   - required_assertions: 数组（允许为空，但字段必须存在）
 *
 * 可选字段：
 *   - repo: 仓库标识
 *   - manifest_digest: sha256（Mapper 未连接时为 null）
 *   - projection_digest: sha256（可选）
 *   - fact_revisions: 任意 object
 *   - freshness_evidence: null 时合同仍有效（MJ5 stub 期间）
 *   - inapplicable_items: 空数组有效
 *   - metadata: 任意 object
 */
export const ImpactContractSchema = z.object({
  // 版本标识
  schema_version: z.number().int().positive().default(1),

  // 关联任务（UUID 格式校验，接受标准 UUID 字符串）
  task_id: z.string().uuid({ message: 'task_id 必须是有效 UUID' }),

  // 变更分档（四档枚举）
  change_kind: z.enum(
    /** @type {[string, ...string[]]} */ (CHANGE_KINDS),
    {
      errorMap: () => ({
        message: `change_kind 必须是以下之一: ${CHANGE_KINDS.join(', ')}`,
      }),
    }
  ),

  // 仓库标识（如 "perfectuser21/cecelia"）
  repo: z.string().optional(),

  // base commit（40 位 hex）
  base_revision: z
    .string()
    .regex(/^[0-9a-f]{40}$/i, { message: 'base_revision 必须是 40 位 Git SHA' }),

  // Mapper 生成摘要（MJ5 前允许 null）
  manifest_digest: z.string().nullable().optional(),
  projection_digest: z.string().nullable().optional(),

  // 细粒度依赖快照
  fact_revisions: z.record(z.unknown()).optional(),

  // freshness 证据（MJ5 前允许 null）
  freshness_evidence: FreshnessEvidenceSchema,

  // 受影响 Capability 列表（至少一条）
  affected_capabilities: z
    .array(AffectedCapabilitySchema)
    .min(1, { message: 'affected_capabilities 至少需要声明一个受影响 Capability' }),

  // 必跑断言列表（允许为空数组，但字段必须存在）
  required_assertions: z.array(RequiredAssertionSchema),

  // 不适用项（允许为空数组）
  inapplicable_items: z.array(InapplicableItemSchema).optional().default([]),

  // 额外元数据
  metadata: z.record(z.unknown()).optional(),
});

/**
 * validateImpactContract(data) — 验证并解析 Impact Contract。
 *
 * 成功时返回 { success: true, data: <parsed> }
 * 失败时返回 { success: false, error: ZodError }
 *
 * @param {unknown} data
 * @returns {{ success: true, data: object } | { success: false, error: import('zod').ZodError }}
 */
export function validateImpactContract(data) {
  const result = ImpactContractSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * parseImpactContract(data) — 验证并返回 parsed 合同，失败时抛出 ZodError。
 *
 * @param {unknown} data
 * @returns {object}
 */
export function parseImpactContract(data) {
  return ImpactContractSchema.parse(data);
}

export default ImpactContractSchema;
