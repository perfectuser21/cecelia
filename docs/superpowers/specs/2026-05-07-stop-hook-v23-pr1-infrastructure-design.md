# Stop Hook v23 — PR-1 基础设施 Spec

> 日期：2026-05-07
> Brain task：`7cdae14e-c28a-43d3-926c-01965922d852`
> 上层设计：`docs/design/stop-hook-v23-redesign.md`
> 范围：v23 重构 3-PR 序列的 **第 1 个**

---

## 1. 目标

为 stop hook 心跳模型搭建物理基础。**本 PR 不切换 hook 行为，零回归风险**。

为后续 PR-2（hook 切换）和 PR-3（v22 清理）准备好可独立验证的部件：

1. 守护进程脚本（"小傻子"维持灯亮）
2. 中止脚本（用户手动撤销 /dev）
3. 结构化决策日志（hook 后续调试用）
4. launcher 契约测试（确保 session_id 注入正确）

---

## 2. 核心架构（PR-1 范围）

### 2.1 守护进程：`packages/engine/lib/dev-heartbeat-guardian.sh`

**单一职责**：守一盏灯（一个心跳文件），每 60 秒 touch 一次维持新鲜，崩溃 / 被杀时清理灯文件。

**接口契约**：

```
用法：dev-heartbeat-guardian.sh <light_file_path>

行为：
  - 每 60 秒：touch <light_file_path>，刷新 mtime
  - 收到 SIGTERM/SIGINT/SIGHUP：rm <light_file_path> 后 exit 0（cleanup trap）
  - 父进程死亡（PPID 改变 → 1）：rm <light_file_path> 后 exit 0（防孤儿）
  - touch 失败（文件不可写）：rm 尝试 + exit 1
  - light_file_path 为空：exit 1（参数错误）

状态机：
  start
    ↓
  touch light → sleep 60 → 检查 ppid → loop
  
  收到 trap 信号 → rm light → exit 0
```

**实现要求**：
- 纯 bash，不依赖 jq / python / 其他工具
- macOS（BSD ps）+ Linux（GNU ps）双平台兼容
- ~25 行代码，封死复杂度

### 2.2 中止脚本：`packages/engine/scripts/abort-dev.sh`

**单一职责**：用户手动撤销一条 /dev 流程。

**接口契约**：

```
用法：abort-dev.sh <branch>

行为：
  1. 找 .cecelia/lights/*-<branch>.live（可能匹配多盏灯，取第一个）
  2. 从灯文件读 guardian_pid 字段
  3. kill -SIGTERM <guardian_pid>（guardian 自己 rm 灯文件）
  4. 写 .cecelia/aborted/<sid_short>-<branch>.aborted（审计标记）
  5. 输出操作摘要（stderr）

退出码：
  0  - 成功中止
  1  - 找不到匹配的灯
  2  - guardian_pid 缺失或非数字
  3  - kill 失败（进程不存在或权限不够）
```

**实现要求**：
- 不删 worktree（用户可能要保留）
- 不改 git 状态
- 幂等（重复跑不报错）

### 2.3 结构化决策日志：`~/.claude/hook-logs/stop-dev.jsonl`

**单一职责**：每次 stop hook 决策追加一行 JSON，方便后续 PR-2 调试。

**Schema**：

```json
{
  "ts": "2026-05-07T13:55:00+08:00",
  "session_id_short": "abc12345",
  "decision": "block|release",
  "reason_code": "lights_alive|all_dark|no_session_id|bypass|...",
  "lights_count": 3,
  "branch": "cp-0507135525-stop-hook-v23-pr1",
  "hook_version": "22"
}
```

**接入方式**：
- 在 `packages/engine/lib/devloop-check.sh` 加一个 `log_hook_decision` 函数（共享库）
- 当前 v22 stop-dev.sh **加一行调用**记录每次决策（不改主逻辑）
- PR-2 新 hook 复用同一个函数

### 2.4 Launcher 契约测试

**测试目标**：保证 `claude-launch.sh` / `cecelia-run.sh` 启动 claude 时正确注入 `--session-id`。

