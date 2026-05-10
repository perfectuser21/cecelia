# Sprint Contract Draft (Round 3)

**Initiative**: W8 LangGraph v18 真端到端验证
**Initiative Task ID**: 98aef732-ce7d-4469-a156-fddbf7df4747
**journey_type**: autonomous

---

## Round 3 修订摘要（回应 Reviewer Round 2 五条 Risk）

| Reviewer Risk | Round 2 状态 | Round 3 修订位置 |
|---|---|---|
| 1. child PRD 由 Proposer 现写可能漏 DoD 命令 | 仅口头描述 | 合同附录 §A 固化 **Child PRD 模板**（三段：场景描述 / Golden Path / DoD 命令清单），WS1 强制按模板落盘 `sprints/w8-langgraph-v18/child-prd.md`；新增 ARTIFACT 校验三段 heading |
| 2. PR title 关联子↔父不可靠（用户可改 title） | 仅写"通过 PR title 找父 Initiative" | 子 Initiative 创建 body 必须含 `metadata.parent_initiative_id="$TASK_ID"`；Step 1 + E2E 改为查 `metadata.parent_initiative_id` 字段，PR title 仅作辅助 |
| 3. 子 Initiative PR 可能未 merge → 父无 diff 验收 | 只校验 HTTP 200 | Step 3 (c) 增加 `gh pr view --json state` 必须 `MERGED`，否则 BLOCKED；新增 `gh pr view --json commits` 校验 commit message 含 `child_initiative_id` 前 8 位 |
| 4. STDOUT_FILE 缺失 → §8 仅 WARN，可能放过真实失败 | E2E §8 缺失即降级 WARN | WS1 Step 1 反查 STDOUT_FILE 路径并写入报告 frontmatter `stdout_file:`；E2E §8 改从 frontmatter 取，缺失或不存在即 **FAIL exit 1**（去掉 else 的 stderr WARN） |
| 5. Cascade 失败：仅 Planner completed 其余 4h 未推进 | Step 2 仅卡 ≥4 类完成 | Step 2 注释补一段 cascade 风险说明：若 Planner completed 其余 in_progress 超 4h，evaluator 按 BLOCKED 处理（不重试不强行通过），与 risk 2 同处理路径 |

---

## Golden Path

[本 Sprint Generator 容器内 POST /api/brain/tasks 创建一个最小子 `harness_initiative`，请求体 metadata 中写入父 ID]
→ [Brain LangGraph 全程自主跑完 Planner → Proposer GAN → Generator → Evaluator → Reporter，全程容器化、调真账户、真 GitHub PR 并 **MERGED**]
→ [子 Initiative `tasks` 行 `status='completed'`、`result.evaluator_verdict='APPROVED'`、`result.pr_url` 为已 MERGED 的真实 GitHub PR、`result.report_path` 文件落地，且子任务全部 completed、Brain stdout 无已知失败模式]
→ [本 Sprint Generator 把上述全部观测钉死在 `sprints/w8-langgraph-v18/harness-report.md` 的 frontmatter (`child_initiative_id` + `parent_initiative_id` + `stdout_file`) + 5 个章节 + `child-prd.md` 模板存证中]

---

### Step 1: Generator 触发一个最小子 Initiative（含 metadata.parent_initiative_id + child PRD 模板存证）

**可观测行为**: 在 Brain `tasks` 表中新增一行 `task_type='harness_initiative'` 子任务，其 `metadata.parent_initiative_id` 严格等于本 Sprint 父 Initiative ID（`$TASK_ID`）；其 id 写入 `sprints/w8-langgraph-v18/harness-report.md` frontmatter `child_initiative_id` 字段；同时 frontmatter `parent_initiative_id` = `$TASK_ID`、`stdout_file` 指向 Brain 主进程实际写 stdout 的路径；同时 `sprints/w8-langgraph-v18/child-prd.md` 落盘且含三段 heading（见附录 §A 模板）；Brain API 能立即查到该任务（status ∈ {queued, in_progress, completed}）。

