# Codex 美国 M4 默认出口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 CMG 稳定默认使用美国 M4 exit node，仅在 M4 不可用时临时使用 SF，并在会话收尾时再次回归 M4。

**Architecture:** 保留 `codex-us-exit-guard.sh` 的 `prepare|restore` 接口，让两个 launcher 无需改动。`prepare` 不再把 SF 当作与 M4 等价的稳定状态，而是每次优先尝试 M4；`restore` 不再读取进入前出口作为目标，而是把 M4 作为固定收尾目标，失败时保留或切到 SF 并返回非零。

**Tech Stack:** Bash、Tailscale CLI、现有 shell mock 测试、SSH 实机验收

---

### Task 1: 用失败测试定义固定 M4 语义

**Files:**
- Modify: `scripts/__tests__/codex-us-exit-guard.test.sh`
- Test: `scripts/__tests__/codex-us-exit-guard.test.sh`

- [ ] **Step 1: 把旧的“恢复进入前出口”断言改成“收尾保持 M4”**

将 `test_no_exit_switches_to_m4_and_restore_clears_exit` 和 `test_non_us_exit_restores_original_after_session` 改为：

```bash
test_no_exit_switches_to_m4_and_restore_keeps_m4() {
  setup
  : > "$MOCK_EXIT_FILE"
  run_prepare
  bash "$TARGET" restore "${TEST_TMP}/state" >> "${TEST_TMP}/out" 2>&1
  [[ "$(cat "$MOCK_EXIT_FILE")" == "100.71.151.105" ]]
}

test_non_us_exit_finishes_on_m4() {
  setup
  printf '%s' '100.86.118.99' > "$MOCK_EXIT_FILE"
  run_prepare
  bash "$TARGET" restore "${TEST_TMP}/state" >> "${TEST_TMP}/out" 2>&1
  [[ "$(cat "$MOCK_EXIT_FILE")" == "100.71.151.105" ]]
}
```

保留现有 `pass`、`fail` 和 `teardown` 风格，为每个分支打印明确失败原因。

- [ ] **Step 2: 增加 SF 只作为临时兜底的测试**

新增三个行为测试：

```bash
test_existing_sf_prefers_m4_when_available() {
  setup
  printf '%s' '100.79.41.61' > "$MOCK_EXIT_FILE"
  if run_prepare && [[ "$(cat "$MOCK_EXIT_FILE")" == "100.71.151.105" ]]; then
    pass "当前 SF 且 M4 在线时切到 M4"
  else
    fail "当前 SF 且 M4 在线时切到 M4" "$(cat "${TEST_TMP}/out")"
  fi
  teardown
}

test_sf_fallback_returns_to_m4_after_recovery() {
  setup
  : > "$MOCK_EXIT_FILE"
  printf '%s\n' '{"Peer":{"m4":{"HostName":"perfect21","TailscaleIPs":["100.71.151.105"],"Online":false,"ExitNodeOption":true},"sf":{"HostName":"sf-vps","TailscaleIPs":["100.79.41.61"],"Online":true,"ExitNodeOption":true}}}' > "$MOCK_STATUS_FILE"
  if ! run_prepare || [[ "$(cat "$MOCK_EXIT_FILE")" != "100.79.41.61" ]]; then
    fail "临时 SF 在 M4 恢复后回归 M4" "$(cat "${TEST_TMP}/out")"
  else
    printf '%s\n' '{"Peer":{"m4":{"HostName":"perfect21","TailscaleIPs":["100.71.151.105"],"Online":true,"ExitNodeOption":true},"sf":{"HostName":"sf-vps","TailscaleIPs":["100.79.41.61"],"Online":true,"ExitNodeOption":true}}}' > "$MOCK_STATUS_FILE"
    if bash "$TARGET" restore "${TEST_TMP}/state" >> "${TEST_TMP}/out" 2>&1 &&
       [[ "$(cat "$MOCK_EXIT_FILE")" == "100.71.151.105" ]]; then
      pass "临时 SF 在 M4 恢复后回归 M4"
    else
      fail "临时 SF 在 M4 恢复后回归 M4" "$(cat "${TEST_TMP}/out")"
    fi
  fi
  teardown
}

test_restore_keeps_sf_and_fails_when_m4_still_offline() {
  setup
  : > "$MOCK_EXIT_FILE"
  printf '%s\n' '{"Peer":{"m4":{"HostName":"perfect21","TailscaleIPs":["100.71.151.105"],"Online":false,"ExitNodeOption":true},"sf":{"HostName":"sf-vps","TailscaleIPs":["100.79.41.61"],"Online":true,"ExitNodeOption":true}}}' > "$MOCK_STATUS_FILE"
  if ! run_prepare; then
    fail "M4 仍离线时保留 SF 并报错" "$(cat "${TEST_TMP}/out")"
  elif bash "$TARGET" restore "${TEST_TMP}/state" >> "${TEST_TMP}/out" 2>&1; then
    fail "M4 仍离线时保留 SF 并报错" "restore 意外成功"
  elif [[ "$(cat "$MOCK_EXIT_FILE")" == "100.79.41.61" ]]; then
    pass "M4 仍离线时保留 SF 并报错"
  else
    fail "M4 仍离线时保留 SF 并报错" "出口=$(cat "$MOCK_EXIT_FILE")"
  fi
  teardown
}
```

同时把 macOS `ExitNodeIP` 为空的测试期望改为：从 status 识别当前 SF 后仍切换到 M4。

- [ ] **Step 3: 把验证失败后的期望改成保留 M4**

将 `test_prepare_verification_failure_rolls_back_immediately` 改名并断言：

```bash
[[ "$(cat "$MOCK_EXIT_FILE")" == "100.71.151.105" ]]
```

