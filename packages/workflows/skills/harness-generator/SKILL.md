---
id: harness-generator-skill
description: |
  Harness Generator — Harness v5.0 严格合同执行者 × Superpowers 融合。
  读取 GAN 对抗已批准的 sprint-contract.md + tests/ws{N}/*.test.ts + contract-dod-ws{N}.md，按 TDD 纪律两次 commit（commit 1 = 测试 Red / commit 2 = 实现 Green）。
  融入 4 个 superpowers：test-driven-development / verification-before-completion / systematic-debugging / requesting-code-review。
  CONTRACT IS LAW：合同里有的全实现，合同外一字不加；**测试文件从合同原样复制，commit 1 后不可修改**（CI 强校验）。
version: 6.1.0
created: 2026-04-08
updated: 2026-05-06
changelog:
  - 6.1.0: 加 Step 6.5 Contract Self-Verification — push 前自跑 contract-dod-ws*.md 所有 [BEHAVIOR] manual:bash 命令，任一 FAIL 不准 push 必须自修。配合 proposer v7.4 + reviewer v6.2 + evaluator v1.1 协议对齐。修 W19/W20/W21/W22 实证 generator 频繁推漂移实现给 evaluator 兜底的根因
  - 6.0.0: Working Skeleton — skeleton task 检测（is_skeleton）；允许 SKELETON STUB 注释；commit message 加 (Skeleton Red)/(Skeleton Green)；PR body 必须含 Stub 清单
  - 5.0.0: TDD × Superpowers 融合 — 两次 commit 纪律（commit 1 测试 Red / commit 2 实现 Green）+ 4 个 superpowers（test-driven-development / verification-before-completion / systematic-debugging / requesting-code-review）；测试文件从合同原样 checkout，commit 1 后不可修改；Mode 2 harness_fix 走 systematic-debugging
  - 4.3.0: contract-dod-ws 读取路径改为 ${SPRINT_DIR}/contract-dod-ws${WS_IDX}.md（与 Proposer 写入路径对齐）
  - 4.2.0: DoD 来源改为 ${SPRINT_DIR}/contract-dod-ws{N}.md（独立文件），DoD.md 加 contract_branch header 供 CI 完整性校验
  - 4.1.0: 按 workstream_index 定向实现；DoD 直接从合同复制（禁止自起草）
  - 4.0.1: 禁止 find /Users 广泛搜索，只能在当前目录(.)内搜索
  - 4.0.0: Harness v4.0 Generator（严格合同执行者，输出 pr_url 供 harness_ci_watch 使用）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，不要 find/glob 查找任何 SKILL.md，直接按本文档流程操作。**

# /harness-generator — Harness v5.0 TDD 执行者（Superpowers 融合）

**角色**: Generator（代码实现者，遵循 TDD Red-Green 纪律）
**对应 task_type**: `harness_generate` / `harness_fix`

---

## ⚠️ CONTRACT IS LAW

```
合同里有的：全部实现
合同里没有的：一个字不加
测试文件（从合同 checkout）：commit 1 后绝对不可修改，CI 强校验
发现其他问题：写进 PR description，不实现
```

---

## ⚠️ 文件搜索规则（CRITICAL — 违反会导致系统挂起数小时）

**当前工作目录（pwd）即项目根目录，直接使用相对路径。**

```bash
# ❌ 严禁（会遍历 iCloud/网络挂载点，挂起数小时）
find /Users -name "server.js"
find /home -name "*.js"
find / -name "*.ts"

# ✅ 只在当前目录内搜索
find . -name "server.js" -path "*/brain/src/*" 2>/dev/null | head -5
ls packages/brain/src/
cat packages/brain/src/server.js
grep -r "tick_stats" packages/brain/src/
```

---

## Mode 1: harness_generate（首次实现，TDD Red-Green 两次 commit）

### Step 0: 解析任务上下文

Brain 在 prompt 头部注入：

```
TASK_ID={task_id}
SPRINT_DIR={sprint_dir}
CONTRACT_BRANCH={contract_branch}
PLANNER_BRANCH={planner_branch}
WORKSTREAM_INDEX={workstream_index}  # 1-based，可能为空（单 workstream 时）
WORKSTREAM_COUNT={workstream_count}
```

**CONTRACT_BRANCH / SPRINT_DIR / BRAIN_URL / WORKSTREAM_INDEX 任一未定义时绝对禁止继续。**

```bash
# v6 P1-D 自检 — Brain dispatch 必须把这 4 个 env 都注入进来
for var in CONTRACT_BRANCH SPRINT_DIR BRAIN_URL WORKSTREAM_INDEX; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: env $var 未定义 — Brain dispatch 协议失败 (harness-task-dispatch.js 应注入)"
    echo "{\"verdict\": \"ABORTED\", \"reason\": \"missing env $var\"}"
    exit 1
  fi
done
```

**Skeleton Task 检测：**
```bash
IS_SKELETON=$(echo "$TASK_PAYLOAD" | jq -r '.is_skeleton // false')
```
若 `IS_SKELETON=true`，进入 **Skeleton 模式**：目标是让 E2E 测试从 Red 变 Green，中间层允许 stub。
详见文件末尾 "## Skeleton 模式规则" 附录。

### Step 0.4: ★ git remote 验证（v6 P1-D）

entrypoint.sh 已自动重写 origin URL，但保险起见在容器内自检 — 如果仍是宿主绝对路径，所有 git fetch / push 都会挂 "does not appear to be a git repository"。

```bash
ORIGIN_URL=$(git remote get-url origin)
if [[ "$ORIGIN_URL" =~ ^/ ]]; then
  echo "ERROR: git remote 仍是宿主路径 $ORIGIN_URL — entrypoint 重写失败"
  echo "{\"verdict\": \"ABORTED\", \"reason\": \"git remote points to host filesystem path\"}"
  exit 1
fi
```

### Step 0.5: ★ MANDATORY PRE-FLIGHT — rebase 到最新 main

**为什么必须**：Brain 在 Phase B 并行派发 4 个 ws。ws1 先合并到 main 后，ws2/ws3/ws4 的 worktree 仍基于**老 main 快照**（clone 时的 main），如果不 rebase，兄弟 ws 动过的共享文件（常见 `packages/brain/src/routes/*.js`）会在 PR 阶段跟 main 产生 **add/add 冲突**，CI 直接挂，需要人肉救场。

```bash
# 必须在任何 checkout -b / 写代码之前跑
git fetch origin main
git rebase origin/main || {
  echo "ERROR: rebase 冲突 — 必须解决后才能继续"
  # 诊断步骤：
  #   git status               → 查看冲突文件
  #   多半是兄弟 ws 共享文件：
  #     - packages/brain/src/routes/*.js（多个 ws 往同一个 router 加端点）
  #     - packages/brain/src/server.js（route 注册）
  #     - packages/brain/src/brain-manifest.generated.json（自动生成）
  # 解决策略：
  #   - routes/*.js add/add：打开文件，保留双方新增端点（ws 互不冲突，只是都加了东西）
  #   - manifest.generated.json：丢弃本地，接受 origin/main，后面重新生成
  # 解决后：
  #   git add <file> && git rebase --continue
  # 实在搞不定：
  #   git rebase --abort
  #   echo "{\"verdict\": \"ABORTED\", \"reason\": \"rebase main 冲突无法自动解决\"}"
  exit 1
}

# verify: 当前 HEAD 必须 >= origin/main
git merge-base --is-ancestor origin/main HEAD || {
  echo "ERROR: rebase 后 HEAD 仍落后 origin/main，拒绝继续"
  exit 1
}
```

**禁止事项**：
- 禁止跳过 rebase 直接开工（即使 worktree 看起来"干净"）
- 禁止用 `git merge origin/main` 代替 rebase（会产生 merge commit 污染历史）

### Step 1: 读合同 + 测试文件清单

```bash
WS_IDX="${WORKSTREAM_INDEX:-1}"

git fetch origin "${CONTRACT_BRANCH}" 2>/dev/null || true

# 读合同
git show "origin/${CONTRACT_BRANCH}:${SPRINT_DIR}/sprint-contract.md"

# 读 DoD（只含 [ARTIFACT]）
git show "origin/${CONTRACT_BRANCH}:${SPRINT_DIR}/contract-dod-ws${WS_IDX}.md"

# 列出测试文件
git ls-tree -r "origin/${CONTRACT_BRANCH}" -- "${SPRINT_DIR}/tests/ws${WS_IDX}/"
```

**只读 sprint-contract.md，不读 contract-draft.md。**

### Step 2: 创建 cp-* 分支（强制仓库命名规约）

**为什么强制 cp-\***：仓库 `hooks/branch-protect.sh` 硬编码只接受 `^cp-[0-9]{8,10}-[a-z0-9][a-z0-9_-]*$`。任何其他命名（如 Brain worktree 默认的 `harness-v2/task-<uuid>`）在 CI 的 branch-naming check 上直接挂。

```bash
# TASK_ID 从 env HARNESS_TASK_ID 读，Brain dispatch 必注入
if [ -z "${HARNESS_TASK_ID:-}" ]; then
  echo "ERROR: HARNESS_TASK_ID 未设置，无法构造合规分支名"
  exit 1
fi
TASK_ID_SHORT="${HARNESS_TASK_ID:0:8}"

# 分支名必须按仓库规约 cp-MMDDHHNN-* （详见 hooks/branch-protect.sh）
# 时区用上海时间保证 MMDDHHNN 稳定；task_id 前 8 位作唯一后缀（避免兄弟 ws 撞名）
WS_SUFFIX=${WORKSTREAM_INDEX:+"-ws${WORKSTREAM_INDEX}"}
BRANCH="cp-$(TZ=Asia/Shanghai date +%m%d%H%M)-ws-${TASK_ID_SHORT}${WS_SUFFIX}"

# 合法性自检（跟 hooks/branch-protect.sh 同规则）
if ! [[ "$BRANCH" =~ ^cp-[0-9]{8,10}-[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "ERROR: 构造的分支名不合规：$BRANCH"
  exit 1
fi

git checkout -b "$BRANCH"
```

**禁止事项**：
- 禁止直接在 Brain 创建的 `harness-v2/task-<uuid>` 分支上 commit（CI branch-naming check 会挂）
- 禁止用 `harness-v2/...`、`feature/...`、`fix/...` 等前缀（本仓库只放行 `cp-*`）
- 禁止跳过合法性自检直接 checkout

### Step 3: ★ TDD Red 阶段（commit 1 = 测试文件 + DoD，禁含实现）

**调用 skill: `superpowers:test-driven-development`** — 遵循 Red-Green-Refactor 铁律。

```bash
# 从合同 branch 原样 checkout 测试文件（禁止修改）
git checkout "origin/${CONTRACT_BRANCH}" -- "${SPRINT_DIR}/tests/ws${WS_IDX}/"

# 原样复制 DoD（contract-dod-ws{N}.md → DoD.md，加 contract 来源 header）
CONTRACT_DOD=$(git show "origin/${CONTRACT_BRANCH}:${SPRINT_DIR}/contract-dod-ws${WS_IDX}.md")
cat > DoD.md << DODEOF
contract_branch: ${CONTRACT_BRANCH}
workstream_index: ${WS_IDX}
sprint_dir: ${SPRINT_DIR}

${CONTRACT_DOD}
DODEOF

# commit 1 只能 touch：sprints/*/tests/**/*.test.ts + DoD.md
# 禁含 packages/ apps/ 等实现目录
git add "${SPRINT_DIR}/tests/ws${WS_IDX}/" DoD.md
git commit -m "test(harness): ws${WS_IDX} failing tests (Red)"

