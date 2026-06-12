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
} from '../harness-judge.js';

// 注入一个不落盘的证据收集（避免 fs）。
function fakeEvidence(goldenPathSteps = ['step A', 'step B']) {
  return async () => ({
    contractE2E: '## E2E\ncurl localhost',
    goldenPathSteps,
    transcript: 'PASS: did A\nPASS: did B',
    brainResult: { verdict: 'PASS' },
  });
}

// 注入不落盘的 writeFileFn，避免 persistJudgeArtifact 真写盘。
const noopWrite = { writeFileFn: async () => {} };
// worktreePath 非空（过证据门）；fakeEvidence 提供 Golden Path 步骤。
const baseCtx = {
  worktreePath: '/tmp/judge-test',
  sprintDir: 'sprints/x',
  instanceLabel: 'harness-evaluate-t1-r0-abcd1234',
  transcript: 'PASS: did A\nPASS: did B',
};

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
    const emptyEvidence = async () => ({ contractE2E: '', goldenPathSteps: [], transcript: 'x', brainResult: null });
    const res = await runJudgeGate(
      { ...baseCtx, agentVerdict: 'PASS', agentFeedback: null },
      { judgeFn, collectEvidence: emptyEvidence, ...noopWrite }
    );
    expect(res.verdict).toBe('PASS');
    expect(res.judged).toBe(false);
    expect(judgeFn).not.toHaveBeenCalled();
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
    expect(cfg.model).toBe('deepseek-v4-flash');
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
  it('verdict 归一化：含糊/未知 → FAIL（运动员说 PASS，裁判含糊不放行）', () => {
    expect(normalizeJudgeVerdict('pass')).toBe('PASS');
    expect(normalizeJudgeVerdict('FAIL')).toBe('FAIL');
    expect(normalizeJudgeVerdict('maybe')).toBe('FAIL');
    expect(normalizeJudgeVerdict(undefined)).toBe('FAIL');
  });
});