**验证命令**:
```bash
SPRINT_DIR="${SPRINT_DIR:-sprints/w8-langgraph-v18}"
REPORT="${SPRINT_DIR}/harness-report.md"
PARENT_ID="${TASK_ID:?TASK_ID 未注入}"

# (a) 报告 frontmatter 必含三个关键字段，且 child_initiative_id 是合法 UUID v4
INIT_ID=$(awk '/^child_initiative_id:/ {print $2}' "$REPORT")
PARENT_FROM_REPORT=$(awk '/^parent_initiative_id:/ {print $2}' "$REPORT")
STDOUT_PATH=$(awk '/^stdout_file:/ {print $2}' "$REPORT")
[[ "$INIT_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] \
  || { echo "FAIL: child_initiative_id 缺失或非 UUID v4 (实际=$INIT_ID)"; exit 1; }
[ "$PARENT_FROM_REPORT" = "$PARENT_ID" ] \
  || { echo "FAIL: 报告 parent_initiative_id=$PARENT_FROM_REPORT 与父 TASK_ID=$PARENT_ID 不一致"; exit 1; }
[ -n "$STDOUT_PATH" ] && [ -f "$STDOUT_PATH" ] \
  || { echo "FAIL: 报告 stdout_file 缺失或文件不存在 (实际=$STDOUT_PATH)"; exit 1; }

# (b) Brain DB 端：子任务存在 + task_type 正确 + metadata.parent_initiative_id == $TASK_ID（核心 risk 2 mitigation）
curl -fsS "localhost:5221/api/brain/tasks/${INIT_ID}" \
  | jq -e --arg pid "$PARENT_ID" '
      .task_type == "harness_initiative"
      and (.status | IN("queued","in_progress","completed"))
      and (.metadata.parent_initiative_id == $pid)
    ' >/dev/null \
  || { echo "FAIL: 子 Initiative DB 行不满足 (task_type/status/metadata.parent_initiative_id) 三件套"; exit 1; }

# (c) child PRD 模板存证（risk 1 mitigation）— 三段 heading 必须齐全
CHILD_PRD="${SPRINT_DIR}/child-prd.md"
[ -f "$CHILD_PRD" ] || { echo "FAIL: child-prd.md 未落盘"; exit 1; }
grep -q '^## 场景描述' "$CHILD_PRD"        || { echo "FAIL: child-prd 缺 '## 场景描述' 段"; exit 1; }
grep -q '^## Golden Path' "$CHILD_PRD"     || { echo "FAIL: child-prd 缺 '## Golden Path' 段"; exit 1; }
grep -q '^## DoD 命令清单' "$CHILD_PRD"    || { echo "FAIL: child-prd 缺 '## DoD 命令清单' 段"; exit 1; }
# DoD 命令清单段必含 ≥1 行 ```bash 代码块（强制可执行命令而非空模板）
awk '/^## DoD 命令清单/,/^## /' "$CHILD_PRD" | grep -q '^```bash' \
  || { echo "FAIL: child-prd DoD 命令清单段无 \`\`\`bash 代码块（不可执行）"; exit 1; }
```

**硬阈值**:
- (a) 报告 frontmatter 三字段齐全：`child_initiative_id` 合法 UUID v4 / `parent_initiative_id` 严格等于 `$TASK_ID` / `stdout_file` 指向真实存在的文件
- (b) Brain DB 中子任务 `task_type='harness_initiative'` AND `status ∈ {queued,in_progress,completed}` AND `metadata.parent_initiative_id == $TASK_ID`（PR title 不参与判断）
- (c) `child-prd.md` 存在且严格含三段 heading（`## 场景描述` / `## Golden Path` / `## DoD 命令清单`），且 DoD 段含 ≥1 个 `\`\`\`bash` 代码块

> **GAN 防造假说明**：
> - `metadata.parent_initiative_id == $TASK_ID` 锁死亲子关系，绕开"用户改 PR title 即丢失关联"
> - `stdout_file` 在 frontmatter 而非环境变量，evaluator 不依赖运行时 env，本地 / CI / 跨容器复跑结果一致
> - child PRD 强制三段 + bash 代码块，阻止 Generator 写一份空模板凑数

---

### Step 2: Brain LangGraph 自主跑完 5 个节点，无人工干预、无已知失败模式、无 cascade 死锁

