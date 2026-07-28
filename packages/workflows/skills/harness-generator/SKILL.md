---
id: harness-generator-skill
description: |
  Harness Generator — 严格合同执行者 × Superpowers 融合。
  读取 GAN 对抗已批准的 contract-draft.md + tests/*.test.ts + contract-dod.md，按 TDD 纪律两次 commit（commit 1 = 测试 Red / commit 2 = 实现 Green）。
  融入 4 个 superpowers：test-driven-development / verification-before-completion / systematic-debugging / requesting-code-review。
  CONTRACT IS LAW：合同里有的全实现，合同外一字不加；测试文件从合同原样复制，commit 1 后不可修改（由 evaluator CONTRACT-IS-LAW 与 judge 复核把关；CI 机械闸 lint-contract-test-immutability 落地后由其强制）。一个 Sprint = 一个 Generator = 一个 PR。
version: 7.13.0
created: 2026-04-08
updated: 2026-07-28
changelog:
  - 7.13.0: Fleet managed GitHub mutation declaration — provider 只提交绑定 frozen branch/HEAD 的 DONE/FIXED 声明，禁止取得 GitHub credential、push、建 PR 或轮询 CI；容器退出后由 Worker broker 校验并执行 force-with-lease push + draft PR
  - 7.12.0: Kernel raw result channel — DONE/FIXED/FAILED 三态显式 result 统一经 runner-owned writer；MAX_FIXES 用尽前固定 FAILED + FAILURE_REASON；channel version presence 判 managed，channel/file 均 unset 才保持 stdout-only
  - 7.11.0: gear 档位：Step 0 IS_SKELETON 检测旁新增 WORKSTREAM_INDEX 检测（移植自 cecelia #4027 harness-gear 一体化 60a80ddc 决策7）——segmented 档位下存在时只实现 task-plan.json 对应段的 scope/files，禁碰其他段实现文件；测试棋盘共享只许点绿禁改断言（CONTRACT IS LAW 不变）；TDD 两 commit 纪律照旧；default（未设置）保持现行整份 Sprint 一口气实现不变
  - 7.10.0: TDD 纪律新增「禁 mock 边执行规则」（刀2，配套 proposer 9.12.0）——合同 ## 禁 mock 边清单 列出的边，测试代码中 vi.mock/jest.mock/stub 命中即违约（CONTRACT IS LAW 的一部分，evaluator 机械 grep 核查，命中 = CONTRACT-IS-LAW FAIL）；需要真 PG 的测试按合同指定放 integration 命名/位置，CI 由 brain-integration job 起真 Postgres 跑
  - 7.9.0: EVA v2 审计五处修法 — G1 Red 阶段 relay 现实双分支（合同测试已随 contract import 存在则 Red commit=DoD.md+red-evidence 摘要，不重复 checkout；Red 验证按测试类型分派，.test.sh 合同逐个 bash 执行预期非零退出码即为红，替代 numTotalTests=0 即 exit 1 的死路）；G2 防事后补标（(Red) commit committer date 必须早于实现 commit）+ lint-tdd-commit-order 表述如实化（只校验文件序不校验标签顺序）；G3 新增 Step 6.7 push 前 CI 门禁自查（smoke 存在且登记/DoD 全勾/[BEHAVIOR] 测试覆盖，3827 实证）；G4 BEHIND 统一 gh pr update-branch，禁 merge commit 限定开工 rebase 阶段；G5 MAX_FIXES 用尽接线 Step 8 FAILED verdict + RELAY_STATUS BLOCKED
  - 7.8.0: 新增 Step 5.5 RPA 真机自验——碰 RPA 执行路径的 sprint 在 push 前必须经快验通道(POST /api/brain/rpa/dev-verify)在研发机真跑一次动作并把回执贴进 Test Evidence；根治 generator 盲写 RPA 代码(容器内 vitest 绿≠真机能跑)
  - 7.7.0: Step 6 Code Review 由「调 requesting-code-review 派 review subagent」改为「generator 内联自审 diff」（NESTED-SUB-AUDIT-20260705 F1/F2）——relay 下 generator 是 controller 的 sub，无 Task 工具不能再派 sub，原步骤静默跳过导致 push 前 code review 漏检进 PR；内联版按同一检查清单自审。Step 7 PR body 模板同步（F2）
  - 7.6.0: 追加「Relay 模式出口协议」（T5，additive）——被 harness-controller 派发时在报告末尾输出 RELAY_STATUS 四态；原 verdict JSON 一字不变（v1 LangGraph 双轨兼容；图路径 2026-07-05 起已废弃，relay 为唯一编排）
  - 7.5.0: 🚫 删除 Step 7.5 的 gh pr merge --auto 自合并 — generator 职责到 CI 全绿为止，merge 由 Brain mergePrNode 在 evaluator PASS 后执行；否则 evaluator pre-merge gate 被绕过（2026-06-11 PR #3342 实证：CI 绿即自动合并，evaluator 从未运行）。循环退出条件从 MERGED 改为 CI 全绿（保留 MERGED/CLOSED 容错出口）
  - 7.4.0: 链路审计修复 5 项 — (a) 回流「防照抄示例占位 PR URL」保护到 Step 8（含 verdict JSON schema 表 DONE/FIXED/FAILED 三态）；(b) Step 6.5 镜像注释改指向 evaluator 新增 Step B-1.6（名称引用，不写行号）；(c) Step 3 Red 验证从 grep 日志符号改为 `npx vitest run --reporter=json` 统计 failed/passed（确定性）；(d) Step 6.5 失败补「重试工作流」（修实现→commit→重跑，连续 3 轮仍 FAIL 标 [BEHAVIOR_FAIL] 并 push 交 evaluator）
  - 7.3.0: Step 6.5 加 localhost→host.docker.internal 替换逻辑（与 Evaluator 镜像，修复容器内 Brain API BEHAVIOR 命令必然超时 FAIL 的问题）
  - 7.2.0: 修 Bug 5 — 读合同文件名从 sprint-contract.md 改为 contract-draft.md（v8.x reviewer 不再做 cp 步骤）
  - 7.1.0: Step 6.5 补 windows_cloud 例外说明 — [BEHAVIOR] 必须 bash-executable；PowerShell 只在 contract-draft.md ## E2E 验收 区块
  - 7.0.0: 移除 Workstream 拆分 — 对齐 Anthropic 官方 v2 Harness 设计（一个 Sprint = 一个 Generator = 一个 PR）。删除 WORKSTREAM_INDEX/WORKSTREAM_COUNT 必要参数约束；测试目录从 tests/ws1/ 改为 tests/；DoD 文件从 contract-dod-ws1.md 改为 contract-dod.md；分支命名去掉 ws 后缀；移除多 ws 并行 rebase 说明
  - 6.3.0: 修字段名协议矛盾 — workstreams[].scope_files → tasks[].files（proposer SKILL v7.6+ 实际输出 schema 是 tasks[]，v6.2 段写错）
  - 6.2.0: 修协议盲 — Step 1 后加 task-plan.json 必读字段段（proposer GAN 收敛后输出，含 workstreams scope_files 白名单）
  - 6.1.0: 加 Step 6.5 Contract Self-Verification — push 前自跑 contract-dod.md 所有 [BEHAVIOR] manual:bash 命令，任一 FAIL 不准 push 必须自修
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

# /harness-generator — Harness Generator TDD 执行者（Superpowers 融合，单 Sprint）

**角色**: Generator（代码实现者，遵循 TDD Red-Green 纪律）
**对应 task_type**: `harness_generate` / `harness_fix`

---

## ⚠️ CONTRACT IS LAW

```
合同里有的：全部实现
合同里没有的：一个字不加
测试文件（从合同 checkout）：commit 1 后绝对不可修改，由 evaluator CONTRACT-IS-LAW 与 judge 复核把关；CI 机械闸 lint-contract-test-immutability 落地后由其强制
发现其他问题：写进 PR description，不实现
```

**禁 mock 边执行规则（v7.10 — CONTRACT IS LAW 的一部分，配套 proposer 9.12.0）**：合同 `## 禁 mock 边清单` 列出的每条边（模块A↔模块B、代码↔DB表X），测试代码中 `vi.mock` / `jest.mock` / stub **命中即违约**——清单里说「代码↔DB表X 禁 mock」，测试就必须真 Postgres 验真行落库，不许 mock pg/db 模块；清单里说「模块A↔模块B 禁 mock」，测试就必须真调 B，只允许 mock 更外层的无关依赖。evaluator 会机械 grep 测试文件的 mock 目标对照清单，命中 = CONTRACT-IS-LAW FAIL。需要真 PG 的测试放 integration 命名/位置（按合同指定），CI 由 brain-integration job 起真 Postgres 跑，不要因"vitest 单测环境没有 DB"而回退成 mock。

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

## Managed Kernel GitHub mutation override

当 `BRAIN_RESULT_CHANNEL_VERSION` 存在时，本次运行由 Fleet Worker 托管 GitHub
写操作。此规则覆盖本文后续所有 legacy push/PR/CI 轮询步骤：

- provider 容器禁止执行 `git push`、`gh pr create`、`gh pr view`、`gh pr checks`
  或任何 GitHub 写/读操作；禁止寻找 token、`~/.config/gh` 或其他宿主 credential。
- 只在 frozen `HARNESS_GITHUB_MUTATION_BRANCH` 上完成本地 commit。不得改 branch，
  不得改 remote，不得自行 rebase 到 frozen base 之外的提交。
- 完成本地 commit 后直接执行 Step 8 的唯一 writer 并结束；writer 会从 Git
  重新读取并绑定 frozen branch 与本地 HEAD。Worker 会在容器退出后校验 base、
  HEAD、allowed paths、
  secret、binary、symlink/submodule 和 remote lease，再执行 push 与 draft PR。
- `HARNESS_ATTEMPT_KIND=initial` 必须输出 `DONE`；
  `HARNESS_ATTEMPT_KIND=fix` 必须输出 `FIXED` 和非空 `FIXES_JSON`。
- managed 模式绝不创建 ready-for-review PR，绝不 merge，绝不等待 CI。

### Step 0: 解析任务上下文

Brain 在 prompt 头部注入：

```
TASK_ID={task_id}
SPRINT_DIR={sprint_dir}
CONTRACT_BRANCH={contract_branch}
PLANNER_BRANCH={planner_branch}
```

**CONTRACT_BRANCH / SPRINT_DIR / BRAIN_URL 任一未定义时绝对禁止继续。**

```bash
# 自检 — Brain dispatch 必须把这 3 个 env 都注入进来
for var in CONTRACT_BRANCH SPRINT_DIR BRAIN_URL; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: env $var 未定义 — Brain dispatch 协议失败 (harness-task-dispatch.js 应注入)" >&2
    # managed Kernel 不向 stdout 伪造 raw result；非零进程退出由 controller 处理。
    if [ "${BRAIN_RESULT_CHANNEL_VERSION+x}" != x ] && [ "${BRAIN_RESULT_FILE+x}" != x ]; then
      echo "{\"verdict\": \"ABORTED\", \"reason\": \"missing env $var\"}"
    fi
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

**WORKSTREAM_INDEX 检测（segmented 档位 — harness gear 一体化 60a80ddc 决策7）：**

```bash
WORKSTREAM_INDEX="${WORKSTREAM_INDEX:-}"
```

> **default 声明**：`WORKSTREAM_INDEX` 未设置时，本节不生效——按现行行为一口气实现 task-plan.json 唯一的 ws1（整个 Sprint）。以下规则仅在 `WORKSTREAM_INDEX` 存在时启用。

若 `WORKSTREAM_INDEX` 存在（如 `ws2`），进入 **段定向模式**：

- controller 已在 segmented 档位下按段串行派发，本次调用只负责 `task-plan.json` 的 `tasks[]` 中 `task_id == "${WORKSTREAM_INDEX}"` 这一段
- **只实现该段的 `scope` 与 `files`**——先读 `task-plan.json`（Step 1 已读的合同分支上，路径 `${SPRINT_DIR}/task-plan.json`），用 `jq -e --arg ws "$WORKSTREAM_INDEX" '.tasks[] | select(.task_id==$ws)'` 取出本段的 `scope`/`files`/`dod`
- **禁止碰其他段的实现文件**：`files[]` 白名单外的实现文件不得修改；其他段（尚未轮到或已完成）的实现文件即使在同一 PR 分支上可见，也不允许改动
- **测试棋盘共享，只许点绿不许改断言**：`${SPRINT_DIR}/tests/` 是骨架棒（`is_skeleton`）落下的全红棋盘，整个 segmented Sprint 共用一份；本段只能修改被测实现代码把本段对应的断言从 Red 变 Green，**禁止修改任何测试断言本身**（CONTRACT IS LAW 不变——测试文件 commit 1 后不可修改的铁律在 segmented 档位下同样成立，且跨段也不可改）
- **TDD 两 commit 纪律照旧**：本段仍是 Red→Green 两次 commit（commit 1 = 本段对应测试片段的红证据/DoD 更新，commit 2 = 本段实现让红变绿），不因段定向而合并成一次 commit
- 输出 verdict / RELAY_STATUS 时 `workstream_index` 字段回填 `${WORKSTREAM_INDEX}`，供 evaluator SEGMENT_EVAL 对齐

### Step 0.4: ★ git remote 验证（v6 P1-D）

entrypoint.sh 已自动重写 origin URL，但保险起见在容器内自检 — 如果仍是宿主绝对路径，所有 git fetch / push 都会挂 "does not appear to be a git repository"。

```bash
ORIGIN_URL=$(git remote get-url origin)
if [[ "$ORIGIN_URL" =~ ^/ ]]; then
  echo "ERROR: git remote 仍是宿主路径 $ORIGIN_URL — entrypoint 重写失败" >&2
  # managed Kernel 不向 stdout 伪造 raw result；非零进程退出由 controller 处理。
  if [ "${BRAIN_RESULT_CHANNEL_VERSION+x}" != x ] && [ "${BRAIN_RESULT_FILE+x}" != x ]; then
    echo "{\"verdict\": \"ABORTED\", \"reason\": \"git remote points to host filesystem path\"}"
  fi
  exit 1
fi
```

### Step 0.5: ★ MANDATORY PRE-FLIGHT — rebase 到最新 main

```bash
git fetch origin main
git rebase origin/main || {
  echo "ERROR: rebase 冲突 — 必须解决后才能继续"
  exit 1
}
git merge-base --is-ancestor origin/main HEAD || {
  echo "ERROR: rebase 后 HEAD 仍落后 origin/main，拒绝继续"
  exit 1
}
```

**禁止事项**：
- 禁止跳过 rebase 直接开工
- 禁止用 `git merge origin/main` 代替 rebase（会产生 merge commit 污染历史）——此禁令仅适用于**开工 rebase 阶段**；PR 阶段 BEHIND 用 `gh pr update-branch` 产生的 merge commit 不违规（EVA v2 G4）

### Step 1: 读合同 + 测试文件清单

```bash
git fetch origin "${CONTRACT_BRANCH}" 2>/dev/null || true

# 读合同（⚠️ harness::contract-filename 接口约定：文件名是 contract-draft.md，不是 sprint-contract.md）
git show "origin/${CONTRACT_BRANCH}:${SPRINT_DIR}/contract-draft.md"

# 读 DoD（[ARTIFACT] + [BEHAVIOR]）
git show "origin/${CONTRACT_BRANCH}:${SPRINT_DIR}/contract-dod.md"

# 列出测试文件
git ls-tree -r "origin/${CONTRACT_BRANCH}" -- "${SPRINT_DIR}/tests/"
```

**只读 contract-draft.md，CONTRACT IS LAW。**


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
BRANCH="cp-$(TZ=Asia/Shanghai date +%m%d%H%M)-${TASK_ID_SHORT}"

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
# EVA v2（G1）Red 双分支：先判合同测试是否已随 contract import 存在于当前分支
# 若合同 tests 已随 contract import（GAN 分支）存在于当前分支：Red commit = DoD.md + /tmp/red-evidence
# 摘要文件（记录合同测试执行输出），不再重复 checkout 测试文件——这是 relay 的常态（a85e0582 实证）
if [ -n "$(ls -A "${SPRINT_DIR}/tests/" 2>/dev/null)" ]; then
  TESTS_ALREADY_PRESENT=true
  echo "[red] 合同测试已随 contract import 存在于当前分支（relay 常态），不重复 checkout"
else
  TESTS_ALREADY_PRESENT=false
  # 从合同 branch 原样 checkout 测试文件（禁止修改）
  git checkout "origin/${CONTRACT_BRANCH}" -- "${SPRINT_DIR}/tests/"
fi

# 原样复制 DoD（contract-dod.md → DoD.md，加 contract 来源 header）
CONTRACT_DOD=$(git show "origin/${CONTRACT_BRANCH}:${SPRINT_DIR}/contract-dod.md")
cat > DoD.md << DODEOF
contract_branch: ${CONTRACT_BRANCH}
sprint_dir: ${SPRINT_DIR}

${CONTRACT_DOD}
DODEOF

# verify Red：跑测试看红（预期 FAIL，因实现还不存在）
# EVA v2（G1）：Red 验证按测试类型分派——.test.sh 合同不进 vitest（原 numTotalTests=0 就 exit 1 是死路）
: > /tmp/red-evidence.txt

# ① .test.ts / .test.js：走现有 vitest JSON 数值判定
# 用 --reporter=json 拿确定性统计，不 grep 日志里的 FAIL/✗/× 符号（受颜色码/语言/格式干扰，会误判）
TS_TESTS=$(find "${SPRINT_DIR}/tests/" \( -name "*.test.ts" -o -name "*.test.js" \) 2>/dev/null)
if [ -n "$TS_TESTS" ]; then
  npx vitest run "${SPRINT_DIR}/tests/" --reporter=json --outputFile=/tmp/red-report.json 2>&1 | tee -a /tmp/red-evidence.txt || true

  # 从 JSON 读 failed/passed/total（确定性）
  FAILED_RED=$(node -e "const r=require('/tmp/red-report.json');process.stdout.write(String(r.numFailedTests ?? 0))" 2>/dev/null || echo 0)
  PASSED_RED=$(node -e "const r=require('/tmp/red-report.json');process.stdout.write(String(r.numPassedTests ?? 0))" 2>/dev/null || echo 0)
  TOTAL_RED=$(node -e "const r=require('/tmp/red-report.json');process.stdout.write(String(r.numTotalTests ?? 0))" 2>/dev/null || echo 0)

  # Red 阶段：实现还不存在，所有测试都应 FAIL
  if [ "$TOTAL_RED" -eq 0 ]; then
    echo "ERROR: vitest numTotalTests=0 — 测试文件路径错或未被收集"
    exit 1
  fi
  if [ "$PASSED_RED" -gt 0 ]; then
    echo "ERROR: Red 阶段有 $PASSED_RED 个测试已通过（应全红）— 实现还没写就能过 = import 错或断言太弱"
    exit 1
  fi
  echo "Red 证据（vitest）：$FAILED_RED/$TOTAL_RED failed（全红，符合预期）" | tee -a /tmp/red-evidence.txt
fi

# ② .test.sh 合同（EVA v2：3845 实证 5 个里 4 个是 .sh）：逐个 bash 执行，预期非零退出码即为红
SH_TESTS=$(find "${SPRINT_DIR}/tests/" -name "*.test.sh" 2>/dev/null)
if [ -n "$SH_TESTS" ]; then
  for t in $SH_TESTS; do
    echo "[red] bash $t" >> /tmp/red-evidence.txt
    if bash "$t" >> /tmp/red-evidence.txt 2>&1; then
      echo "ERROR: Red 阶段 $t 退出码 0（应非零）— 实现还没写就能过 = 断言太弱或测试打错目标"
      exit 1
    fi
    echo "[red] $t 非零退出码（红，符合预期）" | tee -a /tmp/red-evidence.txt
  done
fi

# 两类测试都没有 → 才是真的收集失败
if [ -z "$TS_TESTS" ] && [ -z "$SH_TESTS" ]; then
  echo "ERROR: ${SPRINT_DIR}/tests/ 下未发现 .test.ts/.test.js/.test.sh 测试文件"
  exit 1
fi

# commit 1（Red）——按双分支（EVA v2 G1），先验红再 commit（红证据要进 commit）：
if [ "$TESTS_ALREADY_PRESENT" = "true" ]; then
  # relay 常态：测试文件已在分支上，Red commit = DoD.md + red-evidence 摘要（记录合同测试执行输出）
  head -80 /tmp/red-evidence.txt > "${SPRINT_DIR}/red-evidence.md"
  git add DoD.md "${SPRINT_DIR}/red-evidence.md"
else
  # commit 1 只能 touch：sprints/*/tests/** + DoD.md，禁含 packages/ apps/ 等实现目录
  git add "${SPRINT_DIR}/tests/" DoD.md
fi
git commit -m "test(harness): sprint failing tests (Red)"
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
git commit -m "feat(harness): sprint implementation (Green)"
```

**硬约束**：

1. commit 1 之后，任何 commit 都**不许修改** `sprints/*/tests/**/*.test.ts`（由 evaluator CONTRACT-IS-LAW 与 judge 复核把关；CI 机械闸 lint-contract-test-immutability 落地后由其强制）
2. commit 2+ 必须包含实现代码（`packages/` 或 `apps/` 目录变更），不能只改 docs
3. commit 1 message 含 `(Red)`，commit 2 message 含 `(Green)`
4. **（EVA v2 死规则）含 `(Red)` 的 commit 的 committer date 必须早于任何实现 commit；禁止实现完成后补一个标 `(Red)` 的标记 commit**（3845 实证漂移：Green 11:44 早于补标的 Red 11:47）
   > 如实说明：lint-tdd-commit-order 只校验文件序（test 文件先于 src），不校验 (Red)/(Green) 标签顺序，且存在同 commit 共存与 smoke.sh 计为测试先行两条可被穿透的豁免——标签顺序目前由 evaluator/judge 复核把关

**Skeleton 模式**：`IS_SKELETON=true` 时：
- commit message 改为：`feat(harness): skeleton implementation (Skeleton Green)`
- 允许 stub 中间层（返回 hardcode），但每个 stub 必须有注释：`// SKELETON STUB — replaced in <task_id>`
- stub 的函数签名/接口必须与最终实现兼容，不得为了省事修改接口

