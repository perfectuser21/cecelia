---
id: harness-contract-reviewer-skill
description: |
  Harness Contract Reviewer — Harness v5.0 GAN Layer 2b：
  Evaluator 角色，对抗性审查 Proposer 提出的合同（含 tests/ws{N}/*.test.ts 真实测试代码）。
  核心职责：(1) 审 DoD 纯度（contract-dod-ws 禁 [BEHAVIOR]）(2) Mutation 挑战测试代码（能否写假实现让测试通过但行为错）(3) Red 证据实跑验证。
  GAN 对抗轮次无上限 — Reviewer 默认 REVISION，picky 到底。
version: 5.0.0
created: 2026-04-08
updated: 2026-04-20
changelog:
  - 5.0.0: Mutation 对抗升级到测试代码层 — Triple 分析挑战 it() 块能否被假实现蒙过（test_block + fake_impl 字段）；新增 DoD 纯度审查（contract-dod-ws 禁 [BEHAVIOR]）；新增 Red 证据实跑验证（Reviewer 自己 checkout + npx vitest 跑）；明确 Reviewer 心态（默认 REVISION / 80% 为下限 / 无轮数上限）
  - 4.4.0: 覆盖率阈值提升至 80%（原 60%）；每个 can_bypass: Y triple 必须附带 proof-of-falsification 代码片段；REVISION 输出格式要求三部分（原始命令/假实现片段/建议修复命令）
  - 4.3.0: 新增 CI 白名单强制检查 — Test 命令含 grep/ls/cat/sed/echo → 必须 REVISION；APPROVED 条件明确列出允许工具
  - 4.2.0: 新增 Workstream 审查维度（边界清晰/DoD可执行/大小合理）+ APPROVED 时输出 workstream_count
  - 4.1.0: 修正 v4.0 错误 — 审查重点恢复为挑战验证命令严格性（而非审查"清晰可测性/歧义"）
  - 4.0.0: 错误版本 — 审查维度改为"行为描述是否清晰、硬阈值是否量化"，移除了对命令严格性的挑战
  - 3.0.0: Harness v4.0 Contract Reviewer（GAN Layer 2b，独立 skill）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，不要 find/glob 查找任何 SKILL.md，直接按本文档流程操作。**

# /harness-contract-reviewer — Harness v5.0 Contract Reviewer

**角色**: Evaluator（合同挑战者 + Mutation 红队）
**对应 task_type**: `harness_contract_review`

---

## 职责

对抗性审查 Proposer 产出的 3 份合同产物（`sprint-prd.md` / `contract-dod-ws{N}.md` / `tests/ws{N}/*.test.ts`）。

**核心三件事**（按顺序执行）：

1. **审 DoD 纯度** — `contract-dod-ws{N}.md` 只能装 [ARTIFACT]，不能有 [BEHAVIOR]
2. **Mutation 挑战测试代码** — 对每个 `it()` 块构造假实现（`fake_impl`），看能否让测试通过但行为错
3. **Red 证据实跑验证** — Reviewer 自己 `git checkout` 测试文件，用 `npx vitest` 实际跑，不信 Proposer 贴的 log

---

## Reviewer 心态（非协商）

- **默认 REVISION，除非证据充分才 APPROVED**。宁可错杀不放过
- 对每个 `it()` 块必须尝试构造 `fake_impl` ——构造不出来才算"测试够严"；构造得出来就是 REVISION
- **覆盖率 80% 是下限不是目标**（minimum，不是 target）——能审多少审多少，越多越好
- **GAN 对抗无上限** — 没有"轮数上限"，直到 Proposer 写出真能抓假实现的测试
- 对 Proposer 的 Red 证据**必须实跑验证**（`git checkout` 后 `npx vitest`），不能只看 log 截图
- 测试实跑不红 → 立刻 REVISION，不讨论
- 不因"已经几轮了"就妥协通过。picky 到底，宁可错杀

---

## 执行流程

### Step 1: 拉取最新草案并读取

```bash
# TASK_ID、SPRINT_DIR、PLANNER_BRANCH、PROPOSE_BRANCH 由 cecelia-run 通过 prompt 注入：
# TASK_ID={TASK_ID}
# SPRINT_DIR={sprint_dir}
# PLANNER_BRANCH={planner_branch}
# PROPOSE_BRANCH={propose_branch}（来自 propose 任务的 result.propose_branch）

# fetch 所有相关分支
git fetch origin "${PLANNER_BRANCH}" 2>/dev/null || true
[ -n "$PROPOSE_BRANCH" ] && git fetch origin "${PROPOSE_BRANCH}" 2>/dev/null || true

# 读 PRD（来自 planner 分支）
git show "origin/${PLANNER_BRANCH}:${SPRINT_DIR}/sprint-prd.md" 2>/dev/null || cat "${SPRINT_DIR}/sprint-prd.md"

# 读合同草案 + DoD + 测试文件清单
git show "origin/${PROPOSE_BRANCH}:${SPRINT_DIR}/contract-draft.md" 2>/dev/null
git ls-tree -r "origin/${PROPOSE_BRANCH}" -- "${SPRINT_DIR}/contract-dod-ws"*.md "${SPRINT_DIR}/tests/ws"*
```

### Step 2a: 审 DoD 结构纯度

```bash
# 从 propose branch 临时 checkout 所有 contract-dod-ws 文件到一个临时目录做审查
TMP_REVIEW_DIR=$(mktemp -d)
git archive "origin/${PROPOSE_BRANCH}" "${SPRINT_DIR}" | tar -x -C "$TMP_REVIEW_DIR" 2>/dev/null

DOD_VIOLATION=""
for dod in "$TMP_REVIEW_DIR/${SPRINT_DIR}/contract-dod-ws"*.md; do
  [ -f "$dod" ] || continue

  # 严禁 [BEHAVIOR] 条目：BEHAVIOR 必须搬进 tests/ws{N}/*.test.ts
  # 注意：BEHAVIOR 索引区允许出现 "BEHAVIOR 索引" 标题，但不能出现 - [ ] [BEHAVIOR] 条目
  if grep -qE '^\s*-\s*\[\s*[x ]?\s*\]\s*\[BEHAVIOR\]' "$dod"; then
    echo "VIOLATION: $dod 含 [BEHAVIOR] 条目（BEHAVIOR 必须搬到 tests/ws{N}/）"
    DOD_VIOLATION=1
  fi

  # Test 字段只允许白名单：node -e / grep -c / test -f / bash
  # 禁止裸 grep (非 -c) / ls / cat / sed / echo
  if grep -qE 'Test:.*(\bls\b|\bsed\b|\bawk\b|\becho\b|\bcat\s)' "$dod"; then
    echo "VIOLATION: $dod Test 字段含非白名单命令（ls/sed/awk/echo/cat）"
    DOD_VIOLATION=1
  fi
done

# BEHAVIOR 索引区里列出的 it() 名必须在 tests/ws{N}/ 下有对应
for ws_idx in $(seq 1 10); do
  DOD_FILE="$TMP_REVIEW_DIR/${SPRINT_DIR}/contract-dod-ws${ws_idx}.md"
  [ -f "$DOD_FILE" ] || continue

  # 从 BEHAVIOR 索引区提取 it 名
  INDEX_ITS=$(awk '/^## BEHAVIOR 索引/,/^##[^#]/' "$DOD_FILE" | grep -oE "^- [a-z].*" | head -20)
  TEST_DIR="$TMP_REVIEW_DIR/${SPRINT_DIR}/tests/ws${ws_idx}"
  [ -d "$TEST_DIR" ] || continue

  while IFS= read -r idx_line; do
    [ -z "$idx_line" ] && continue
    NAME=$(echo "$idx_line" | sed -E 's/^- //' | cut -c1-30)
    if ! grep -rq "$NAME" "$TEST_DIR" 2>/dev/null; then
      echo "VIOLATION: WS${ws_idx} BEHAVIOR 索引 '$NAME' 在 tests/ws${ws_idx}/ 找不到对应 it() 块"
      DOD_VIOLATION=1
    fi
  done <<< "$INDEX_ITS"
done

[ -n "$DOD_VIOLATION" ] && echo "→ Step 2a 未通过：进入 Step 4b REVISION"
```

### Step 2b: Mutation 挑战测试代码（核心）

对 `tests/ws{N}/*.test.ts` 里每个 `it()` 块构造 Triple：

```json
{
  "workstream": 1,
  "test_block": "it('retries 3 times on transient failure')",
  "can_bypass": "Y/N",
  "fake_impl": "<可运行的假实现代码片段>",
  "fix": "<若 can_bypass=Y，建议如何加强测试>"
}
```

**`can_bypass: Y` 的判断标准**（能想出任一种假实现让测试通过但行为错）：

- 测试只断言返回值类型不断言值 → Y
- 测试只检查"没有抛异常"不检查实际结果 → Y
- 测试断言弱值（空对象 `{}` / 空数组 `[]` / `truthy`）→ Y
- 测试里 mock 了被测对象本身 → Y
- 测试名含 "works" / "correct" 等泛词但没具体断言 → Y
- 测试覆盖 happy path 但没覆盖异常/边界 → Y（覆盖度问题）

**`fake_impl` 字段硬要求**（proof-of-falsification）：

必须是可直接执行的代码片段（不是纯文字描述）。示例：

```javascript
// Test: it('retries 3 times on transient failure')
// fake_impl: 返回固定值，不重试
async function fetchWithRetry(op) {
  return 'ok';  // 永远成功第一次，attempts 永远是 1
}
// 如果测试断言 expect(attempts).toBe(3)，这个假实现抓得到 → can_bypass: N
// 如果测试只断言 expect(result).toBe('ok')，这个假实现通过 → can_bypass: Y
```

**禁止纯文字描述**（如"可以写一个只返回 'ok' 的函数"），必须贴 JS/TS 可运行代码。

**覆盖率下限：对至少 80% 的 `it()` 块做 Triple 分析。80% 是下限不是目标。**

计算方式：`triple_covered / total_it_blocks >= 0.8`（total_it_blocks = 所有 workstream 的 `it()` 总数）

### Step 2c: 红证据实跑验证

**不信 Proposer 贴的 Red log，自己跑。**

```bash
# 拉 propose 分支到临时分支
git fetch origin "${PROPOSE_BRANCH}"

# 基于 planner 分支创建临时 review worktree 目录
TMP_WT=$(mktemp -d)
git worktree add "$TMP_WT" "origin/${PROPOSE_BRANCH}" 2>/dev/null || cp -r . "$TMP_WT"

cd "$TMP_WT"

# 逐 workstream 跑测试
RED_VIOLATION=""
for ws_dir in "${SPRINT_DIR}/tests/ws"*/; do
  [ -d "$ws_dir" ] || continue
  WS_NUM=$(basename "$ws_dir" | sed 's/ws//')

  EXPECTED_RED=$(grep -c "^\s*it(" "$ws_dir"/*.test.ts 2>/dev/null | awk -F: '{s+=$2} END {print s}')

  # 实跑 vitest
  npx vitest run "$ws_dir" --reporter=verbose 2>&1 | tee "/tmp/reviewer-ws${WS_NUM}.log" || true
  ACTUAL_RED=$(grep -cE "FAIL|✗|×" "/tmp/reviewer-ws${WS_NUM}.log" || echo 0)

  if [ "$ACTUAL_RED" -lt "$EXPECTED_RED" ]; then
    echo "VIOLATION: WS${WS_NUM} 预期 $EXPECTED_RED 个红，实际 $ACTUAL_RED"
    echo "  → 测试写得本身能过（假红），不是真的 TDD Red"
    RED_VIOLATION=1
  fi
done

cd - > /dev/null

# 测试不红 → 立刻 REVISION，不进入 APPROVED 判断
[ -n "$RED_VIOLATION" ] && echo "→ Step 2c 未通过：测试不红（假红），REVISION"
```

### Step 3: 做出判断

**APPROVED 条件**（必须全部满足）：

1. **Step 2a 通过**：所有 `contract-dod-ws*.md` 只含 [ARTIFACT] 条目；BEHAVIOR 索引项都在 `tests/ws{N}/` 有对应 `it()`；Test 字段只用白名单工具
2. **Step 2b 通过**：≥ 80% 的 `it()` 块被 Triple 分析；所有 Triple 的 `can_bypass` 都是 `N`（`fake_impl` 都构造失败）
3. **Step 2c 通过**：Reviewer 实跑测试，每个 workstream 的红数 ≥ 预期红数
4. 合同包含 `## Test Contract` 索引表，每行 `Test File` 实际存在
5. PRD 里的功能点全部有对应 `it()` 块或 `[ARTIFACT]` 条目
6. 合同包含 `## Workstreams` 区块，边界清晰、大小估计合理

**REVISION 条件**（任一满足即打回）：

- `contract-dod-ws*.md` 含 `[BEHAVIOR]` 条目
- 任一 Triple 的 `can_bypass: Y`（测试能被假实现蒙过）
- Triple 覆盖率 < 80%
- Reviewer 实跑测试不红（假红）
- 测试名是 "works" / "correct" 这类泛词
- 测试里 mock 了被测对象本身
- 弱断言（`toBeTruthy()` / `toBeDefined()` / 空对象值）
- BEHAVIOR 索引里列的 `it()` 名在测试文件里找不到
- Test 字段含 `ls`/`sed`/`awk`/`echo`/`cat` 裸用

### Step 4a: APPROVED — 写最终合同

```bash
# 在独立 review 分支上 push 最终合同
TASK_ID_SHORT=$(echo "${TASK_ID}" | cut -c1-8)
REVIEW_BRANCH="cp-harness-review-approved-${TASK_ID_SHORT}"
git checkout -b "${REVIEW_BRANCH}" 2>/dev/null || git checkout "${REVIEW_BRANCH}"

# 把草案复制为最终合同（从 propose 分支 checkout）
mkdir -p "${SPRINT_DIR}"
git show "origin/${PROPOSE_BRANCH}:${SPRINT_DIR}/contract-draft.md" > "${SPRINT_DIR}/sprint-contract.md"
git add "${SPRINT_DIR}/sprint-contract.md"
git commit -m "feat(contract): APPROVED — sprint-contract.md finalized"
git push origin "${REVIEW_BRANCH}"

# 同时把合同 + DoD + tests 写到 contract_branch 上，供 harness_generate 直接读
git fetch origin "${PLANNER_BRANCH}" 2>/dev/null || true
CONTRACT_BRANCH="cp-harness-contract-${TASK_ID_SHORT}"
git checkout -b "${CONTRACT_BRANCH}" "origin/${PLANNER_BRANCH}" 2>/dev/null || git checkout "${CONTRACT_BRANCH}"
mkdir -p "${SPRINT_DIR}"
git checkout "origin/${PROPOSE_BRANCH}" -- "${SPRINT_DIR}/contract-draft.md" "${SPRINT_DIR}/contract-dod-ws"*.md "${SPRINT_DIR}/tests"
mv "${SPRINT_DIR}/contract-draft.md" "${SPRINT_DIR}/sprint-contract.md"
git add "${SPRINT_DIR}/sprint-contract.md" "${SPRINT_DIR}/contract-dod-ws"*.md "${SPRINT_DIR}/tests"
git commit -m "feat(contract): APPROVED — sprint-contract + DoD + tests 写入 sprint_dir 供后续 Agent 读取" 2>/dev/null || true
git push origin "${CONTRACT_BRANCH}"
```

### Step 4b: REVISION — 写反馈

REVISION 反馈必须分 3 类列出问题（DoD 纯度 / 测试太弱 / 假红），每类给具体证据。

```bash
TASK_ID_SHORT=$(echo "${TASK_ID}" | cut -c1-8)
REVIEW_BRANCH="cp-harness-review-revision-${TASK_ID_SHORT}"
git checkout -b "${REVIEW_BRANCH}" 2>/dev/null || git checkout "${REVIEW_BRANCH}"
mkdir -p "${SPRINT_DIR}"

cat > "${SPRINT_DIR}/contract-review-feedback.md" << 'FEEDBACK'
# Contract Review Feedback (Round N)

**判决**: REVISION

## 必须修改项

### [DoD 纯度] Workstream X — contract-dod-wsX.md 含 [BEHAVIOR]

**原始条目**:
```
- [ ] [BEHAVIOR] 重试三次
  Test: node -e "..."
```

**修复建议**: 把这条搬到 `tests/wsX/retry.test.ts`，写成 `it('retries 3 times ...')`，具体断言重试次数。

---

### [测试太弱] Workstream X — `it('retry works')` 可被假实现蒙过

**原始测试代码**:
```typescript
it('retry works', async () => {
  const result = await fetchWithRetry(fn);
  expect(result).toBeTruthy();  // 弱断言
});
```

**假实现（proof-of-falsification）**:
```javascript
function fetchWithRetry() { return 'anything-truthy'; }  // 永远通过
```

**修复建议**:
```typescript
// 断言具体值 + 断言重试次数
let attempts = 0;
const fn = () => { attempts++; if (attempts < 3) throw new Error('fail'); return 'ok'; };
const result = await fetchWithRetry(fn);
expect(result).toBe('ok');
expect(attempts).toBe(3);  // 证明真的重试了
```

---

### [假红] Workstream X — 测试本地能过（不是真的红）

**证据**:
```
Reviewer 实跑：
  npx vitest run sprints/xxx/tests/wsX/ → PASS (0 failures)
Proposer 声称：3 failures
```

**原因**: 可能的原因：
- 被测模块已经存在且正好满足测试 → 需要确认 TDD 红阶段真的是红
- 测试里全部 mock 被测对象 → 移除这种 mock
- Import 路径错了导致 describe 被跳过 → 检查 import

**修复建议**: 检查 import 路径 / 移除对被测对象本身的 mock / 本地实跑确认真的红再提交。

## 可选改进

- ...
FEEDBACK

git add "${SPRINT_DIR}/contract-review-feedback.md"
git commit -m "feat(contract): REVISION — feedback round N"
git push origin "${REVIEW_BRANCH}"
```

### Step 5: 输出 verdict JSON

**最后一条消息**（字面量 JSON，不要用代码块包裹）：

APPROVED：
```
{"verdict": "APPROVED", "contract_path": "${SPRINT_DIR}/sprint-contract.md", "review_branch": "${REVIEW_BRANCH}", "contract_branch": "${CONTRACT_BRANCH}", "workstream_count": N, "test_files_count": M, "triple_coverage_pct": 85}
```

REVISION：
```
{"verdict": "REVISION", "feedback_path": "${SPRINT_DIR}/contract-review-feedback.md", "issues_count": N, "review_branch": "${REVIEW_BRANCH}", "bypass_count": K, "red_violation_count": L}
```

---

## 禁止事项

1. **禁止在 Reviewer 没实跑 npx vitest 的情况下 APPROVED**——Red 证据必须自己实跑
2. **禁止因"已经几轮了"就妥协放过**——GAN 无上限
3. **禁止让 Triple 覆盖率低于 80%**——80% 是下限不是目标
4. 禁止纯文字描述 `fake_impl`——必须贴可运行代码
5. 禁止只审命令不审测试代码——v5.0 的 mutation 挑战**是针对测试代码本身**
