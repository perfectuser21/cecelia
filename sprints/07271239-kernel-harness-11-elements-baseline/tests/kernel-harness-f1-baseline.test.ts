import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import {
  ELEMENT_KEYS,
  applyKernelHarnessF1Baseline,
  buildKernelHarnessF1BaselineReport,
} from '../../../packages/brain/src/lib/kernel-harness-f1-baseline.js';

const JOURNEY_ID = 'bb8cc561-b3ee-4fec-b74d-2255694bd963';
const HISTORY = [
  ['c5bae104-da5e-483d-b5ea-c295c90a3f28', 'Planner', 1, '374c40c2-ba63-81a0-8f93-f138607751f5'],
  ['d6dcdfaf-4b98-4717-bbe3-522f03f70757', 'GAN Proposer', 2, '374c40c2-ba63-8140-bf6d-e45c61375a6b'],
  ['e2bd9263-87ef-4461-a1d5-5ff07a38b8a8', 'GAN Reviewer', 3, '374c40c2-ba63-8197-9aa6-ef9da511d853'],
  ['0cdadc1a-e3a0-46a1-8333-ebbc102883f7', 'Generator', 4, '374c40c2-ba63-8159-8ce3-e2f1bd34c5ec'],
  ['1a738e05-99a7-421c-a52d-c2bb80bf19be', 'Evaluator', 5, '374c40c2-ba63-8133-8795-f21ca8576508'],
  ['a6888ef3-2482-4655-8703-cf3b9f037cb9', 'Final E2E', 6, '374c40c2-ba63-8149-81f6-ea2909746d5d'],
] as const;

const STAGES = [
  ['S0', 'Task Born', '每个任务有稳定身份、来源、仓库、环境、风险和锚点'],
  ['S1', 'Intent / PrepPRD', '用户意图、成功标准、真实旅程和依赖被冻结'],
  ['S2', 'Planner', '计划覆盖 FR/NFR/Invariant/真实 E2E，范围足够薄'],
  ['S3', 'Contract GAN', '对抗审核后的合同可执行且批准后不可偷改'],
  ['S4', 'Generator', '在受控工作树先 Red 后 Green，创建 Harness-owned PR'],
  ['S5', 'CI', '客观检查全绿，只产证据，不持有 Harness merge 权'],
  ['S6', 'Evaluator', '新 session 真跑合同、反作弊和真实 E2E'],
  ['S7', 'Independent Judge', '独立复核 Evaluator 证据并给最终机器裁决'],
  ['S8', 'Risk-based Human Review', '首次/高风险变更在 merge 前由主理人查看'],
  ['S9', 'Merge', '只有唯一 Merge Authority 在全部门禁满足后合并'],
  ['S10', 'Staging', '部署并验证刚合并的精确 artifact'],
  ['S11', 'Production', '按发布策略 promote、验活并留回滚锚点'],
  ['S12', 'Report / Learning / Complete', '更新承诺地图、回归、学习和外部状态后才收账'],
] as const;

const EXACT_ELEMENTS = [
  'FR', 'NFR', 'Invariant', '判定点', '保质期', '死亡告警',
  '失败语义', '效果确认', '输入对抗面', '账本保鲜', '两轴衔接',
] as const;

const BACKBONE_HISTORY = new Map([
  ['c5bae104-da5e-483d-b5ea-c295c90a3f28', 'S2'],
  ['d6dcdfaf-4b98-4717-bbe3-522f03f70757', 'S3'],
  ['0cdadc1a-e3a0-46a1-8333-ebbc102883f7', 'S4'],
  ['1a738e05-99a7-421c-a52d-c2bb80bf19be', 'S6'],
]);
const HISTORY_ALIASES = new Map([
  ['e2bd9263-87ef-4461-a1d5-5ff07a38b8a8', 'S3'],
  ['a6888ef3-2482-4655-8703-cf3b9f037cb9', 'S6'],
]);

let client: Client;
let runtimeBefore: unknown;