### Step 5: ★ Verification 阶段（push 前必须实跑 + 贴证据）

**调用 skill: `superpowers:verification-before-completion`** — 禁止自己声称"测试通过"，必须贴 npm test 实际输出。

```bash
# 跑完整测试套件
npx vitest run "${SPRINT_DIR}/tests/" --reporter=verbose 2>&1 | tee /tmp/green-evidence.txt

# 验证：
# - 原本红的测试现在必须绿
# - 无 skip / todo / xit
# - 无新增红
```

Test Evidence 要贴进 PR body 的 `## Test Evidence` 章节（Red → Green 对比）。

### Step 5.5: ★ RPA 代码真机自验（快验通道 dev-verify — target_environment=windows_wechat 等真机 RPA 必做）

**为什么**：RPA 代码的验收位置在真机（微信 UIA 几何/ADB/CDP），vitest 绿照不到那里——这正是历史上"盲写二十几轮"的根因。现在有了快验通道，容器里一条 curl 就能在研发机(ROG)真跑一次动作并同步拿回完整 stdout + exit_code，没有理由再盲交。

**判定是否适用**：本 sprint 改动碰了 RPA 执行路径（wechat-rpa/*.py、agent handlers、UIA/ADB/CDP 脚本）→ 必做；纯中台/UI/DB 代码 → 跳过本步。

```bash
# commit 2 之后、push 之前，至少真跑一次本次改动对应的动作：
curl -s -m 65 -X POST localhost:5221/api/brain/rpa/dev-verify \
  -H "Content-Type: application/json" \
  -d '{"line":"wechat","action":"<本次改动的白名单动作>","params":{...},"timeout_ms":30000}'
```

- 白名单动作（Agent 侧 DEV_VERIFY_WHITELIST，两端已对齐）：`health_check` / `wechat_private_chat_send` / `wechat_moments_send` / `wechat_qr_bind`；白名单外必拒（`action_not_allowed`），不要试图绕
- 回执读法：`ok:true` 且 `exit_code:0` = 真机执行成功，`stdout` 是脚本真实输出（按合同断言其内容）；`rejected:not_dev_machine` = 打到了生产机或研发机 env 未设，找 controller 报障而不是跳过；`error:agent_unreachable/timeout` = 通道故障，同样报障
- 回执（完整 JSON）贴进 PR body 的 `## Test Evidence`，与 vitest Green 证据并列——**没有真机回执的 RPA 类 PR，evaluator 按合同会直接 FAIL**

### Step 6: ★ Code Review 阶段（push 前内联自审 diff）

> **relay 铁律**：你（generator）是 controller 派出的 **sub-agent，没有 Task 工具，不能再派 sub**。因此这里**不调 `superpowers:requesting-code-review`（它会 dispatch 一个 review 子 agent，在 relay 下物理失效、静默跳过 → high 级问题漏检进 PR）**。改由你**自己内联**按 requesting-code-review 的检查清单审自己的 diff。

```bash
git diff origin/main...HEAD -- . ':!DoD.md' ':!docs/learnings/'
```

对上面 diff 逐条自审（requesting-code-review 检查清单内联版）：
- **正确性**：边界/空值/并发/错误路径是否处理；有没有把测试写宽松放水
- **安全**：凭据硬编码、SQL 注入、租户/权限缺失、日志泄密
- **可维护**：重复代码、命名、死代码、未用 import、遗留 console.log
- **测试**：新逻辑是否被合同测试真正覆盖（不是只加行数）

分级处理：**high → 当场修**（修完重跑 Step 3/6.5 验证）；**medium → 记进 PR body 的 Review Summary**；**low → 忽略**。自审结论（含 high 修了什么 / medium 遗留项）写进 PR body。

### Step 6.5: ★ Contract Self-Verification（v6.1 新增 — push 前必须自跑合同 [BEHAVIOR] 全过）

**目的**：W19/W20/W21/W22 实证 generator 频繁推漂移实现给 evaluator 兜底，浪费 evaluator 跑 + retry 周期。本步骤强制 generator push 前自验所有 contract [BEHAVIOR] manual:bash 命令，**任一 FAIL 不准 push，必须自修**。

```bash
# 1. 提取 contract DoD 文件所有 [BEHAVIOR] Test: 命令
DOD_FILE="${SPRINT_DIR}/contract-dod.md"
grep -E "^\s*Test: manual:" "$DOD_FILE" | sed 's/.*Test: manual://' > /tmp/contract-behavior-cmds.sh

CMD_COUNT=$(wc -l < /tmp/contract-behavior-cmds.sh | tr -d ' ')
echo "[contract-self-verify] 提取 $CMD_COUNT 条 [BEHAVIOR] manual:bash 命令"
[ "$CMD_COUNT" -lt 1 ] && { echo "ERROR: contract DoD 缺 [BEHAVIOR] manual: 命令，proposer 应该被 reviewer 第 7 维卡住，不该到 generator 阶段。请回头让 proposer 重写"; exit 1; }

# 2. 逐条真跑（用 bash -c 子 shell 执行，每条独立环境）
PASS_COUNT=0
FAIL_LOG=""
while IFS= read -r cmd; do
  # 容器内 localhost→host.docker.internal 替换（与 evaluator Step B-1.6「环境预检 + localhost 重写」镜像）
  if [ -n "$BRAIN_URL" ] && [ "$BRAIN_URL" != "http://localhost:5221" ]; then
    BRAIN_HOST_PORT=$(echo "$BRAIN_URL" | sed "s|http://||")
    cmd=$(echo "$cmd" | sed "s|localhost:5221|$BRAIN_HOST_PORT|g")
  fi
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
- 注意：替换逻辑与 evaluator Step B-1.6「环境预检 + localhost 重写」镜像，保证 Generator 自验环境与 Evaluator 执行环境行为一致。
- generator 自验跟 evaluator 跑同一套 manual:bash 命令——所以"自验过 = evaluator 也会过"（除了环境差异）
- 自验失败 → 自修代码（不改 contract）
- 自修后重新跑 Step 6.5 直到全过
- **禁止跳过 Step 6.5 直接 push**（W19/W20/W21/W22 教训）

**windows_cloud target 例外说明**：
- contract-dod.md 里的 `[BEHAVIOR]` 条目必须是 **bash-executable**（curl/psql/jq 等 API-level 检查），generator 在 Linux Docker 里跑这些没问题
- PowerShell / Windows 专属命令只写在 contract-draft.md 的 `## E2E 验收` 区块里，供 evaluator 触发 GHA workflow 时使用
- 如果自验时发现 [BEHAVIOR] 里有 PowerShell 命令 → 这是 proposer 写错了（应在 E2E 区块），告知 generator 无法在本地验证、标 `[CI_GAP]` 并 push，让 evaluator 的 windows_cloud Mode B 去跑

**Step 6.5 失败重试工作流（FAIL 时必走，禁止直接放弃或改测试）**：

```
自验 FAIL
   ↓
修「实现代码」让 manual:bash 过（禁改 contract、禁改 sprints/*/tests/ 测试文件）
   ↓
