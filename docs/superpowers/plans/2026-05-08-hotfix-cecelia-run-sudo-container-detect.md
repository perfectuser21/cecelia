# Hotfix cecelia-run.sh 容器内跳 sudo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cecelia-run.sh line 22 if 条件加 `[ ! -f /.dockerenv ] && command -v sudo`，让容器内不调 sudo not found。

**Architecture:** 单点 1 行 if 修改。宿主行为 100% 不变，容器内直接以 root 跑。

**Tech Stack:** Bash + 1 个 .test.sh wrapper test + 1 个 smoke .sh

---

## File Structure

| 文件 | 操作 | 责任 |
|---|---|---|
| `packages/brain/scripts/__tests__/cecelia-run-container-detect.test.sh` | **新建** | wrapper test 4 分支验证 if 条件判断 |
| `packages/brain/scripts/smoke/cecelia-run-container-detect-smoke.sh` | **新建** | 真 brain 容器内 docker exec 跑 cecelia-run.sh |
| `packages/brain/scripts/cecelia-run.sh` | **改** | line 22 if 加 `&& [ ! -f /.dockerenv ] && command -v sudo` |
| `packages/brain/package.json` + `package-lock.json` | **改** | 1.228.5 → 1.228.6 |
| `docs/learnings/cp-0508114729-hotfix-cecelia-run-sudo-container-detect.md` | **新建** | Learning |

---

## Task 1: TDD Red — wrapper test + smoke 骨架

**Files:**
- Create: `packages/brain/scripts/__tests__/cecelia-run-container-detect.test.sh`
- Create: `packages/brain/scripts/smoke/cecelia-run-container-detect-smoke.sh`

- [ ] **Step 1.1: 写 wrapper test (4 分支)**

Create `packages/brain/scripts/__tests__/cecelia-run-container-detect.test.sh`:

```bash
#!/usr/bin/env bash
# cecelia-run.sh 容器 detect 4 分支验证
# 思路：用 wrapper script mock id/sudo + fake .dockerenv 文件，跑 cecelia-run.sh 头部，看是否 exec sudo
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_SCRIPTS="$(cd "$SCRIPT_DIR/.." && pwd)"
CECELIA_RUN="$BRAIN_SCRIPTS/cecelia-run.sh"

if [ ! -f "$CECELIA_RUN" ]; then
  echo "FAIL: cecelia-run.sh 不存在 $CECELIA_RUN"
  exit 1
fi

# 提取 cecelia-run.sh 的 if 条件（前 35 行）让我们能源码级判断
# 注意：不真跑 cecelia-run.sh 全文（会启动 dispatch），只看 if 条件源码

WORK=$(mktemp -d -t cecelia-run-test-XXXXXX)
trap "rm -rf '$WORK'" EXIT

PASS_COUNT=0
FAIL_COUNT=0

assert() {
  local desc="$1"; local actual="$2"; local expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "✓ $desc"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "✗ $desc — expected: $expected, got: $actual"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

# Helper: 在隔离环境跑 cecelia-run.sh 的 if 条件，返回 "ENTERED" 或 "SKIPPED"
test_branch() {
  local label="$1"
  local mock_uid="$2"          # "0" or "1000"
  local has_dockerenv="$3"     # "yes" or "no"
  local has_sudo="$4"          # "yes" or "no"

  local sandbox="$WORK/$label"
  mkdir -p "$sandbox/bin"

  # mock id command
  cat > "$sandbox/bin/id" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "-u" ]; then echo "$mock_uid"; else /usr/bin/id "\$@"; fi
EOF
  chmod +x "$sandbox/bin/id"

  # mock sudo (or remove)
  if [ "$has_sudo" = "yes" ]; then
    cat > "$sandbox/bin/sudo" <<'EOF'
#!/usr/bin/env bash
echo "MOCK_SUDO_CALLED"
exit 0
EOF
    chmod +x "$sandbox/bin/sudo"
  fi

  # fake /.dockerenv via DOCKERENV_FILE override (脚本里读这个变量)
  local dockerenv_file="$sandbox/.dockerenv"
  if [ "$has_dockerenv" = "yes" ]; then
    touch "$dockerenv_file"
  fi

  # 抽出 cecelia-run.sh 的 if 条件段，eval 它，看是否进入分支
  # 注意：cecelia-run.sh 用 /.dockerenv 硬编码 — 我们用一个 wrapper bash -c 替换
  local sentinel="$sandbox/sentinel"
  PATH="$sandbox/bin:/usr/bin:/bin" bash -c '
    DOCKERENV_FILE="'"$dockerenv_file"'"
    if [[ "$(id -u)" == "0" ]] && [[ ! -f "$DOCKERENV_FILE" ]] && command -v sudo >/dev/null 2>&1; then
      echo ENTERED > "'"$sentinel"'"
    else
      echo SKIPPED > "'"$sentinel"'"
    fi
  '
  cat "$sentinel"
}

# 4 分支
echo "=== 测试 4 分支条件判断（cecelia-run.sh line 22 修复后）==="
assert "宿主 root + 无 .dockerenv + 有 sudo → ENTERED（走 sudo 切换）" \
  "$(test_branch host-root 0 no yes)" "ENTERED"

assert "宿主非 root user → SKIPPED（不进 if）" \
  "$(test_branch host-user 1000 no yes)" "SKIPPED"

assert "容器 root + 有 .dockerenv + 无 sudo → SKIPPED（容器跳过）" \
  "$(test_branch container-root-no-sudo 0 yes no)" "SKIPPED"

assert "容器 root + 有 .dockerenv + 有 sudo → SKIPPED（dockerenv 兜底）" \
  "$(test_branch container-root-with-sudo 0 yes yes)" "SKIPPED"

# 还要校验 cecelia-run.sh 实际源码 line 22 真的含新条件
echo ""
echo "=== 源码 line 22 必须含新条件 ==="
LINE_22=$(sed -n '22p' "$CECELIA_RUN")
if echo "$LINE_22" | grep -q '\-f /.dockerenv'; then
  echo "✓ cecelia-run.sh line 22 含 /.dockerenv 检查"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "✗ cecelia-run.sh line 22 缺 /.dockerenv 检查 — 当前内容: $LINE_22"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
if echo "$LINE_22" | grep -q 'command -v sudo'; then
  echo "✓ cecelia-run.sh line 22 含 sudo 检查"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "✗ cecelia-run.sh line 22 缺 sudo 检查 — 当前内容: $LINE_22"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo ""
echo "总计: PASS=$PASS_COUNT FAIL=$FAIL_COUNT"
[ "$FAIL_COUNT" -eq 0 ] && exit 0 || exit 1
```

