/**
 * harness-judge.js — 独立验收裁判（DeepSeek via ToAPIs）单测。
 *
 * 三权分立验证：运动员（agent）保留执行权，证据自动留痕，裁判独立判读。
 * 覆盖：agent PASS+裁判 PASS→merge；agent PASS+裁判 FAIL→fix 且 feedback=裁判意见；
 *       覆盖缺步→FAIL；裁判网络错→fail-open 保留 agent verdict；JUDGE_STRICT=1→fail-closed；
 *       agent FAIL→直接透传不调裁判；coverage 校验 + Golden Path 解析 + 配置解析。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runJudgeGate,
  validateCoverage,
  parseGoldenPathSteps,
  extractE2ESection,
  resolveToapisConfig,
  buildJudgePrompt,
  normalizeJudgeVerdict,
  resolveStdoutFile,
  extractAgentTranscript,
  collectEvidence,
  validateIndependentJudgeStageFacts,
} from '../harness-judge.js';

// 注入一个不落盘的证据收集（避免 fs）。
function fakeEvidence(goldenPathSteps = ['step A', 'step B']) {
  return async () => ({
    contractE2E: '## E2E\ncurl localhost',
    goldenPathSteps,
    transcript: 'PASS: did A\nPASS: did B',
    // 机械闸（刀B dc18d43d）合规字段：behavior_tests 条目级 exit_code + log_tail（E1 schema）
    brainResult: { verdict: 'PASS', behavior_tests: [{ command: 'npm test', exit_code: 0, log_tail: 'ok' }] },
  });
}

// 注入不落盘的 writeFileFn（避免 persistJudgeArtifact 真写盘）+ 机械闸测试文件桩
// （刀B dc18d43d：behavior_tests 非空断言，桩返回一个测试文件，不走默认 fs 扫描）。
const noopWrite = { writeFileFn: async () => {}, listTestFilesFn: async () => ['a.test.ts'] };
// worktreePath 非空（过证据门）；fakeEvidence 提供 Golden Path 步骤。
const baseCtx = {
  worktreePath: '/tmp/judge-test',
  sprintDir: 'sprints/x',
  instanceLabel: 'harness-evaluate-t1-r0-abcd1234',
  transcript: 'PASS: did A\nPASS: did B',
};
const validStageFacts = {
  current_stage: 'independent_judge',
  pr_state: 'OPEN',
  pr_merged: false,
  head_sha: 'a'.repeat(40),
  merge_gate_approved: false,
};

describe('Judge 模型配置化（最终裁判不该是链路里最弱的模型）', () => {
  // 全链路 Planner/Proposer/Reviewer/Generator/Evaluator 都跑 gpt-5.6-sol，
  // 唯独最后一道否决闸写死 deepseek-v4-flash。误判一次整条链路白跑。
  it('未配置 env 时默认模型不再是 deepseek-v4-flash', async () => {
    const prev = process.env.TOAPIS_JUDGE_MODEL;
    delete process.env.TOAPIS_JUDGE_MODEL;
    try {
      const mod = await import('../harness-judge.js');
      const cfg = await mod.resolveToapisConfig({ readFileFn: async () => '' });
      expect(cfg.model).not.toBe('deepseek-v4-flash');
    } finally {
      if (prev === undefined) delete process.env.TOAPIS_JUDGE_MODEL;
      else process.env.TOAPIS_JUDGE_MODEL = prev;
    }
  });

  it('TOAPIS_JUDGE_MODEL 显式配置时以配置为准', async () => {
    const prev = process.env.TOAPIS_JUDGE_MODEL;
    process.env.TOAPIS_JUDGE_MODEL = 'custom-model-x';
    try {
      const mod = await import('../harness-judge.js');
      const cfg = await mod.resolveToapisConfig({ readFileFn: async () => '' });
      expect(cfg.model).toBe('custom-model-x');
    } finally {
      if (prev === undefined) delete process.env.TOAPIS_JUDGE_MODEL;
      else process.env.TOAPIS_JUDGE_MODEL = prev;
    }
  });
});

describe('callContractArbiter — URL 拼接与 judge 同规(r43 实证双 /v1 打 404)', () => {
  it('baseUrl 已含 /v1 时不再重复拼 /v1', async () => {
    const { callContractArbiter } = await import('../harness-judge.js');
    let calledUrl = null;
    await callContractArbiter(
      { contractText: 'x', errorCode: 'E', claimSummary: 'y' },
      {
        config: { apiKey: 'k', baseUrl: 'https://api.example.com/v1', model: 'm' },
        fetchFn: async (url) => {
          calledUrl = url;
          return { ok: true, json: async () => ({ choices: [{ message: { content: '{"upheld":false,"reasoning":"r"}' } }] }) };
        },
      },
    );
    expect(calledUrl).toBe('https://api.example.com/v1/chat/completions');
  });

  // r43 实证:真仲裁器对 CONTRACT_CI_SCOPE_CONFLICT 申诉判"合同文本内部无矛盾→驳回"。
  // 该类的矛盾本来就不在合同内部,而在合同范围条款与仓库级 CI 硬闸之间——
  // 裁定标准必须按故障码分类,否则守法执行者(拒绝超范围改 registry)永远无路可走。
  it('CONTRACT_CI_SCOPE_CONFLICT 类:prompt 必须用范围冲突标准,且明示不得以"内部无矛盾"驳回', async () => {
    const { callContractArbiter } = await import('../harness-judge.js');
    let sentPrompt = null;
    await callContractArbiter(
      { contractText: 'c', errorCode: 'CONTRACT_CI_SCOPE_CONFLICT', claimSummary: 's' },
      {
        config: { apiKey: 'k', baseUrl: 'https://api.example.com/v1', model: 'm' },
        fetchFn: async (url, init) => {
          sentPrompt = JSON.parse(init.body).messages[1].content;
          return { ok: true, json: async () => ({ choices: [{ message: { content: '{"upheld":true,"reasoning":"r"}' } }] }) };
        },
      },
    );
    expect(sentPrompt).toContain('仓库级 CI 硬性要求');
    expect(sentPrompt).toContain('不得以"合同内部无矛盾"为由驳回');
    expect(sentPrompt).not.toContain('唯一标准:合同文本内存在客观矛盾');
  });

  it('自相矛盾类(默认):prompt 保持合同内部矛盾标准', async () => {
    const { callContractArbiter } = await import('../harness-judge.js');
    let sentPrompt = null;
    await callContractArbiter(
      { contractText: 'c', errorCode: 'CONTRACT_SELF_CONTRADICTION', claimSummary: 's' },
      {
        config: { apiKey: 'k', baseUrl: 'https://api.example.com/v1', model: 'm' },
        fetchFn: async (url, init) => {
          sentPrompt = JSON.parse(init.body).messages[1].content;
          return { ok: true, json: async () => ({ choices: [{ message: { content: '{"upheld":false,"reasoning":"r"}' } }] }) };
        },
      },
    );
    expect(sentPrompt).toContain('合同文本内存在客观矛盾');
  });
});

describe('arbitrateContractAppeal — Generator 合同申诉的独立仲裁', () => {
  // Generator 喊"合同自相矛盾"只是申诉,不能自动成立(运动员不能自己当裁判)。
  // 由独立仲裁器(与 Judge 同模型)裁定:成立→重开 GAN;驳回→打回 generator-fix。
  it('仲裁器判申诉成立 → upheld=true 带 reasoning', async () => {
    const { arbitrateContractAppeal } = await import('../harness-judge.js');
    const r = await arbitrateContractAppeal(
      { contractText: 'DoD: x 必须同时 >1 且 <0', errorCode: 'CONTRACT_SELF_CONTRADICTION', claimSummary: 'x 不可能同时满足两个断言' },
      { llmFn: async () => ({ upheld: true, reasoning: '断言互斥,申诉成立' }) },
    );
    expect(r.upheld).toBe(true);
    expect(r.reasoning).toContain('互斥');
  });

  it('仲裁器判申诉不成立 → upheld=false', async () => {
    const { arbitrateContractAppeal } = await import('../harness-judge.js');
    const r = await arbitrateContractAppeal(
      { contractText: 'DoD: 输出须为 JSON', errorCode: 'CONTRACT_SELF_CONTRADICTION', claimSummary: '我觉得太难了' },
      { llmFn: async () => ({ upheld: false, reasoning: '合同无矛盾,系畏难申诉' }) },
    );
    expect(r.upheld).toBe(false);
  });

  it('LLM 调用失败 → upheld=null(不误判任何一方,交人工)', async () => {
    const { arbitrateContractAppeal } = await import('../harness-judge.js');
    const r = await arbitrateContractAppeal(
      { contractText: 'x', errorCode: 'CONTRACT_TEST_UNSATISFIABLE', claimSummary: 'y' },
      { llmFn: async () => { throw new Error('toapis down'); } },
    );
    expect(r.upheld).toBe(null);
    expect(r.reasoning).toContain('toapis down');
  });
});

describe('Judge FAIL 必须带 failure_class（r41 实证：null → 全部死等人工）', () => {
  // r41 实证：Judge 判 FAIL 但 failure_class=null → derive 归入 unknown 分支
  // → wait:human_review 死等。Judge 是最后一道闸，它一 FAIL 就必然卡人工，
  // 意味着"Judge FAIL 后自动修复"这条路从来没通过。且 Judge 的 FAIL 大多是
  // "证据不足"（要 Evaluator 重新取证），不是"代码有 bug"（要 Generator 改码），
  // 必须能分流。
  it('LLM 裁判判 FAIL 且未给 failure_class → 兜底归 evidence_insufficient（退回取证，不误判为代码 bug）', async () => {
    const { runJudgeGate } = await import('../harness-judge.js');
    const r = await runJudgeGate(
      {
        worktreePath: '/tmp/x',
        sprintDir: 'sprints/x',
        stageFacts: { pr_state: 'OPEN', pr_merged: false, merge_gate_approved: false },
        agentVerdict: 'PASS',
      },
      {
        collectEvidence: async () => ({
          contractE2E: 'e2e script',
          goldenPathSteps: ['step1'],
          transcript: 't',
          agentStdout: 's',
          brainResult: {},
        }),
        judgeFn: async () => ({
          verdict: 'FAIL',
          coverage: [{ step: 'step1', passed: true, evidence: 'ok' }],
          feedback: '证据不足：未见失败路径直接执行的 stdout 与退出码',
          // 故意不给 failure_class —— 真实 DeepSeek 输出就是这样
        }),
        persistFn: async () => {},
        mechanicalGateFn: async () => ({ pass: true, reasons: [] }),
      },
    );
    expect(r.verdict).toBe('FAIL');
    expect(r.failure_class, 'FAIL 必须带分类，否则 derive 归 unknown 死等人工').toBe('evidence_insufficient');
  });

  it('LLM 裁判显式给出 product_failure → 原样透传（让 generator-fix 改代码）', async () => {
    const { runJudgeGate } = await import('../harness-judge.js');
    const r = await runJudgeGate(
      {
        worktreePath: '/tmp/x',
        sprintDir: 'sprints/x',
        stageFacts: { pr_state: 'OPEN', pr_merged: false, merge_gate_approved: false },
        agentVerdict: 'PASS',
      },
      {
        collectEvidence: async () => ({
          contractE2E: 'e2e', goldenPathSteps: ['step1'], transcript: 't', agentStdout: 's', brainResult: {},
        }),
        judgeFn: async () => ({
          verdict: 'FAIL',
          coverage: [{ step: 'step1', passed: false, evidence: '功能未实现' }],
          feedback: '产品行为不符合 Golden Path',
          failure_class: 'product_failure',
        }),
        persistFn: async () => {},
        mechanicalGateFn: async () => ({ pass: true, reasons: [] }),
      },
    );
    expect(r.verdict).toBe('FAIL');
    expect(r.failure_class).toBe('product_failure');
  });

  it('机械闸 FAIL → 也必须带 failure_class（evidence_insufficient）', async () => {
    const { runJudgeGate } = await import('../harness-judge.js');
    const r = await runJudgeGate(
      {
        worktreePath: '/tmp/x',
        sprintDir: 'sprints/x',
        stageFacts: { pr_state: 'OPEN', pr_merged: false, merge_gate_approved: false },
        agentVerdict: 'PASS',
      },
      {
        collectEvidence: async () => ({
          contractE2E: 'e2e', goldenPathSteps: ['step1'], transcript: 't', agentStdout: 's', brainResult: {},
        }),
        persistFn: async () => {},
        mechanicalGateFn: async () => ({ pass: false, reasons: ['behavior_tests 缺失'] }),
      },
    );
    expect(r.verdict).toBe('FAIL');
    expect(r.failure_class).toBe('evidence_insufficient');
  });
});

describe('runJudgeGate — 三权分立裁判门', () => {
  const ORIG = process.env.JUDGE_STRICT;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.JUDGE_STRICT;
    else process.env.JUDGE_STRICT = ORIG;
  });

  it('agent PASS + 裁判 PASS → 终判 PASS（merge 路）', async () => {
    const judgeFn = vi.fn().mockResolvedValue({
      verdict: 'PASS',
      coverage: [{ step: 'step A', passed: true }, { step: 'step B', passed: true }],
      feedback: null,
    });
    const res = await runJudgeGate(
      { ...baseCtx, agentVerdict: 'PASS', agentFeedback: null },
      { judgeFn, collectEvidence: fakeEvidence(), ...noopWrite }
    );
    expect(res.verdict).toBe('PASS');
    expect(res.judged).toBe(true);
    expect(judgeFn).toHaveBeenCalledOnce();
  });

  it('agent PASS + 裁判 FAIL → 终判 FAIL（fix 路），feedback=裁判意见', async () => {
    const judgeFn = vi.fn().mockResolvedValue({
      verdict: 'FAIL',
      coverage: [{ step: 'step A', passed: true }, { step: 'step B', passed: false }],
      feedback: '第二步没有真实证据',
    });
    const res = await runJudgeGate(
      { ...baseCtx, agentVerdict: 'PASS', agentFeedback: 'agent 说都过了' },
      { judgeFn, collectEvidence: fakeEvidence(), ...noopWrite }
    );
    expect(res.verdict).toBe('FAIL');
    expect(res.judged).toBe(true);
    expect(res.feedback).toContain('第二步没有真实证据');
  });

  it('裁判 verdict=PASS 但 Golden Path 覆盖缺步 → 终判 FAIL', async () => {
    const judgeFn = vi.fn().mockResolvedValue({
      verdict: 'PASS',
      coverage: [{ step: 'step A', passed: true }], // 缺 step B
      feedback: null,
    });
    const res = await runJudgeGate(
      { ...baseCtx, agentVerdict: 'PASS', agentFeedback: null },
      { judgeFn, collectEvidence: fakeEvidence(["step A", "step B"]), ...noopWrite }
    );
    expect(res.verdict).toBe('FAIL');
    expect(res.feedback).toContain('缺步');
  });

  it('裁判网络错（默认）→ fail-open 保留 agent verdict + judgeError', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    delete process.env.JUDGE_STRICT;
    const judgeFn = vi.fn().mockRejectedValue(new Error('toapis HTTP 429: rate limited'));
    const res = await runJudgeGate(
      { ...baseCtx, agentVerdict: 'PASS', agentFeedback: null },
      { judgeFn, collectEvidence: fakeEvidence(), ...noopWrite }
    );
    expect(res.verdict).toBe('PASS'); // 保留运动员 verdict
    expect(res.judged).toBe(false);
    expect(res.judgeError).toContain('429');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('JUDGE_STRICT=1 + 裁判网络错 → fail-closed 终判 FAIL', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const judgeFn = vi.fn().mockRejectedValue(new Error('timeout'));
    const res = await runJudgeGate(
      { ...baseCtx, agentVerdict: 'PASS', agentFeedback: null },
      { judgeFn, collectEvidence: fakeEvidence(), strict: true, ...noopWrite }
    );
    expect(res.verdict).toBe('FAIL');
    expect(res.feedback).toContain('fail-closed');
    vi.restoreAllMocks();
  });

  it('agent FAIL → 直接透传，不调裁判（运动员已失败，走 fix loop）', async () => {
    const judgeFn = vi.fn();
    const res = await runJudgeGate(
      { ...baseCtx, agentVerdict: 'FAIL', agentFeedback: 'happy 路 FAIL' },
      { judgeFn, collectEvidence: fakeEvidence(), ...noopWrite }
    );
    expect(res.verdict).toBe('FAIL');
    expect(res.feedback).toBe('happy 路 FAIL');
    expect(judgeFn).not.toHaveBeenCalled();
  });

  it('无合同/Golden Path 证据 → 证据门跳过裁判，保留 agent verdict（不误杀单测/无证据 run）', async () => {
    const judgeFn = vi.fn();
    const emptyEvidence = async () => ({ contractE2E: '', goldenPathSteps: [], transcript: 'x', brainResult: { verdict: 'PASS', behavior_tests: [{ command: 'x', exit_code: 0, log_tail: 'ok' }] } });
    const res = await runJudgeGate(
      { ...baseCtx, agentVerdict: 'PASS', agentFeedback: null },
      { judgeFn, collectEvidence: emptyEvidence, ...noopWrite }
    );
    expect(res.verdict).toBe('PASS');
    expect(res.judged).toBe(false);
    expect(judgeFn).not.toHaveBeenCalled();
  });

  it('精确 PR 验收只有 required_command_evidence 时仍必须进入独立裁判', async () => {
    const commands = ['npm test', 'bash scripts/smoke.sh'];
    const judgeFn = vi.fn().mockResolvedValue({
      verdict: 'PASS',
      coverage: commands.map((step) => ({ step, passed: true, evidence: `${step} exit 0` })),
      feedback: null,
    });
    const commandEvidence = async () => ({
      contractE2E: '',
      goldenPathSteps: [],
      transcript: 'commands completed',
      brainResult: {
        verdict: 'PASS',
        behavior_tests: commands.map((command) => ({ command, exit_code: 0, log_tail: 'passed' })),
      },
    });

    const res = await runJudgeGate(
      {
        ...baseCtx,
        agentVerdict: 'PASS',
        agentFeedback: null,
        requiredCommandEvidence: commands,
      },
      {
        judgeFn,
        collectEvidence: commandEvidence,
        mechanicalGateFn: async () => ({ pass: true, reasons: [] }),
        ...noopWrite,
      },
    );

    expect(res).toMatchObject({ verdict: 'PASS', judged: true });
    expect(judgeFn).toHaveBeenCalledWith(
      expect.objectContaining({ goldenPathSteps: commands }),
      expect.any(Object),
    );
  });
});

describe('validateCoverage — 代码判 coverage 覆盖（不信裁判文字）', () => {
  it('每步都有 passed=true → ok', () => {
    const r = validateCoverage(
      [{ step: 'a', passed: true }, { step: 'b', passed: true }],
      ['a', 'b']
    );
    expect(r.ok).toBe(true);
  });
  it('缺步 → missing 非空，ok=false', () => {
    const r = validateCoverage([{ step: 'a', passed: true }], ['a', 'b']);
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0].index).toBe(2);
  });
  it('某步 passed=false → failed 非空，ok=false', () => {
    const r = validateCoverage(
      [{ step: 'a', passed: true }, { step: 'b', passed: false, evidence: '无输出' }],
      ['a', 'b']
    );
    expect(r.ok).toBe(false);
    expect(r.failed[0].evidence).toBe('无输出');
  });
});

describe('parseGoldenPathSteps / extractE2ESection', () => {
  it('解析 ## Golden Path 段有序步骤', () => {
    const prd = [
      '## Golden Path（核心场景）',
      '',
      '1. 用户 curl 端点 → 返回 200',
      '2. 用户看到 6 项数组',
      '3. any_drift 一致',
      '',
      '## 边界情况',
      '不应解析这里',
    ].join('\n');
    const steps = parseGoldenPathSteps(prd);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toContain('curl 端点');
    expect(steps).not.toContain('不应解析这里');
  });
  it('无 Golden Path 段 → 空数组', () => {
    expect(parseGoldenPathSteps('## 其它\n随便')).toEqual([]);
  });
  it('提取 ## E2E 验收 段', () => {
    const contract = '## 背景\nx\n## E2E 验收\n```bash\ncurl localhost\n```\n## 下一段\ny';
    const e2e = extractE2ESection(contract);
    expect(e2e).toContain('curl localhost');
    expect(e2e).not.toContain('下一段');
  });
});

describe('resolveToapisConfig — env 优先 → toapis.env 兜底', () => {
  const ORIG_KEY = process.env.TOAPIS_API_KEY;
  const ORIG_URL = process.env.TOAPIS_BASE_URL;
  beforeEach(() => {
    delete process.env.TOAPIS_API_KEY;
    delete process.env.TOAPIS_BASE_URL;
  });
  afterEach(() => {
    if (ORIG_KEY === undefined) delete process.env.TOAPIS_API_KEY; else process.env.TOAPIS_API_KEY = ORIG_KEY;
    if (ORIG_URL === undefined) delete process.env.TOAPIS_BASE_URL; else process.env.TOAPIS_BASE_URL = ORIG_URL;
  });

  it('env 设了直接用 env', async () => {
    process.env.TOAPIS_API_KEY = 'sk-env';
    process.env.TOAPIS_BASE_URL = 'https://env.example/v1';
    const cfg = await resolveToapisConfig({ readFileFn: async () => 'TOAPIS_API_KEY=sk-file' });
    expect(cfg.apiKey).toBe('sk-env');
    expect(cfg.baseUrl).toBe('https://env.example/v1');
  });
  it('env 缺失 → 从 toapis.env 文件解析（跳过 # 注释）', async () => {
    const fileContent = [
      '# ToAPIs API 凭据',
      'TOAPIS_API_KEY=sk-test-fromfile',
      'TOAPIS_BASE_URL=https://toapis.com/v1',
      '# 注释行 KEY=should_skip',
    ].join('\n');
    const cfg = await resolveToapisConfig({ readFileFn: async () => fileContent });
    expect(cfg.apiKey).toBe('sk-test-fromfile');
    expect(cfg.baseUrl).toBe('https://toapis.com/v1');
    expect(cfg.model).toBe('gpt-5.6-sol');
  });
  it('兼容 shell source 文件的 export 前缀', async () => {
    const fileContent = [
      'export TOAPIS_API_KEY=sk-export-fromfile',
      'export TOAPIS_BASE_URL=https://export.example/v1',
    ].join('\n');
    const cfg = await resolveToapisConfig({ readFileFn: async () => fileContent });
    expect(cfg.apiKey).toBe('sk-export-fromfile');
    expect(cfg.baseUrl).toBe('https://export.example/v1');
  });
  it('全缺失 → apiKey 空 + 默认 baseUrl', async () => {
    const cfg = await resolveToapisConfig({ readFileFn: async () => { throw new Error('ENOENT'); } });
    expect(cfg.apiKey).toBe('');
    expect(cfg.baseUrl).toBe('https://toapis.com/v1');
  });
});

describe('buildJudgePrompt / normalizeJudgeVerdict', () => {
  it('prompt 含合同 E2E + Golden Path + agent verdict + 只输出 JSON 指令', () => {
    const p = buildJudgePrompt({
      contractE2E: 'curl X',
      goldenPathSteps: ['步骤1', '步骤2'],
      agentVerdict: 'PASS',
      transcript: 'PASS: ok',
      brainResult: { verdict: 'PASS' },
    });
    expect(p).toContain('curl X');
    expect(p).toContain('步骤1');
    expect(p).toContain('运动员自报 verdict：PASS');
    expect(p).toContain('只输出 JSON');
  });
  it('prompt 含结构化阶段事实，未来人审/merge/report 只验时序前提', () => {
    const p = buildJudgePrompt({
      contractE2E: 'bash contract-e2e.sh',
      goldenPathSteps: ['独立裁判后人工批准', '批准后 merge 并回写报告'],
      agentVerdict: 'PASS',
      transcript: 'contract-e2e.sh: 8 passed',
      brainResult: {
        verdict: 'PASS',
        behavior_tests: [{ command: 'bash contract-e2e.sh', exit_code: 0, log_tail: '8 passed' }],
      },
      stageFacts: validStageFacts,
    });
    expect(p).toContain('"current_stage": "independent_judge"');
    expect(p).toContain('"merge_gate_approved": false');
    expect(p).toContain('后置动作');
    expect(p).toContain('缺少未来的批准、merge、report 日志不得判为证据缺失');
    expect(p).toContain('exit_code=0');
    expect(p).toContain('同一份 stdout');
  });
  it('verdict 归一化：含糊/未知 → FAIL（运动员说 PASS，裁判含糊不放行）', () => {
    expect(normalizeJudgeVerdict('pass')).toBe('PASS');
    expect(normalizeJudgeVerdict('FAIL')).toBe('FAIL');
    expect(normalizeJudgeVerdict('maybe')).toBe('FAIL');
    expect(normalizeJudgeVerdict(undefined)).toBe('FAIL');
  });
});

describe('independent judge stage facts — fail-closed 时序闸', () => {
  it('只允许有当前 head、尚未 merge、尚未批准 merge gate 的 judge 阶段', () => {
    expect(validateIndependentJudgeStageFacts(validStageFacts)).toEqual({ pass: true, reasons: [] });
  });

  it.each([
    [{ ...validStageFacts, head_sha: null }, 'head_sha'],
    [{ ...validStageFacts, pr_state: 'CLOSED' }, 'pr_state'],
    [{ ...validStageFacts, pr_merged: true }, 'pr_merged'],
    [{ ...validStageFacts, merge_gate_approved: true }, 'merge_gate_approved'],
  ])('非法阶段事实 %j 在调用模型前终局 FAIL', async (stageFacts, reason) => {
    const judgeFn = vi.fn();
    const res = await runJudgeGate(
      { ...baseCtx, agentVerdict: 'PASS', stageFacts },
      { judgeFn, collectEvidence: fakeEvidence(), ...noopWrite }
    );
    expect(res).toMatchObject({
      verdict: 'FAIL',
      judged: true,
      failure_class: 'evidence_invalid',
    });
    expect(res.feedback).toContain(reason);
    expect(judgeFn).not.toHaveBeenCalled();
  });

  it('合法阶段事实透传给独立裁判并允许双 PASS', async () => {
    const judgeFn = vi.fn().mockResolvedValue({
      verdict: 'PASS',
      coverage: [{ step: 'step A', passed: true }, { step: 'step B', passed: true }],
      feedback: null,
    });
    const res = await runJudgeGate(
      { ...baseCtx, agentVerdict: 'PASS', stageFacts: validStageFacts },
      { judgeFn, collectEvidence: fakeEvidence(), ...noopWrite }
    );
    expect(res.verdict).toBe('PASS');
    expect(judgeFn.mock.calls[0][0].stageFacts).toEqual(validStageFacts);
  });
});

// ── 证据供给：裁判要拿到 agent 完整 stdout 转录（#3372 配套缺口） ─────────────────
describe('resolveStdoutFile — 据 taskId 定位 forensics stdout 转录（最新 mtime）', () => {
  const TASK = '01f31f66-e6d2-4d32-a6fb-190c6bd3cbf6';
  const dirEntries = [
    `${TASK}.aaaa1111.prompt`,    // 非 .stdout，忽略
    `${TASK}.aaaa1111.stdout`,    // 旧
    `${TASK}.bbbb2222.stdout`,    // 新（最大 mtime）
    `other-task.cccc3333.stdout`, // 别的 task，忽略
  ];
  const mtimes = {
    [`/p/${TASK}.aaaa1111.stdout`]: 1000,
    [`/p/${TASK}.bbbb2222.stdout`]: 2000,
    [`/p/other-task.cccc3333.stdout`]: 9999,
  };
  it('挑同 task 前缀里 mtime 最新的 .stdout，忽略别的 task 与非 stdout', async () => {
    const f = await resolveStdoutFile(
      { promptDir: '/p', taskId: TASK },
      {
        listDirFn: async () => dirEntries,
        statFn: async (p) => ({ mtimeMs: mtimes[p] || 0 }),
      }
    );
    expect(f).toBe(`/p/${TASK}.bbbb2222.stdout`);
  });
  it('promptDir/taskId 缺失 → null（fail-open）', async () => {
    expect(await resolveStdoutFile({ promptDir: '', taskId: TASK })).toBeNull();
    expect(await resolveStdoutFile({ promptDir: '/p', taskId: '' })).toBeNull();
  });
  it('目录不可读 → null（不抛）', async () => {
    const f = await resolveStdoutFile(
      { promptDir: '/p', taskId: TASK },
      { listDirFn: async () => { throw new Error('ENOENT'); } }
    );
    expect(f).toBeNull();
  });
});

describe('extractAgentTranscript — 从 forensics 文件取可读转录', () => {
  it('单对象 JSON（--output-format json）→ 取 .result 叙述', () => {
    const raw = JSON.stringify({ type: 'result', result: 'E2E 全过：step1 stdout=ok exit=0', usage: { x: 1 } });
    expect(extractAgentTranscript(raw)).toBe('E2E 全过：step1 stdout=ok exit=0');
  });
  it('NDJSON / 纯文本（含命令输出）→ 原样返回', () => {
    const raw = '{"type":"tool_result","content":"+ vitest run\\n5 passed"}\n{"type":"result"}';
    expect(extractAgentTranscript(raw)).toBe(raw);
  });
  it('空 → 空串', () => {
    expect(extractAgentTranscript('')).toBe('');
    expect(extractAgentTranscript(null)).toBe('');
  });
});

describe('collectEvidence — 把 agent 完整 stdout 纳入证据', () => {
  it('据 promptDir/taskId 读 forensics stdout，extract 后填 agentStdout', async () => {
    const stdoutRaw = JSON.stringify({ result: '运动员执行：vitest 5 passed，exit=0' });
    const ev = await collectEvidence(
      {
        worktreePath: '/tmp/x',
        sprintDir: 'sprints/x',
        transcript: 'callback 4KB tail',
        brainResult: { verdict: 'PASS' },
        promptDir: '/p',
        taskId: 't1',
      },
      {
        // contract/prd 读不到 → 走 catch（空段），不影响 agentStdout 断言
        readFileFn: async (p) => {
          if (String(p).endsWith('.stdout')) return stdoutRaw;
          throw new Error('ENOENT');
        },
        listDirFn: async () => ['t1.zzzz9999.stdout'],
        statFn: async () => ({ mtimeMs: 1 }),
      }
    );
    expect(ev.agentStdout).toBe('运动员执行：vitest 5 passed，exit=0');
    expect(ev.transcript).toBe('callback 4KB tail');
  });
  it('forensics 文件缺失 → agentStdout 空，transcript 仍在（fail-open）', async () => {
    const ev = await collectEvidence(
      { worktreePath: '/tmp/x', sprintDir: 'sprints/x', transcript: 'tail only', promptDir: '/p', taskId: 't1' },
      { readFileFn: async () => { throw new Error('ENOENT'); }, listDirFn: async () => [] }
    );
    expect(ev.agentStdout).toBe('');
    expect(ev.transcript).toBe('tail only');
  });
});

describe('buildJudgePrompt — 含 agentStdout + 接受命令 stdout 即证据规则', () => {
  it('agentStdout 段进 prompt，且声明「含命令 stdout 即视为执行证据」', () => {
    const p = buildJudgePrompt({
      contractE2E: 'curl X',
      goldenPathSteps: ['步骤1'],
      agentVerdict: 'PASS',
      transcript: '4KB tail',
      agentStdout: '完整转录：+ vitest run / 5 passed',
      brainResult: { verdict: 'PASS' },
    });
    expect(p).toContain('完整转录：+ vitest run / 5 passed');
    expect(p).toContain('即视为该步已执行的证据');
    // 仍保留「证据缺失 → FAIL」红线
    expect(p).toContain('确实缺失某步的执行输出');
  });
});

describe('runJudgeGate — 把 promptDir/taskId 透传给 collectEvidence', () => {
  it('collectEvidence 收到 promptDir + taskId', async () => {
    const collect = vi.fn().mockResolvedValue({
      contractE2E: '## E2E\ncurl', goldenPathSteps: ['A'], transcript: 't', agentStdout: 's', brainResult: { verdict: 'PASS', behavior_tests: [{ command: 'x', exit_code: 0, log_tail: 'ok' }] },
    });
    const judgeFn = vi.fn().mockResolvedValue({ verdict: 'PASS', coverage: [{ step: 'A', passed: true }], feedback: null });
    const res = await runJudgeGate(
      { worktreePath: '/tmp/x', sprintDir: 'sprints/x', agentVerdict: 'PASS', transcript: 't', promptDir: '/p', taskId: 'task-xyz' },
      { judgeFn, collectEvidence: collect, writeFileFn: async () => {}, listTestFilesFn: async () => ['a.test.ts'] }
    );
    expect(res.verdict).toBe('PASS');
    const passedCtx = collect.mock.calls[0][0];
    expect(passedCtx.promptDir).toBe('/p');
    expect(passedCtx.taskId).toBe('task-xyz');
    // judgeFn 也拿到 agentStdout
    expect(judgeFn.mock.calls[0][0].agentStdout).toBe('s');
  });
});
