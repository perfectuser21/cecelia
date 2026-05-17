# CI/CD Gate 覆盖范围评估报告

生成日期: 2026-04-09
评估范围: Cecelia Monorepo Engine Pipeline

---

## 覆盖项

### L1 — 代码静态检查 Gate

| 检测点 | 覆盖方式 |
|-------|---------|
| TypeScript 类型检查 | `npx tsc --noEmit`（engine-tests job）|
| 版本四处同步 | `check-version-sync.sh`（engine-tests job）|
| Contract 引用完整性 | `check-contract-refs.sh`（engine-tests job）|
| DoD 格式（[BEHAVIOR] 必须存在）| engine-tests job DoD 格式检查步骤 |
| DoD 未勾选条目（- [ ] 阻断）| engine-tests job DoD 格式检查步骤 |
| manual: 命令白名单 | 本地 hook（branch-protect.sh）调用 `check-manual-cmd-whitelist.cjs` |
| PR 大小 | `pr-size-check` job |
| 分支命名规范 | `branch-naming` job |
| 敏感信息扫描 | `secrets-scan` job |

### L2 — 单元测试 Gate

| 检测点 | 覆盖方式 |
|-------|---------|
| Engine 单元测试（skills/hooks 逻辑）| `npx vitest run`（engine-tests job）|
| Brain 单元测试 | brain-unit job |
| Brain 集成测试（DB/API）| brain-integration job |

### L3 — 构建与功能测试 Gate

| 检测点 | 覆盖方式 |
|-------|---------|
| Workspace 前端构建 | workspace-build job |
| Workspace 功能测试 | workspace-test job |
| feat 类型 PR 必须含测试文件 | engine-tests CI 规则 |

### L4 — 烟雾测试 Gate

| 检测点 | 覆盖方式 |
|-------|---------|
| 端到端 API 冒烟测试 | e2e-smoke job |
| E2E 完整性检测（hooks/worktree/DoD/Learning）| e2e-integrity-check（engine-tests job 新增）|

---

## 盲区

### 盲区 1：Learning Format Gate 未进入 CI

**现状**：check-learning-format.sh 仅在本地 hook 层可能被触发，CI 中没有对应步骤。
**建议**：在 engine-tests job 中添加 Learning 格式校验步骤，检测 PR diff 中 Learning 文件是否包含 `### 根本原因` 章节（且为新增行，而非 diff context）。
**理由**：同名文件 diff context 陷阱（`### 根本原因` 出现在 diff context 行而非 `+` 行）只有 CI 的 git diff 视角才能可靠检测，本地 hook 无法覆盖。

### 盲区 2：manual: 命令白名单校验未进入 CI

**现状**：`check-manual-cmd-whitelist.cjs` 是 DevGate 脚本，仅在开发者手动运行时生效，CI 不会自动验证 DoD BEHAVIOR 命令白名单。
**建议**：在 engine-tests job 的 DoD BEHAVIOR 命令执行步骤前，先运行 check-manual-cmd-whitelist.cjs 对 task-card 文件做预检，将白名单违规转为 CI 错误。
**理由**：开发者可能遗忘手动运行 DevGate，导致含 `grep`/`ls` 等非白名单命令的 task-card 进入 CI 并报错，难以定位原因。

### 盲区 3：worktree 僵尸检测无 CI 覆盖

**现状**：branch-protect.sh 在本地 hook 层检测僵尸 worktree（分支已合并到 main），但 CI 中无对应检测。
**建议**：可选项，在 PR 合并后触发清理脚本（或 Actions post-merge hook），自动列出可回收的 worktree。
**理由**：长期积累的僵尸 worktree 会导致 git worktree list 输出噪音，影响 stop-dev.sh 的 _collect_search_dirs 扫描性能。

---

## 结论

当前 CI pipeline（L1-L4）已覆盖绝大部分质量门禁。本次新增的 E2E Integrity Check 填补了 Engine pipeline 组件完整性的盲区。Learning Format Gate（盲区1）和 manual: 白名单（盲区2）建议在后续 sprint 中补充为 CI gate，以达到完全机械化验证。
