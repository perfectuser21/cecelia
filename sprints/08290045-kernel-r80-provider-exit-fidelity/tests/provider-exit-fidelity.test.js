// Sprint r80「结构化上报保真透传，根除 provider_exit 语义埋没」冻结合同测试（封印主线）。
//
// 病根三实证：
//   ① r69 generator 合同死锁分析（结构化 BLOCKED + CONTRACT_*）被包装成 provider_exit（attempt 56a09164）；
//   ② r76 同类；
//   ③ r77 commander 的 claude 返回 success 结果 JSON 却被判 provider_exit failed（attempt e022a331）。
// 根因链：runner/entrypoint 在 CLI 退出码非零时一律降级为 provider_exit → 真因（CONTRACT_* 码 /
//   success 结果）被埋没 → kernel 把合同故障当基础设施病族重试并拉黑 target → run 死。
//
// 本文件覆盖 kernel 侧（纯函数，无 DB——本 attempt runtime_resources.postgres=false）：
//   A. 病族边界 SSOT（ground-truth.js）：CONTRACT_* 家族不属基础设施病族（provider_exit/provider_timeout）。
//   B. failed_targets 拉黑过滤（dispatcher.js __test__）：CONTRACT_* 故障的 target 不进黑名单，
//      provider_exit / provider_timeout 真崩溃仍拉黑（负向语义不变）。
//
// 禁 mock 被改的边：真 import 被改模块（ground-truth.js / dispatcher.js），零 vi.mock / stub。
// 纯函数可重放：相同输入恒得相同分类，无时钟 / 随机 / DB。
import { describe, it, expect } from 'vitest';
import {
  isInfrastructureErrorCode,
  isContractFaultCode,
} from '../../../packages/brain/src/orchestrator/ground-truth.js';
import { __test__ as dispatcherTest } from '../../../packages/brain/src/orchestrator/dispatcher.js';

// r80 真因 CONTRACT_* 家族样本（与 derive.js CONTRACT_FAULT_CORE_TOKENS + LLM 词序/多词漂移对齐）。
const CONTRACT_FAULT_SAMPLES = [
  'CONTRACT_SELF_CONTRADICTION', // r69 合同死锁分析
  'CONTRACT_TEST_UNSATISFIABLE',
  'CONTRACT_CI_SCOPE_CONFLICT',
  'CONTRACT_SCOPE_CI_CONFLICT', // 词序漂移（r43 实证）
  'APPROVED_CONTRACT_CI_CONFLICT', // 多词/丢词漂移（F6 案卷实证）
];
// 真基础设施病族（真 provider 进程崩溃 / 超时，无结构化产出）——语义必须不变。
const INFRA_CODES = ['provider_exit', 'provider_timeout'];

describe('A. 病族边界 SSOT（ground-truth.js，真 import 被改模块）', () => {
  it('A1 真基础设施故障码归入病族：isInfrastructureErrorCode 对 provider_exit/provider_timeout 为 true', () => {
    for (const code of INFRA_CODES) {
      expect(isInfrastructureErrorCode(code)).toBe(true);
    }
  });

  it('A2 CONTRACT_* 家族不入基础设施病族：isInfrastructureErrorCode 恒 false（根除埋没）', () => {
    for (const code of CONTRACT_FAULT_SAMPLES) {
      expect(isInfrastructureErrorCode(code)).toBe(false);
    }
  });

  it('A3 isContractFaultCode 命中 CONTRACT_* 家族（含词序/多词漂移），token 子集匹配', () => {
    for (const code of CONTRACT_FAULT_SAMPLES) {
      expect(isContractFaultCode(code)).toBe(true);
    }
  });

  it('A4 isContractFaultCode 不误判基础设施码与无关码（不过度放宽，防真产品 bug 被路由成合同申诉）', () => {
    for (const code of [...INFRA_CODES, 'CONTRACT_MISSING_FIXTURE', 'auth_failed', '', null, undefined]) {
      expect(isContractFaultCode(code)).toBe(false);
    }
  });

  it('A5 纯函数可重放：相同输入两次调用结果一致，无隐藏态', () => {
    for (const code of [...CONTRACT_FAULT_SAMPLES, ...INFRA_CODES]) {
      expect(isInfrastructureErrorCode(code)).toBe(isInfrastructureErrorCode(code));
      expect(isContractFaultCode(code)).toBe(isContractFaultCode(code));
    }
  });
});

describe('B. failed_targets 拉黑过滤（dispatcher.js __test__，真 import 被改模块）', () => {
  const T = (error_code, failure_class = null) => ({
    provider: 'claude',
    account: 'account1',
    machine: 'us-mac-m4',
    error_code,
    failure_class,
  });

  it('B1 CONTRACT_* 故障 target 不进 failed_targets 黑名单（不按 infrastructure 拉黑）', () => {
    const kept = dispatcherTest.filterBlacklistableTargets([
      T('CONTRACT_SELF_CONTRADICTION', 'semantic_refusal'),
      T('CONTRACT_CI_SCOPE_CONFLICT', 'semantic_refusal'),
    ]);
    expect(kept).toEqual([]);
  });

  it('B2 真 provider 崩溃 / 超时的 target 仍进黑名单（负向语义不变）', () => {
    const input = [T('provider_exit'), T('provider_timeout')];
    const kept = dispatcherTest.filterBlacklistableTargets(input);
    expect(kept).toHaveLength(2);
    expect(kept.map((t) => t.error_code).sort()).toEqual(['provider_exit', 'provider_timeout']);
  });

  it('B3 混合列表只滤掉 CONTRACT_*，保留真基础设施故障 target', () => {
    const kept = dispatcherTest.filterBlacklistableTargets([
      T('provider_exit'),
      T('CONTRACT_SELF_CONTRADICTION', 'semantic_refusal'),
      T('provider_timeout'),
    ]);
    expect(kept.map((t) => t.error_code)).toEqual(['provider_exit', 'provider_timeout']);
  });

  it('B4 error_code 为 null 的历史行按基础设施保留（不误滤真崩溃）', () => {
    const kept = dispatcherTest.filterBlacklistableTargets([T(null), T(undefined)]);
    expect(kept).toHaveLength(2);
  });

  it('B5 纯函数可重放且不改入参：相同输入两次结果一致，原数组不被 mutate', () => {
    const input = [T('provider_exit'), T('CONTRACT_SELF_CONTRADICTION', 'semantic_refusal')];
    const snapshot = JSON.parse(JSON.stringify(input));
    const first = dispatcherTest.filterBlacklistableTargets(input);
    const second = dispatcherTest.filterBlacklistableTargets(input);
    expect(first).toEqual(second);
    expect(input).toEqual(snapshot);
  });
});
