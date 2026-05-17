# Stop Hook Ralph 模式测试补全 — Phase A/B/C

分支：`cp-0504200437-ralph-tests`
Brain Task：`b7820794-6444-46ce-8496-706e18e6d4d6`
日期：2026-05-04
前置：PR #2752（Ralph Loop 模式）已合 main

## 背景

PR #2752 落地 Ralph Loop 三层防御，但留下重大测试 gap：
1. 12 场景 E2E（`stop-hook-full-lifecycle.test.ts`）整体 `describe.skip` — Ralph 完成路径 0 覆盖
2. 3 个 stop-hook 测试文件（`stop-hook-exit-codes` / `stop-hook-exit` / `stop-hook`）整体 skip — 174+ case 全靠 follow-up
3. `verify_dev_complete()` 核心函数 0 单元测试（3 守门 × 8+ 分支）
4. 无 smoke test（无端到端真环境验证）

下次有人改 stop hook 没测试兜底就裸跑——技术债。

## 目标（三 Phase）

### Phase A：重写 12 场景 E2E 适配 Ralph 协议
重点覆盖 **完成路径**（最关键的 happy path，目前 0 覆盖）。

### Phase B：`verify_dev_complete()` unit test
每个分支独立测试，10+ case。

### Phase C：smoke test
真起 git repo + 真触发 stop hook，验证状态文件生命周期。

## 不做

- 不改 `stop-dev.sh` / `verify_dev_complete` 业务逻辑（Ralph 模式已稳）
- 不改 `.cecelia/dev-active` 协议
- 不改 `cleanup.sh` / `deploy-local.sh`
- 不动 `worktree-manage.sh`
- 不引入新依赖
- 不重写已 skip 的旧 stop-hook-exit-codes 174+ case（scope 太大，仅做 12 场景 E2E + new unit + smoke）

## 设计

### Phase A：重写 12 场景 E2E

**File**: `packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts`

**移除**：`describe.skip` 改回 `describe`。

**重写场景**（适配 Ralph 协议 — exit 0 + decision JSON）：

| # | 场景 | setup | 期望 |
|---|---|---|---|
| 1 | 无 .cecelia → 普通对话放行 | 不创建 .cecelia | exit 0 + 无 stdout JSON |
| 2 | bypass env → 直接 exit 0 | CECELIA_STOP_HOOK_BYPASS=1 | exit 0 + 无 stdout JSON |
| 3 | .cecelia 存在 + PR 未创建 → block | 写状态文件 + mock gh 返回空 PR | exit 0 + stdout 含 "decision":"block" + reason 含 "PR 未创建" |
| 4 | PR + CI in_progress → block | mock gh status=in_progress | stdout 含 "CI 进行中" |
| 5 | PR + CI completed but not merged → block | mock gh mergedAt=null + status=completed | stdout 含 "auto-merge" 提示 |
| 6 | PR merged + Learning 不存在 → block | mock gh mergedAt 非空 + 不创建 learning 文件 | stdout 含 "Learning 文件不存在" |
| 7 | PR merged + Learning 缺 ### 根本原因 → block | 创建 learning 但内容空 | stdout 含 "缺必备段" |
| 8 | PR merged + Learning OK + 无 cleanup.sh → block | 不放 cleanup.sh | stdout 含 "未找到 cleanup.sh" |
| 9 | PR merged + Learning OK + cleanup fail → block | mock cleanup.sh exit 1 | stdout 含 "cleanup.sh 失败" |
| 10 | **PR merged + Learning OK + cleanup ok → done**（关键 happy path）| mock 三全满足 | exit 0 + decision:"allow" + 状态文件被 rm |
| 11 | harness 模式：PR merged + 无 Learning → done（豁免）| harness_mode=true + 无 learning | exit 0 + decision:"allow" |
| 12 | 状态文件损坏（无 branch 字段）→ block | 写入无效 JSON | stdout 含 "状态文件损坏" |