git commit -m "fix(harness): 修实现让 contract 自验过 (Green after fix)"
   ↓
重跑 Step 6.5
   ↓
过 → 进 Step 7 push；仍 FAIL → 计数 +1，回到「修实现代码」
   ↓
连续 3 轮仍 FAIL（ROUND≥3）→ 不再死磕：
   - PR description 顶部标 [BEHAVIOR_FAIL]，列出仍失败的 manual:bash 命令 + 实际输出
   - 正常 push（不阻塞），交 evaluator 处理（evaluator 是判官，generator 不自判 PASS）
```

```bash
SELFVERIFY_ROUND_FILE="/tmp/generator-selfverify-round-${TASK_ID:-x}"
ROUND=$(cat "$SELFVERIFY_ROUND_FILE" 2>/dev/null || echo 0)
# ...（每次 Step 6.5 FAIL 后）
ROUND=$((ROUND+1)); echo "$ROUND" > "$SELFVERIFY_ROUND_FILE"
if [ "$ROUND" -ge 3 ]; then
  echo "⚠️ Step 6.5 连续 $ROUND 轮 FAIL，标 [BEHAVIOR_FAIL] 并 push 交 evaluator"
  # 在 PR body 顶部加 [BEHAVIOR_FAIL] 段（列出失败命令 + 输出），然后正常走 Step 7