**可观测行为**: 子 Initiative 派生出 ≥4 类 `harness_*` 子任务（覆盖 `harness_planner` / `harness_contract_propose` / `harness_generate` / `harness_evaluate` / `harness_report` 至少 4 个），且这些子任务全部 `status='completed'`，无 `failed` / `stuck`；Brain stdout（`stdout_file` frontmatter 字段）未出现已知失败关键词（`PROBE_FAIL_*` / `BREAKER_OPEN` / `WORKTREE_KEY_COLLISION` / `STDOUT_LOST` / `EVALUATOR_DOD_NOT_FOUND`）。

**验证命令**:
```bash
SPRINT_DIR="${SPRINT_DIR:-sprints/w8-langgraph-v18}"
DB="${DB_URL:-postgresql://localhost/cecelia}"
REPORT="${SPRINT_DIR}/harness-report.md"
INIT_ID=$(awk '/^child_initiative_id:/ {print $2}' "$REPORT")

# (a) 时间窗口防造假：6 小时内派生且 completed 的不同 task_type ≥4
COMPLETED_TYPES=$(psql "$DB" -tAc "SELECT count(DISTINCT task_type) FROM tasks WHERE parent_task_id='${INIT_ID}' AND status='completed' AND created_at > NOW() - interval '6 hours' AND task_type LIKE 'harness\\_%'")
[ "${COMPLETED_TYPES:-0}" -ge 4 ] || { echo "FAIL: 6h 内 completed harness_* task_type 仅 $COMPLETED_TYPES (<4)"; exit 1; }

# (b) 不允许任何 failed / stuck 子任务
FAILED=$(psql "$DB" -tAc "SELECT count(*) FROM tasks WHERE parent_task_id='${INIT_ID}' AND status IN ('failed','stuck')")
[ "${FAILED:-1}" -eq 0 ] || { echo "FAIL: 失败/卡死子任务=$FAILED"; exit 1; }

# (c) Brain stdout 关键词扫描 — STDOUT 路径必从 frontmatter 取，缺失或不存在直接 FAIL（risk 4 mitigation）
STDOUT_PATH=$(awk '/^stdout_file:/ {print $2}' "$REPORT")
[ -n "$STDOUT_PATH" ] && [ -f "$STDOUT_PATH" ] \
  || { echo "FAIL: 报告 stdout_file 字段无效（缺失或文件不存在）— 不允许跳过关键词扫描"; exit 1; }
! grep -E 'PROBE_FAIL_|BREAKER_OPEN|WORKTREE_KEY_COLLISION|STDOUT_LOST|EVALUATOR_DOD_NOT_FOUND' "$STDOUT_PATH" \
  || { echo "FAIL: Brain stdout 命中已知失败关键词"; exit 1; }
```

**硬阈值**:
- (a) 6 小时内 `parent_task_id=$INIT_ID AND status=completed AND task_type LIKE 'harness\_%'` 的不同 `task_type` ≥ 4
- (b) `parent_task_id=$INIT_ID AND status IN ('failed','stuck')` 计数 = 0
- (c) `stdout_file`（报告 frontmatter）必填且文件真实存在，不允许 SKIP；其内容不得含已知失败关键词

> **GAN 防造假说明**：
> - `created_at > NOW() - interval '6 hours'` 阻断"用半年前的旧数据冒充本次真跑"
> - `task_type LIKE 'harness\_%'` 阻断"用同 parent 下的其他系统任务凑数"
> - `count(DISTINCT task_type) ≥ 4` 阻断"只跑了 1 个节点 4 次冒充全程"
> - **STDOUT_FILE 必须存在**：阻断"Brain 没真跑时输出文件不存在 → 关键词扫描被静默跳过 → 真实失败模式漏网"
>
> **Cascade 风险说明（risk 5 mitigation）**：
> 若仅 `harness_planner` completed、其余 `harness_*` 子任务 `in_progress` 超 4h 未推进 → 视为 GAN 死锁/cascade 失败。Step 2 (a) 的 `count(DISTINCT task_type) ≥ 4` 自然不满足，Evaluator 应裁 **BLOCKED**（与 risk 2 处理路径一致：报告 Residual Issues 段如实记录，不重试不强行通过）。

---

### Step 3: 终态——子 Initiative 真 completed + APPROVED + 真 GitHub PR **已 MERGED** + report 文件落地

