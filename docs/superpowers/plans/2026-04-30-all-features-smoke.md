# All Features Smoke Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 写一个动态 bash 脚本，从 Brain API 实时拉取所有 feature 的 `smoke_cmd`，逐个执行，把结果写回 `smoke_status`，有失败则 exit 1，自动被 CI `real-env-smoke` job 执行。

**Architecture:** 单脚本动态模式，运行时从 `/api/brain/features` 拉取列表，`bash -c` 执行每条 smoke_cmd，`PATCH` 写回结果。不用 `set -e`（需捕获每条退出码后继续），用 `set -uo pipefail`。

**Tech Stack:** bash, curl, jq

---

## File Structure

- Create: `packages/brain/scripts/smoke/all-features-smoke.sh` — 动态执行脚本
- Create: `packages/brain/src/routes/__tests__/all-features-smoke.test.js` — trivial unit test（验证脚本文件存在且含关键行）

---

### Task 1: Smoke 骨架 + unit test（TDD 起点）

**Files:**
- Create: `packages/brain/scripts/smoke/all-features-smoke.sh`（骨架，此时会失败）
- Create: `packages/brain/src/routes/__tests__/all-features-smoke.test.js`

- [ ] **Step 1: 写失败 unit test**

创建 `packages/brain/src/routes/__tests__/all-features-smoke.test.js`：

```javascript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('all-features-smoke.sh', () => {
  it('脚本文件存在且含关键逻辑', () => {
    const content = readFileSync(
      'packages/brain/scripts/smoke/all-features-smoke.sh',
      'utf8'
    );
    expect(content).toContain('/api/brain/features');
    expect(content).toContain('smoke_cmd');
    expect(content).toContain('smoke_status');
    expect(content).toContain('set -uo pipefail');
    expect(content).toContain('exit 1');
  });
});
```

- [ ] **Step 2: 运行测试确认失败（脚本不存在）**

```bash
cd packages/brain && npx vitest run src/routes/__tests__/all-features-smoke.test.js --reporter=verbose 2>&1 | tail -10
```

Expected: FAIL — `ENOENT: no such file or directory`

- [ ] **Step 3: 写脚本骨架（空内容，让测试进入下一阶段）**

创建 `packages/brain/scripts/smoke/all-features-smoke.sh`（骨架占位，内容待 Task 2 填充）：

```bash
#!/usr/bin/env bash
# all-features-smoke.sh — 占位骨架，Task 2 填充
set -uo pipefail
```

- [ ] **Step 4: 赋执行权限**

```bash
chmod +x packages/brain/scripts/smoke/all-features-smoke.sh
```

- [ ] **Step 5: Commit（TDD commit-1：失败的 smoke 骨架 + 单元测试）**

```bash
git add packages/brain/src/routes/__tests__/all-features-smoke.test.js \
        packages/brain/scripts/smoke/all-features-smoke.sh
git commit -m "test(brain): failing smoke skeleton + unit test for all-features-smoke

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: 实现 all-features-smoke.sh

**Files:**
- Modify: `packages/brain/scripts/smoke/all-features-smoke.sh`

- [ ] **Step 1: 写完整实现**

用以下内容替换 `packages/brain/scripts/smoke/all-features-smoke.sh`：

```bash
#!/usr/bin/env bash
# all-features-smoke.sh
# 从 Brain API 动态拉取所有 feature 的 smoke_cmd，逐个执行，写回结果。
# exit 1 if any feature fails.
set -uo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "=== all-features-smoke ==="
echo "Brain: $BRAIN_URL"
echo "Time:  $NOW"
echo ""

# 拉取所有 feature（limit=500 保证一次全取）
FEATURES_JSON=$(curl -sf "$BRAIN_URL/api/brain/features?limit=500")
TOTAL=$(echo "$FEATURES_JSON" | jq '.features | length')
echo "Features: $TOTAL"
echo ""

PASSED=0
FAILED=0
FAILED_IDS=()

