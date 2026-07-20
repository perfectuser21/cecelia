# Codex 跨机 Pull-Request 模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让西安 M4 侧的同事用一条命令（`codex-request.sh --team teamN`）在本地发起请求，从美国 M4 拉取最新 token、跑 codex、退出后自动把（可能已刷新的）token 推回美国；同时把现有 `codex-remote-launch.sh`（美国主动推，供 headless 自动化用）的账号白名单从 team3/4/5 扩展到 team1~5。

**Architecture:** 两个独立、自包含的 bash 脚本，不共享 library（跟随本仓库 `scripts/*.sh` 现有惯例——每个脚本自成一体，测试用 mock 覆盖 PATH 里的 `ssh`/`scp`/`codex` 等外部命令，仿照 `scripts/__tests__/preview-reaper.test.sh` 的手写 pass/fail 框架）。

**Tech Stack:** bash（`set -euo pipefail`），ssh/scp（Tailscale 网络），手写 shell 测试框架（无外部测试库）。

---

### Task 1: 扩展 codex-remote-launch.sh 白名单为 team1~5

**Files:**
- Modify: `scripts/codex-remote-launch.sh:60`（`ALLOWED_TEAMS=(team3 team4 team5)`）
- Test: `scripts/__tests__/codex-remote-launch.test.sh`（新建，此前不存在）

- [ ] **Step 1: 写失败的测试**

创建 `scripts/__tests__/codex-remote-launch.test.sh`：

```bash
#!/usr/bin/env bash
# codex-remote-launch.test.sh — 白名单 + 核心流程单元自测（mock ssh/scp）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${SCRIPT_DIR}/../codex-remote-launch.sh"
PASS=0; FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

setup() {
  TMP=$(mktemp -d)
  HOME="$TMP/home"
  mkdir -p "$HOME"
  BIN="$TMP/bin"
  mkdir -p "$BIN"
  LOG="$TMP/calls.log"

  # mock ssh：记录调用，探活恒成功，tmux ls 输出固定字符串
  cat >"$BIN/ssh" <<SH
#!/bin/bash
echo "ssh \$*" >> "$LOG"
if [[ "\$*" == *"echo ok"* ]]; then echo ok; exit 0; fi
if [[ "\$*" == *"mkdir -p"* ]]; then exit 0; fi
if [[ "\$*" == *"chmod 600"* ]]; then exit 0; fi
if [[ "\$*" == *"tmux new-session"* ]]; then exit 0; fi
if [[ "\$*" == *"tmux ls"* ]]; then echo "mock-session: 1 windows"; exit 0; fi
if [[ "\$*" == *"cat >"* ]]; then exit 0; fi
exit 0
SH
  chmod +x "$BIN/ssh"

  # mock scp：记录调用 + 落盘一个假 auth.json（不含真实 token）
  cat >"$BIN/scp" <<SH
#!/bin/bash
echo "scp \$*" >> "$LOG"
dest="\${@: -1}"
if [[ "\$dest" != *":"* ]]; then
  echo '{"mock":"auth"}' > "\$dest"
fi
exit 0
SH
  chmod +x "$BIN/scp"

  export PATH="$BIN:$PATH"
  export HOME
  mkdir -p "$HOME/.codex-team1" "$HOME/.codex-team2" "$HOME/.codex-team3"
  echo '{"mock":"team1"}' > "$HOME/.codex-team1/auth.json"
  echo '{"mock":"team2"}' > "$HOME/.codex-team2/auth.json"
  echo '{"mock":"team3"}' > "$HOME/.codex-team3/auth.json"
}

teardown() { rm -rf "$TMP"; }

test_team1_now_allowed() {
  setup
  if bash "$TARGET" --team team1 --dry-run >/tmp/out.$$  2>&1; then
    pass "team1 现在被 --dry-run 接受（此前应被拒绝）"
  else
    fail "team1 现在被 --dry-run 接受（此前应被拒绝）" "$(cat /tmp/out.$$)"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_team2_now_allowed() {
  setup
  if bash "$TARGET" --team team2 --dry-run >/tmp/out.$$ 2>&1; then
    pass "team2 现在被 --dry-run 接受（此前应被拒绝）"
  else
    fail "team2 现在被 --dry-run 接受（此前应被拒绝）" "$(cat /tmp/out.$$)"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_team6_still_rejected() {
  setup
  if bash "$TARGET" --team team6 --dry-run >/tmp/out.$$ 2>&1; then
    fail "team6（非法账号）应被拒绝" "脚本却成功退出"
  else
    pass "team6（非法账号）仍被拒绝"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_team3_unaffected() {
  setup
  if bash "$TARGET" --team team3 --dry-run >/tmp/out.$$ 2>&1; then
    pass "team3（原有白名单成员）行为不受影响"
  else
    fail "team3（原有白名单成员）行为不受影响" "$(cat /tmp/out.$$)"
  fi
  rm -f /tmp/out.$$
  teardown
}

echo "=== codex-remote-launch.sh 白名单扩容测试 ==="
test_team1_now_allowed
test_team2_now_allowed
test_team6_still_rejected
test_team3_unaffected

echo ""
echo "结果: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]]
```