fi
```

**死规则**：重试期间**只能改实现代码**，绝不允许改 contract / 改测试文件来迁就（违反 CONTRACT IS LAW，测试文件不可改由 evaluator CONTRACT-IS-LAW 与 judge 复核把关；CI 机械闸 lint-contract-test-immutability 落地后由其强制）。

### Step 6.7: ★ push 前 CI 门禁自查（EVA v2：3827 实证缺这步多烧 2 个 fix commit）

**目的**：把 CI 必挂项左移到 push 前自查。以下三条任一缺 → 补完（补 smoke / 勾 DoD / 补测试映射）再 push，禁止带着已知 CI 必挂项 push。

```bash
# ① smoke 脚本存在且登记（按 base_repo 分派）
FEATURE=<本 sprint 的 feature 名>
if [ -d packages/brain ]; then
  # cecelia
  test -f "packages/brain/scripts/smoke/${FEATURE}-smoke.sh" \
    || echo "❌ 缺 smoke 脚本：packages/brain/scripts/smoke/${FEATURE}-smoke.sh"
  grep -q "${FEATURE}-smoke.sh" packages/quality/smoke-allowlist.txt \
    || echo "❌ smoke 未登记：packages/quality/smoke-allowlist.txt"
else
  # zenithjoy
  test -f ".github/workflows/scripts/smoke/${FEATURE}-smoke.sh" \
    || echo "❌ 缺 smoke 脚本：.github/workflows/scripts/smoke/${FEATURE}-smoke.sh"
  grep -q "${FEATURE}-smoke.sh" smoke-baseline.txt \
    || echo "❌ smoke 未登记：smoke-baseline.txt"