- [ ] **Step 1.2: 写 smoke.sh 真容器 E2E**

Create `packages/brain/scripts/smoke/cecelia-run-container-detect-smoke.sh`:

```bash
#!/usr/bin/env bash
# 真 brain 容器内 docker exec 跑 cecelia-run.sh：不应报 sudo not found
set -uo pipefail

CONTAINER="cecelia-node-brain"

# 确认容器在跑
if ! docker ps --filter "name=$CONTAINER" --format '{{.Names}}' | grep -q "^$CONTAINER$"; then
  echo "SKIP: $CONTAINER 容器不在跑（CI 环境无 brain 容器）"
  exit 0
fi

CECELIA_RUN_PATH="/Users/administrator/perfect21/cecelia/packages/brain/scripts/cecelia-run.sh"

# 在容器内跑 cecelia-run.sh 但不真做 dispatch（dry/help/早期 exit）
# cecelia-run.sh 没 --help，但缺 PROMPT_FILE 会早 exit；我们只看 stderr 是否含 "sudo: not found"
OUTPUT=$(docker exec "$CONTAINER" bash -c "$CECELIA_RUN_PATH 2>&1 || true" | head -20)

if echo "$OUTPUT" | grep -q "sudo: not found"; then
  echo "❌ FAIL: cecelia-run.sh 仍报 sudo not found"
  echo "$OUTPUT"
  exit 1
fi

if echo "$OUTPUT" | grep -q "切换到 administrator 重新执行"; then
  echo "❌ FAIL: cecelia-run.sh 在容器内仍尝试 sudo 切换（应跳过）"
  echo "$OUTPUT"
  exit 1
fi

echo "✅ cecelia-run-container-detect smoke PASS — 容器内不调 sudo"
exit 0
```

- [ ] **Step 1.3: chmod +x 两个 .sh**

```bash
chmod +x packages/brain/scripts/__tests__/cecelia-run-container-detect.test.sh
chmod +x packages/brain/scripts/smoke/cecelia-run-container-detect-smoke.sh
```

- [ ] **Step 1.4: 跑 wrapper test 看 fail（Red）**

```bash
cd /Users/administrator/worktrees/cecelia/hotfix-cecelia-run-sudo-container-detect
bash packages/brain/scripts/__tests__/cecelia-run-container-detect.test.sh
echo "exit=$?"
```

期望：4 分支 PASS（条件判断本身已对）但**源码 line 22 lint 2 个 FAIL**（line 22 现在还没含新条件）→ 总体 exit 1。

- [ ] **Step 1.5: 跑 smoke.sh 看 fail（Red）**

```bash
cd /Users/administrator/worktrees/cecelia/hotfix-cecelia-run-sudo-container-detect
bash packages/brain/scripts/smoke/cecelia-run-container-detect-smoke.sh
echo "exit=$?"
```

