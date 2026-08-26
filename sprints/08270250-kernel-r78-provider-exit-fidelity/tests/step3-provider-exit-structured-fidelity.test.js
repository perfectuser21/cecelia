// F1「工厂 · 开发闭环」步骤 3「造完真验」——
// 边1：attempt callback(结构化终态) ↔ derive 分类路由（kernel 侧）
// 边2：runner 回执归一化 ↔ structured-terminal-classifier（runner 侧，纯函数 SSOT）
//
// 病根三实证（本主题第三次点火，r78）：
//   ① r69：generator 合同死锁分析（结构化 BLOCKED + CONTRACT_* 错误码）被包装成
//      provider_exit（attempt 56a09164）→ kernel 按 infrastructure 重试/进黑名单，病族丢失。
//   ② r76：generator 死局同类。
//   ③ r77：commander 的 claude 实际返回成功结果 JSON
//      （{"type":"result","subtype":"success",...}，虽 provider 进程 exit≠0）
//      却被 runner 判 provider_exit failed（attempt e022a331）——连成功结果都被吞。
//
// 根因：runner 回执归一化在 provider_exit≠0 时无条件降级包装为 provider_exit，
//   结构化终态（success 结果 JSON / 结构化 BLOCKED + CONTRACT_*）未先识别透传；
//   且 kernel derive 的 infrastructure_blocked 分支先于合同故障分支返回，
//   即便 CONTRACT_* 病族被保留也会被 infra 重试短路吞掉。
//
// 修法两层：
//   runner：结构化终态识别抽为纯函数 classifyProviderTerminal（entrypoint.sh 调用 + 本测试真 import），
//           识别到结构化终态即保真透传，禁降级 provider_exit。
//   kernel：derive 对 CONTRACT_* 家族错误码取路由优先级，走既有合同故障重开 GAN，
//           不进 failed_targets、不按 infrastructure 重试；真崩溃（无结构化产出）语义不变。
//
// 产物闸规矩：真 derive（不 stub attemptCallbackRoute）+ 真 classifier（不 mock 被改的边）。
import { describe, it, expect } from 'vitest';
import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

// runner 侧纯函数 SSOT——修前不存在（动态 import 令 kernel 用例可独立跑出断言级 RED）。
const CLASSIFIER_PATH = '../../../docker/cecelia-runner/structured-terminal-classifier.cjs';
async function loadClassify() {
  const mod = await import(CLASSIFIER_PATH);
  return mod.classifyProviderTerminal ?? mod.default?.classifyProviderTerminal;
}

function baseObserved(overrides = {}) {
  return {
    run: { phase: 'generate' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: null,
    inflight: { containers: [], host_pids: [], attempts: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 1,
    ganLatestRoundVerdict: 'APPROVED',
    generatorSpawned: true,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    counters: { hops: 30, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}

const cb = (hop, detail) => ({
  hop,
  action: 'verdict:attempt_callback',
  detail: { hop: hop - 1, ...detail },
});

describe('F1 step3 — 结构化上报保真透传，根除 provider_exit 语义埋没（kernel 侧路由）', () => {
  it('CONTRACT_ 家族故障码路由到合同故障重开 GAN，不按 infrastructure 重试', () => {
    // r69/r76 复刻：结构化 BLOCKED + CONTRACT_TEST_UNSATISFIABLE，即便残留 failure_class=infrastructure_blocked，
    // CONTRACT_* 病族必须取路由优先级 → 合同故障仲裁/重开 GAN，而非 infra 重试进黑名单。
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, {
          status: 'blocked',
          failure_class: 'infrastructure_blocked',
          error_code: 'CONTRACT_TEST_UNSATISFIABLE',
          role: 'generator',
        }),
      ],
    }));
    expect(r.action).toBe('arbitrate:contract_fault');
    expect(r).toMatchObject({ phase: 'gan', reason: 'contract_fault_appeal' });
  });

  it('真实 provider 崩溃（provider_exit）仍按 infrastructure 有界重派，负向语义不变', () => {
    // 负向铁律：无结构化产出的真崩溃，error_code=provider_exit 不属 CONTRACT_* 家族，
    // 仍走 infrastructure 有界重派（可进黑名单/重试），修前修后一致。
    const r = derive(baseObserved({
      decisionLog: [
        cb(29, {
          status: 'failed',
          failure_class: 'infrastructure_blocked',
          error_code: 'provider_exit',
          role: 'generator',
        }),
      ],
    }));
    expect(r).toMatchObject({
      phase: 'generate',
      action: 'spawn:generator-fix',
      reason: 'callback_infrastructure_blocked',
    });
    expect(r.action).not.toBe('arbitrate:contract_fault');
  });
});

describe('F1 step3 — runner 回执归一化保真透传（structured-terminal-classifier 纯函数）', () => {
  it('结构化成功终态（exit≠0）保真透传为成功，不降级 provider_exit', async () => {
    const classifyProviderTerminal = await loadClassify();
    const out = classifyProviderTerminal({
      providerExit: 1,
      structuredResult: { status: 'completed_with_concerns', summary: 'done' },
      commanderContract: false,
    });
    expect(out).toMatchObject({ passthrough: true, status: 'completed_with_concerns', errorCode: null });
  });

  it('commander 成功指令（exit≠0）保真透传，不降级 provider_exit', async () => {
    // r77 复刻：claude 返回 subtype=success（commander-directive/v1），进程 exit≠0，必须透传成功。
    const classifyProviderTerminal = await loadClassify();
    const out = classifyProviderTerminal({
      providerExit: 1,
      structuredResult: { schema: 'commander-directive/v1', action: 'continue_default' },
      commanderContract: true,
    });
    expect(out).toMatchObject({ passthrough: true, status: 'completed', errorCode: null });
  });

  it('结构化 BLOCKED + CONTRACT_ 错误码保真透传，error.code 病族不丢', async () => {
    // r69 复刻：结构化 BLOCKED，error.code 必须原样保留（不被 provider_exit 抹平）。
    const classifyProviderTerminal = await loadClassify();
    const out = classifyProviderTerminal({
      providerExit: 1,
      structuredResult: { status: 'blocked', error: { code: 'CONTRACT_TEST_UNSATISFIABLE', message: 'seed RED missing' } },
      commanderContract: false,
    });
    expect(out).toMatchObject({ passthrough: true, status: 'blocked', errorCode: 'CONTRACT_TEST_UNSATISFIABLE' });
  });

  it('无结构化产出的真实崩溃/超时映射 provider_exit / provider_timeout（负向不透传）', async () => {
    const classifyProviderTerminal = await loadClassify();
    const crash = classifyProviderTerminal({ providerExit: 1, structuredResult: null, commanderContract: false });
    expect(crash).toMatchObject({ passthrough: false, failureCode: 'provider_exit' });
    const timeout = classifyProviderTerminal({ providerExit: 124, structuredResult: null, commanderContract: false });
    expect(timeout).toMatchObject({ passthrough: false, failureCode: 'provider_timeout' });
    // 垃圾结构（无 .status / 无 schema）不得误判成功透传（铁律：成功判定看语义字段，非仅存在性）。
    const garbage = classifyProviderTerminal({ providerExit: 1, structuredResult: { foo: 1 }, commanderContract: false });
    expect(garbage).toMatchObject({ passthrough: false, failureCode: 'provider_exit' });
  });
});