fi

# ② DoD 条目全部 [x]（存在未勾 [ ] 条目 = 不许 push）
! grep -q '\- \[ \]' "${SPRINT_DIR}/contract-dod.md" || { echo "❌ DoD 有未勾 [ ] 条目"; exit 1; }

# ③ [BEHAVIOR] 覆盖：每条 [BEHAVIOR] 的覆盖文本必须能与测试 it()/文件名子串匹配
grep -oE '\[BEHAVIOR\][^|]*' "${SPRINT_DIR}/contract-dod.md" | while read -r b; do
  KEY=$(echo "$b" | sed 's/\[BEHAVIOR\]//' | awk '{print $1}')
  grep -rq "$KEY" "${SPRINT_DIR}/tests/" || echo "❌ [BEHAVIOR] 未见测试覆盖：$b"
done
```

**规则**：出现任何 ❌ → 不准 push，补完对应项后重跑本 step 直到无 ❌（EVA v2：3827 实证缺这步多烧 2 个 fix commit）。

### Step 7: Push + PR

```bash
git push origin HEAD

PR_URL=$(gh pr create --title "feat(harness): <Sprint 目标>" --body "$(cat <<'PRBODY'
## Summary
<本 Sprint 实现的完整功能>

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
<贴 Step 6 内联自审的 high（已修）/medium（遗留）issues 摘要>

## Learning
docs/learnings/cp-xxx-xxx.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PRBODY
)" | tail -1)