while IFS= read -r row; do
  ID=$(echo "$row" | jq -r '.id')
  CMD=$(echo "$row" | jq -r '.smoke_cmd')

  # smoke_cmd 为空则跳过
  if [ -z "$CMD" ] || [ "$CMD" = "null" ]; then
    echo "⏭️  $ID — no smoke_cmd, skip"
    continue
  fi

  # 执行 smoke_cmd，捕获退出码
  if bash -c "$CMD" > /dev/null 2>&1; then
    STATUS="passing"
    PASSED=$((PASSED + 1))
    echo "✅ $ID"
  else
    STATUS="failing"
    FAILED=$((FAILED + 1))
    FAILED_IDS+=("$ID")
    echo "❌ $ID"
  fi

  # 写回 smoke_status
  curl -sf -X PATCH "$BRAIN_URL/api/brain/features/$ID" \
    -H "Content-Type: application/json" \
    -d "{\"smoke_status\":\"$STATUS\",\"smoke_last_run\":\"$NOW\"}" \
    > /dev/null

done < <(echo "$FEATURES_JSON" | jq -c '.features[]')

echo ""
echo "=== 结果 ==="
echo "✅ passed: $PASSED"
echo "❌ failed: $FAILED"

if [ ${#FAILED_IDS[@]} -gt 0 ]; then
  echo ""
  echo "失败列表:"
  for id in "${FAILED_IDS[@]}"; do
    echo "  - $id"
  done
fi

echo ""
if [ "$FAILED" -gt 0 ]; then
  echo "❌ all-features-smoke FAILED ($FAILED failures)"
  exit 1
fi

echo "✅ all-features-smoke PASSED"
```

- [ ] **Step 2: 运行 unit test 确认通过**

```bash
cd packages/brain && npx vitest run src/routes/__tests__/all-features-smoke.test.js --reporter=verbose 2>&1 | tail -10
```

Expected: `✓ all-features-smoke.sh > 脚本文件存在且含关键逻辑`

- [ ] **Step 3: 对真实 Brain 跑 smoke 确认通过**

```bash
bash packages/brain/scripts/smoke/all-features-smoke.sh 2>&1 | tail -15
```

Expected:
```
=== 结果 ===
✅ passed: 159
❌ failed: 0

✅ all-features-smoke PASSED
```

- [ ] **Step 4: Commit（TDD commit-2：实现）**

```bash
git add packages/brain/scripts/smoke/all-features-smoke.sh
git commit -m "feat(brain): all-features-smoke.sh — dynamic feature registry CI smoke

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: DoD + Learning

**Files:**
- Create: `DoD.md`
- Create: `docs/learnings/cp-0430165047-all-features-smoke.md`

- [ ] **Step 1: 写 DoD.md**

```markdown
# DoD — All Features Smoke Script

- [x] [ARTIFACT] packages/brain/scripts/smoke/all-features-smoke.sh 存在
  Test: manual:node -e "require('fs').accessSync('packages/brain/scripts/smoke/all-features-smoke.sh')"

- [x] [BEHAVIOR] 脚本含 /api/brain/features、smoke_cmd、smoke_status、set -uo pipefail、exit 1
  Test: packages/brain/src/routes/__tests__/all-features-smoke.test.js

- [x] [BEHAVIOR] 对真实 Brain 运行后所有 feature smoke_status 得到刷新
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/scripts/smoke/all-features-smoke.sh','utf8');if(!c.includes('smoke_last_run'))process.exit(1)"
```

- [ ] **Step 2: 写 Learning 文件**

创建 `docs/learnings/cp-0430165047-all-features-smoke.md`：

```markdown
## All Features Smoke 动态脚本（2026-04-30）

### 根本原因
feature registry 里 159 个 feature 的 smoke_cmd 无法被自动持续验证，状态只是初始填入的一次性快照。CI 没有机制在每次部署后重新跑全部 smoke_cmd 刷新状态。

### 下次预防
- [ ] 新增 feature 到 registry 时，smoke_cmd 必须在同一 PR 里验证通过
- [ ] all-features-smoke.sh 进入 CI 后，每次 brain 改动都会重跑，状态陈旧问题消失
- [ ] bash 循环捕获每条命令退出码时不能用 set -e，用 set -uo pipefail + 手动计数
```

- [ ] **Step 3: Commit DoD + Learning**

```bash
git add DoD.md docs/learnings/cp-0430165047-all-features-smoke.md
git commit -m "docs: DoD + learning for all-features-smoke

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