期望：exit 1，因为容器内当前 cecelia-run.sh 仍报 sudo not found（修复未应用）。

- [ ] **Step 1.6: Commit Red**

```bash
cd /Users/administrator/worktrees/cecelia/hotfix-cecelia-run-sudo-container-detect
git add packages/brain/scripts/__tests__/cecelia-run-container-detect.test.sh \
        packages/brain/scripts/smoke/cecelia-run-container-detect-smoke.sh
git commit -m "test(brain): TDD Red — cecelia-run.sh 容器 detect wrapper test + smoke 骨架"
```

---

## Task 2: TDD Green — 改 cecelia-run.sh line 22

**Files:**
- Modify: `packages/brain/scripts/cecelia-run.sh` (line 21-22)

- [ ] **Step 2.1: Read line 18-32 确认实际内容**

读 `packages/brain/scripts/cecelia-run.sh` line 18-32，确认 if 条件位置。

- [ ] **Step 2.2: Edit line 22 加新条件 + 注释更新**

old_string：
```bash
# 如果以 root 运行，重新以 administrator 身份执行（claude 拒绝 root + setsid 下的 --dangerously-skip-permissions）
if [[ "$(id -u)" == "0" ]]; then
```

new_string：
```bash
# 如果以 root 运行（仅宿主环境），重新以 administrator 身份执行（claude 拒绝 root + setsid 下的 --dangerously-skip-permissions）
# 容器内（/.dockerenv 存在 OR 没装 sudo）跳过切换：直接以 root 跑，brain 容器本就 root + 不需切 user
if [[ "$(id -u)" == "0" ]] && [[ ! -f /.dockerenv ]] && command -v sudo >/dev/null 2>&1; then
```

- [ ] **Step 2.3: 跑 wrapper test 验证 PASS**

```bash
cd /Users/administrator/worktrees/cecelia/hotfix-cecelia-run-sudo-container-detect
bash packages/brain/scripts/__tests__/cecelia-run-container-detect.test.sh
echo "exit=$?"
```

期望：6 个 assert 全 PASS（4 分支 + 2 源码 lint），exit 0。

- [ ] **Step 2.4: Commit Green**

```bash
cd /Users/administrator/worktrees/cecelia/hotfix-cecelia-run-sudo-container-detect
git add packages/brain/scripts/cecelia-run.sh
git commit -m "$(cat <<'EOF'
fix(brain): cecelia-run.sh 容器内（有 .dockerenv 或没 sudo）跳过 sudo 切 user

brain 容器内 cecelia-run.sh 触发 root → administrator 切换，但容器无
sudo + 无 administrator user → exec sudo: not found → capability-probe
dispatch 探针失败 → cecelia-run breaker 周期 OPEN（5-15min 攒 18-56
failures）→ tick scheduler 拒绝 dispatch 任何 task。

修：if 条件加 [ ! -f /.dockerenv ] && command -v sudo。容器内（有
.dockerenv 或没 sudo）跳过 sudo 切换，直接以 root 继续；宿主 root
（cron 等场景）仍走 sudo 切到 administrator。

宿主行为 100% 不变，容器内不再报 sudo not found。

接 PR #2837 (propose_branch 协议双修) + PR #2838 (inferTaskPlan
git fetch) 之后第三个 hotfix。Cecelia Harness Pipeline Journey
长治 sprint 会做容器/宿主环境差异统一封装。
EOF
)"
```

---

## Task 3: brain version bump

- [ ] **Step 3.1: bump 1.228.5 → 1.228.6**

```bash
cd /Users/administrator/worktrees/cecelia/hotfix-cecelia-run-sudo-container-detect
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('packages/brain/package.json', 'utf8'));
p.version = '1.228.6';
fs.writeFileSync('packages/brain/package.json', JSON.stringify(p, null, 2) + '\n');
const lock = JSON.parse(fs.readFileSync('packages/brain/package-lock.json', 'utf8'));
lock.version = '1.228.6';
if (lock.packages && lock.packages['']) lock.packages[''].version = '1.228.6';
fs.writeFileSync('packages/brain/package-lock.json', JSON.stringify(lock, null, 2) + '\n');
console.log('bumped:', p.version);
"
```

- [ ] **Step 3.2: 同步根 package-lock.json**

```bash
node -e "
const fs = require('fs');
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
if (lock.packages && lock.packages['packages/brain']) {
  lock.packages['packages/brain'].version = '1.228.6';
  fs.writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
  console.log('root lock packages/brain:', '1.228.6');
}
"
```

- [ ] **Step 3.3: commit**

```bash
git add packages/brain/package.json packages/brain/package-lock.json package-lock.json
git commit -m "chore(brain): bump 1.228.5 → 1.228.6 — cecelia-run.sh 容器 detect hotfix"
```