echo "PR created: $PR_URL"
```

### Step 7.5: 轮询 CI 到全绿（PR 创建后立刻执行，不退出；禁止 merge）

PR 创建完不退出，原地轮询直到 **CI 全绿**，然后进 Step 8 输出 verdict。

> **🚫 红线（v7.5.0）：generator 禁止执行任何 `gh pr merge`（含 `--auto`）。**
> merge 是 Brain `mergePrNode` 在 **evaluator PASS 之后**的职责。generator 自行 merge =
> 绕过 evaluator pre-merge gate（"evaluator 不 PASS，main 不变动"被破坏）。
> 实证：2026-06-11 PR #3342 被 generator 的 `--auto` 在 CI 绿后自动合并，evaluator 从未运行。

```bash
# 从 PR_URL 提取 PR 号
PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$')
REPO=$(echo "$PR_URL" | grep -oE 'github\.com/[^/]+/[^/]+' | sed 's|github.com/||')
MAX_FIXES=3
# FIX_COUNT 持久化到文件，防止 Bash timeout 重调用后计数归零
FIX_COUNT_FILE="/tmp/generator-fix-count-${PR_NUMBER}"
FIX_COUNT=$(cat "$FIX_COUNT_FILE" 2>/dev/null || echo 0)

while true; do
  STATE=$(gh pr view "$PR_NUMBER" --repo "$REPO" --json state --jq '.state' 2>/dev/null)
  # 容错出口：恢复场景下 PR 可能已被 mergePrNode 合并/人工关闭
  [ "$STATE" = "MERGED" ] && { echo "PR #$PR_NUMBER already merged (by mergePrNode)"; rm -f "$FIX_COUNT_FILE"; break; }
  [ "$STATE" = "CLOSED" ] && { echo "PR #$PR_NUMBER closed"; break; }

  CHECKS=$(gh pr checks "$PR_NUMBER" --repo "$REPO" 2>/dev/null)
  FAILED=$(echo "$CHECKS" | grep -c "fail" 2>/dev/null || echo 0)
  PENDING=$(echo "$CHECKS" | grep -cE "pending|in_progress|queued" 2>/dev/null || echo 0)
  MERGE_STATE=$(gh pr view "$PR_NUMBER" --repo "$REPO" --json mergeStateStatus --jq '.mergeStateStatus' 2>/dev/null)

  if [ "$FAILED" -gt 0 ]; then
    if [ "$FIX_COUNT" -ge "$MAX_FIXES" ]; then
      echo "CI failed $MAX_FIXES times, giving up"
      rm -f "$FIX_COUNT_FILE"
      # 必须在 break 前固定 Step 8 输入；否则默认值会把失败误报成 DONE。
      GENERATOR_VERDICT=FAILED
      FAILURE_REASON="CI remained red after ${MAX_FIXES} repair attempts: $(printf '%s' "$CHECKS" | tail -5 | tr '\n' ';' | cut -c1-2000)"
      RELAY_STATUS=BLOCKED
      export GENERATOR_VERDICT FAILURE_REASON RELAY_STATUS
      break
    fi
    FIX_COUNT=$((FIX_COUNT+1))
    echo "$FIX_COUNT" > "$FIX_COUNT_FILE"
    # CI 失败 → 读日志修复
    RUN_ID=$(gh pr checks "$PR_NUMBER" --repo "$REPO" --json name,conclusion,databaseId 2>/dev/null \
      | jq -r '[.[] | select(.conclusion=="failure")] | sort_by(.databaseId) | last | .databaseId // empty')
    echo "CI failed (attempt $FIX_COUNT), reading logs..."
    gh run view "$RUN_ID" --repo "$REPO" --log-failed 2>/dev/null | tail -100
    # 分析日志 → 在 worktree 里修复 → git commit + push
    # （根据日志内容直接修复，此处为 Claude 的内联操作，不另起 session）
    continue
  fi

  [ "$MERGE_STATE" = "BEHIND" ] && {
    # EVA v2（G4）：BEHIND 统一走 gh pr update-branch（与 controller 实践/全局规范对齐），
    # 不再本地 rebase + force-with-lease push
    echo "branch behind main, update-branch..."
    gh pr update-branch "$PR_NUMBER" --repo "$REPO"
    continue
  }

  if [ "$FAILED" -eq 0 ] && [ "$PENDING" -eq 0 ]; then
    echo "CI 全绿，generator 任务完成（merge 交给 evaluator PASS 后的 mergePrNode）"
    rm -f "$FIX_COUNT_FILE"
    break
  fi

  echo "$(TZ=Asia/Shanghai date '+%H:%M:%S') OPEN | pending=$PENDING fail=$FAILED | $MERGE_STATE"
  sleep 30
