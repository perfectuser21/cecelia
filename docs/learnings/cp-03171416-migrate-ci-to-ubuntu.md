# Learning: migrate CI hk-vps to ubuntu-latest

**Branch**: cp-03171416-migrate-ci-to-ubuntu
**Date**: 2026-03-17

## 问题背景

HK VPS（8GB RAM）运行 8 个并发 GitHub Actions self-hosted runner。每个 vitest 进程使用 22GB+ 虚拟内存，
8 个 runner 同时运行 L3 测试时触发 OOM killer，导致 Tailscale 和 SSH daemon 被杀，机器失联约 1 小时。

### 根本原因

- `runs-on: [self-hosted, Linux, hk-vps]` 使所有 L1/L2/L3/L4 jobs 竞争同一批 runner
- 8 runner × 22GB 虚拟内存/进程 >> 8GB 物理 RAM + 4GB Swap
- OOM 导致系统关键进程被杀 → 机器假死
- 即使缩减到 3 个 runner，HK VPS 仍会因 CI 队列积压 + OOM 再次崩溃

### 下次预防

- [x] CI jobs 全部迁移到 `ubuntu-latest`（GitHub 托管，独立 VM，无 OOM 风险）
- [x] HK VPS 所有 8 个 runner 全部禁用，不再作为 CI runner 使用
- [x] self-hosted runner 只用于需要特定环境的场景（PostgreSQL + Homebrew → xian-mac-m1）
- [ ] 若需恢复 HK VPS runner，先扩容内存或限制并发数（max: 1）

## 变更内容

- `ci-l1-process.yml`：2 处 `hk-vps` → `ubuntu-latest`（DoD Verification Gate + Engine L1 Process）
- `ci-l2-consistency.yml`：5 处 `hk-vps` → `ubuntu-latest`
- `ci-l3-code.yml`：6 处 `hk-vps` → `ubuntu-latest`
- `ci-l4-runtime.yml`：2 处 `hk-vps` → `ubuntu-latest`（detect-changes + gate-passed）
- L4 `brain-integration` 保留 `xian-mac-m1`（需要 PostgreSQL + Homebrew）

## 附带修复的 CI Bug

### Bug 1：test-coverage-required pull_request 路径缺少 commit type 检查

**问题**：`[CONFIG]` 豁免失败（git diff 返回 0 CI 文件）后，pull_request 事件路径直接报
"feat PR 必须包含测试文件"，未检查 PR 是否真为 `feat` 类型。`fix(ci):` 类型 PR 被误判。

**根本原因**：push/workflow_dispatch 路径有 commit type 检查，pull_request 路径没有。

**修复**：从 `detect-commit-type` job 传入 `DETECTED_COMMIT_TYPE`，pull_request 路径
non-feat 类型直接跳过测试文件检查。

### Bug 2：DoD Test 格式不合规

**问题**：DoD 条目的 `Test:` 字段使用了 `echo OK` 假测试，被 `check-dod-mapping.cjs` 拒绝。

**规则**：`Test: manual:` 命令必须包含真实执行命令（`node`, `npm`, `bash`, `curl` 等）；
禁止 `echo`、`grep | wc -l`、`test -f` 假测试。

**修复**：改用 `node -e "..."` 直接读取文件内容验证。

### Bug 3：[CONFIG] 豁免的 git diff 问题

**问题**：`git diff --name-only "origin/${BASE_REF}...HEAD" | grep -cE '^\.github/workflows/...'`
在 PR 触发的 ubuntu-latest runner 上返回 0，即使分支确实有 CI 文件变更。

**临时绕过**：依赖 Bug 1 修复（commit type 检查）来跳过检查，而不是依赖 [CONFIG] 豁免。

**待跟进**：调查 `origin/${BASE_REF}` 在 ubuntu-latest runner 上的可用性。
