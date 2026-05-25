/**
 * harness-container-liveness.test.js — B2/B3 回归测试
 *
 * Bug B2: Docker 容器崩了（exit 非 0）没有 POST 回调，
 *         _waitForSubGraphCompletion 傻等到 90 分钟超时。
 *
 * Bug B3: Brain 重启时 resume_from_checkpoint=true，容器早已死亡，
 *         _waitForSubGraphCompletion 再次傻等 90 分钟。
 *
 * 修复目标：在轮询循环里检查 containerId 对应容器的 docker 状态。
 *   如果容器 exited / dead，主动通过 compiled.invoke({resume:{status:"failed",...}}, config)
 *   唤醒 sub-graph 走 failure 路径，而不是等到 90min 超时。
 *
 * 测试策略：
 *   - mock compiled.getState() → 始终返回 next=["await_callback"]（sub-graph stuck）
 *   - mock child_process.execFile → 模拟 docker inspect 返回结果
 *   - mock compiled.invoke（resume）→ 让 getState 之后返回 next=[]
 *   - 断言：在合理时间内（小于 10s 而非 90min），invoke 被调用且带 resume.status="failed"
 *
 * DoD 映射：
 * - [BEHAVIOR] B2: container exited → liveness check 主动 resume sub-graph → 返回 failed 状态
 * - [BEHAVIOR] B3: container 不存在（docker inspect 报错）→ 同样主动 resume
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── mock child_process（必须 hoisted，在所有 import 之前注册）──────────────────
const mockExecFile = vi.hoisted(() => vi.fn());
vi.mock("child_process", () => ({ execFile: mockExecFile }));

// ─── mock 所有 harness-initiative.graph.js 的重量级依赖 ─────────────────────────
vi.mock("../db.js", () => ({ default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock("../spawn/index.js", () => ({ spawn: vi.fn() }));
vi.mock("../harness-session-bridge.js", () => ({
  reconnectOrSpawn: vi.fn(),
  makeSessionRecord: vi.fn(),
}));
vi.mock("../harness-shared.js", () => ({
  parseDockerOutput: vi.fn((x) => x),
  loadSkillContent: vi.fn(() => "SKILL"),
  readBrainResult: vi.fn(),
}));
vi.mock("../harness-dag.js", () => ({
  parseTaskPlan: vi.fn(),
  upsertTaskPlan: vi.fn().mockResolvedValue({ idMap: {}, insertedTaskIds: [] }),
}));
vi.mock("../harness-final-e2e.js", () => ({
  runFinalE2E: vi.fn(),
  attributeFailures: vi.fn(),
  runScenarioCommand: vi.fn(),
  bootstrapE2E: vi.fn(),
  teardownE2E: vi.fn(),
  normalizeAcceptance: vi.fn(),
}));
vi.mock("../harness-worktree.js", () => ({
  ensureHarnessWorktree: vi.fn().mockResolvedValue("/mock-wt"),
  harnessSubTaskWorktreePath: vi.fn(),
  DEFAULT_BASE_REPO: "/mock-cecelia",
}));
vi.mock("../harness-credentials.js", () => ({
  resolveGitHubToken: vi.fn().mockResolvedValue("mock-token"),
}));
vi.mock("../lib/git-fence.js", () => ({
  fetchAndShowOriginFile: vi.fn(),
}));
vi.mock("../harness-gan-graph.js", () => ({
  runGanContractGraph: vi.fn(),
  buildHarnessGanGraph: vi.fn(),
}));
vi.mock("../orchestrator/pg-checkpointer.js", () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({}),
}));
vi.mock("./retry-policies.js", () => ({ LLM_RETRY: {}, DB_RETRY: {}, NO_RETRY: {} }));
vi.mock("../workflows/retry-policies.js", () => ({ LLM_RETRY: {}, DB_RETRY: {}, NO_RETRY: {} }));
vi.mock("@langchain/langgraph", () => {
  function Annotation(x) { return x; }
  Annotation.Root = (fields) => fields;
  return {
    StateGraph: class {
      addNode() { return this; }
      addEdge() { return this; }
      addConditionalEdges() { return this; }
      compile() { return { invoke: vi.fn(), getState: vi.fn() }; }
    },
    Annotation,
    START: "__start__",
    END: "__end__",
    Send: class { constructor(n, s) { this.node = n; this.state = s; } },
    interrupt: vi.fn(),
    MemorySaver: class {},
  };
});
vi.mock("./harness-task.graph.js", () => ({
  buildHarnessTaskGraph: vi.fn(() => ({
    compile: vi.fn(() => ({ invoke: vi.fn(), getState: vi.fn() })),
  })),
  compileHarnessTaskGraph: vi.fn(),
}));
vi.mock("../harness-pg-checkpointer.js", () => ({ getPgCheckpointer: vi.fn() }));

// ─── 导入被测函数（在所有 mock 之后）────────────────────────────────────────────
import { _waitForSubGraphCompletion } from "../workflows/harness-initiative.graph.js";

describe("_waitForSubGraphCompletion — container liveness detection (B2/B3)", () => {
  let compiled;
  let config;

  beforeEach(() => {
    vi.clearAllMocks();
    config = { configurable: { thread_id: "harness-task:test-initiative:ws1" } };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("B2: container exited → 主动 resume sub-graph 走 failure 路径，不等超时", async () => {
    const mockGetState = vi.fn()
      .mockResolvedValueOnce({
        next: ["await_callback"],
        values: { containerId: "harness-ws1-abc123", status: "queued" },
      })
      .mockResolvedValue({
        next: [],
        values: { status: "failed", containerId: "harness-ws1-abc123" },
      });

    const mockInvoke = vi.fn().mockResolvedValue(undefined);
    compiled = { getState: mockGetState, invoke: mockInvoke };

    // docker inspect 返回 "exited"（通过 execFile callback）
    mockExecFile.mockImplementation((cmd, args, cb) => cb(null, "exited
"));

    const result = await _waitForSubGraphCompletion(compiled, config, 30_000, {
      pollIntervalMs: 50,
      livenessCheckEveryN: 1,
    });

    // 断言：execFile 被调用，参数含 containerId
    expect(mockExecFile).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["inspect", "--format", "{{.State.Status}}", "harness-ws1-abc123"]),
      expect.any(Function)
    );

    // 断言：invoke 被调用（liveness resume），payload 含 resume.status="failed"
    expect(mockInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        resume: expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("exited"),
        }),
      }),
      config
    );

    expect(result).toMatchObject({ status: "failed" });
  });

  it("B3: docker inspect 失败（容器不存在）→ 主动 resume sub-graph", async () => {
    const mockGetState = vi.fn()
      .mockResolvedValueOnce({
        next: ["await_callback"],
        values: { containerId: "harness-ws1-dead456", status: "queued" },
      })
      .mockResolvedValue({
        next: [],
        values: { status: "failed", containerId: "harness-ws1-dead456" },
      });

    const mockInvoke = vi.fn().mockResolvedValue(undefined);
    compiled = { getState: mockGetState, invoke: mockInvoke };

    // docker inspect 失败（容器不存在）— execFile 以 err 调用 callback
    mockExecFile.mockImplementation((cmd, args, cb) =>
      cb(new Error("Error: No such object: harness-ws1-dead456"), "")
    );

    const result = await _waitForSubGraphCompletion(compiled, config, 30_000, {
      pollIntervalMs: 50,
      livenessCheckEveryN: 1,
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        resume: expect.objectContaining({ status: "failed" }),
      }),
      config
    );

    expect(result).toMatchObject({ status: "failed" });
  });

  it("正常路径: container running → 不触发 resume，继续等待", async () => {
    let callCount = 0;
    const mockGetState = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          next: ["await_callback"],
          values: { containerId: "harness-ws1-ok789", status: "queued" },
        };
      }
      return { next: [], values: { status: "completed", pr_url: "https://github.com/x/y/pull/99" } };
    });

    const mockInvoke = vi.fn();
    compiled = { getState: mockGetState, invoke: mockInvoke };

    // docker inspect → running（容器还活着）
    mockExecFile.mockImplementation((cmd, args, cb) => cb(null, "running
"));

    const result = await _waitForSubGraphCompletion(compiled, config, 30_000, {
      pollIntervalMs: 50,
      livenessCheckEveryN: 1,
    });

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "completed" });
  });

  it("无 containerId → 跳过 liveness check，不报错", async () => {
    const mockGetState = vi.fn()
      .mockResolvedValueOnce({
        next: ["await_callback"],
        values: { containerId: null, status: "queued" },
      })
      .mockResolvedValue({
        next: [],
        values: { status: "completed" },
      });

    const mockInvoke = vi.fn();
    compiled = { getState: mockGetState, invoke: mockInvoke };

    const result = await _waitForSubGraphCompletion(compiled, config, 30_000, {
      pollIntervalMs: 50,
      livenessCheckEveryN: 1,
    });

    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "completed" });
  });

  it("container dead → 视为 exited，触发 resume", async () => {
    const mockGetState = vi.fn()
      .mockResolvedValueOnce({
        next: ["await_callback"],
        values: { containerId: "harness-ws1-dead", status: "queued" },
      })
      .mockResolvedValue({
        next: [],
        values: { status: "failed" },
      });

    const mockInvoke = vi.fn().mockResolvedValue(undefined);
    compiled = { getState: mockGetState, invoke: mockInvoke };

    mockExecFile.mockImplementation((cmd, args, cb) => cb(null, "dead
"));

    await _waitForSubGraphCompletion(compiled, config, 30_000, {
      pollIntervalMs: 50,
      livenessCheckEveryN: 1,
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        resume: expect.objectContaining({ status: "failed" }),
      }),
      config
    );
  });
});