done
```

> **说明**：Bash 工具单次 timeout 上限 600000ms（10 分钟）。超时后立刻重新发 Bash 调用继续轮询，不输出任何文字，不结束 turn。直到 CI 全绿为止。

> **EVA v2（G5）MAX_FIXES 用尽出口（死规则）**：CI 修复 3 次用尽走到 `giving up` 分支后，禁止静默结束——**立即执行 Step 8**，输出 `{"verdict":"FAILED","pr_url":"<url>","reason":"<最后一轮 CI 失败摘要>"}`；relay 模式下报告末尾输出 `RELAY_STATUS: BLOCKED`。消除 break 后的流程真空。

### Step 8: 提交 raw verdict JSON（CI 全绿后执行）

> `BRAIN_RESULT_CHANNEL_VERSION` 存在时是 managed Kernel，空值/未知值或缺
> result file 均 fail closed；channel version unset 但 `BRAIN_RESULT_FILE`
> 存在时是 headed/relay override，仍经中央 helper 原子写。两者都 unset 才
> 保持最后一条消息 stdout-only 的旧行为。

**verdict JSON schema（三态，各自必带字段）**：

| verdict | 用于 | 必带字段 | 说明 |
|---|---|---|---|
| `DONE` | Mode 1 首次实现成功 push + CI 全绿（未 merge，merge 由 mergePrNode 做）| `verdict`, `pr_url` | `pr_url` 必须是真实 URL（见下方占位符红线）|
| `FIXED` | Mode 2 harness_fix 修复后 push | `verdict`, `pr_url`, `fixes`（修复说明数组）| 在原 PR 分支修复，不新建 PR |
| `FAILED` | 连续 3 轮自验/CI 仍 FAIL，放弃 | `verdict`, `pr_url`, `reason`（失败根因）| PR body 已标 [BEHAVIOR_FAIL]，交 evaluator/人处理 |

```bash
# generator-result-writer:start
if [ "${BRAIN_RESULT_CHANNEL_VERSION+x}" = x ]; then
  MANAGED_GENERATOR_BRANCH="$(git branch --show-current)"
  [ "$MANAGED_GENERATOR_BRANCH" = "${HARNESS_GITHUB_MUTATION_BRANCH:?frozen mutation branch required}" ] \
    || { echo "frozen mutation branch mismatch" >&2; exit 1; }
  MANAGED_GENERATOR_HEAD_SHA="$(git rev-parse HEAD)"
  [[ "$MANAGED_GENERATOR_HEAD_SHA" =~ ^[a-f0-9]{40}$ ]] \
    || { echo "invalid local HEAD" >&2; exit 1; }
  case "${GENERATOR_VERDICT:-DONE}" in
    DONE)
      RAW_RESULT_JSON=$(jq -cn \
        --arg branch "$MANAGED_GENERATOR_BRANCH" \
        --arg head_sha "$MANAGED_GENERATOR_HEAD_SHA" \
        '{contract_version:"github-mutation-declaration/v1",verdict:"DONE",branch:$branch,head_sha:$head_sha}')
      ;;
    FIXED)
      jq -e 'type == "array" and length > 0' <<<"${FIXES_JSON:?non-empty fixes array required}" >/dev/null
      RAW_RESULT_JSON=$(jq -cn \
        --arg branch "$MANAGED_GENERATOR_BRANCH" \
        --arg head_sha "$MANAGED_GENERATOR_HEAD_SHA" \
        --argjson fixes "$FIXES_JSON" \
        '{contract_version:"github-mutation-declaration/v1",verdict:"FIXED",branch:$branch,head_sha:$head_sha,fixes:$fixes}')
      ;;
    *)
      echo "managed generator requires DONE or FIXED mutation declaration" >&2
      exit 1
      ;;
  esac
