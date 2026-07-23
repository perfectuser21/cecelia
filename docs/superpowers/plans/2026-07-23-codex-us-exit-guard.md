# Codex US Exit Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在西安 CMG 传输任何 team1~5 token、启动 Codex 前自动确保 Tailscale 使用允许的美国出口，并在会话结束后恢复原路由。

**Architecture:** 新增一个独立 shell 守卫，提供 `prepare <state-file>` 与 `restore <state-file>` 两个命令；它统一完成 Tailscale 候选选择、公网国家、hosts/DNS 与 ChatGPT HTTPS 门禁。`codex-request.sh` 在本地持有守卫生命周期，`codex-remote-launch.sh` 则先把守卫同步到西安临时目录，再把恢复责任交给远程 tmux launcher。

**Tech Stack:** Bash、Python 3（只解析 Tailscale JSON）、Tailscale CLI、curl、现有 mock shell 测试框架。

---

## 文件结构

- Create: `scripts/codex-us-exit-guard.sh` — 唯一的美国出口选择、验证、状态记录和恢复实现。
- Create: `scripts/__tests__/codex-us-exit-guard.test.sh` — 守卫的 mock Tailscale/curl/DNS 单元测试。
- Modify: `scripts/codex-request.sh` — 拉 token 前 prepare，Codex 退出后 restore。
- Modify: `scripts/__tests__/codex-request.test.sh` — 证明失败门禁不 scp、不启动 Codex，并更新退出恢复断言。
- Modify: `scripts/codex-remote-launch.sh` — token push 前在西安 prepare，tmux launcher 接管 restore。
- Modify: `scripts/__tests__/codex-remote-launch.test.sh` — 证明远端 prepare 顺序、失败关闭和恢复责任交接。
- Modify: `scripts/codex-token-refresh/README.md` is not in this repository and must not be touched; operational notes stay in the design and handoff.

### Task 1: 出口守卫只读门禁

**Files:**
- Create: `scripts/__tests__/codex-us-exit-guard.test.sh`
- Create: `scripts/codex-us-exit-guard.sh`

- [ ] **Step 1: 写已选美国 M4、hosts 污染、CN 公网与 HTTPS 超时的失败测试**

测试 setup 创建临时 `tailscale`、`curl`、`dscacheutil`，并通过以下环境变量驱动真实守卫入口：

```bash
export CODEX_HOSTS_FILE="$TMP/hosts"
export CODEX_EXIT_PRIMARY="100.71.151.105"
export CODEX_EXIT_FALLBACK="100.79.41.61"
export MOCK_EXIT_FILE="$TMP/current-exit"
export MOCK_COUNTRY_FILE="$TMP/country"
export MOCK_HTTP_CODE_FILE="$TMP/http-code"
export PATH="$BIN:$PATH"

bash "$TARGET" prepare "$TMP/state"
```

至少新增四个独立用例：

```bash
test_allowed_m4_passes_without_switching
test_loopback_hosts_fails_before_network_change
test_cn_public_egress_fails_closed
test_chatgpt_transport_timeout_fails_closed
```

每个失败用例断言返回非零，且 mock 调用日志不含 `tailscale set`。

- [ ] **Step 2: 运行守卫测试并确认 Red**

Run: `bash scripts/__tests__/codex-us-exit-guard.test.sh`

Expected: FAIL，因为 `scripts/codex-us-exit-guard.sh` 尚不存在。

- [ ] **Step 3: 实现最小只读门禁与状态文件**

生产脚本固定接口：

```bash
scripts/codex-us-exit-guard.sh prepare /tmp/state-file
scripts/codex-us-exit-guard.sh restore /tmp/state-file
```

核心常量和函数必须按下列签名实现：

```bash
PRIMARY_EXIT="${CODEX_EXIT_PRIMARY:-100.71.151.105}"
FALLBACK_EXIT="${CODEX_EXIT_FALLBACK:-100.79.41.61}"
HOSTS_FILE="${CODEX_HOSTS_FILE:-/etc/hosts}"

current_exit_ip
candidate_is_available
assert_no_loopback_override
assert_public_country_us
assert_chatgpt_transport
write_state
prepare
restore
```

`prepare` 在当前出口已属于 allowlist 时写入 mode 600 状态：

```text
previous_exit=<当前出口>
selected_exit=<当前出口>
changed=0
```

然后依次执行 hosts/DNS、公网 `US`、ChatGPT HTTP 三个门禁；任一失败返回非零。ChatGPT 探测只接受 curl 成功且 `%{http_code}` 不是 `000`，不发送 Authorization header。

- [ ] **Step 4: 运行守卫测试并确认 Green**

