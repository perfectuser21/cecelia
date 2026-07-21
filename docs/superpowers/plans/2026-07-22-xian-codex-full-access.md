# Xian Codex Full Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every Codex session launched from the US M4 onto the Xian M4 explicitly bypasses approvals and sandboxing.

**Architecture:** Keep the existing token push and remote tmux flow unchanged. Add the Codex full-access CLI flag only to the two generated remote launcher commands, with shell tests that execute both branches through mocked SSH and inspect the captured launcher content.

**Tech Stack:** Bash, mocked `ssh`/`scp`, Codex CLI.

---

## File structure

- Modify `scripts/__tests__/codex-remote-launch.test.sh`: add behavioral coverage for brief and no-brief remote launcher generation.
- Modify `scripts/codex-remote-launch.sh`: add one Codex CLI flag to both remote `exec` branches.

### Task 1: Require Full access in generated remote sessions

**Files:**
- Modify: `scripts/__tests__/codex-remote-launch.test.sh`
- Modify: `scripts/codex-remote-launch.sh`

- [ ] **Step 1: Write the failing no-brief and brief tests**

Add these functions before the test invocation block in `scripts/__tests__/codex-remote-launch.test.sh`:

```bash
test_remote_session_uses_full_access_without_brief() {
  setup
  if bash "$TARGET" --team team1 >/tmp/out.$$ 2>&1 \
    && grep -Fq 'exec /opt/homebrew/bin/codex --dangerously-bypass-approvals-and-sandbox' "$LOG"; then
    pass "无 brief 的远程 Codex session 使用 Full access"
  else
    fail "无 brief 的远程 Codex session 使用 Full access" "$(cat /tmp/out.$$; cat "$LOG")"
  fi
  rm -f /tmp/out.$$
  teardown
}

test_remote_session_uses_full_access_with_brief() {
  setup
  brief="$TMP/task.md"
  printf '%s\n' '执行任务' > "$brief"
  if bash "$TARGET" --team team1 --brief "$brief" >/tmp/out.$$ 2>&1 \
    && grep -Fq 'exec /opt/homebrew/bin/codex --dangerously-bypass-approvals-and-sandbox "$(cat /tmp/codex-brief-team1-' "$LOG"; then
    pass "带 brief 的远程 Codex session 在 prompt 前使用 Full access"
  else
    fail "带 brief 的远程 Codex session 在 prompt 前使用 Full access" "$(cat /tmp/out.$$; cat "$LOG")"
  fi
  rm -f /tmp/out.$$
  teardown
}
```

Invoke both functions after the existing test invocations:

```bash
test_remote_session_uses_full_access_without_brief
test_remote_session_uses_full_access_with_brief
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
bash scripts/__tests__/codex-remote-launch.test.sh
```

Expected: the existing seven assertions pass, the two new Full access assertions fail because the generated remote launchers do not contain `--dangerously-bypass-approvals-and-sandbox`, and the script exits non-zero.

- [ ] **Step 3: Commit the failing tests**

```bash
git add scripts/__tests__/codex-remote-launch.test.sh
git commit -m "test: require full access for xian codex sessions"
```

- [ ] **Step 4: Add the minimal launcher implementation**

In the brief branch of `scripts/codex-remote-launch.sh`, replace:

```bash
exec ${REMOTE_CODEX_BIN} "\$(cat ${remote_brief_path})"
```

with:

```bash
exec ${REMOTE_CODEX_BIN} --dangerously-bypass-approvals-and-sandbox "\$(cat ${remote_brief_path})"
```

In the no-brief branch, replace:

```bash
exec ${REMOTE_CODEX_BIN}
```

with:

```bash
exec ${REMOTE_CODEX_BIN} --dangerously-bypass-approvals-and-sandbox
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
bash scripts/__tests__/codex-remote-launch.test.sh
```

Expected: `9 passed, 0 failed` and exit code 0.

- [ ] **Step 6: Verify shell syntax**

Run:

```bash
bash -n scripts/codex-remote-launch.sh
bash -n scripts/__tests__/codex-remote-launch.test.sh
```

Expected: both commands exit 0 with no output.

- [ ] **Step 7: Commit the implementation**

```bash
git add scripts/codex-remote-launch.sh
git commit -m "fix: launch xian codex sessions with full access"
```

- [ ] **Step 8: Run final verification**

Run:

```bash
git diff --check origin/main...HEAD
bash scripts/__tests__/codex-remote-launch.test.sh
```

Expected: no whitespace errors and `9 passed, 0 failed`.