公网验证失败仍必须返回非零，但不能恢复成 `none`。

- [ ] **Step 4: 运行守卫测试并确认是预期失败**

Run:

```bash
bash scripts/__tests__/codex-us-exit-guard.test.sh
```

Expected: 新增或改写的固定 M4 测试失败；失败原因显示当前实现恢复 `none`、恢复非美国节点，或把现有 SF 直接当作稳定出口。

- [ ] **Step 5: 提交测试红灯**

```bash
git add scripts/__tests__/codex-us-exit-guard.test.sh
git commit -m "test(codex): 固定美国 M4 出口语义"
```

### Task 2: 实现 M4 固定默认与 SF 临时兜底

**Files:**
- Modify: `scripts/codex-us-exit-guard.sh`
- Test: `scripts/__tests__/codex-us-exit-guard.test.sh`

- [ ] **Step 1: 修改 `prepare` 的候选选择顺序**

将“当前只要是允许节点就不切换”改为：

```bash
if [[ "$current" == "$PRIMARY_EXIT" ]]; then
  selected="$PRIMARY_EXIT"
elif try_candidate "$PRIMARY_EXIT"; then
  selected="$PRIMARY_EXIT"
elif [[ "$current" == "$FALLBACK_EXIT" ]] && candidate_is_available "$FALLBACK_EXIT"; then
  selected="$FALLBACK_EXIT"
elif try_candidate "$FALLBACK_EXIT"; then
  selected="$FALLBACK_EXIT"
else
  die "两个美国出口节点均不可用（M4=${PRIMARY_EXIT}, SF=${FALLBACK_EXIT}）"
  return 1
fi
[[ "$selected" == "$current" ]] || changed=1
```

这保证当前为 SF 时也优先回到 M4。

- [ ] **Step 2: 把 `restore` 改为固定回归 M4**

实现以下精确语义：

```bash
current="$(current_exit_ip)" || return 1
if [[ "$current" == "$PRIMARY_EXIT" ]]; then
  rm -f "$state_file"
  return 0
fi
if try_candidate "$PRIMARY_EXIT"; then
  rm -f "$state_file"
  log "已回归默认美国 M4 exit node（${PRIMARY_EXIT}）"
  return 0
fi
if [[ "$current" != "$FALLBACK_EXIT" ]]; then
  try_candidate "$FALLBACK_EXIT" || {
    die "无法回归美国 M4，SF 兜底也不可用"
    return 1
  }
fi
die "美国 M4 仍不可用，保留 SF exit node（${FALLBACK_EXIT}）"
```

失败路径保留 state file，便于后续收尾或下次启动再次尝试。

- [ ] **Step 3: 验证失败时也执行固定收尾**

把仅在 `changed=1` 时调用旧恢复逻辑改为无条件调用新的 `restore`：

```bash
if ! assert_public_country_us || ! assert_chatgpt_transport; then
  restore "$state_file" || true
  return 1
fi
```

这样从 `none` 切到 M4 后即使 HTTPS 门禁失败，也仍保持 M4。

- [ ] **Step 4: 运行守卫测试并修正实现，直至该命令返回 0**

Run:

```bash
bash scripts/__tests__/codex-us-exit-guard.test.sh
```

Expected: 所有守卫测试通过，0 failed。

- [ ] **Step 5: 运行入口回归测试**

Run:

```bash
bash scripts/__tests__/codex-request.test.sh
bash scripts/__tests__/codex-remote-launch.test.sh
```

Expected: `codex-request` 与 `codex-remote-launch` 全部通过；`prepare|restore` 接口保持兼容。

- [ ] **Step 6: 提交实现**

```bash
git add scripts/codex-us-exit-guard.sh
git commit -m "fix(codex): 固定美国 M4 为默认出口"
```

### Task 3: 全量验证、部署 CMG 并更新 PR

**Files:**
- Verify: `scripts/codex-us-exit-guard.sh`
- Verify: `scripts/codex-request.sh`
- Verify: `scripts/codex-remote-launch.sh`
- Deploy: `xian-m4:~/repos/cecelia/scripts/codex-us-exit-guard.sh`

- [ ] **Step 1: 运行语法与全量回归**

```bash
bash -n scripts/codex-us-exit-guard.sh scripts/codex-request.sh scripts/codex-remote-launch.sh
bash scripts/__tests__/codex-us-exit-guard.test.sh
bash scripts/__tests__/codex-request.test.sh
bash scripts/__tests__/codex-remote-launch.test.sh
git diff main...HEAD --check
```

Expected: 全部命令 exit 0，测试输出 0 failed。

- [ ] **Step 2: 部署守卫并固定 CMG 到美国 M4**

```bash
scp scripts/codex-us-exit-guard.sh xian-m4:~/repos/cecelia/scripts/codex-us-exit-guard.sh
ssh xian-m4 'chmod 755 ~/repos/cecelia/scripts/codex-us-exit-guard.sh &&
  /Applications/Tailscale.app/Contents/MacOS/Tailscale set --exit-node=100.71.151.105'
```

部署前先在远端备份现有守卫；若普通用户无法设置，使用已配置的无交互 sudo 路径。

- [ ] **Step 3: 实机确认默认出口**

远端读取 Tailscale status 和 Cloudflare trace，必须满足：

```text
EXIT_IP=100.71.151.105
PUBLIC_LOC=US
```

再执行一次守卫 `prepare` 与 `restore`，两步结束后仍必须是 `100.71.151.105`。

- [ ] **Step 4: 推送分支并核验 Draft PR**

```bash
git push
gh pr view 4221 --repo perfectuser21/cecelia \
  --json url,isDraft,baseRefName,headRefName,headRefOid
```

Expected: PR #4221 仍为 Draft，base 为 `main`，head SHA 等于本地 `HEAD`。
