/**
 * harness-line-context-wiring.test.js — A-1 注入接线测试。
 *
 * 现状：仅 harness-gan.graph.js proposer 单点注入（原 harness-task.graph.js
 * generator/evaluator 注入点已随该文件删除）。用例：
 *   有数据 → prompt 含段头 + 角色指令句；fetch 抛错或返回 '' → 流程照常且不含段头。
 * 另测 runGanContractGraph 入口 fetch 一次（GAN 多轮复用，只传 {id: taskId} 交 helper 补齐）。
 *
 * mock 前导参照 harness-task-spawn-base-repo.test.js + harness-handoff-wiring.test.js；
 * harness-line-context.js 用 importOriginal 半 mock：只替换 fetchAndFormatLineContext，
 * 段头常量保持真实导出（wiring 断言复用 = 消死导出）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { lineCtxMock } = vi.hoisted(() => ({ lineCtxMock: vi.fn(async () => '') }));

vi.mock('../harness-line-context.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchAndFormatLineContext: lineCtxMock };
});

vi.mock('node:fs/promises', () => {
  const m = { readFile: vi.fn(), readdir: vi.fn(), access: vi.fn(), mkdir: vi.fn(), unlink: vi.fn() };
  return { default: m, ...m };
});
vi.mock('../db.js', () => ({ default: { connect: vi.fn(), query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('../lib/contract-verify.js', () => ({
  ContractViolation: class extends Error {},
  verifyProposerOutput: vi.fn(),
  verifyContractProposerOutput: vi.fn(async () => {}),
  verifyGeneratorOutput: vi.fn(),
  verifyEvaluatorWorktree: vi.fn(),
}));
vi.mock('../lib/contract-gate.js', () => ({
  runContractGate: vi.fn(async () => ({ ok: true })),
  formatGateReport: vi.fn(() => ''),
  evaluateContractText: vi.fn(),
}));
vi.mock('../harness-credentials.js', () => ({ resolveGitHubToken: vi.fn(async () => 'tok') }));
vi.mock('../lib/git-fence.js', () => ({ fetchAndShowOriginFile: vi.fn() }));
vi.mock('../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../spawn/detached.js', () => ({ spawnDockerDetached: vi.fn(), spawnCodexBridgeDetached: vi.fn() }));
vi.mock('../spawn/host-executor.js', () => ({ executeOnHost: vi.fn() }));
vi.mock('../spawn/middleware/account-rotation.js', () => ({ resolveAccount: vi.fn() }));
vi.mock('../spawn/middleware/cap-marking.js', () => ({ checkAuthFailure: vi.fn() }));
vi.mock('../harness-shared.js', () => ({
  parseDockerOutput: vi.fn(),
  extractField: vi.fn(),
  readPrFromGitState: vi.fn(),
  readVerdictFile: vi.fn(),
  readBrainResult: vi.fn(async () => ({})),
  readAndValidateBrainResult: vi.fn(async () => ({})),
  EvaluatorOutputSchema: {},
  ReviewerOutputSchema: {},
  loadSkillContent: vi.fn(() => ''),
  assertSprintDir: vi.fn((v) => v || 'sprints/test-default'),
}));
vi.mock('../harness-judge.js', () => ({ runJudgeGate: vi.fn() }));
vi.mock('../docker-executor.js', () => ({ getHostPromptDir: vi.fn(() => '/tmp/prompts') }));
vi.mock('../lib/live-container.js', () => ({ findLiveEvaluateContainer: vi.fn(async () => null) }));
vi.mock('../routing/resolve-executor.js', () => ({ resolveExecutor: vi.fn(async () => ({ executor: 'claude' })) }));
vi.mock('../shepherd.js', () => ({ checkPrStatus: vi.fn(), classifyFailedChecks: vi.fn() }));
vi.mock('../orchestrator/pg-checkpointer.js', () => ({ getPgCheckpointer: vi.fn() }));
vi.mock('../harness-session-bridge.js', () => ({ makeSessionRecord: vi.fn(() => ({})), reconnectOrSpawn: vi.fn() }));
vi.mock('../harness-worktree.js', () => ({
  ensureHarnessWorktree: vi.fn(async () => '/mock-wt'),
  harnessSubTaskBranchName: vi.fn(() => 'cp-mock-branch'),
  harnessTaskWorktreePath: vi.fn((id) => `/mock-wt/${id}`),
  cleanupHarnessWorktree: vi.fn(),
  DEFAULT_BASE_REPO: '/mock-repo',
}));
vi.mock('@langchain/langgraph', () => {
  function Annotation(x) { return x; }
  Annotation.Root = (fields) => fields;
  return {
    StateGraph: class {
      addNode() { return this; }
      addEdge() { return this; }
      addConditionalEdges() { return this; }
      compile() { return { invoke: vi.fn(async () => ({})) }; }
    },
    Annotation,
    START: '__start__',
    END: '__end__',
    interrupt: vi.fn(),
    Command: class {},
    MemorySaver: class {},
  };
});

import { createGanContractNodes, runGanContractGraph } from '../workflows/harness-gan.graph.js';
import { INVARIANT_SECTION_HEADER } from '../harness-line-context.js';

const PROPOSER_RULE = '合同的 [BEHAVIOR] 断言不得与上述铁律冲突；已验收行为只能引用不得重做。';
const CTX_TEXT = `${INVARIANT_SECTION_HEADER}\n- [不进群] 只私聊；群聊一律跳过（来源: journey_feature）`;

function makePool() {
  return { query: vi.fn(async () => ({ rows: [] })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  lineCtxMock.mockImplementation(async () => '');
});

// ── proposer（harness-gan.graph.js）─────────────────────────────────────────

function ganCtx(overrides = {}) {
  return {
    taskId: 'task-gan-1',
    initiativeId: 'init-1',
    sprintDir: 'sprints/x',
    worktreePath: '/tmp/wt-gan',
    githubToken: 'tok',
    plannerOutput: '',
    readContractFile: vi.fn(async () => '# contract'),
    readContractFromBranch: vi.fn(async () => null),
    verifyProposer: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('proposer 注入（createGanContractNodes ctx.lineContextText）', () => {
  it('lineContextText 有值 → executor prompt 含段头 + proposer 指令句', async () => {
    const executor = vi.fn(async () => ({ exit_code: 0 }));
    const nodes = createGanContractNodes(executor, ganCtx({ lineContextText: CTX_TEXT }));
    await nodes.proposer({ round: 0, prdContent: 'PRD 内容', feedback: null, costUsd: 0 });
    expect(executor).toHaveBeenCalledTimes(1);
    const { prompt } = executor.mock.calls[0][0];
    expect(prompt).toContain(INVARIANT_SECTION_HEADER);
    expect(prompt).toContain('- [不进群] 只私聊；群聊一律跳过（来源: journey_feature）');
    expect(prompt).toContain(PROPOSER_RULE);
  });

  it('lineContextText 空 → spawn 照常，prompt 不含段头/指令句', async () => {
    const executor = vi.fn(async () => ({ exit_code: 0 }));
    const nodes = createGanContractNodes(executor, ganCtx({ lineContextText: '' }));
    const r = await nodes.proposer({ round: 0, prdContent: 'PRD 内容', feedback: null, costUsd: 0 });
    expect(executor).toHaveBeenCalledTimes(1);
    const { prompt } = executor.mock.calls[0][0];
    expect(prompt).not.toContain(INVARIANT_SECTION_HEADER);
    expect(prompt).not.toContain(PROPOSER_RULE);
    expect(r.round).toBe(1);
  });
});

describe('runGanContractGraph 入口 fetch（GAN 多轮复用一次查询）', () => {
  function ganOpts(pool) {
    return {
      taskId: 'task-gan-1', initiativeId: 'init-1', sprintDir: 'sprints/x',
      prdContent: 'PRD', executor: vi.fn(), worktreePath: '/tmp/wt-gan',
      githubToken: 'tok', checkpointer: {}, pool,
    };
  }

  it('入口调 fetchAndFormatLineContext 一次，只传 {id: taskId}（helper 内部补齐 ability/journey）', async () => {
    lineCtxMock.mockResolvedValueOnce(CTX_TEXT);
    const pool = makePool();
    const r = await runGanContractGraph(ganOpts(pool));
    expect(lineCtxMock).toHaveBeenCalledTimes(1);
    expect(lineCtxMock).toHaveBeenCalledWith({ pool }, { id: 'task-gan-1' });
    expect(r).toBeTruthy();
  });

  it('fetch 抛错 → 非致命，GAN 入口照常 invoke 返回', async () => {
    lineCtxMock.mockRejectedValueOnce(new Error('db down'));
    const r = await runGanContractGraph(ganOpts(makePool()));
    expect(r).toBeTruthy();
  });
});