else
  case "${GENERATOR_VERDICT:-DONE}" in
    DONE)
      RAW_RESULT_JSON=$(jq -cn --arg pr_url "$PR_URL" \
        '{verdict:"DONE",pr_url:$pr_url}')
      ;;
    FIXED)
      jq -e 'type == "array" and length > 0' <<<"${FIXES_JSON:?non-empty fixes array required}" >/dev/null
      RAW_RESULT_JSON=$(jq -cn --arg pr_url "$PR_URL" \
        --argjson fixes "$FIXES_JSON" \
        '{verdict:"FIXED",pr_url:$pr_url,fixes:$fixes}')
      ;;
    FAILED)
      RAW_RESULT_JSON=$(jq -cn --arg pr_url "$PR_URL" \
        --arg reason "${FAILURE_REASON:?failure reason required}" \
        '{verdict:"FAILED",pr_url:$pr_url,reason:$reason}')
      ;;
    *)
      echo "invalid GENERATOR_VERDICT" >&2
      exit 1
      ;;
  esac
fi
if [ "${BRAIN_RESULT_CHANNEL_VERSION+x}" = x ] || [ "${BRAIN_RESULT_FILE+x}" = x ]; then
  printf '%s' "$RAW_RESULT_JSON" | node /usr/local/bin/raw-result-writer.cjs
else
  printf '%s\n' "$RAW_RESULT_JSON"
fi
# generator-result-writer:end
```

先设置 `GENERATOR_VERDICT` 及对应字段，再执行上面的唯一 writer。

> 🚫 **严禁照抄示例占位 URL**：任何含 `x/y`、`OWNER/REPO`、`org/repo`、`pull/123` 的 URL 都是占位符，原样输出会让 Brain 报 `generator_pr_not_found`、整条 harness 线作废。`pr_url` 必须取自你刚 `gh pr create` 实际返回的 `$PR_URL`（或 `gh pr view --json url -q .url`），不是从本文档示例里复制的字面值。

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

**最终提交**：设置 `GENERATOR_VERDICT=FIXED`，把真实修复说明放进非空
`FIXES_JSON` 数组，然后执行 Step 8 的唯一 writer。

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

1. **禁止自写 contract-draft.md** —— 合同是上游 GAN 阶段产出，Generator 只读
2. **禁止加合同外内容** —— 安全阀/额外测试/顺手修复全不加；测试文件也是合同一部分
3. **禁止修改从合同 checkout 的测试文件** —— 测试一旦 commit 1 Red，就**不可改**（由 evaluator CONTRACT-IS-LAW 与 judge 复核把关；CI 机械闸 lint-contract-test-immutability 落地后由其强制）
4. **禁止自判 PASS** —— Evaluator / CI 才是判官
5. **禁止在 main 分支操作**
6. **禁止广泛文件搜索** —— `find /Users`、`find /home` 或任何绝对路径搜索；只能在当前目录内（`find .`）

---

## 红旗（出现这些心态立刻停下）

| 想法 | 真相 |
|---|---|
| "测试写得太严，改一下让它能过" | 改测试 = 违反 CONTRACT IS LAW，push 时 CI 会抓 |
| "我知道 BEHAVIOR 应该是啥，不看测试直接写实现" | 违反 TDD Red-Green 顺序，evaluator/judge 复核会抓（lint-tdd-commit-order 只校验文件序，不校验标签顺序——EVA v2）|
| "先让一个测试过，其他等 CI 告诉我" | 违反 verification-before-completion，必须本地先全绿 |
| "合同写漏了一个功能，顺手加上" | 违反合同外不加，只能写进 PR description 上报 |
| "跑测试挺慢，跳过这一步吧" | 违反 verification-before-completion，禁止"看起来应该过了"的假设 |

# GREEN commit 前真验：见 Step 6.5 Contract Self-Verification（v6.1+）


---

## Relay 模式出口协议（T5，harness-controller 派发时生效）

当你是 harness-controller 的 subagent（派发 prompt 声明"按 Relay 出口协议报告"）时：
**上面所有流程与 verdict JSON 输出一字不变**（双轨期 v1 图仍消费原 JSON），只在报告最末尾追加一行：

```
RELAY_STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
```

| 状态 | 何时用 | 必须附带 |
|---|---|---|
| DONE | 完成且验收证据齐（PR 存在/Red-Green/自验过） | pr_url + 两个 commit SHA |
| DONE_WITH_CONCERNS | 完成但有疑虑（如 [BEHAVIOR_FAIL] 标记 push、文件超 500 行） | 疑虑清单 |
| NEEDS_CONTEXT | 缺信息无法开工/继续 | 确切缺什么（controller 补料后原模型重派） |
| BLOCKED | 干不了 | 原因分类：缺上下文 / 需更强推理 / 任务太大该拆 / 合同本身错该上报 |

**铁律**：卡住绝不静默原地重试——报 BLOCKED 让 controller 改变某样东西（补料/换模型/拆任务），这是"绝不让同一 agent 无变化重试"协议的工人侧义务。
