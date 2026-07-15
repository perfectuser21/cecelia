# Contract Draft — 刀A2：watchdog 收口顺序 + _parseBaseRepo 容器内解析修复

sprint: 07150221-watchdog-finalize-order
task_id: 5e9c0496-a7a9-4889-b536-8094c25da604
date: 2026-07-15
status: PROPOSED

---

## 背景与根因

`initiative_runs.pr_url` 为空（relay session 未回写）时，watchdog 在 `generator_done=true` 分支直接 `continue`，
`_discoverPrFromGithub` 永远不被调用。`_parseBaseRepo` 仅识别 `https://github.com/` URL 格式，
容器内宿主机路径（如 `/Users/administrator/perfect21/cecelia`）返回 `null` → 反查失明。

---

## Test Contract 表

| ID | 场景 | 输入条件 | 预期断言 | 测试形态 |
|----|------|----------|----------|----------|
| TC-1 | GP-1: generator_done+pr_url 空+反查 MERGED | `task.payload.generator_done=true`, `run.pr_url=null`, `_discoverPrFromGithub` mock 返回 `{state:'MERGED', url:'https://github.com/x/y/pull/1'}` | `_finalizeMergedRun` 被调用（`pool.query` 含 `UPDATE initiative_runs ... 'done'` 和 `UPDATE tasks ... 'completed'`）；`out.mergedPr===1`；`execFn` 未收到 spawn 相关调用；日志输出含 `discovered_merged_via_fallback` | unit:vitest |
| TC-2 | GP-2: `_parseBaseRepo` 宿主机路径映射 | 调用 `_parseBaseRepo('/Users/administrator/perfect21/cecelia')` | 返回字符串 `'perfectuser21/cecelia'` | unit:vitest |
| TC-3 | GP-2b: `_parseBaseRepo` 容器内路径映射 | 调用 `_parseBaseRepo('/workspace')` | 返回字符串 `'perfectuser21/cecelia'` | unit:vitest |
| TC-4 | GP-2c: HARNESS_REPO_MAP env 覆盖 | `process.env.HARNESS_REPO_MAP='{"custom/path":"myorg/myrepo"}'`；调用 `_parseBaseRepo('custom/path')` | 返回 `'myorg/myrepo'` | unit:vitest |
| TC-5 | GP-3: generator_done+pr_url 空+反查 OPEN | `task.payload.generator_done=true`, `run.pr_url=null`, mock 反查返回 `{state:'OPEN', url:'https://github.com/x/y/pull/2'}` | `pool.query` 含 `UPDATE initiative_runs SET pr_url`；`spawnFn` 未被调用；`out.resumed===0` | unit:vitest |
| TC-6 | GP-4: 既有测试无回归 | 不修改任何既有 test case | `pnpm --filter brain test` 全部通过（0 failures） | unit:vitest |
| TC-7 | generator_done+pr_url 空+反查无命中 | mock 反查返回 `null` | `spawnFn` 未被调用（`continue` 分支仍保留）；`out.resumed===0` | unit:vitest |
| TC-8 | generator_done 超时兜底不变 | `doneAt` 超过 `GENERATOR_DONE_TIMEOUT_MS`，无可用 pr_url | `UPDATE initiative_runs SET phase='failed', failure_reason='generator_done_timeout'` 被执行 | unit:vitest |
| TC-9 | URL 格式 base_repo 优先于路径映射 | `_parseBaseRepo('https://github.com/org/repo')` | 返回 `'org/repo'`（原逻辑不变） | unit:vitest |

---

## E2E 验收

### E2E-1（核心场景，测试环境：brain_unit_test）

**前置**：在 vitest 测试环境中，通过 `deps.pool`/`deps.execFn` mock 注入构造如下场景：

```
initiative_runs: { initiative_id: TASK_ID, phase: 'planning', pr_url: null, attempts: '1',
                   deadline_at: NOW()+3600s }
tasks: { id: TASK_ID, status: 'in_progress', payload: { orchestrator:'skill-relay',
         generator_done: true, base_repo: '/Users/administrator/perfect21/cecelia' } }
_discoverPrFromGithub mock: → { state: 'MERGED', url: 'https://github.com/perfectuser21/cecelia/pull/1' }
```

**执行**：`await resumeStalledRelayRuns(deps)`

**验收断言**（可机器执行）：
1. `spawnFn` 未被调用（`expect(deps.spawnFn).not.toHaveBeenCalled()`）
2. `out.mergedPr === 1`
3. `pool.query` 被调用过含 `UPDATE initiative_runs` 和 `'done'` 的 SQL
4. `pool.query` 被调用过含 `UPDATE tasks` 和 `'completed'` 的 SQL
5. console.log 输出含字符串 `discovered_merged_via_fallback`（可通过 `vi.spyOn(console, 'log')` 捕获）

### E2E-2（_parseBaseRepo 端到端）

**执行**：直接调用导出函数

```js
import { _parseBaseRepo } from '../harness-relay-watchdog.js';
expect(_parseBaseRepo('/Users/administrator/perfect21/cecelia')).toBe('perfectuser21/cecelia');
expect(_parseBaseRepo('/workspace')).toBe('perfectuser21/cecelia');
expect(_parseBaseRepo('https://github.com/org/repo')).toBe('org/repo');
expect(_parseBaseRepo(null)).toBeNull();
```

---

## 未覆盖真实链路清单

以下为本次 sprint 范围内明确不覆盖、需人工或后续 sprint 处理的真实链路风险：

| # | 真实链路 | 未覆盖原因 | 风险等级 |
|---|----------|-----------|----------|
| 1 | `_discoverPrFromGithub` 实际调用 `gh pr list`（网络 I/O） | brain_unit_test 环境无 GitHub 网络，mock execFn 替代 | 低（已有 mock 覆盖正向路径） |
| 2 | `HARNESS_REPO_MAP` 从真实 env 读取并解析的端到端流程 | 单元测试注入 env，未验证 process.env 动态变更后模块缓存 | 低 |
| 3 | `_finalizeMergedRun` → `promoteRegressionOnHarnessMerged` 实际 DB 写入 | dynamic import mock 在 vitest 中有 ESM 限制，仅验证函数被调用 | 低 |
| 4 | generator_done 超时兜底与本次新增反查路径的竞态（超时期间恰好反查 MERGED） | 需组合 `doneAt` 和 mock 时钟，当前测试不含时钟控制 | 中（已有 timeout 分支单独 test，竞态 window 极小） |
| 5 | 多 run 行并发（同一 initiative_id 多条 initiative_runs）时 `_finalizeMergedRun` 幂等性 | `phase NOT IN ('done','failed')` 条件在 SQL 层保证，未做并发压测 | 低 |

---

## 不变量（铁律）

1. `GENERATOR_DONE_TIMEOUT_MS = 6h` 语义不变——超时仍标 `failed(generator_done_timeout)`
2. 只修改 `harness-relay-watchdog.js` 中 `_parseBaseRepo` 函数 + `resumeStalledRelayRuns` 的 `generatorDone` 分支
3. 不碰 `_finalizeMergedRun` 内部逻辑、`_raiseUngatedMergeAlert`、`evaluator gate` 判断、spawn 路径
4. `_discoverPrFromGithub` gh 调用失败 → `continue`（保守失明），此行为不变
5. `generator_done=true` 时绝不二次 spawn（防重复 PR）