```bash
chmod +x scripts/__tests__/codex-remote-launch.test.sh
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bash scripts/__tests__/codex-remote-launch.test.sh`
Expected: `test_team1_now_allowed` 和 `test_team2_now_allowed` 两个 FAIL（因为当前 `ALLOWED_TEAMS=(team3 team4 team5)` 还没扩容），其余 PASS。

- [ ] **Step 3: 最小实现——扩展白名单**

修改 `scripts/codex-remote-launch.sh` 第 60 行：

```bash
ALLOWED_TEAMS=(team1 team2 team3 team4 team5)
```

- [ ] **Step 4: 跑测试确认全部通过**

Run: `bash scripts/__tests__/codex-remote-launch.test.sh`
Expected: `结果: 4 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add scripts/codex-remote-launch.sh scripts/__tests__/codex-remote-launch.test.sh
git commit -m "test(scripts): codex-remote-launch白名单扩容team1/2覆盖(commit-1 红)"
```

> 注：Step1(红)/Step3(绿) 严格来说该拆两次 commit（TDD 铁律），但白名单这行改动极小、且此前完全没有测试文件——此 Task 用一次 commit 落地"新增测试+改动"整体，下面 Task 3 的新脚本会严格走两段式 commit。

---

### Task 2: 新建 codex-request.sh（西安侧 pull 模式脚本）

**Files:**
- Create: `scripts/codex-request.sh`
- Test: `scripts/__tests__/codex-request.test.sh`

- [ ] **Step 1: 写失败的测试**

创建 `scripts/__tests__/codex-request.test.sh`：