**测试方法**：
- dry-run 启动器，捕获最终 claude 命令行
- grep `--session-id <uuid-format>`
- 匹配失败 → 测试 fail

**实现位置**：`packages/engine/__tests__/launcher-contract.test.ts`

---

## 3. 测试策略（必含段，按 /dev v18.6.0 规范）

按 Cecelia 测试金字塔分级：

### 3.1 E2E 测试（跨进程 / 持久化 / I/O）

| 测试 | 验证内容 | 落点 |
|---|---|---|
| guardian-lifecycle | 启动 guardian → 文件被 touch → kill -TERM → 文件被 rm | `tests/engine/heartbeat-guardian.test.ts` |
| guardian-orphan | guardian 父进程死 → 60 秒内自动 rm 灯并退出 | 同上 |
| abort-dev-happy-path | 启动 guardian → 调 abort-dev.sh → 灯被清 + aborted-marker 写入 | `tests/engine/abort-dev.test.ts` |
| log-decision-append | 调 log_hook_decision → ~/.claude/hook-logs/stop-dev.jsonl 追加合法 JSON 行 | `tests/engine/hook-decision-log.test.ts` |

### 3.2 Integration 测试（跨多模块）

| 测试 | 验证内容 | 落点 |
|---|---|---|
| launcher-injects-session-id | dry-run claude-launch.sh → cmdline 含 `--session-id <uuid>` | `tests/engine/launcher-contract.test.ts` |
| cecelia-run-injects-session-id | dry-run cecelia-run.sh → 同上 | 同上 |

### 3.3 Unit 测试（单函数行为）

| 测试 | 验证内容 | 落点 |
|---|---|---|
| log_hook_decision-schema | 输入合法字段 → 输出合法 JSON 一行 | `tests/engine/hook-decision-log.test.ts` |
| log_hook_decision-malformed | 字段缺失 → 仍输出 JSON（默认值兜底） | 同上 |

### 3.4 Trivial wrapper（不写测试）

无 — 本 PR 所有产物都涉及 I/O 或跨进程。

### 3.5 测试环境约束

- guardian 测试用 `bash -c` 派子进程 + `kill -TERM` 验证 trap
- 文件 I/O 测试用 `mktemp` 临时目录，不污染 `~/.claude/`
- launcher 契约用 `--dry-run` 标志（如 launcher 不支持，加 dry-run 选项是本 PR 子任务）

---

## 4. DoD（成功标准）

按 CLAUDE.md DoD 三要素：

```
- [ARTIFACT] packages/engine/lib/dev-heartbeat-guardian.sh 存在且 chmod +x
  Test: manual:node -e "const fs=require('fs');const s=fs.statSync('packages/engine/lib/dev-heartbeat-guardian.sh');if(!(s.mode & 0o111))process.exit(1)"

- [ARTIFACT] packages/engine/scripts/abort-dev.sh 存在且 chmod +x
  Test: manual:node -e "const fs=require('fs');const s=fs.statSync('packages/engine/scripts/abort-dev.sh');if(!(s.mode & 0o111))process.exit(1)"

- [BEHAVIOR] guardian 启动后每 60 秒 touch 灯文件
  Test: tests/engine/heartbeat-guardian.test.ts

- [BEHAVIOR] guardian 收到 SIGTERM 后 rm 灯文件并退出 0
  Test: tests/engine/heartbeat-guardian.test.ts

- [BEHAVIOR] guardian 父进程死后 60 秒内自杀
  Test: tests/engine/heartbeat-guardian.test.ts

- [BEHAVIOR] abort-dev.sh 中止指定 branch 的 guardian + 写 aborted-marker
  Test: tests/engine/abort-dev.test.ts

- [BEHAVIOR] log_hook_decision 追加合法 JSON 行到 ~/.claude/hook-logs/stop-dev.jsonl
  Test: tests/engine/hook-decision-log.test.ts

- [BEHAVIOR] claude-launch.sh dry-run 输出含 --session-id <uuid>
  Test: tests/engine/launcher-contract.test.ts
```

---

## 5. 不做的事（明确范围）

