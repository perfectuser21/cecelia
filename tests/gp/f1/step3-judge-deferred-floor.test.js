// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：Judge coverage 机械判定 ↔ server-owned 后置断言
//
// 2026-08-20 生产实证（run 1e27d4da，r31）：裁判两轮意见全 PASS（"修复真实且与合同吻合"），
// 但合同没有 verification_stage.deferred_checks（proposer 从不生成，r31 合同全文 0 次出现
// deferred）→ validateCoverage 白名单为空 → 裁判对 server-owned 后置步骤报 passed=false
// （它本就无从验证）全部落进 failed → coverage_ok=false → FAIL(evidence_insufficient)
// → recollect 同形 FAIL → 止损闸停人审。裁决书正文"裁判=PASS"却终判 FAIL 第三次复发
// （前两半 #4948/#4949；本次是第三半：结构性 server-owned 检查的承认不能依赖合同白名单）。
//
// 修法：DEFERRED_CHECK_PATTERNS 键集（kernel 自身机械门专名，每个 run 都由服务端执行，
// judge 活在 Provider 生命周期内结构上无法验证）升为结构性 deferred 底座；合同白名单只增
// 不减。另（ce703092 教训延伸）：裁判把 deferred 依据写在 evidence 正文而 step 无专名是
// 生产常态，匹配候选纳入 evidence——防拆闸不变式不变：必须命中服务端专名，纯产品措辞/
// 自称 deferred 不认。
//
// 按产物闸规矩写在边上：真 import validateCoverage（不 vi.mock 被改模块）。
import { describe, expect, it } from 'vitest';
import { validateCoverage } from '../../../packages/brain/src/harness-judge.js';

// r31 run 1e27d4da 第二轮 judge 真实 payload（逐字段照抄，含 deferred:false 字段与
// evidence 正文声明——这是生产常态形状，不是理想数据）：
const R31_STEPS = [
  '合同测试 diff-gate-deterministic-stale.test.js 全绿（确定性 stale 透传 reason_code + retryable:false）',
  'GP Step 3: orchestrator classifies impact_contract_invalid + failRun(impact_gate_deterministic:<code>) precise end-to-end termination',
  'required_assertions ground-truth.test.js execution',
];
const R31_COVERAGE = [
  { step: R31_STEPS[0], passed: true, deferred: false, evidence: 'vitest 6/6 passed at exact head' },
  {
    step: 'GP Step 3: orchestrator classifies impact_contract_invalid + failRun(impact_gate_deterministic:<code>) precise end-to-end termination [deferred=true]',
    passed: false,
    deferred: false,
    evidence: 'DEFERRED — owned by server mechanical gate (deferred_checks: all_gates_passed/completed_role_chain). Gate-side precondition satisfied: mask-diff surfaces reason_code=projection_revision_mismatch and retryable:false. Does not force FAIL.',
  },
  {
    step: 'required_assertions ground-truth.test.js execution [deferred=true]',
    passed: false,
    deferred: false,
    evidence: 'DEFERRED — server_required_assertions run by Runner after Provider exit (evaluator checks empty by design). Not a Judge-owned check.',
  },
];

describe('validateCoverage：server-owned 结构性 deferred 底座（r31 死循环回归）', () => {
  it('合同无 deferred_checks 白名单：r31 真实 payload 两条 server-owned 步骤判 deferred，ok=true', () => {
    const cov = validateCoverage(R31_COVERAGE, R31_STEPS, {});
    expect(cov.failed).toEqual([]);
    expect(cov.ok).toBe(true);
    expect(cov.deferred.length).toBe(2);
  });

  it('deferredChecks 显式传 undefined 同样吃结构底座（调用点真实形状 ctx.verificationStage?.deferred_checks）', () => {
    const cov = validateCoverage(R31_COVERAGE, R31_STEPS, { deferredChecks: undefined });
    expect(cov.ok).toBe(true);
  });

  it('防拆闸：普通产品步骤 passed=false 不因自称 deferred 被放行（无服务端专名不认）', () => {
    const steps = ['用户点击发布按钮 → 帖子出现在列表'];
    const cov = validateCoverage(
      [{
        step: '用户点击发布按钮 → 帖子出现在列表 [deferred=true]',
        passed: false,
        deferred: true,
        evidence: 'DEFERRED — 按钮点了没反应，标记 deferred 留给以后验证',
      }],
      steps,
      {},
    );
    expect(cov.ok).toBe(false);
    expect(cov.failed.length).toBe(1);
  });

  it('防拆闸：产品步骤真失败（无 deferred 字样）照旧 failed', () => {
    const steps = ['数据写入 tasks 表且字段正确'];
    const cov = validateCoverage(
      [{ step: steps[0], passed: false, deferred: false, evidence: 'psql 查无记录' }],
      steps,
      {},
    );
    expect(cov.ok).toBe(false);
  });

  it('合同白名单仍可扩充自定义检查（只增不减）', () => {
    const steps = ['custom_e2e_probe 在生产环境执行'];
    const cov = validateCoverage(
      [{ step: 'custom_e2e_probe (server-owned) [deferred=true]', passed: false, deferred: true, evidence: 'named in verification_stage.deferred_checks' }],
      steps,
      { deferredChecks: ['custom_e2e_probe'] },
    );
    expect(cov.ok).toBe(true);
    expect(cov.deferred.length).toBe(1);
  });
});