**Mock 框架**：
- PATH 注入假 gh：`gh-mock` 二进制脚本，根据 env var `MOCK_GH_PR_NUMBER` / `MOCK_GH_MERGED_AT` / `MOCK_GH_CI_STATUS` 决定输出
- mock cleanup.sh：写到临时 PROJECT_ROOT，按 env var `MOCK_CLEANUP_EXIT` 决定 exit 0 / 1
- mock Learning 文件：直接 `writeFileSync(docs/learnings/<branch>.md, content)`

### Phase B：`verify_dev_complete()` unit test

**File**: `packages/engine/tests/unit/verify-dev-complete.test.sh`（新建）

纯 bash 测试，不依赖 vitest。直接 source `lib/devloop-check.sh` 调 `verify_dev_complete`。

**10 case**：

1. branch / main_repo 缺参数 → blocked + reason="缺参数"
2. gh 不可用（PATH 移除 gh）→ blocked + reason="gh CLI 不可用"
3. PR 未创建（mock gh 返回空）→ blocked + reason 含 "PR 未创建"
4. PR + CI in_progress → blocked + reason 含 "CI 进行中"
5. PR + CI completed but not merged → blocked + reason 含 "auto-merge"
6. PR merged + Learning 不存在 → blocked + reason 含 "Learning 文件不存在"
7. PR merged + Learning 缺 ### 根本原因 → blocked + reason 含 "缺必备段"
8. PR merged + Learning OK + 无 cleanup.sh → blocked + reason 含 "未找到 cleanup.sh"
9. PR merged + Learning + cleanup fail → blocked + reason 含 "cleanup.sh 执行失败"
10. **PR merged + Learning + cleanup ok → done**（关键 happy path）
11. harness 模式 + PR merged + 无 Learning → done（豁免）

### Phase C：smoke test

**File**: `packages/engine/scripts/smoke/ralph-loop-smoke.sh`（新建）

真环境端到端验证，不 mock 任何东西（只 mock gh，因为无法真合 PR）。

**流程**：
1. 创建临时 git repo + 主分支 + cp-* 工作分支
2. 跑 `worktree-manage.sh init-or-check` 创建 worktree + 状态文件
3. 验证 `.cecelia/dev-active-<branch>.json` 存在
4. 直接调 stop-dev.sh（cwd 在 worktree）→ 期望 block（PR 未创建）
5. 验证状态文件**仍存在**（block 不删文件）
6. 直接调 stop-dev.sh（cwd 漂到主仓库）→ 期望 block（关键 cwd 漂移修复）
7. mock gh + cleanup.sh + Learning → 跑 stop-dev.sh → 期望 done + 状态文件被 rm
8. 验证状态文件**已删除**

## 测试策略（自我引用）

按 Cecelia 测试金字塔：

- **E2E（rigid，跨进程 + 持久化）**：12 场景 stop-hook-full-lifecycle 重写（Phase A）
- **integration（跨多模块）**：既有 ralph-loop-mode 5 case 不退化（保留）
- **unit（单函数）**：verify-dev-complete 10 case（Phase B）
- **smoke（真环境）**：ralph-loop-smoke 端到端（Phase C）

四层金字塔全覆盖。

## 验收清单

- [BEHAVIOR] `packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts` 移除 describe.skip，重写 12 场景全过
- [BEHAVIOR] `packages/engine/tests/unit/verify-dev-complete.test.sh` 新增，10+ case 100% 通过
- [BEHAVIOR] `packages/engine/scripts/smoke/ralph-loop-smoke.sh` 新增，端到端通过
- [BEHAVIOR] 既有 `ralph-loop-mode.test.sh` 5 case 不退化
- [BEHAVIOR] check-single-exit Ralph 守护通过（出口拓扑未变）
- [BEHAVIOR] 既有 130 PASS 测试不退化
- [ARTIFACT] Engine 版本 patch bump 18.19.0 → 18.19.1
- [ARTIFACT] feature-registry.yml 加 18.19.1 changelog

## 实施顺序

1. Phase A：重写 12 场景 E2E（unskip + 适配 Ralph 协议）
2. Phase B：verify_dev_complete unit test 10 case
3. Phase C：ralph-loop-smoke.sh 端到端
4. 全测试套回归
5. Engine 版本 bump + changelog + Learning
