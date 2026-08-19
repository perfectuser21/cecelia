#!/usr/bin/env node
/**
 * gate-probe.mjs — Diff/Structure Impact Gate 非 fresh 分类探针
 *
 * 直接 import 真实 gate 代码（evaluateDiffGate / evaluateStructureGate），
 * 喂入构造的 Mapper freshness（PRD 假设：radius.js 产的 reason_code 为可信输入，本 sprint 不重算），
 * 把 gate 返回对象写入 --out 指定文件（JSON）。
 *
 * 禁 mock 被改的边：被改的分类逻辑在 gate 内部，探针跑真实 gate 代码，只注入上游 Mapper 输入。
 * 注意：import 会触发 db.js 打印 "PostgreSQL pool configured" 到 stdout（不连库），
 *       所以结果只写文件、不靠 stdout 解析，assertion 用 jq 读文件。
 *
 * 用法: node gate-probe.mjs --gate diff|structure --scenario <name> --out <path>
 */
import { writeFileSync } from 'node:fs';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { evaluateStructureGate } from '../../../packages/brain/src/impact-contract/structure-gate.js';

function argOf(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const gate = argOf('--gate', 'diff');
const scenario = argOf('--scenario', '');
const out = argOf('--out', '/tmp/gate-probe.json');

// Mapper freshness 固件（瞬态 stale / 确定性 unknown / 缺失边界）
const FRESHNESS = {
  transient: { status: 'stale', reason_code: 'fact_snapshot_stale' },
  transient2: { status: 'stale', reason_code: 'manifest_projection_mismatch' },
  deterministic: { status: 'unknown', reason_code: 'impact_anchor_missing' },
  deterministic2: { status: 'unknown', reason_code: 'capability_not_in_active_projection' },
  code_missing_unknown: { status: 'unknown' }, // reason_code 缺失但 status 非 fresh（确定性）
  code_missing_stale: { status: 'stale' },      // reason_code 缺失但 status 非 fresh（瞬态）
  missing: null,                                 // freshness 对象缺失
};
if (!(scenario in FRESHNESS)) {
  console.error(`unknown scenario: ${scenario}`);
  process.exit(2);
}
const freshness = FRESHNESS[scenario];

const REPO = 'cecelia';
const BASE = 'base-sha';
const mkMapClient = (fr) => async ({ repo, baseRevision }) => ({
  manifest_digest: 'md',
  projection_digest: 'pd',
  fact_revisions: { [repo || REPO]: baseRevision || BASE },
  freshness: fr,
  affected_nodes: [],
  required_assertions: [],
});

let result;
if (gate === 'diff') {
  result = await evaluateDiffGate({
    db: null,
    taskId: 'probe-task',
    repo: REPO,
    headRevision: 'head',
    changedFiles: ['packages/brain/src/tick.js'],
    mapClient: mkMapClient(freshness),
  });
} else {
  result = await evaluateStructureGate({
    task: { id: 'probe-task', change_kind: 'code' },
    contract: {
      task_id: 'probe-task',
      change_kind: 'code',
      repo: REPO,
      base_revision: BASE,
      contract_body: { affected_capabilities: [], required_assertions: [] },
    },
    mapClient: mkMapClient(freshness),
  });
}

writeFileSync(out, JSON.stringify(result));
console.error(`[gate-probe] gate=${gate} scenario=${scenario} -> ${JSON.stringify(result)}`);