```bash
#!/usr/bin/env bash
# codex-request.test.sh — 西安侧 pull 请求脚本单元自测（mock ssh/scp/codex）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${SCRIPT_DIR}/../codex-request.sh"
PASS=0; FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

setup() {
  TMP=$(mktemp -d)
  HOME="$TMP/home"
  mkdir -p "$HOME"
  BIN="$TMP/bin"
  mkdir -p "$BIN"
  LOG="$TMP/calls.log"
  touch "$LOG"

  cat >"$BIN/ssh" <<SH
#!/bin/bash
echo "ssh \$*" >> "$LOG"
if [[ "\$*" == *"echo ok"* ]]; then echo ok; exit 0; fi
exit 0
SH
  chmod +x "$BIN/ssh"

  # mock scp：记录调用；拉取方向（远程:xxx -> 本地路径）落一份假token；
  # 推回方向（本地路径 -> 远程:xxx）只记录，不需要真落盘到"远程"
  cat >"$BIN/scp" <<SH
#!/bin/bash
echo "scp \$*" >> "$LOG"
dest="\${@: -1}"
if [[ "\$dest" != *":"* ]]; then
  echo '{"mock":"pulled-token"}' > "\$dest"
fi
exit 0
SH
  chmod +x "$BIN/scp"

  # mock codex 二进制：读环境变量 CODEX_MOCK_EXIT_CODE 决定退出码，
  # 用来验证 trap 在正常退出(0)和异常退出(非0)两种情况下都触发
  cat >"$BIN/codex" <<SH
#!/bin/bash
echo "codex ran with CODEX_HOME=\$CODEX_HOME" >> "$LOG"
exit "\${CODEX_MOCK_EXIT_CODE:-0}"
SH
  chmod +x "$BIN/codex"

  export PATH="$BIN:$PATH"
  export HOME
  export CODEX_REMOTE_LAUNCH_TEST=1
}

teardown() { rm -rf "$TMP"; }

test_invalid_team_rejected() {
  setup
  if bash "$TARGET" --team team6 >/tmp/out.$$ 2>&1; then
    fail "非法 team（team6）应被拒绝" "脚本却成功退出"
  else
    pass "非法 team（team6）被拒绝"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_missing_team_rejected() {
  setup
  if bash "$TARGET" >/tmp/out.$$ 2>&1; then
    fail "缺少 --team 参数应报错" "脚本却成功退出"
  else
    pass "缺少 --team 参数报错"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_pull_then_run_then_pushback_on_success() {
  setup
  set +e
  CODEX_MOCK_EXIT_CODE=0 bash "$TARGET" --team team3 >/tmp/out.$$ 2>&1
  local rc=$?
  set -e
  if [[ "$rc" -ne 0 ]]; then
    fail "codex 正常退出(0)时脚本应以 0 退出" "实际 rc=$rc, 输出: $(cat /tmp/out.$$)"
  elif ! grep -q "codex ran with CODEX_HOME=$HOME/.codex-team3" "$LOG"; then
    fail "应以正确 CODEX_HOME 前台运行 codex" "$(cat "$LOG")"
  elif [[ "$(grep -c '^scp ' "$LOG")" -lt 2 ]]; then
    fail "应发生至少 2 次 scp（拉取 + 推回）" "$(cat "$LOG")"
  else
    pass "正常退出：拉取→前台跑codex→推回 全流程正确"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_pushback_happens_even_on_nonzero_exit() {
  setup
  set +e
  CODEX_MOCK_EXIT_CODE=7 bash "$TARGET" --team team3 >/tmp/out.$$ 2>&1
  local rc=$?
  set -e
  if [[ "$rc" -ne 7 ]]; then
    fail "脚本应透传 codex 的非零退出码(7)" "实际 rc=$rc"
  elif [[ "$(grep -c '^scp ' "$LOG")" -lt 2 ]]; then
    fail "codex 异常退出(7)时仍应触发 trap 推回token" "$(cat "$LOG")"
  else
    pass "codex 非零退出(7)时 trap 依然触发推回，且退出码透传"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_no_exec_used() {
  if grep -qE '^\s*exec\s' "$TARGET"; then
    fail "不能用 exec 跑 codex（会导致脚本进程消失、trap 不触发）" "$(grep -nE '^\s*exec\s' "$TARGET")"
  else
    pass "未使用 exec（trap 回传逻辑得以保留）"
  fi
}

test_no_token_content_printed() {
  if grep -nE 'cat[[:space:]]+.*auth\.json|echo.*auth_token|print.*refresh_token|print.*access_token' "$TARGET"; then
    fail "脚本疑似打印 token 内容" "命中上面 grep 结果"
  else
    pass "grep 确认脚本无打印 token 内容语句"
  fi
}

test_no_login_command() {
  if grep -qE 'codex[[:space:]]+login' "$TARGET"; then
    fail "西安侧脚本绝不能调用 codex login" "命中"
  else
    pass "脚本未调用 codex login（红线遵守）"
  fi
}

test_chmod_600_both_directions() {
  setup
  set +e
  CODEX_MOCK_EXIT_CODE=0 bash "$TARGET" --team team3 >/tmp/out.$$ 2>&1
  set -e
  if [[ -f "$HOME/.codex-team3/auth.json" ]]; then
    local mode
    mode=$(stat -f "%Lp" "$HOME/.codex-team3/auth.json" 2>/dev/null || stat -c "%a" "$HOME/.codex-team3/auth.json")
    if [[ "$mode" == "600" ]]; then
      pass "本地 auth.json 落盘后 mode 为 600"
    else
      fail "本地 auth.json 落盘后 mode 为 600" "实际 mode=$mode"
    fi
  else
    fail "本地 auth.json 落盘后 mode 为 600" "文件不存在"
  fi
  rm -f /tmp/out.$$
  teardown
}

echo "=== codex-request.sh 单元测试 ==="
test_invalid_team_rejected
test_missing_team_rejected
test_pull_then_run_then_pushback_on_success
test_pushback_happens_even_on_nonzero_exit
test_no_exec_used
test_no_token_content_printed
test_no_login_command
test_chmod_600_both_directions

echo ""
echo "结果: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]]
```

```bash
chmod +x scripts/__tests__/codex-request.test.sh
```

- [ ] **Step 2: 跑测试确认失败（`codex-request.sh` 还不存在）**

Run: `bash scripts/__tests__/codex-request.test.sh`
Expected: 报 `scripts/codex-request.sh: No such file or directory` 或全部 FAIL（脚本不存在导致每个 test 调用都失败）。

- [ ] **Step 3: Commit 失败测试（TDD commit-1 / 红）**

```bash
git add scripts/__tests__/codex-request.test.sh
git commit -m "test(scripts): codex-request.sh 西安侧pull模式——失败测试先行(红)"
```

- [ ] **Step 4: 实现 `scripts/codex-request.sh`**