# verify Red：跑测试看红（预期 FAIL，因实现还不存在）
npx vitest run "${SPRINT_DIR}/tests/ws${WS_IDX}/" --reporter=verbose 2>&1 | tee /tmp/red-evidence.txt || true

EXPECTED_RED=$(grep -c "^\s*it(" "${SPRINT_DIR}/tests/ws${WS_IDX}/"*.test.ts 2>/dev/null | awk -F: '{s+=$2} END {print s}')
ACTUAL_RED=$(grep -cE "FAIL|✗|×" /tmp/red-evidence.txt || echo 0)
if [ "$ACTUAL_RED" -lt "$EXPECTED_RED" ]; then
  echo "ERROR: 预期 $EXPECTED_RED 个红，实际 $ACTUAL_RED — 测试本地就能过，说明 import 错或测试太弱"
  exit 1
fi
```

**Red 证据贴进 commit 1 的 git notes 或临时保存在 /tmp/red-evidence.txt，后面进 PR body。**

**Skeleton 模式**：`IS_SKELETON=true` 时，commit message 改为：
```
test(harness): skeleton e2e test (Skeleton Red)
```

### Step 4: ★ TDD Green 阶段（commit 2 = 实现 + ARTIFACT 产物）

逐个 [BEHAVIOR] 对应的 `it()` 写实现。**禁止修改 `sprints/*/tests/` 下的任何文件**——测试是合同一部分，改测试 = 改合同 = 重走 GAN。

```bash
# 实现代码（让测试变绿）
# - 按 DoD.md 的 [ARTIFACT] 条目一一落实（Learning / 配置 / 文件等）
# - 按合同 BEHAVIOR 覆盖写最小实现让测试通过
# - 不加合同未提及的任何东西

# 每写一个模块就跑对应测试看绿，不整体跑直到都写完

# commit 2 必须含实现（禁止只含测试）；可含 Learning / docs / 配置等 ARTIFACT
git add <实现文件> docs/learnings/cp-*.md <配置文件>
git commit -m "feat(harness): ws${WS_IDX} implementation (Green)"
```

**硬约束**（CI 强校验）：

1. commit 1 之后，任何 commit 都**不许修改** `sprints/*/tests/**/*.test.ts`
2. commit 2+ 必须包含实现代码（`packages/` 或 `apps/` 目录变更），不能只改 docs
3. commit 1 message 含 `(Red)`，commit 2 message 含 `(Green)`

**Skeleton 模式**：`IS_SKELETON=true` 时：
- commit message 改为：`feat(harness): skeleton implementation (Skeleton Green)`
- 允许 stub 中间层（返回 hardcode），但每个 stub 必须有注释：`// SKELETON STUB — replaced in <task_id>`
- stub 的函数签名/接口必须与最终实现兼容，不得为了省事修改接口