Run: `bash scripts/__tests__/codex-us-exit-guard.test.sh`

Expected: 4 passed, 0 failed。

- [ ] **Step 5: 提交只读门禁**

```bash
git add scripts/codex-us-exit-guard.sh scripts/__tests__/codex-us-exit-guard.test.sh
git commit -m "feat(codex): 添加美国出口只读门禁"
```

### Task 2: 自动切换、M4→SF 回退与恢复

**Files:**
- Modify: `scripts/codex-us-exit-guard.sh`
- Modify: `scripts/__tests__/codex-us-exit-guard.test.sh`

- [ ] **Step 1: 写自动切换与恢复失败测试**

新增以下用例：

```bash
test_no_exit_switches_to_m4_and_restore_clears_exit
test_non_us_exit_restores_original_after_session
test_m4_unavailable_falls_back_to_sf
test_both_candidates_unavailable_fails
test_prepare_verification_failure_rolls_back_immediately
test_restore_failure_returns_nonzero
```

mock `tailscale set --exit-node=<IP>` 必须更新 `$MOCK_EXIT_FILE`，并能通过环境变量让指定候选失败。断言 `prepare` 失败时也会恢复原出口，不遗留半切换状态。

- [ ] **Step 2: 运行测试确认 Red**

Run: `bash scripts/__tests__/codex-us-exit-guard.test.sh`

Expected: 新增 6 个用例 FAIL，因为尚无切换和回退逻辑。

- [ ] **Step 3: 实现切换与恢复**

新增以下函数：

```bash
set_exit_node() {
  local ip="$1"
  tailscale set --exit-node="$ip" || sudo -n tailscale set --exit-node="$ip"
}

try_candidate
restore_from_state
```

`prepare` 先保存 previous exit；当前不是允许节点时按 `PRIMARY_EXIT`、`FALLBACK_EXIT` 顺序检查 `Online=true` 与 `ExitNodeOption=true` 后切换。切换成功立即写 `changed=1` 状态，再执行三重门禁；门禁失败必须调用 `restore_from_state` 后才返回。

空 previous exit 用 `tailscale set --exit-node=` 恢复；非空 previous exit 恢复原 IP。只有 `changed=1` 才修改路由。

- [ ] **Step 4: 运行全套守卫测试确认 Green**

Run: `bash scripts/__tests__/codex-us-exit-guard.test.sh`

Expected: 10 passed, 0 failed。

- [ ] **Step 5: 提交切换生命周期**

```bash
git add scripts/codex-us-exit-guard.sh scripts/__tests__/codex-us-exit-guard.test.sh
git commit -m "feat(codex): 自动切换并恢复美国 exit node"
```

### Task 3: 接入西安人工 `codex-request`

**Files:**
- Modify: `scripts/codex-request.sh`
- Modify: `scripts/__tests__/codex-request.test.sh`

- [ ] **Step 1: 写入口顺序和恢复失败测试**

测试 setup 增加 mock `codex-us-exit-guard.sh`，记录 `prepare`/`restore`。新增或更新用例：

```bash
test_guard_prepare_happens_before_scp
test_guard_failure_prevents_scp_and_codex
test_guard_restores_after_codex_success
test_guard_restores_after_codex_nonzero_exit
test_no_token_pushback_remains_true
```

调用顺序必须为 `guard prepare` → `ssh/scp pull` → `codex` → `guard restore`。

- [ ] **Step 2: 运行 request 测试确认 Red**

Run: `bash scripts/__tests__/codex-request.test.sh`

Expected: 新守卫用例 FAIL，因为入口尚未调用 guard。

- [ ] **Step 3: 实现 request 生命周期**

在参数校验完成、`assert_ssh` 之前设置：

```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXIT_GUARD="${CODEX_EXIT_GUARD:-${SCRIPT_DIR}/codex-us-exit-guard.sh}"
EXIT_STATE="${TMPDIR:-/tmp}/codex-us-exit-request-${TEAM}-$$.state"
```

先执行 `prepare`，注册只负责出口恢复的 EXIT trap，再执行现有 pull/freshness 流程。把最后的 `exec env CODEX_HOME=... codex` 改成前台子进程，捕获并返回其退出码。trap 不得包含任何 token 回传。

- [ ] **Step 4: 运行 request 测试确认 Green**

Run: `bash scripts/__tests__/codex-request.test.sh`

Expected: 全部通过，0 failed。

- [ ] **Step 5: 提交 request 接入**

```bash
git add scripts/codex-request.sh scripts/__tests__/codex-request.test.sh
git commit -m "feat(codex-request): 拉 token 前确保美国出口"
```

### Task 4: 接入美国主动 `codex-remote-launch`