```bash
#!/usr/bin/env bash
# codex-request.sh — 西安 M4 侧发起的 codex token pull-request
#
# 设计目标：
#   西安 M4（本脚本运行处）= 同事交互式使用发起点
#   美国 M4 = token 的家（唯一持久存储）
#   模型：用前拉最新（scp pull）→ 前台跑 codex → 用后立即还（trap EXIT scp push）
#
# 用法：
#   bash scripts/codex-request.sh --team <team1|team2|team3|team4|team5>
#
# 环境变量：
#   CODEX_US_HOST   默认 mac-mini-m4-us 的 Tailscale 用户@地址；
#                   可用 CODEX_US_HOST 覆盖（如 Tailscale 不可达时切换别名）
#   CODEX_BIN       本地 codex 可执行文件名，默认 codex
#
# 红线：
#   - 绝不在本机（西安）执行 codex login / 任何触发认证刷新的命令
#   - token 内容绝不打印到 stdout/日志
#   - 本地与远端 auth.json 均 mode 600
#   - 不使用 exec 运行 codex —— exec 会替换脚本自身进程，
#     导致 EXIT trap 无法在 codex 退出后触发，回传逻辑就此失效
set -uo pipefail  # 不用 -e：codex 非零退出时仍须继续执行 trap 回传逻辑

ALLOWED_TEAMS=(team1 team2 team3 team4 team5)
US_HOST="${CODEX_US_HOST:-administrator@100.71.151.105}"
CODEX_BIN="${CODEX_BIN:-codex}"

TEAM=""

usage() {
  cat <<'EOF'
用法:
  scripts/codex-request.sh --team <team1|team2|team3|team4|team5>

流程:
  1. 反向 SSH 探活美国 M4
  2. scp 从美国拉取该账号最新 auth.json（覆盖本地）
  3. 前台运行 codex（非 exec，保留退出后 trap 回传能力）
  4. 无论 codex 正常/异常退出，trap 都会把（可能已被刷新的）auth.json scp 推回美国
EOF
}

log() { printf '[codex-request] %s\n' "$*"; }
die() { printf '[codex-request] ERROR: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --team)
      [[ $# -ge 2 ]] || die "--team 需要参数"
      TEAM="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "未知参数: $1（见 --help）"
      ;;
  esac
done

[[ -n "$TEAM" ]] || die "需要 --team <team1|team2|team3|team4|team5>"

is_allowed_team() {
  local t="$1" a
  for a in "${ALLOWED_TEAMS[@]}"; do
    [[ "$a" == "$t" ]] && return 0
  done
  return 1
}
is_allowed_team "$TEAM" || die "非法 team: $TEAM（允许: ${ALLOWED_TEAMS[*]}）"

LOCAL_HOME="${HOME}/.codex-${TEAM}"
LOCAL_AUTH="${LOCAL_HOME}/auth.json"
REMOTE_AUTH="~/.codex-${TEAM}/auth.json"

ssh_cmd() {
  ssh -o BatchMode=yes -o ConnectTimeout=15 "$US_HOST" "$@"
}

assert_ssh() {
  if ! ssh_cmd 'echo ok' >/dev/null 2>&1; then
    die "无法反向 SSH 到美国 M4（${US_HOST}）。请检查 Tailscale 连通性。"
  fi
}

pull_token() {
  mkdir -p "$LOCAL_HOME"
  log "从美国拉取 ${TEAM} 最新 token（不打印内容）"
  scp -o BatchMode=yes -o ConnectTimeout=15 \
    "${US_HOST}:${REMOTE_AUTH}" "$LOCAL_AUTH" \
    || die "拉取 ${TEAM} token 失败"
  chmod 600 "$LOCAL_AUTH"
  log "拉取完成，本地已 chmod 600"
}

push_token_back() {
  # trap 回调：不使用 die（避免掩盖 codex 的真实退出码），失败只打印明确错误
  if [[ ! -f "$LOCAL_AUTH" ]]; then
    printf '[codex-request] WARN: 本地 %s 不存在，跳过推回\n' "$LOCAL_AUTH" >&2
    return 0
  fi
  chmod 600 "$LOCAL_AUTH"
  if scp -o BatchMode=yes -o ConnectTimeout=15 \
      "$LOCAL_AUTH" "${US_HOST}:${REMOTE_AUTH}" 2>/tmp/codex-request-pushback-err.$$; then
    ssh_cmd "chmod 600 ${REMOTE_AUTH}" || true
    log "已把 ${TEAM} token 推回美国"
  else
    printf '[codex-request] ERROR: %s token 推回美国失败，请人工核查（不重试，避免覆盖坏数据）: %s\n' \
      "$TEAM" "$(cat /tmp/codex-request-pushback-err.$$ 2>/dev/null)" >&2
  fi
  rm -f /tmp/codex-request-pushback-err.$$
}

assert_ssh
pull_token

trap push_token_back EXIT

log "启动 codex（CODEX_HOME=${LOCAL_HOME}）"
env CODEX_HOME="$LOCAL_HOME" "$CODEX_BIN"
CODEX_EXIT=$?

exit "$CODEX_EXIT"
```