**可观测行为**: Brain API 返回的子 Initiative 行 `status='completed'`；`result.evaluator_verdict='APPROVED'`；`result.pr_url` 是 `https://github.com/<owner>/<repo>/pull/<N>` 形式真实 URL，HEAD 请求 HTTP 200，**`gh pr view` 返回 `state="MERGED"`**，且其 commits 中至少一条 commit message 头 / 体含 `child_initiative_id` 前 8 位（用于反向追溯亲子）；`result.report_path` 指向的文件在 worktree 真存在（已 commit/push 进 PR diff）。

**验证命令**:
```bash
SPRINT_DIR="${SPRINT_DIR:-sprints/w8-langgraph-v18}"
REPORT="${SPRINT_DIR}/harness-report.md"
INIT_ID=$(awk '/^child_initiative_id:/ {print $2}' "$REPORT")
ROW=$(curl -fsS "localhost:5221/api/brain/tasks/${INIT_ID}")

# (a) status = completed
echo "$ROW" | jq -e '.status == "completed"' >/dev/null \
  || { echo "FAIL: status != completed"; exit 1; }

# (b) result.evaluator_verdict = APPROVED
echo "$ROW" | jq -e '.result.evaluator_verdict == "APPROVED"' >/dev/null \
  || { echo "FAIL: result.evaluator_verdict != APPROVED"; exit 1; }

# (c) pr_url shape + HEAD 200 + state=MERGED + commits 含 INIT_ID 前 8 位（risk 3 mitigation）
PR_URL=$(echo "$ROW" | jq -r '.result.pr_url // empty')
[[ "$PR_URL" =~ ^https://github\.com/[^/]+/[^/]+/pull/[0-9]+$ ]] \
  || { echo "FAIL: pr_url 不是 github PR 链接 shape (实际=$PR_URL)"; exit 1; }
curl -fsSI --max-time 15 "$PR_URL" | head -1 | grep -qE 'HTTP/[12](\.[01])? 200' \
  || { echo "FAIL: pr_url HEAD != HTTP 200"; exit 1; }

# (c.1) PR 必须真的 MERGED（仅"MERGED"通过；OPEN / CLOSED 均 BLOCKED）
gh pr view "$PR_URL" --json state,mergedAt 2>/dev/null \
  | jq -e '.state == "MERGED" and (.mergedAt | type == "string")' >/dev/null \
  || { echo "FAIL: PR 未 MERGED（state != MERGED 或 mergedAt 缺失）— 视为 BLOCKED"; exit 1; }

# (c.2) PR commits 中至少 1 条 messageHeadline+messageBody 联合体含 INIT_ID 前 8 位（防 PR title 篡改后追溯不到父）
INIT_PREFIX="${INIT_ID:0:8}"
gh pr view "$PR_URL" --json commits 2>/dev/null \
  | jq -e --arg p "$INIT_PREFIX" '
      .commits
      | length > 0
      and (any(.[]; ((.messageHeadline // "") + " " + (.messageBody // "")) | test($p; "i")))
    ' >/dev/null \
  || { echo "FAIL: PR commits 中无任何 message 含 child_initiative_id 前 8 位 ($INIT_PREFIX)"; exit 1; }

# (d) report_path 文件真实存在
REPORT_PATH=$(echo "$ROW" | jq -r '.result.report_path // empty')
[ -n "$REPORT_PATH" ] || { echo "FAIL: report_path 为空"; exit 1; }
[ -f "$REPORT_PATH" ] || { echo "FAIL: report_path 文件不存在: $REPORT_PATH"; exit 1; }
```

**硬阈值**:
- (a) `.status == "completed"` 严格相等
- (b) `.result.evaluator_verdict == "APPROVED"` 严格相等
- (c) `pr_url` 同时满足：(i) PR 链接 shape；(ii) HEAD HTTP 200（15s 超时防挂死）；(iii) `gh pr view --json state` 返回 `MERGED` 且 `mergedAt` 非空；(iv) `gh pr view --json commits` 中 ≥1 条 commit `messageHeadline + messageBody` 含 `INIT_ID` 前 8 位
- (d) `report_path` 文件在文件系统真实存在

> **GAN 防造假说明**：
> - `state == "MERGED"` 阻断"PR 还没合并就贴上来骗终态"；`mergedAt` 类型必为 string 阻断"jq 取到 null 仍 truthy"
> - commits 含 `INIT_ID` 前 8 位作为亲子追溯，独立于 PR title（risk 3）；test 用 `"i"` 大小写不敏感防误报
> - `pr_url` shape 用正则锁死，防止贴 github 首页或非 PR 链接