| 不做 | 理由 |
|---|---|
| 改 stop-dev.sh 主逻辑 | PR-2 范围 |
| engine-worktree.skill 启动 guardian | PR-2 范围 |
| engine-ship.skill 关 guardian + 写 done-marker | PR-2 范围 |
| 创建 `.cecelia/lights/` 目录或灯文件 | guardian 还没被任何流程调用 |
| 删 `dev-active-*.json` 状态文件机制 | PR-3 范围 |
| 删 `verify_dev_complete` P1-P7 状态机 | PR-2 / PR-3 重构 |
| Brain 重启频率调查 | 不在 stop hook 重构序列内，独立项目 |

---

## 6. 风险与缓解

| 风险 | 概率 | 缓解 |
|---|---|---|
| guardian ppid 自检在 macOS 和 Linux 行为不一致 | 中 | uname 分支处理 BSD ps vs GNU ps |
| `~/.claude/hook-logs/` 目录不存在导致写日志失败 | 低 | log_hook_decision 函数自动 mkdir -p |
| launcher dry-run 标志未实现 | 中 | 本 PR 子任务：先加 --dry-run 选项再写测试 |
| 现有 v22 stop-dev.sh 集成 log_hook_decision 后行为变化 | 低 | 仅新增日志写入，不改决策路径 |

---

## 7. Engine 三要素同步

按 CLAUDE.md "Engine skills 改动三要素"：

1. **PR title 含 `[CONFIG]`** — 本 PR 改 `packages/engine/`，必须加
2. **Engine 版本 bump 5 个文件** — package.json / package-lock.json / VERSION / .hook-core-version / regression-contract.yaml
3. **feature-registry.yml 加 changelog** — 给 `dev-heartbeat-guardian` 注册新条目，运行 `bash packages/engine/scripts/generate-path-views.sh`

---

## 8. Commit 顺序（TDD 强制）

按 /dev v18.6.0 TDD 红线，必须两段式 commit：

```
commit 1: test(engine): stop-hook-v23 PR-1 基础设施 — fail tests
  - tests/engine/heartbeat-guardian.test.ts（fail）
  - tests/engine/abort-dev.test.ts（fail）
  - tests/engine/hook-decision-log.test.ts（fail）
  - tests/engine/launcher-contract.test.ts（fail）

commit 2: feat(engine): stop-hook-v23 PR-1 基础设施 — 实现 + 测试通过
  - packages/engine/lib/dev-heartbeat-guardian.sh
  - packages/engine/scripts/abort-dev.sh
  - packages/engine/lib/devloop-check.sh（新增 log_hook_decision 函数）
  - packages/engine/hooks/stop-dev.sh（仅新增 log_hook_decision 调用，主逻辑不动）
  - claude-launch.sh + cecelia-run.sh（加 --dry-run 选项）
  - Engine 5 文件 version bump
  - feature-registry.yml changelog
```

CI 强校验：commit 顺序错 → `lint-tdd-commit-order` job fail。

---

## 9. 验收（merge 前必须满足）

1. ✅ 8 个 DoD 全部 `[x]`
2. ✅ CI 全绿（含 `lint-test-pairing` / `lint-feature-has-smoke` / `lint-tdd-commit-order`）
3. ✅ 本机跑一次完整测试套件 `npm test --workspaces` 全过
4. ✅ Learning 文件 `docs/learnings/cp-0507135525-stop-hook-v23-pr1.md` 写就（含根本原因 + 下次预防）
5. ✅ 主理人手测一次：本机起 guardian + abort 一次，观察灯被清

---

## 10. 后续 PR 衔接说明

PR-2 启动条件：本 PR 合并后观察 24h 无回归。

PR-2 范围预告：
- engine-worktree.skill 启动 guardian
- engine-ship.skill 关 guardian + 写 done-marker
- 重写 stop-dev.sh 为 ~50 行（依赖本 PR 的日志函数）
- 12 个 contract 测试 + 5 个集成测试

PR-3 范围预告：
- 删 `dev-active-*.json` 整套
- 删 `verify_dev_complete` 内 hook 专用代码
- 现网状态文件迁移脚本