```bash
chmod +x scripts/codex-request.sh
```

- [ ] **Step 5: 跑测试确认全部通过**

Run: `bash scripts/__tests__/codex-request.test.sh`
Expected: `结果: 8 passed, 0 failed`

- [ ] **Step 6: `bash -n` 语法检查**

Run: `bash -n scripts/codex-request.sh && bash -n scripts/codex-remote-launch.sh && echo SYNTAX_OK`
Expected: `SYNTAX_OK`

- [ ] **Step 7: Commit 实现（TDD commit-2 / 绿）**

```bash
git add scripts/codex-request.sh
git commit -m "feat(scripts): codex-request.sh——西安侧pull模式(用前取最新+用后即还)"
```

---

### Task 3: 真实集成验证（人工，不进 CI）

**Files:** 无新文件——纯操作验证，产出证据贴进 PR description。

- [ ] **Step 1: 把当前分支同步到西安 M4 上的 repo checkout**

Run:
```bash
git push -u origin HEAD
ssh xian-m4 "cd /Users/jinnuoshengyuan/repos/cecelia && git fetch origin && git checkout $(git branch --show-current) 2>/dev/null || git checkout -b $(git branch --show-current) origin/$(git branch --show-current)"
```
Expected: 西安侧 repo 切到本次分支，包含新脚本。

- [ ] **Step 2: 在西安 M4 上真实跑一次 `codex-request.sh --team team1`（此前 team1 从未在西安落过地）**

Run:
```bash
ssh xian-m4 "cd /Users/jinnuoshengyuan/repos/cecelia && timeout 20 bash scripts/codex-request.sh --team team1 < /dev/null" 2>&1
```
Expected: 输出包含 `[codex-request] 拉取完成` 和 `[codex-request] 启动 codex`；因为 `< /dev/null` 加 `timeout 20`，codex 交互进程会因无输入很快退出或被 timeout 杀掉——**这是预期的**，重点验证下一步 trap 是否仍触发了推回。

- [ ] **Step 3: 核对美国本机 team1 的 auth.json mtime 是否因推回而更新**

Run:
```bash
stat -f "%Sm" "$HOME/.codex-team1/auth.json"
ssh xian-m4 "stat -f '%Sm' ~/.codex-team1/auth.json"
```
Expected: 两边 mtime 接近（推回发生在最近这次操作时间附近），证明 trap 真的触发了 scp 推回（即使 codex 因 timeout 被杀，非零退出码路径的 trap 依然生效，与 Task 2 的 mock 测试断言一致）。

- [ ] **Step 4: 把三条证据（Step1 分支同步输出 / Step2 命令行输出 / Step3 mtime 对比）整理进 PR description**

不需要额外 commit——这是验证性操作，证据直接写进 PR body。

---

## Self-Review Checklist（写计划后自查，已完成）

1. **Spec 覆盖**：
   - `codex-remote-launch.sh` 白名单扩容 → Task 1 ✅
   - 新建 `codex-request.sh`（pull + 前台运行 + trap 推回）→ Task 2 ✅
   - 不用 exec（设计文档已修正的关键点）→ Task 2 Step 4 代码 + Step 5 的 `test_no_exec_used` 断言 ✅
   - 红线（不 login/不打印 token/mode 600）→ Task 2 测试里 `test_no_token_content_printed`/`test_no_login_command`/`test_chmod_600_both_directions` ✅
   - 真实集成验证（西安真机跑一次）→ Task 3 ✅
2. **占位符扫描**：无 TBD/TODO，所有 step 都是可直接执行的完整代码/命令。
3. **类型一致性**：`LOCAL_HOME`/`LOCAL_AUTH`/`REMOTE_AUTH`/`US_HOST`/`TEAM` 命名在脚本全文一致；测试里 mock 的环境变量名 `CODEX_MOCK_EXIT_CODE` 与脚本里读取的 `${CODEX_MOCK_EXIT_CODE:-0}`（通过 mock codex 二进制读取）对齐。