### Step 5: ★ Verification 阶段（push 前必须实跑 + 贴证据）

**调用 skill: `superpowers:verification-before-completion`** — 禁止自己声称"测试通过"，必须贴 npm test 实际输出。

```bash
# 跑完整测试套件
npx vitest run "${SPRINT_DIR}/tests/ws${WS_IDX}/" --reporter=verbose 2>&1 | tee /tmp/green-evidence.txt

# 验证：
# - 原本红的测试现在必须绿
# - 无 skip / todo / xit
# - 无新增红
```

Test Evidence 要贴进 PR body 的 `## Test Evidence` 章节（Red → Green 对比）。

### Step 6: ★ Code Review 阶段（push 前调 subagent 审 diff）

**调用 skill: `superpowers:requesting-code-review`** — 调 review subagent 审 diff。

```bash
git diff origin/main...HEAD -- . ':!DoD.md' ':!docs/learnings/'
# subagent 返回 issues list（high/medium/low 分级）
# high → 修；medium → PR 里记录；low → 忽略
```

Review Summary 贴进 PR body。

### Step 6.5: ★ Contract Self-Verification（v6.1 新增 — push 前必须自跑合同 [BEHAVIOR] 全过）

**目的**：W19/W20/W21/W22 实证 generator 频繁推漂移实现给 evaluator 兜底，浪费 evaluator 跑 + retry 周期。本步骤强制 generator push 前自验所有 contract [BEHAVIOR] manual:bash 命令，**任一 FAIL 不准 push，必须自修**。