---

## Task 4: Learning + push + PR

- [ ] **Step 4.1: 写 Learning**

Create `docs/learnings/cp-0508114729-hotfix-cecelia-run-sudo-container-detect.md`:

```markdown
# cp-0508114729 — Hotfix cecelia-run.sh 容器内跳过 sudo 切 user

**日期**: 2026-05-08
**Branch**: cp-0508114729-hotfix-cecelia-run-sudo-container-detect
**触发**: brain 容器内 cecelia-run.sh exec sudo not found，capability-probe 周期失败 → cecelia-run breaker 周期 OPEN

## 现象

```
$ docker exec cecelia-node-brain bash /Users/administrator/perfect21/cecelia/packages/brain/scripts/cecelia-run.sh
[cecelia-run] 检测到 root 运行，切换到 administrator 重新执行...
/Users/administrator/perfect21/cecelia/packages/brain/scripts/cecelia-run.sh: line 31: exec: sudo: not found
```

reset cecelia-run breaker 后 5-15 分钟攒 18-56 failures 又 OPEN，tick scheduler 因 breaker OPEN 拒绝 dispatch 任何 task。

## 根本原因

cecelia-run.sh line 21-32 检测 root 用户（`id -u == 0`）就 exec sudo 切到 administrator。但 brain 容器（cecelia-brain image）内：
- root 运行（容器 default）
- 没装 sudo
- 没 administrator user

`exec sudo: not found` 让 capability-probe dispatch 探针 stderr 输出错误 → 当作探针 fail → breaker 累计 failures → OPEN。

脚本设计假设宿主环境（有 sudo + administrator user），没 detect 容器场景。

## 下次预防

- [ ] **shell 脚本第一行 detect 容器** — 任何 cron 等可能在容器内跑的脚本都要检测 `/.dockerenv` + `command -v sudo`
- [ ] **跨环境脚本必须 wrapper test 4 分支** — host root / host user / container root / container 假 sudo 都要测
- [ ] **smoke.sh 在真 brain 容器跑** — 不只 host 跑，必须 docker exec 跑一遍
- [ ] **probe 失败 stderr 必须 distinguish 错误类型** — sudo not found 跟 dispatch 真挂是两回事，不该都触发 breaker

## 修复

- cecelia-run.sh line 22 if 条件加 `&& [[ ! -f /.dockerenv ]] && command -v sudo >/dev/null 2>&1`
- 宿主行为 100% 不变（root + 无 .dockerenv + 有 sudo → 走 sudo 切换）
- 容器内（有 .dockerenv OR 没 sudo）跳过切换直接以 root 跑
- 4 分支 wrapper test + 真容器 smoke E2E
- brain version 1.228.5 → 1.228.6

## 长治依赖

[Cecelia Harness Pipeline Journey](https://www.notion.so/Cecelia-Harness-Pipeline-35ac40c2ba6381dba6fbf0c3cb4f1ad4) 长治 sprint 中应该统一规范容器/宿主环境差异层（一个 helper 函数 + 文档约定）。
```

- [ ] **Step 4.2: 终验所有 test + smoke**

```bash
cd /Users/administrator/worktrees/cecelia/hotfix-cecelia-run-sudo-container-detect
bash packages/brain/scripts/__tests__/cecelia-run-container-detect.test.sh
echo "wrapper test exit=$?"
echo "---"
bash packages/brain/scripts/smoke/cecelia-run-container-detect-smoke.sh
echo "smoke exit=$?"
echo "---"
git log --oneline main..HEAD
```

期望：wrapper 6/6 PASS exit 0，smoke exit 0（容器内不报 sudo not found），4 commit。

- [ ] **Step 4.3: commit Learning**

```bash
git add docs/learnings/cp-0508114729-hotfix-cecelia-run-sudo-container-detect.md
git commit -m "docs(brain): learning — cecelia-run.sh 容器 detect hotfix"
```

- [ ] **Step 4.4: push 到 origin**

```bash
git push -u origin cp-0508114729-hotfix-cecelia-run-sudo-container-detect
```

- [ ] **Step 4.5: PR — finishing skill 接管**

---

## Self-Review

✅ **Spec coverage**: 5 个改动清单全有对应 task
✅ **Placeholder scan**: 无 TBD/TODO
✅ **TDD 顺序**: Task 1 (Red) → Task 2 (Green)
✅ **CI 兼容**: smoke.sh 检测容器是否跑（不在则 SKIP），CI 环境无容器自动跳过

---

## Execution Handoff

按 dev SKILL Tier 1 默认: **Subagent-Driven**。下一步 invoke `superpowers:subagent-driven-development`。