---

## Test Evidence Protocol（Round 3 维持 — 钉死 TDD Red/Green 流程）

**测试入口**：`sprints/w8-langgraph-v18/tests/ws1/harness-report-evidence.test.ts`
**测试结构**：5 个 `it` 共享一个 `beforeAll`，`beforeAll` 内 `readFileSync(REPORT, 'utf8')`；缺文件时抛
`Cannot find harness-report.md at sprints/w8-langgraph-v18/ (errno=ENOENT). Generator must write the real-run evidence report before evaluator runs this test.`

**跑测命令（Evaluator + CI 强制使用）**：
```bash
npx vitest run sprints/w8-langgraph-v18/tests/ws1/harness-report-evidence.test.ts --reporter=verbose
```

**Commit 1 阶段（Red — 仅测试落盘，无 harness-report.md / 无 child-prd.md）**：
- exit code = `1`
- 输出末尾摘要严格为 `Test Files  1 failed (1)` + `Tests  5 skipped (5)`（vitest 在 `beforeAll` 抛错时的标准行为：suite-level 失败导致 5 个 `it` 不进入执行而被标 skipped；这是预期红，不是测试逃逸）
- 错误信息含 `Cannot find harness-report.md at sprints/w8-langgraph-v18/ (errno=ENOENT)`（精确字符串，可 `grep -F` 匹配）
- 已本地预演：proposer 在写测试前 `ls harness-report.md` 不存在 → 跑测命令真返回 exit 1 + 上述错误（输出存档于 `task-plan.json` 同分支历史可追）

**Commit 2 阶段（Green — Generator 已写完真跑报告 + child-prd.md）**：
- exit code = `0`
- 5 个 `it` 全部 PASS（vitest 显示 `5 passed`），具体：
  1. `child_initiative_id frontmatter is a valid UUID v4` PASS
  2. `Final Status section contains completed` PASS
  3. `Evaluator Verdict section contains APPROVED` PASS
  4. `Report contains at least one https://github.com/.../pull/N URL` PASS
  5. `Subtask Summary lists 4+ distinct harness_* completed types with no failed/stuck` PASS

**为什么 BEHAVIOR 测试不新增 `metadata.parent_initiative_id` / `MERGED` / `stdout_file` 这 3 条断言**：
- 这 3 条都是基础设施观测项，需要"实时调 Brain API + GitHub API"，**单元测试**层不该联网
- 已通过：(i) Step 1/2/3 验证命令在 Evaluator 端强校验；(ii) `contract-dod-ws1.md` 新增 ARTIFACT 静态检查 frontmatter 字段存在 + child-prd.md 三段；(iii) E2E §5/§8 联网强校验
- 5 条 BEHAVIOR `it` 仍精确对应 PRD「Golden Path 可观测结果」5 项关键事实，不超载

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -euo pipefail

SPRINT_DIR="${SPRINT_DIR:-sprints/w8-langgraph-v18}"
DB="${DB_URL:-postgresql://localhost/cecelia}"
REPORT="${SPRINT_DIR}/harness-report.md"
PARENT_ID="${TASK_ID:?TASK_ID 未注入}"

# 0. 报告 + child-prd.md 必须存在
[ -f "$REPORT" ] || { echo "FAIL: $REPORT 不存在"; exit 1; }
[ -f "${SPRINT_DIR}/child-prd.md" ] || { echo "FAIL: ${SPRINT_DIR}/child-prd.md 不存在"; exit 1; }