async function seedHistoricalFixture() {
  await client.query(`DELETE FROM journey_step_links WHERE journey_id=$1`, [JOURNEY_ID]);
  await client.query(`DELETE FROM journey_steps WHERE journey_id=$1`, [JOURNEY_ID]);
  await client.query(
    `INSERT INTO journeys
       (id, name, journey_type, maturity, status, home, domain, trigger, endpoint, notion_id)
     VALUES ($1,'Cecelia Harness Pipeline','dev_pipeline','skeleton','active','factory','工厂',
             '一个任务要做（主理人开口/Brain自派）',
             '合格PR合并+账本格子变绿+handoff可查',
             '35ac40c2-ba63-81db-a6fb-f0c3cb4f1ad4')
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name, endpoint=EXCLUDED.endpoint, notion_id=EXCLUDED.notion_id`,
    [JOURNEY_ID],
  );
  for (const [id, name, stepNumber, notionId] of HISTORY) {
    await client.query(
      `INSERT INTO journey_steps
         (id, journey_id, name, step_number, status, backbone_version, notion_id)
       VALUES ($1,$2,$3,$4,'done','1.0',$5)`,
      [id, JOURNEY_ID, name, stepNumber, notionId],
    );
  }
}

async function runtimeFingerprint() {
  const { rows } = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM tasks) AS tasks_count,
      (SELECT COUNT(*)::int FROM initiative_runs) AS runs_count,
      (SELECT COUNT(*)::int FROM staging_e2e_results) AS staging_count
  `);
  return rows[0];
}

beforeAll(async () => {
  const databaseUrl = process.env.HARNESS_TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error('HARNESS_TEST_DATABASE_URL 必须指向隔离测试库');
  client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const { rows } = await client.query(`SELECT current_database() AS name`);
  if (!/(?:_test$|^preview_)/.test(rows[0].name)) {
    throw new Error(`拒绝写非隔离数据库: ${rows[0].name}`);
  }
  await client.query('BEGIN');
  await seedHistoricalFixture();
  runtimeBefore = await runtimeFingerprint();
  await applyKernelHarnessF1Baseline(client, { repoRoot: process.cwd() });
  await applyKernelHarnessF1Baseline(client, { repoRoot: process.cwd() });
});

afterAll(async () => {
  if (client) {
    await client.query('ROLLBACK');
    await client.end();
  }
});

describe.sequential('Kernel Harness F1 账本归位（真 PostgreSQL，禁 mock）', () => {
  it('唯一 F1 Journey 且二次应用不重复', async () => {
    const { rows } = await client.query(
      `SELECT id, name FROM journeys
       WHERE id=$1 OR name IN ('Cecelia Harness Pipeline','Kernel Harness Delivery')`,
      [JOURNEY_ID],
    );
    expect(rows).toEqual([{ id: JOURNEY_ID, name: 'Cecelia Harness Pipeline' }]);
    const { rows: duplicates } = await client.query(`
      SELECT lifecycle_stage, COUNT(*)::int AS count
      FROM journey_steps
      WHERE journey_id=$1 AND is_backbone=true
      GROUP BY lifecycle_stage HAVING COUNT(*) <> 1
    `, [JOURNEY_ID]);
    expect(duplicates).toEqual([]);
  });

  it('历史 ID 与 Notion 关联保留且 S0-S12 名称 promise 骨干完整', async () => {
    const { rows: history } = await client.query(
      `SELECT id, notion_id, lifecycle_stage, is_backbone
       FROM journey_steps WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [HISTORY.map(([id]) => id)],
    );
    expect(history).toHaveLength(6);
    for (const [id, , , notionId] of HISTORY) {
      expect(history).toContainEqual(expect.objectContaining({ id, notion_id: notionId }));
    }
    for (const [id, stage] of BACKBONE_HISTORY) {
      expect(history).toContainEqual(expect.objectContaining({
        id, lifecycle_stage: stage, is_backbone: true,
      }));
    }
    for (const [id, stage] of HISTORY_ALIASES) {
      expect(history).toContainEqual(expect.objectContaining({
        id, lifecycle_stage: stage, is_backbone: false,
      }));
    }
    const { rows: stages } = await client.query(
      `SELECT lifecycle_stage, name, promise FROM journey_steps
       WHERE journey_id=$1 AND is_backbone=true ORDER BY step_number`,
      [JOURNEY_ID],
    );
    expect(stages).toEqual(STAGES.map(([lifecycle_stage, name, promise]) => ({
      lifecycle_stage, name, promise,
    })));
  });

  it('每个 S0-S12 骨干 Step 恰有精确 11 个 element cells', async () => {
    expect(ELEMENT_KEYS).toEqual(EXACT_ELEMENTS);
    const { rows } = await client.query(`
      SELECT s.lifecycle_stage,
             COUNT(*)::int AS count,
             ARRAY_AGG(l.cell_key ORDER BY l.cell_key) AS keys,
             BOOL_AND(l.cell_status IN ('gray','red','pending','green','na')) AS statuses_ok
      FROM journey_steps s
      JOIN journey_step_links l ON l.step_id=s.id AND l.cell_kind='element'
      WHERE s.journey_id=$1 AND s.is_backbone=true
      GROUP BY s.lifecycle_stage ORDER BY MIN(s.step_number)
    `, [JOURNEY_ID]);
    expect(rows).toHaveLength(13);
    expect(rows.every((row) => row.count === 11 && row.statuses_ok)).toBe(true);
    expect(rows.flatMap((row) => row.keys)).toHaveLength(143);
    const expectedKeys = [...EXACT_ELEMENTS].sort();
    expect(rows.every((row) => JSON.stringify(row.keys) === JSON.stringify(expectedKeys)))
      .toBe(true);
  });

  it('143 格状态依据逐格唯一命中五态事实门槛', async () => {
    const report = await buildKernelHarnessF1BaselineReport(client, { repoRoot: process.cwd() });
    const currentSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    expect(report.invalid_assertion_refs).toEqual([]);
    expect(report.invalid_cell_source_refs).toEqual([]);
    expect(report.false_green_cells).toEqual([]);
    expect(report.unsupported_red_cells).toEqual([]);
    expect(report.unsupported_pending_cells).toEqual([]);
    expect(report.unsupported_na_cells).toEqual([]);
    expect(report.unclassified_cells).toEqual([]);
    expect(report.ambiguous_cells).toEqual([]);
    expect(report.cell_manifest).toHaveLength(143);
    expect(report.cells).toHaveLength(143);

    const manifestByKey = new Map(report.cell_manifest.map((cell) => [
      `${cell.step_id}:${cell.element}`, cell,
    ]));
    expect(manifestByKey.size).toBe(143);
    let grayCount = 0;
    let nonGrayFrCount = 0;

    for (const cell of report.cells) {
      expect(EXACT_ELEMENTS).toContain(cell.element);
      expect(cell.step_id).toBeTruthy();
      expect(STAGES.map(([stage]) => stage)).toContain(cell.lifecycle_stage);
      expect(['gray', 'red', 'pending', 'green', 'na']).toContain(cell.cell_status);
      expect(typeof cell.reason_code).toBe('string');
      expect(Array.isArray(cell.source_refs)).toBe(true);
      expect(Array.isArray(cell.missing_evidence)).toBe(true);
      for (const sourceRef of cell.source_refs) {
        expect(typeof sourceRef).toBe('string');
        const repoPath = sourceRef.split('#', 1)[0].replace(/:L\d+$/, '');
        expect(repoPath).not.toBe('');
        expect(existsSync(resolve(process.cwd(), repoPath))).toBe(true);
      }
      expect(manifestByKey.get(`${cell.step_id}:${cell.element}`)).toEqual(
        expect.objectContaining({
          lifecycle_stage: cell.lifecycle_stage,
          element: cell.element,
          cell_status: cell.cell_status,
          reason_code: cell.reason_code,
          source_refs: cell.source_refs,
          missing_evidence: cell.missing_evidence,
          assertion_ref: cell.assertion_ref,
          evidence_requirement: cell.evidence_requirement,
          na_reason: cell.na_reason,
        }),
      );

      const envelope = cell.evidence_envelope;
      const currentPass = Boolean(
        envelope
        && envelope.artifact_sha === currentSha
        && envelope.probe_started === true
        && envelope.exit_code === 0
        && envelope.expired !== true,
      );
      const currentFailure = Boolean(
        envelope
        && envelope.artifact_sha === currentSha
        && envelope.probe_started === true
        && (
          envelope.exit_code !== 0
          || envelope.observed_result !== envelope.expected_result
        ),
      );
      const currentScanNoMatch = Boolean(
        envelope
        && envelope.artifact_sha === currentSha
        && envelope.inventory_scan_started === true
        && Array.isArray(envelope.searched_paths)
        && envelope.searched_paths.length > 0
        && envelope.match_count === 0,
      );
      const matchedRules = [
        cell.reason_code === 'requirement_undefined'
          && cell.source_refs.length === 0
          && cell.missing_evidence.includes('requirement_definition')
          && !cell.assertion_ref
          && currentScanNoMatch
          ? 'gray' : null,
        ['known_gap', 'probe_failed'].includes(cell.reason_code)
          && cell.source_refs.length > 0
          && cell.missing_evidence.length > 0
          && (cell.reason_code === 'known_gap' ? Boolean(cell.known_gap_ref) : currentFailure)
          ? 'red' : null,
        ['awaiting_executable_evidence', 'evidence_expired'].includes(cell.reason_code)
          && cell.source_refs.length > 0
          && cell.missing_evidence.length > 0
          && !currentPass
          ? 'pending' : null,
        cell.reason_code === 'verified'
          && cell.source_refs.length > 0
          && Boolean(cell.assertion_ref)
          && cell.missing_evidence.length === 0
          && currentPass
          ? 'green' : null,
        cell.reason_code === 'not_applicable'
          && Boolean(cell.na_reason)
          && cell.source_refs.length > 0
          && !currentPass
          ? 'na' : null,
      ].filter(Boolean);

      expect(cell.matched_status_rules).toEqual(matchedRules);
      expect(matchedRules).toEqual([cell.cell_status]);
      if (cell.cell_status === 'gray') grayCount += 1;
      if (cell.element === 'FR' && cell.cell_status !== 'gray') nonGrayFrCount += 1;
    }
    expect(grayCount).toBeLessThan(143);
    expect(nonGrayFrCount).toBe(13);
  });

  it('P0/P1 筛选与五态证据逐项机检', async () => {
    const report = await buildKernelHarnessF1BaselineReport(client, { repoRoot: process.cwd() });
    const currentSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    expect(report.authoritative).toBe(false);
    expect(report.authoritative_source).toBe(
      'regression-contract.yaml#kernel_harness_f1_baseline',
    );
    expect(report.legacy_baseline.length).toBeGreaterThan(0);
    const coverage = report.legacy_source_coverage;
    expect(coverage).toMatchObject({
      unmapped_count: 0,
      duplicate_mapping_count: 0,
      unknown_auto_decidable_count: 0,
    });
    expect(coverage.candidate_source_count).toBe(
      coverage.included_source_count + coverage.excluded_source_count,
    );
    expect(coverage.selected_seed_count).toBe(coverage.mapped_behavior_count);
    expect(coverage.proven_status_count).toBeGreaterThan(0);
    expect(coverage.status_counts.unknown).toBeLessThan(coverage.mapped_behavior_count);
    for (const sourceKind of ['engine_contract', 'hook', 'devgate_ci', 'kernel_gate']) {
      const sourceCoverage = coverage.by_kind[sourceKind];
      expect(sourceCoverage.candidate_count)
        .toBeGreaterThan(0);
      expect(sourceCoverage.candidate_count).toBe(
        sourceCoverage.included_count + sourceCoverage.excluded_count,
      );
    }
    expect(report.legacy_exclusions.length).toBe(coverage.excluded_source_count);
    for (const excluded of report.legacy_exclusions) {
      expect(excluded.source_ref).toBeTruthy();
      expect([
        'priority_not_p0_p1',
        'priority_missing',
        'no_explicit_p0_p1_contract_edge',
      ]).toContain(excluded.reason_code);
    }
    expect(report.invalid_source_refs).toEqual([]);
    expect(report.invalid_cell_targets).toEqual([]);
    expect(report.invalid_root_assertion_refs).toEqual([]);
    const statuses = ['active', 'shadowed', 'retired', 'drifted', 'unknown'];
    const actualStatusCounts = Object.fromEntries(
      statuses.map((status) => [status, 0]),
    ) as Record<string, number>;
    const elements = EXACT_ELEMENTS;
    const seenIds = new Set<string>();
    for (const item of report.legacy_baseline) {
      expect(item.legacy_behavior_id).toBeTruthy();
      expect(seenIds.has(item.legacy_behavior_id)).toBe(false);
      seenIds.add(item.legacy_behavior_id);
      expect(['P0', 'P1']).toContain(item.priority);
      expect(item.selection_basis).toMatchObject({
        kind: 'explicit_priority',
        priority: item.priority,
        contract: 'packages/engine/regression-contract.yaml',
      });
      expect(STAGES.map(([stage]) => stage)).toContain(item.journey_stage);
      expect(elements).toContain(item.element);
      expect(item.legacy_owner).toBeTruthy();
      expect(statuses).toContain(item.audit_status);
      actualStatusCounts[item.audit_status] += 1;
      expect(item.unified_owner).toBeTruthy();
      expect(typeof item.gap).toBe('string');
      expect(item.next_knife_order).toBeGreaterThan(0);
      expect(item.source_refs.length).toBeGreaterThan(0);
      expect(Object.hasOwn(item, 'assertion_ref')).toBe(true);
      expect(item.status_evidence).toMatchObject({
        artifact_sha: currentSha,
      });
      expect(item.status_evidence.checked_at).toBeTruthy();
      expect(Number.isNaN(Date.parse(item.status_evidence.checked_at))).toBe(false);
      expect(item.status_evidence.source_digest).toMatch(/^sha256:[a-f0-9]{64}$/);

      if (item.audit_status === 'active') {
        expect(item.status_evidence.legacy_wiring_exists).toBe(true);
        expect(item.status_evidence.probe_command).toBeTruthy();
        expect(item.status_evidence.probe_started).toBe(true);
        expect(item.status_evidence.exit_code).toBe(0);
      } else if (item.audit_status === 'shadowed') {
        expect(item.status_evidence.legacy_source_exists).toBe(true);
        expect(item.status_evidence.replacement_ref).toBeTruthy();
        expect(item.status_evidence.replacement_probe_command).toBeTruthy();
        expect(item.status_evidence.replacement_probe_started).toBe(true);
        expect(item.status_evidence.replacement_exit_code).toBe(0);
      } else if (item.audit_status === 'retired') {
        expect(item.status_evidence.retirement_ref).toBeTruthy();
        expect(item.status_evidence.retirement_ref_resolved).toBe(true);
        expect(() => execFileSync(
          'git',
          ['rev-parse', '--verify', `${item.status_evidence.retirement_ref}^{commit}`],
          { stdio: 'ignore' },
        )).not.toThrow();
        expect(item.status_evidence.consumer_scan_command).toBeTruthy();
        expect(item.status_evidence.consumer_scan_started).toBe(true);
        expect(item.status_evidence.consumer_scan_exit_code).toBe(0);
        expect(item.status_evidence.consumer_count).toBe(0);
      } else if (item.audit_status === 'drifted') {
        expect(item.status_evidence.environment_ready).toBe(true);
        expect(item.status_evidence.probe_command).toBeTruthy();
        expect(item.status_evidence.probe_started).toBe(true);
        expect(item.status_evidence.mismatch).toBeTruthy();
        expect(
          item.status_evidence.exit_code !== 0
          || item.status_evidence.observed_result !== item.status_evidence.expected_result,
        ).toBe(true);
      } else {
        expect(item.status_evidence.missing_evidence.length).toBeGreaterThan(0);
        expect(item.auto_decidable).toBe(false);
      }
    }
    expect(seenIds.size).toBe(coverage.mapped_behavior_count);
    expect(coverage.status_counts).toMatchObject(actualStatusCounts);
    expect(coverage.proven_status_count).toBe(
      actualStatusCounts.active
      + actualStatusCounts.shadowed
      + actualStatusCounts.retired
      + actualStatusCounts.drifted,
    );
  });

  it('endpoint 延伸到 production verified 与 report learning', async () => {
    const { rows } = await client.query(`SELECT endpoint FROM journeys WHERE id=$1`, [JOURNEY_ID]);
    expect(rows[0].endpoint).toMatch(/production verified/i);
    expect(rows[0].endpoint).toMatch(/rollback anchor/i);
    expect(rows[0].endpoint).toMatch(/report\/learning/i);
    expect(rows[0].endpoint).not.toBe('合格PR合并+账本格子变绿+handoff可查');
  });

  it('不新增平行账本且运行时表状态不被迁移改写', async () => {
    const { rows } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public'
        AND table_name IN ('kernel_steps','behavior_ledger','kernel_harness_delivery')
    `);
    expect(rows).toEqual([]);
    expect(await runtimeFingerprint()).toEqual(runtimeBefore);
  });
});