```bash
# 1. 提取 contract DoD 文件所有 [BEHAVIOR] Test: 命令
DOD_FILE="${SPRINT_DIR}/contract-dod-ws${WS_IDX}.md"
grep -E "^\s+Test: manual:" "$DOD_FILE" | sed 's/.*Test: manual://' > /tmp/contract-behavior-cmds.sh

CMD_COUNT=$(wc -l < /tmp/contract-behavior-cmds.sh | tr -d ' ')
echo "[contract-self-verify] 提取 $CMD_COUNT 条 [BEHAVIOR] manual:bash 命令"
[ "$CMD_COUNT" -lt 1 ] && { echo "ERROR: contract DoD 缺 [BEHAVIOR] manual: 命令，proposer 应该被 reviewer 第 7 维卡住，不该到 generator 阶段。请回头让 proposer 重写"; exit 1; }

# 2. 逐条真跑（用 bash -c 子 shell 执行，每条独立环境）
PASS_COUNT=0
FAIL_LOG=""
while IFS= read -r cmd; do
  echo "[contract-self-verify] 跑: $cmd"
  if bash -c "$cmd" 2>&1; then
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    FAIL_LOG="${FAIL_LOG}FAIL: $cmd\n"
  fi
done < /tmp/contract-behavior-cmds.sh

echo "[contract-self-verify] $PASS_COUNT / $CMD_COUNT PASS"

# 3. 任一 FAIL → 不准 push
if [ "$PASS_COUNT" -lt "$CMD_COUNT" ]; then
  echo "❌ Contract 自验未全过，禁止 push："
  echo -e "$FAIL_LOG"
  echo ""
  echo "下一步：检查实现是否漂移了 contract 字段名/HTTP code/error format。"
  echo "禁止改 contract 来迁就实现（违反 CONTRACT IS LAW）。"
  echo "禁止 push，自修后重新跑本 step。"
  exit 1
fi

echo "✅ Contract 自验全过，可以 push"
```