**Files:**
- Modify: `scripts/codex-remote-launch.sh`
- Modify: `scripts/__tests__/codex-remote-launch.test.sh`

- [ ] **Step 1: 写远端 prepare、失败关闭与 handoff 测试**

扩展 mock `ssh`/`scp` 日志并新增：

```bash
test_remote_guard_is_uploaded_before_token
test_remote_prepare_failure_prevents_token_push
test_failure_after_prepare_invokes_remote_restore
test_tmux_launcher_restores_after_codex_exit
test_dry_run_does_not_change_remote_route
```

必须根据日志行号断言 guard 上传与 remote `prepare` 均发生在 `auth.json` scp 之前。

- [ ] **Step 2: 运行 remote-launch 测试确认 Red**

Run: `bash scripts/__tests__/codex-remote-launch.test.sh`

Expected: 新增 5 个用例 FAIL，因为尚无远端 guard 生命周期。

- [ ] **Step 3: 实现远端守卫同步和责任交接**

新增全局状态与函数：

```bash
LOCAL_EXIT_GUARD="${CODEX_EXIT_GUARD:-${SCRIPT_DIR}/codex-us-exit-guard.sh}"
REMOTE_GUARD=""
REMOTE_GUARD_STATE=""
REMOTE_GUARD_PREPARED=0
REMOTE_GUARD_HANDED_OFF=0

prepare_remote_us_exit
restore_remote_us_exit
```

主流程顺序调整为：`assert_ssh` → `prepare_remote_us_exit` → `push_token` → `start_remote_session`。prepare 后任何本地失败均调用远端 `restore`；tmux 创建成功后设置 handed-off，远程 launcher 等待 Codex 子进程并在 EXIT trap 中 restore 和删除临时 guard/state。

- [ ] **Step 4: 运行 remote-launch 测试确认 Green**

Run: `bash scripts/__tests__/codex-remote-launch.test.sh`

Expected: 全部通过，0 failed。

- [ ] **Step 5: 提交 remote-launch 接入**

```bash
git add scripts/codex-remote-launch.sh scripts/__tests__/codex-remote-launch.test.sh
git commit -m "feat(codex-remote): 启动前验证西安美国出口"
```

### Task 5: 全量验证、部署与实机验收

**Files:**
- Modify only if verification reveals a defect in the files listed above.

- [ ] **Step 1: 运行语法和全部相关测试**

```bash
bash -n scripts/codex-us-exit-guard.sh
bash -n scripts/codex-request.sh
bash -n scripts/codex-remote-launch.sh
bash scripts/__tests__/codex-us-exit-guard.test.sh
bash scripts/__tests__/codex-request.test.sh
bash scripts/__tests__/codex-remote-launch.test.sh
```

Expected: 所有命令 exit 0，0 failed。

- [ ] **Step 2: 确认安全红线**

```bash
rg -n 'codex login|cat .*auth\.json|print.*access_token|print.*refresh_token' \
  scripts/codex-us-exit-guard.sh scripts/codex-request.sh scripts/codex-remote-launch.sh
git diff --check
git status --short
```

Expected: 没有新增 login/token 输出；diff check 为空；只含计划内文件。

- [ ] **Step 3: 一次性清理 CMG hosts 阻断**

先备份 `/etc/hosts` 到带时间戳文件，再定点删除唯一的 `127.0.0.1 chatgpt.com` 行，刷新 macOS DNS 缓存。删除前后都打印匹配行，不打印任何 token；若匹配不是唯一一行则停止并人工复核。

- [ ] **Step 4: 同步脚本并做无 token 的 guard 实测**

把 guard 与 request 脚本同步到 `~/repos/cecelia/scripts/`，先单独运行 guard `prepare`/`restore`：从无 exit 状态确认选择 `100.71.151.105`、公网 `loc=US`、ChatGPT HTTP code 非 `000`，然后恢复无 exit。

- [ ] **Step 5: 做 team1 真实启动验收**

在 CMG 任意目录运行：

```bash
codex-request --team team1
```

Expected: 先完成美国出口门禁，再拉取 token、检查有效期并启动 Codex；退出后 Tailscale 恢复原设置。全程不显示 token 内容。

- [ ] **Step 6: 最终提交（仅在 Task 5 有修复时）**

```bash
git add scripts/codex-us-exit-guard.sh scripts/codex-request.sh scripts/codex-remote-launch.sh \
  scripts/__tests__/codex-us-exit-guard.test.sh scripts/__tests__/codex-request.test.sh \
  scripts/__tests__/codex-remote-launch.test.sh
git commit -m "fix(codex): 修正美国出口守卫实机验收问题"
```
