# 合同草案：ci-poll.sh CI 全绿时死循环修复

sprint_id: 07141110-ci-poll-green-fix
contract_version: v1.0
date: 2026-07-14

---

## 问题描述

`packages/workflows/skills/scripts/ci-poll.sh` 第 18-19 行存在 bug：

```bash
FAILED=$(echo "$CHECKS" | grep -c "fail" 2>/dev/null || echo 0)
PENDING=$(echo "$CHECKS" | grep -cE "pending|in_progress|queued" 2>/dev/null || echo 0)
```

`grep -c` 在 0 匹配时退出码为 1，触发 `|| echo 0` 追加输出，导致变量值为多行字符串 `"0\n0"`。
后续 `[ "${FAILED:-0}" -gt 0 ]` 等整数比较因变量含换行符而报 `integer expression expected`，
全绿分支条件永远无法进入，脚本陷入无限轮询死循环。

## 修复方案

将 `|| echo 0` 替换为 `|| true`：

```bash
FAILED=$(echo "$CHECKS" | grep -c "fail" 2>/dev/null || true)
PENDING=$(echo "$CHECKS" | grep -cE "pending|in_progress|queued" 2>/dev/null || true)
```

`grep -c` 在 0 匹配时已输出 `"0"` 到 stdout，`|| true` 仅保证退出码为 0，不再追加额外行，
变量值恒为单行整数 `"0"`，整数比较恢复正常。

---

## E2E 验收

### 环境准备

测试通过 PATH 前置 fake `gh` 脚本实现隔离，不调用真实 GitHub API。

### 验收命令（stub gh）

```bash
# 运行全量测试套件（含全绿、失败、BEHIND、变量单行四个场景）
cd /workspace && bash packages/workflows/skills/scripts/__tests__/ci-poll.test.sh
```

### 场景一：CI 全绿（stub gh 返回全 pass + CLEAN）

```bash
# 手动验证全绿场景
cd /workspace && bash -c '
  TMPDIR=$(mktemp -d)
  cat > "$TMPDIR/gh" <<'"'"'EOF'"'"'
#!/usr/bin/env bash
if [[ "$*" == *"pr checks"* ]]; then
  echo "lint       pass  https://ci/1"
  echo "unit-test  pass  https://ci/2"
  echo "build      pass  https://ci/3"
elif [[ "$*" == *"pr view"* ]]; then
  echo "CLEAN"
fi
EOF
  chmod +x "$TMPDIR/gh"
  PATH="$TMPDIR:$PATH" timeout 5 \
    bash packages/workflows/skills/scripts/ci-poll.sh 123 owner/repo 2>&1
  echo "exit_code=$?"
  rm -rf "$TMPDIR"
'
# 预期：stderr 含 CI_GREEN，exit_code=0
```

### 场景二：CI 有失败（stub gh 含 fail 行）

```bash
cd /workspace && bash -c '
  TMPDIR=$(mktemp -d)
  cat > "$TMPDIR/gh" <<'"'"'EOF'"'"'
#!/usr/bin/env bash
if [[ "$*" == *"pr checks"* ]]; then
  echo "lint  fail  https://ci/1"
  echo "unit  pass  https://ci/2"
elif [[ "$*" == *"pr view"* ]]; then
  echo "CLEAN"
fi
EOF
  chmod +x "$TMPDIR/gh"
  PATH="$TMPDIR:$PATH" timeout 5 \
    bash packages/workflows/skills/scripts/ci-poll.sh 123 owner/repo 2>&1; echo "exit_code=$?"
  rm -rf "$TMPDIR"
'
# 预期：exit_code=10
```

### 场景三：BEHIND（stub gh 返回 BEHIND）

```bash
cd /workspace && bash -c '
  TMPDIR=$(mktemp -d)
  cat > "$TMPDIR/gh" <<'"'"'EOF'"'"'
#!/usr/bin/env bash
if [[ "$*" == *"pr checks"* ]]; then
  echo "lint  pass  https://ci/1"
elif [[ "$*" == *"pr view"* ]]; then
  echo "BEHIND"
fi
EOF
  chmod +x "$TMPDIR/gh"
  PATH="$TMPDIR:$PATH" timeout 5 \
    bash packages/workflows/skills/scripts/ci-poll.sh 123 owner/repo 2>&1; echo "exit_code=$?"
  rm -rf "$TMPDIR"
'
# 预期：exit_code=11
```

---

## 未覆盖真实链路清单

本次测试全部使用 stub gh 脚本隔离，以下真实 GitHub API 路径**未被测试覆盖**：

1. **真实 `gh pr checks` 输出格式**：GitHub Actions / third-party checks 的实际列输出格式可能与 stub 不同（如含 tab 分隔、颜色码、不同列数），grep 匹配规则未经真实数据验证。

2. **`gh pr view --json mergeStateStatus` JSON 解析路径**：stub 直接返回纯文本字符串，真实 API 返回 JSON 并经 `--jq` 解析，JSON 结构变更不会被 stub 测试捕获。

3. **API 限流 / 认证失败路径**：stub 不模拟 `gh` 因 token 过期、rate limit 返回非零退出码的情形（虽然 `|| true` 已兜底，但 CHECKS 为空时的 grep 行为未专项测试）。

4. **多轮轮询（pending → pass 状态转换）**：所有 stub 测试均为首轮即完成的场景，pending 变为 pass 的多轮轮询链路未覆盖。

5. **并发 PR / 不同 repo 参数**：不同 repo 格式（fork、org repo、private repo）下的行为未测试。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|------|-----------|---------------|------------|
| CI全绿退出 | `tests/ci-poll.test.ts` | CI全绿时应exit 0且stderr含CI_GREEN | → FAIL（当前 bug 下 timeout 超时，exit 124） |
| CI失败退出 | `tests/ci-poll.test.ts` | CI有失败时应exit 10 | → FAIL（|| echo 0 导致 integer expression expected，exit code 不符） |
| BEHIND退出 | `tests/ci-poll.test.ts` | BEHIND时应exit 11 | → FAIL（同 integer expression expected 根因） |

---

## 不变量（Invariant）

| # | 约束 |
|---|------|
| 1 | 只修改 FAILED/PENDING 赋值逻辑 |
| 2 | 退出码协议不变：0=全绿，10=有失败，11=BEHIND |
| 3 | `sleep 30` 轮询间隔不变 |
| 4 | 不修改任何上游 skill 文件 |
| 5 | 测试必须 stub gh，不得真调 GitHub API |
| 6 | 保持 `set -euo pipefail` 语义 |