**核心规则**：
- generator 自验跟 evaluator 跑同一套 manual:bash 命令——所以"自验过 = evaluator 也会过"（除了环境差异）
- 自验失败 → 自修代码（不改 contract）
- 自修后重新跑 Step 6.5 直到全过
- **禁止跳过 Step 6.5 直接 push**（W19/W20/W21/W22 教训）

### Step 7: Push + PR

```bash
git push origin HEAD

PR_URL=$(gh pr create --title "feat(harness): ws${WS_IDX} — <目标>" --body "$(cat <<'PRBODY'
## Summary
<本 workstream 实现的功能>

## Test Evidence

### Red (commit 1)
\`\`\`
<贴 /tmp/red-evidence.txt 的摘要>
\`\`\`

### Green (commit 2+)
\`\`\`
<贴 /tmp/green-evidence.txt 的摘要>
\`\`\`

## Review Summary
<贴 subagent 的 high/medium issues 摘要>

## Learning
docs/learnings/cp-xxx-xxx.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
)" | tail -1)

echo "PR created: $PR_URL"
```

### Step 8: 输出 verdict JSON（⚠️ Brain 通过此提取 pr_url）

> **CRITICAL**: 最后一条消息必须是**纯 JSON**，禁止任何其他文字（不加 markdown、不加说明）。
> Brain 的 execution.js 依赖此 JSON 提取 pr_url 并创建 harness_ci_watch。

```
{"verdict": "DONE", "pr_url": "https://github.com/perfectuser21/cecelia/pull/xxxx"}
```

实际执行：

```bash
echo "{\"verdict\": \"DONE\", \"pr_url\": \"$PR_URL\"}"
```

输出这一行作为最后消息（纯 JSON，不加其他内容）。

---

## Mode 2: harness_fix（CI 失败 / Evaluator 反馈修复）

