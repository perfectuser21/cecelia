# B44 — Harness Pipeline A→B→C + phase=done 集成测试 Implementation Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用 nodeOverrides 驱动的集成测试覆盖 harness pipeline A→B→C 完整路径，断言 `final_e2e_verdict='PASS'` 且 DB `phase='done'` writeback 被正确调用，能在 CI ubuntu-latest 跑通，< 30s。

**Architecture:** 在 B43 已有的 `buildHarnessFullGraph({ nodeOverrides })` 接缝基础上，新增专用 b44 测试文件，复用相同 mock 结构（MemorySaver checkpointer + pool.query mock），额外验证 `reportNode` 写回 DB 时 `phase='done'` 的 UPDATE 调用。新增对应的静态 smoke.sh 确认断言行存在。

**Tech Stack:** vitest, @langchain/langgraph MemorySaver, Node.js ESM, bash (smoke.sh)

---

## 文件结构

- **新增** `packages/brain/src/workflows/__tests__/harness-pipeline-b44-integration.test.js` — 集成测试主文件
- **新增** `packages/brain/scripts/smoke/b44-harness-phase-done-smoke.sh` — 静态 smoke 验证

## 测试设计

### Mock 层

| Mock 目标 | 方式 | 原因 |
|---|---|---|
| `run_sub_task` 节点 | `nodeOverrides.runSubTaskFn` | 替换 Phase B（外部 Claude API + GitHub） |
| `final_evaluate` 节点 | `nodeOverrides.finalEvaluateFn` | 替换 Phase C evaluator（外部 Docker） |
| `getPgCheckpointer` | `vi.mock` → MemorySaver | 去掉真实 PG checkpointer 依赖 |
| `pool.query` | `vi.fn()` + mockResolvedValue | 记录所有 DB 调用，验 phase writeback |
| `harness-shared.js` pool | `vi.mock` | Brain DB pool 替换为 mock |

### 断言

```
断言 1: final.final_e2e_verdict === 'PASS'
断言 2: pool.query 被调用过至少一次，调用参数含 'phase' 且含 'done'
断言 3: mockRunSubTaskFn 被调 1 次
断言 4: mockFinalEvaluateFn 被调 1 次
```

断言 2 验证路径：`reportNode` → `pool.query('UPDATE initiative_runs SET phase=$2 ...', [id, 'done'])`

### DB mock 序列（Phase A transaction）

`pool.query` 按顺序 mockResolvedValueOnce：
1. `BEGIN` → `{}`
2. `INSERT INTO initiative_contracts` → `{ rows: [{ id: 'contract-1' }] }`
3. `INSERT INTO initiative_runs` → `{ rows: [{ id: 'run-1' }] }`
4. `COMMIT` → `{}`
5. 后续调用（UPDATE phase 等）→ `mockResolvedValue({})` 兜底

### 测试 input

```js
{
  prd: 'Build GET /ping → { pong: true }',
  initiative_id: 'test-b44-initiative-id',
  sprint_dir: '/tmp/b44-test-sprint'
}
```

## Smoke.sh 设计

静态验证（< 1s，不起服务）：
- Case 1：测试文件存在
- Case 2：测试文件含 `phase.*done` 断言行
- Case 3：`buildHarnessFullGraph` import 存在于测试文件

## 测试策略

- **类型**：integration test（harness graph 多模块 + DB mock + nodeOverrides 注入）
- **运行环境**：CI ubuntu-latest，纯 in-process vitest，无真实 DB/API/Docker 依赖
- **超时**：8000ms per test（实际预期 < 3s）
- **TDD 顺序**：commit-1 写失败测试，commit-2 写实现让测试绿

## 成功标准

- `vitest run` 绿，含 4 个断言全部通过
- `bash packages/brain/scripts/smoke/b44-harness-phase-done-smoke.sh` exit 0
- CI `lint-test-pairing` + `lint-feature-has-smoke` 通过