# 1. 提取 frontmatter 三字段
INIT_ID=$(awk '/^child_initiative_id:/ {print $2}' "$REPORT")
PARENT_FROM_REPORT=$(awk '/^parent_initiative_id:/ {print $2}' "$REPORT")
STDOUT_PATH=$(awk '/^stdout_file:/ {print $2}' "$REPORT")
[[ "$INIT_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] \
  || { echo "FAIL: child_initiative_id 缺失或非 UUID (实际=$INIT_ID)"; exit 1; }
[ "$PARENT_FROM_REPORT" = "$PARENT_ID" ] \
  || { echo "FAIL: parent_initiative_id=$PARENT_FROM_REPORT != \$TASK_ID=$PARENT_ID"; exit 1; }

# 2. 子 Initiative 行存在 + metadata.parent_initiative_id 严格匹配（risk 2 mitigation）
ROW=$(curl -fsS "localhost:5221/api/brain/tasks/${INIT_ID}") \
  || { echo "FAIL: Brain API 不可达或 task ${INIT_ID} 不存在"; exit 1; }
echo "$ROW" | jq -e --arg pid "$PARENT_ID" '.metadata.parent_initiative_id == $pid' >/dev/null \
  || { echo "FAIL: DB 中 metadata.parent_initiative_id 不等于父 \$TASK_ID（亲子关系断裂）"; exit 1; }

# 3. status=completed
echo "$ROW" | jq -e '.status == "completed"' >/dev/null \
  || { echo "FAIL: status != completed"; exit 1; }

# 4. evaluator_verdict=APPROVED
echo "$ROW" | jq -e '.result.evaluator_verdict == "APPROVED"' >/dev/null \
  || { echo "FAIL: evaluator_verdict != APPROVED"; exit 1; }

# 5. pr_url shape + HEAD 200 + MERGED + commits 含 INIT_PREFIX（risk 3 mitigation）
PR_URL=$(echo "$ROW" | jq -r '.result.pr_url // empty')
[[ "$PR_URL" =~ ^https://github\.com/[^/]+/[^/]+/pull/[0-9]+$ ]] \
  || { echo "FAIL: pr_url 非 PR 链接 (实际=$PR_URL)"; exit 1; }
curl -fsSI --max-time 15 "$PR_URL" | head -1 | grep -qE 'HTTP/[12](\.[01])? 200' \
  || { echo "FAIL: pr_url HEAD != HTTP 200"; exit 1; }
gh pr view "$PR_URL" --json state,mergedAt 2>/dev/null \
  | jq -e '.state == "MERGED" and (.mergedAt | type == "string")' >/dev/null \
  || { echo "FAIL: PR 未 MERGED — BLOCKED"; exit 1; }
INIT_PREFIX="${INIT_ID:0:8}"
gh pr view "$PR_URL" --json commits 2>/dev/null \
  | jq -e --arg p "$INIT_PREFIX" '.commits | length > 0 and (any(.[]; ((.messageHeadline // "") + " " + (.messageBody // "")) | test($p; "i")))' >/dev/null \
  || { echo "FAIL: PR commits 中无 message 含 child_initiative_id 前 8 位 ($INIT_PREFIX)"; exit 1; }

# 6. report_path 文件真实存在
REPORT_PATH=$(echo "$ROW" | jq -r '.result.report_path // empty')
[ -n "$REPORT_PATH" ] && [ -f "$REPORT_PATH" ] \
  || { echo "FAIL: report_path 缺失或文件不存在 (实际=$REPORT_PATH)"; exit 1; }

# 7. 子任务 ≥4 类 completed（6h 时间窗）+ 0 失败/卡死
COMPLETED_TYPES=$(psql "$DB" -tAc "SELECT count(DISTINCT task_type) FROM tasks WHERE parent_task_id='${INIT_ID}' AND status='completed' AND created_at > NOW() - interval '6 hours' AND task_type LIKE 'harness\\_%'")
[ "${COMPLETED_TYPES:-0}" -ge 4 ] \
  || { echo "FAIL: 6h 内 completed harness_* task_type=${COMPLETED_TYPES} (<4) — 可能 cascade 死锁，按 BLOCKED 处理"; exit 1; }

FAILED=$(psql "$DB" -tAc "SELECT count(*) FROM tasks WHERE parent_task_id='${INIT_ID}' AND status IN ('failed','stuck')")
[ "${FAILED:-1}" -eq 0 ] \
  || { echo "FAIL: failed/stuck 子任务 = $FAILED"; exit 1; }

# 8. Brain stdout 关键词扫描（risk 4 mitigation — 升级为强校验，无 WARN 路径）
[ -n "$STDOUT_PATH" ] && [ -f "$STDOUT_PATH" ] \
  || { echo "FAIL: stdout_file frontmatter 字段缺失或文件不存在（无 WARN 降级路径）"; exit 1; }
if grep -E 'PROBE_FAIL_|BREAKER_OPEN|WORKTREE_KEY_COLLISION|STDOUT_LOST|EVALUATOR_DOD_NOT_FOUND' "$STDOUT_PATH"; then
  echo "FAIL: Brain stdout 命中已知失败关键词"; exit 1
fi

# 9. child-prd.md 三段 heading 模板齐全 + DoD 含 bash 代码块（risk 1 mitigation）
CHILD_PRD="${SPRINT_DIR}/child-prd.md"
grep -q '^## 场景描述' "$CHILD_PRD"     || { echo "FAIL: child-prd 缺 '## 场景描述'"; exit 1; }
grep -q '^## Golden Path' "$CHILD_PRD"  || { echo "FAIL: child-prd 缺 '## Golden Path'"; exit 1; }
grep -q '^## DoD 命令清单' "$CHILD_PRD" || { echo "FAIL: child-prd 缺 '## DoD 命令清单'"; exit 1; }
awk '/^## DoD 命令清单/,/^## /' "$CHILD_PRD" | grep -q '^```bash' \
  || { echo "FAIL: child-prd DoD 段无 \`\`\`bash 代码块"; exit 1; }

# 10. BEHAVIOR 测试 5 个 it 全 PASS（与 §Test Evidence Protocol 一致）
npx vitest run "${SPRINT_DIR}/tests/ws1/harness-report-evidence.test.ts" --reporter=verbose

echo "✅ Golden Path 验证通过：W8 LangGraph v18 真端到端跑通到 status=completed + APPROVED + PR MERGED"
```

**通过标准**: 脚本 `exit 0`

---

## Workstreams

workstream_count: 1

### Workstream 1: 触发最小子 Initiative + 监视 + 收证 + 写 harness-report.md + 落盘 child-prd.md

**范围**:
1. **反查 STDOUT_FILE 路径**：在创建子 Initiative 之前，通过 `curl -fsS localhost:5221/api/brain/context` 或读 Brain 启动配置 / 环境（按可用性顺序）拿到 Brain 主进程 stdout 文件绝对路径；找不到任何来源 → 视为 BLOCKED 并立即终止（不允许降级到无 STDOUT 路径的"半盲跑"）。
2. **按附录 §A 模板写 child PRD**：落盘 `sprints/w8-langgraph-v18/child-prd.md`，三段 heading 齐全，DoD 段含可执行 `\`\`\`bash` 代码块；选定的小目标默认 = "在 docs/current/README.md 末尾追加一行 `W8-v18 真跑验证 @ <ISO timestamp>`"；账户配额受限时降级为"在 sprints/ 下新建一个 .md 占位文件"。
3. **创建子任务**：`POST localhost:5221/api/brain/tasks`，body 必须含
   ```json
   {
     "task_type": "harness_initiative",
     "payload": { "prd_text": "<§A 模板渲染后全文>" },
     "metadata": { "parent_initiative_id": "$TASK_ID", "child_prd_path": "sprints/w8-langgraph-v18/child-prd.md" }
   }
   ```
   记录返回 task_id（即 `child_initiative_id`）。
4. **监视终态**：循环 `GET /api/brain/tasks/<id>` 直到 `status ∈ {completed, failed}` 或超时 4 小时（cascade risk 5 兜底）。
5. **收集证据**：
   - 子 Initiative `tasks` 行 JSON 全文（`jq` 美化后嵌入 Evidence 段）— 必须能看到 `metadata.parent_initiative_id`
   - 子任务清单（`SELECT id, task_type, status, created_at FROM tasks WHERE parent_task_id=$INIT_ID ORDER BY created_at`）
   - PR URL 的 HTTP 状态码（`curl -sI`）+ `gh pr view --json state,mergedAt,commits` 输出片段
   - Brain stdout（`stdout_file` 路径）已知关键词扫描结果（`grep -E 'PROBE_FAIL_|...'`，无命中也要落盘 "no match" 字样）
6. **产出报告**：写 `sprints/w8-langgraph-v18/harness-report.md`，强制含：
   - frontmatter：`child_initiative_id` / `parent_initiative_id`（=`$TASK_ID`）/ `stdout_file`（绝对路径）
   - 5 个章节：`## Final Status` / `## Evaluator Verdict` / `## Subtask Summary` / `## Evidence` / `## Residual Issues`
   - 至少 1 条 `https://github.com/.../pull/N` 形式 PR URL
   - `Subtask Summary` 段列 ≥4 行 `harness_*` + `completed`，无 `failed` / `stuck` 字样
7. **commit + push** 一个 PR；不修改 `packages/brain/src/`。

**TDD 纪律（Round 2 强化沿用）**：
- **commit 1**：仅落 `tests/ws1/harness-report-evidence.test.ts`（**禁止改测试**，从合同原样复制） + `contract-dod-ws1.md`。跑 `npx vitest run sprints/w8-langgraph-v18/tests/ws1/harness-report-evidence.test.ts --reporter=verbose` → exit 1，stderr 含 ENOENT，5 个 it 全 FAIL。截 stderr 前 30 行进 `harness-report.md` Evidence 段。
- **commit 2**：写 `harness-report.md` + `child-prd.md` + 必要的 commit/push 脚本产物。同命令再跑 → exit 0，5 个 it 全 PASS。截 stdout `Test Files 1 passed` 行进 Evidence 段。

**大小**: M（脚本 + report 模板 + child PRD 模板约 250 行 markdown/bash，无 brain 源码改动）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/harness-report-evidence.test.ts`

---

## 附录 §A — Child PRD 强制模板（risk 1 mitigation）

Generator 在 WS1 Step 2 必须按以下骨架渲染并落盘 `sprints/w8-langgraph-v18/child-prd.md`，三段 heading 名一字不差（合同 Step 1 (c) 用 `grep -q '^## 场景描述'` 等精确匹配校验）：

````markdown
# Child Initiative PRD — <一句话标题>

## 场景描述
<2-4 句话写清：我是谁、想解决什么、为什么这次要跑一次最小真跑、预期改动哪一两个文件、不在范围内的是什么>

## Golden Path
[<操作者动作>] → [<Brain LangGraph 自主跑完节点序列>] → [<可观测出口：status=completed + APPROVED + PR MERGED>]

具体步骤（≤5 步）：
1. <触发条件 — POST /api/brain/tasks 创建子 harness_initiative>
2. <系统处理 — Brain 自主跑 5 个节点>
3. <可观测结果 — 子 task 行 + PR + report 文件>

## DoD 命令清单
> 至少 1 个 `\`\`\`bash` 代码块；每条命令 Evaluator 直接执行不解释；含硬阈值（exit code / 期望输出 / 时间窗口）。

```bash
# 例：终态校验
curl -fsS localhost:5221/api/brain/tasks/<child_id> | jq -e '.status == "completed" and .result.evaluator_verdict == "APPROVED"'

# 例：PR MERGED 校验
gh pr view <pr_url> --json state | jq -e '.state == "MERGED"'

# 例：报告落地
test -f <report_path>
```
````

**模板使用约束**：
- 三段 heading 必须以 `## 场景描述` / `## Golden Path` / `## DoD 命令清单` 出现（中文 + 中英混拼，与 grep 正则严格一致）
- DoD 段必须含 ≥1 个 `\`\`\`bash` 代码块；不允许"待补充"占位
- Generator 不得删段、改 heading 名、漏 bash 代码块——这三项任一违反即 Step 1 (c) FAIL

---

## Test Contract

| Workstream | Test File | `it` 名（具名断言） | Red 证据（commit 1） | Green 证据（commit 2） |
|---|---|---|---|---|
| WS1 | `tests/ws1/harness-report-evidence.test.ts` | (1) `child_initiative_id frontmatter is a valid UUID v4`<br>(2) `Final Status section contains completed`<br>(3) `Evaluator Verdict section contains APPROVED`<br>(4) `Report contains at least one https github pull URL`<br>(5) `Subtask Summary lists 4+ distinct harness_* completed types with no failed-or-stuck` | `npx vitest run sprints/w8-langgraph-v18/tests/ws1/harness-report-evidence.test.ts --reporter=verbose` → exit `1`；输出含 `Cannot find harness-report.md at sprints/w8-langgraph-v18 (errno=ENOENT)`；末尾摘要 `Test Files 1 failed (1) ; Tests 5 skipped (5)`（beforeAll suite 级失败的标准呈现） | 同命令 → exit `0`，末尾摘要 `Test Files 1 passed (1) ; Tests 5 passed (5)`，5 个 it 名逐条 PASS |