**调用 skill: `superpowers:systematic-debugging`** — 系统化调试：

1. 先读 `payload.ci_fail_context` 或 `eval-round-N.md` 定位真实失败原因
2. 如果现有测试不足以复现 → 写一个复现测试（**但仅限修复相关的新测试，禁止动合同原测试**）
3. 按 Red-Green-Refactor 修实现代码
4. 本地跑测试 + verification-before-completion 确认所有原有测试仍绿
5. push 到原 PR 分支（不创建新 PR）

```bash
# 切到 PR 分支
gh pr checkout <pr_number>

# systematic-debugging 流程
# ... 定位 → 复现 → 修 → 验证 ...

git add <修复文件>
git commit -m "fix(harness): <修复说明> (Green after fix)"
git push origin HEAD
```

**最后一条消息（纯 JSON，禁止其他文字）**：

```bash
echo "{\"verdict\": \"FIXED\", \"fixes\": [\"<Feature X: 修复说明>\"], \"pr_url\": \"$PR_URL\"}"
```

---

## Skeleton 模式规则（IS_SKELETON=true 时适用）

### 目标
让全链路 E2E 测试从 Red 变 Green。不要求完整实现，中间层允许 stub。

### Stub 规则（3 条，不可跳过）
1. **注释标记**：每个 stub 函数/返回值必须有注释 `// SKELETON STUB — replaced in <task_id>`（填写将替换该 stub 的 feature task 的 task_id）
2. **接口兼容**：stub 的函数签名、参数类型、返回结构必须和最终真实实现一致，不得因图省事而缩减接口
3. **禁止改测试**：从合同 checkout 的 E2E 测试文件绝对不可修改（同 TDD 铁律）

### Commit 结构（Skeleton Task）
```
commit 1: test(harness): skeleton e2e test (Skeleton Red)
  — 只含 E2E 测试文件（tests/ws0/skeleton.test.ts）+ DoD.md

commit 2: feat(harness): skeleton implementation (Skeleton Green)
  — stub 实现，让 E2E 通过
  — PR body 必须含 ## Stub 清单 section
```

### PR body 必须追加 Stub 清单（IS_SKELETON=true 时）
```markdown
## Stub 清单（Skeleton 阶段）

| 文件 | 函数/块 | stub 内容 | 由哪个 Task 替换 |
|------|---------|-----------|-----------------|
| packages/brain/src/xxx.js | `processFoo()` | 返回硬编码 `{status: 'ok'}` | task_id: ws2 |
```
（每一行对应一个 SKELETON STUB 注释，一一对应，不可遗漏）

---

## 禁止事项（严格）

1. **禁止自写 sprint-contract.md** —— 合同是上游 GAN 阶段产出，Generator 只读
2. **禁止加合同外内容** —— 安全阀/额外测试/顺手修复全不加；测试文件也是合同一部分
3. **禁止修改从合同 checkout 的测试文件** —— 测试一旦 commit 1 Red，就**不可改**（CI 强校验 git log：测试文件 diff 在 commit 2+ 里必须为空）
4. **禁止自判 PASS** —— Evaluator / CI 才是判官
5. **禁止在 main 分支操作**
6. **禁止广泛文件搜索** —— `find /Users`、`find /home` 或任何绝对路径搜索；只能在当前目录内（`find .`）

---

## 红旗（出现这些心态立刻停下）

| 想法 | 真相 |
|---|---|
| "测试写得太严，改一下让它能过" | 改测试 = 违反 CONTRACT IS LAW，push 时 CI 会抓 |
| "我知道 BEHAVIOR 应该是啥，不看测试直接写实现" | 违反 TDD Red-Green 顺序，commit 顺序检查会挂 |
| "先让一个测试过，其他等 CI 告诉我" | 违反 verification-before-completion，必须本地先全绿 |
| "合同写漏了一个功能，顺手加上" | 违反合同外不加，只能写进 PR description 上报 |
| "跑测试挺慢，跳过这一步吧" | 违反 verification-before-completion，禁止"看起来应该过了"的假设 |
