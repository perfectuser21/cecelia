// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：九格交接对象的 schema 校验
//
// 行业头号病（Anthropic building-effective-agents / 多 agent 失效模式研究一致结论）：
// 多 agent 流水线的 bug 通常活在**交接处**，不在任何单个 agent 里；解药是每个交接点
// 强制 schema 校验的结构化输出。本仓实证：r40（编造 40hex 假 sha）、r42（递错 run_id）、
// r53（candidate_coordinates 少第五字段 source_attempt_id）——三发全链报废均源于此。
//
// 第 79 批：把五类交接对象的字段契约写死，桥接派发前统一先验：
//   planner_prd_artifact / seal_coordinates / sealed_contract /
//   candidate_coordinates / published_pr
// 缺字段或格式坏 → 校验器给出结构化 issue 清单（缺哪个字段、哪条格式不对），
// 由调用方转成 retry 打回，不再让坏坐标流进下游。
//
// 注：schema 只管**形状**（缺字段/格式坏）；**取值真伪**由服务端权威注入负责
//（第 73/74/78 批已落地：candidate 与 base_sha 从 git_candidate 产物直取）。两层互补。
//
// 真 import 被改模块（守卫在边上），不 mock 它。
import { describe, it, expect } from 'vitest';
import {
  HANDOFF_SCHEMAS,
  validateHandoffObject,
  validateStageEvidence,
} from '../../../packages/brain/src/orchestrator/handoff-schemas.js';

const SHA40 = 'a'.repeat(40);
const UUID = 'cccccccc-0000-4000-8000-000000000009';

const GOOD = {
  planner_prd_artifact: {
    kind: 'planner_prd', path: 'sprints/x/sprint-prd.md',
    branch: 'cp-harness-propose-r1-x', head_sha: SHA40, verification_status: 'verified',
  },
  seal_coordinates: {
    bridge_run_id: UUID, sprint_dir: 'sprints/x',
    branch: 'cp-harness-propose-r1-x', approved_sha: SHA40, base_sha: 'b'.repeat(40),
  },
  sealed_contract: {
    contract_id: UUID, contract_version: 1, approved_sha: SHA40,
    branch: 'cp-harness-propose-r1-x', sprint_dir: 'sprints/x', base_sha: 'b'.repeat(40),
  },
  candidate_coordinates: {
    repo: 'perfectuser21/cecelia', branch: 'cp-harness-propose-r1-x',
    head_sha: SHA40, bridge_run_id: UUID, source_attempt_id: UUID,
  },
  published_pr: {
    pr_number: 5154, pr_url: 'https://github.com/perfectuser21/cecelia/pull/5154', head_sha: SHA40,
  },
};

describe('F1 step3 — 交接对象 schema 契约（第 79 批）', () => {
  it('五类交接对象各有 schema，合法对象全部通过', () => {
    for (const [kind, obj] of Object.entries(GOOD)) {
      expect(HANDOFF_SCHEMAS[kind], `${kind} 应有 schema`).toBeTruthy();
      const r = validateHandoffObject(kind, obj);
      expect(r.ok, `${kind} 应通过: ${JSON.stringify(r.issues)}`).toBe(true);
    }
  });

  it('r53 案卷：candidate_coordinates 少 source_attempt_id → 拒收并点名缺失字段', () => {
    const bad = { ...GOOD.candidate_coordinates };
    delete bad.source_attempt_id;
    const r = validateHandoffObject('candidate_coordinates', bad);
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/source_attempt_id/);
  });

  it('r40 案卷形状层：head_sha 非 40hex → 拒收（值真伪由权威注入另管）', () => {
    const bad = { ...GOOD.candidate_coordinates, head_sha: 'a78b37aa-c951-4cbb-976b-a7b70e975af2' };
    const r = validateHandoffObject('candidate_coordinates', bad);
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/head_sha/);
  });

  it('seal_coordinates 五字段缺任一 → 拒收并点名', () => {
    for (const field of ['bridge_run_id', 'sprint_dir', 'branch', 'approved_sha', 'base_sha']) {
      const bad = { ...GOOD.seal_coordinates };
      delete bad[field];
      const r = validateHandoffObject('seal_coordinates', bad);
      expect(r.ok, `${field} 缺失应被拒`).toBe(false);
      expect(r.issues.join()).toMatch(new RegExp(field));
    }
  });

  it('published_pr：pr_number 非正整数 / pr_url 非 GitHub PR 链接 → 拒收', () => {
    expect(validateHandoffObject('published_pr', { ...GOOD.published_pr, pr_number: 0 }).ok).toBe(false);
    expect(validateHandoffObject('published_pr', { ...GOOD.published_pr, pr_url: 'ftp://x' }).ok).toBe(false);
  });

  it('禁止夹带密钥材料（沿用 commander-contract 的防泄密判据）', () => {
    const bad = { ...GOOD.seal_coordinates, api_key: 'sk-proj-xxxx' };
    const r = validateHandoffObject('seal_coordinates', bad);
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/secret|api_key/i);
  });

  it('未知交接类型 → 明确报错，不静默放行', () => {
    const r = validateHandoffObject('not_a_kind', {});
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/unknown_handoff_kind/);
  });

  it('validateStageEvidence：按阶段挑该验的对象，evidence 里合法条目放行', () => {
    const evidence = [
      { type: 'seal_coordinates', ...GOOD.seal_coordinates },
      { type: 'note', text: '非交接对象条目不受管' },
    ];
    const r = validateStageEvidence('contract', evidence);
    expect(r.ok).toBe(true);
  });

  it('validateStageEvidence：阶段要求的交接对象缺席 → 拒收并点名（r51 类断供前置拦截）', () => {
    const r = validateStageEvidence('contract', [{ type: 'note', text: 'x' }]);
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/seal_coordinates/);
  });

  it('validateStageEvidence：交接对象存在但字段坏 → 拒收并点名字段', () => {
    const bad = { ...GOOD.candidate_coordinates }; delete bad.head_sha;
    const r = validateStageEvidence('generate', [{ type: 'candidate_coordinates', ...bad }]);
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/head_sha/);
  });

  it('无交接要求的阶段（plan/cleanup）→ 放行任何 evidence，零误伤', () => {
    expect(validateStageEvidence('cleanup', []).ok).toBe(true);
  });
});
