# Sprint Contract Draft (Round 1)

覆盖父路声明：独立小路（无父路）— PRD journey_id: none，本 sprint 为 kernel-v1 mixed-provider 主链 fire drill 独立验收路径。

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 交付物为一份文档（docs/fire-drills/kernel-v1-mixed-20260724-r6.md），不新增任何 API 端点。验收只【读取】既有生产端点（GET /api/brain/tasks/:id、GET /api/brain/harness/runs、GET /api/brain/health），断言字段名以本轮实测响应为准（见「Oracle 真跑留痕」段，非凭记忆）。

## 已知约束（来自回归测试）

- （暂无已知约束——本单纯文档交付，不触及 packages/brain、line 模块或任何既有测试文件；未找到 fire-drill 相关回归测试）
- [累积FR] context-manifest: unavailable (journey_id=none，PRD 已声明本 line 暂无历史)

## Golden Path

[controller 点火 planning] → [七角色接力：planner→proposer→独立 reviewer→generator→独立 evaluator→independent judge] → [认证人工批准后 merge + report]

### Step 1: 前段角色接力（planner/proposer/reviewer）产出 PRD 与合同，链路留痕
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 条（planner claude/account1 产出 sprint-prd.md；proposer claude/account1 起草合同；独立 reviewer grok/grok 审合同）

**可观测行为**: Brain harness runs API 中出现 initiative_id=b21467a0-5a67-4787-9d48-92f6820c6b33 的 relay-run 记录；task payload 中 harness_runtime=kernel-v1 且五角色 role_assignments 与实际执行一致。

**验证命令**:
```bash
curl -sf -m 10 "localhost:5221/api/brain/harness/runs?initiative_id=b21467a0-5a67-4787-9d48-92f6820c6b33" | jq -e "[.[] | select(.initiative_id == \"b21467a0-5a67-4787-9d48-92f6820c6b33\")] | length >= 1"
# 注意: 该端点实测不做服务端过滤（返回全量 runs），必须 jq 客户端过滤 initiative_id，否则任意历史 run 都能假绿
```

**硬阈值**: 归属本 initiative 的 run 记录 ≥ 1 条，且 started_at ≥ 2026-07-24（时间窗见 Step 7）。

---

### Step 2: generator 独立 worktree 建 delivery 分支并核对任务身份
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 条（generator codex/team3 读取并核对 HARNESS_TASK_ID=CECELIA_TASK_ID=b21467a0-5a67-4787-9d48-92f6820c6b33，从 origin/main 在独立 delivery worktree 创建 cp-MMDDHHMM-b21467a0 分支，禁止在 controller 共享 worktree checkout delivery 分支）

**可观测行为**: GitHub 上出现 OPEN PR，head 分支名匹配 `^cp-[0-9]{8}-b21467a0$` 形态（分支名带 task short id，对应「点火留痕」铁律）；controller 共享 worktree 上的 sprint-prd/合同观察态不消失（由 delivery diff 不含 sprints/** 间接执法，见 Step 3）。

**验证命令**:
```bash
gh pr list --state open --json headRefName --jq ".[].headRefName" | grep -E "^cp-[0-9]{8}-b21467a0$"
```

**硬阈值**: 恰有匹配该正则的 OPEN PR head 分支。tmux 子 shell 不继承父环境（铁律 [tmux环境]），generator 必须显式核对注入的 HARNESS_TASK_ID 与 CECELIA_TASK_ID 相等且等于本 task id，不等则 BLOCKED，禁止继续。

---

### Step 3: generator 仅新增目标文档，开 PR 前机械核对 diff 恰一行
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 条 + 「边界情况」第 1 条（diff 出现第二个文件必须拦截重做）

**可观测行为**: origin/main...origin/<delivery分支> 的 name-only diff 恰为 `docs/fire-drills/kernel-v1-mixed-20260724-r6.md` 一行；文档含三个字面标记（KERNEL_V1_MIXED_FIRE_DRILL_PASS_R6、1.267.67、19887912bbb581597f12c714a9ed187f051e2850）及五角色 provider/account 实际运行证据摘要。

**验证命令**:
```bash
HB=$(gh pr list --state open --json headRefName --jq ".[].headRefName" | grep -E "^cp-[0-9]{8}-b21467a0$" | head -1)
git fetch -q origin main "$HB"
D=$(git diff --name-only "origin/main...origin/$HB")
[ "$D" = "docs/fire-drills/kernel-v1-mixed-20260724-r6.md" ]
git show "origin/$HB:docs/fire-drills/kernel-v1-mixed-20260724-r6.md" | grep -c "KERNEL_V1_MIXED_FIRE_DRILL_PASS_R6"
```

**硬阈值**: diff 输出与目标文档路径字符串完全相等（同时保证恰一行 + 无 sprints/**、.harness/**、合同产物）；三字面标记 grep 全命中。内容断言以【远端已推送】的分支内容为准（git show origin/...），防本地未推送假绿。

---

### Step 4: 独立 evaluator 逐条执行验收 checks，每条留痕 command/exit_code/log_tail
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 条 + NFR 可观测条款

**可观测行为**: 本合同「## E2E 验收」脚本每条 check 输出 `command:` / `exit_code:` / `log_tail:` 三行留痕（与铁律 [judge格式] 的 exit_code + log_tail 协议对齐）；任一 check 失败则脚本 exit 非零，无 warning 降级（铁律 [禁降级]）。

**验证命令**: 即「## E2E 验收」整段脚本（evaluator 模式 B 直接执行）。

**硬阈值**: 脚本 exit 0 且输出含 `KERNEL_V1_MIXED_R6_E2E_PASS`；失败时如实写 relay-runs 失败原因（PRD 边界：provider 退出/quota 429 不得伪造 PASS）。

---

### Step 5: independent judge 执行 pre-human gate 时点核验
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 条 + 「边界情况」第 3 条（judge 发现 PR 已提前 merge → 直接 FAIL）

**可观测行为**: judge 执行时点，PR 仍 OPEN、未 merge，且无人工批准记录。禁止把「未来的人工批准」或「judge 自己尚未产生的输出」写成 PASS 前置条件——本步验证的是 judge 时点的既成事实。

**验证命令**（judge 时点执行，非 evaluator E2E 内）:
```bash
HB=$(gh pr list --state open --json headRefName --jq ".[].headRefName" | grep -E "^cp-[0-9]{8}-b21467a0$" | head -1)
gh pr view "$HB" --json state,mergedAt,reviews | jq -e ".state == \"OPEN\" and .mergedAt == null and ([.reviews[]? | select(.state == \"APPROVED\")] | length == 0)"
```

**硬阈值**: 三条件同真。PR 已 merge 或已有 APPROVED 记录 → judge 直接 FAIL（[SHA锚定]/[禁自merge] 铁律：若 CI 兜底提前合并，以 PR head SHA 对账后 FAIL）。

---

### Step 6: judge PASS 后创建 human review request，认证批准后才 merge/report
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 6 条（review_required=true，payload 实测确认）

**可观测行为**: 时序上 human review request 只在 judge PASS 之后出现；merge 只在认证人工批准之后发生；merge 后目标文档出现在 origin/main。

**验证命令**（controller merge 前置核验 + report 阶段终验）:
```bash
# merge 前: 必须已有认证批准
gh pr view "$HB" --json reviews | jq -e "[.reviews[]? | select(.state == \"APPROVED\")] | length >= 1"
# report 阶段终验: 文档已入 main
git fetch -q origin main && git cat-file -e "origin/main:docs/fire-drills/kernel-v1-mixed-20260724-r6.md"
```

**硬阈值**: 批准记录 ≥ 1 才允许 merge；merge 权归 controller，generator 禁止自行 merge（铁律 [禁自merge]）。

---

### Step 7: 防历史冒充双闩（时间窗 + 提前入 main 拦截）
**来源**: `[AI_ADDED]` — GAN Round 1 proposer 加入，理由：R3-R5 已有多轮同名 fire drill 历史记录，若不加时间窗与「文档不得已在 main」反向断言，历史 relay-run 或提前 merge 的旧文档可冒充本轮 R6 产出假绿。

**可观测行为**: 归属 run 的 started_at 落在本轮演练时间窗内；evaluator/judge 时点目标文档【不】存在于 origin/main。

**验证命令**:
```bash
curl -sf -m 10 "localhost:5221/api/brain/harness/runs?initiative_id=b21467a0-5a67-4787-9d48-92f6820c6b33" | jq -e "[.[] | select(.initiative_id == \"b21467a0-5a67-4787-9d48-92f6820c6b33\") | select(.started_at >= \"2026-07-24\")] | length >= 1"
if git cat-file -e "origin/main:docs/fire-drills/kernel-v1-mixed-20260724-r6.md" 2>/dev/null; then echo "FAIL: 文档已在 main"; exit 1; fi
```

**硬阈值**: 时间窗内归属 run ≥ 1；merge 前任何时点 cat-file 必须失败（文档不在 main）。

---

## 真实调用方请求 shape

N/A — 本 sprint 无「设备/agent 调服务端」新链路。全部验收调用方即 evaluator 本身（本机 curl 直调生产 Brain 5221、gh CLI 走已认证 GitHub API、git 直连 origin remote），认证方式与生产使用方式一致（gh hosts.yml PAT / localhost 内网直连），无双路径分叉。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）— 全部断言在真目标上执行：生产 Brain API（localhost:5221 实测自报 1.267.67）、GitHub 真 PR/真 CI（gh 已认证真调，满足规则 B「第三方真调一次」）、git origin 真 fetch/diff。无 force_*/stub/假数据。

## 禁 mock 边清单

（本单 delivery 为纯新增一份文档，不涉调度/状态机/跨模块数据传递/生命周期钩子/DB 写路径的代码改动，无接缝边可 mock，N/A）。补充执法：验收命令本身零 mock——tests/ 内无 vi.mock/stub，DoD 全部 manual:bash 真调生产 Brain/GitHub/git。

## 接缝清单（碰真实世界的点 — 全部真目标验证，无 logic-done-pending）

1. **GitHub 真 PR/真 CI**（gh CLI 已认证真调）— 真目标验证：DoD B2/B3（PR OPEN/未 merge/CI 全绿以 GitHub API 实况为准）
2. **生产 Brain API（localhost:5221）**（版本自报/task payload/runs 归属）— 真目标验证：DoD B4/B5/B6（自报对账铁律：以 health.version 生产实体自报核对 1.267.67，禁凭记忆）
3. **git origin remote**（diff/内容以远端已推送分支为准）— 真目标验证：DoD B1/B7/B8（git fetch + origin/... 引用，防本地未推送假绿）

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | 新增 docs/fire-drills/kernel-v1-mixed-20260724-r6.md 一个文件，含 PASS 标记/版本/merge commit/五角色证据摘要；七角色全链留痕 |
| **NFR（做得多好）** | 非功能需求 | 全流程 timeout 28800s；每条 check 留痕 command/exit_code/log_tail；版本锚定 1.267.67 + 19887912b |
| **Invariant（永不违反）** | 不变量 | PR diff 恰一行目标文档；pre-human gate（judge 时无批准且未 merge）；认证批准后才 merge；失败如实入 relay-runs 不伪造 PASS。53 条铁律逐条映射见 contract-dod.md「铁律映射」段 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | 本文档为 2026-07-24 R6 演练的一次性验收留痕，PASS 后即为永久历史证据，不退役、不复用于后续轮次（后续轮次须新建 R7 文档，标记不同） |
| **死亡告警（停了谁知道）** | 停摆感知 | 主链任一角色失败 → relay-runs 写失败原因（R3-R5 即如此留痕）→ controller/用户经 Brain harness runs API 与 task status 可见；无静默路径（铁律 [禁降级]） |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | PR 创建的回执 = gh API 可查 OPEN PR；merge 的回执 = origin/main 上 cat-file 命中目标文档；每条 check 的回执 = exit_code + log_tail 留痕 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| delivery 分支识别 | A. 人工指定分支名; B. OPEN PR headRefName 按 `^cp-[0-9]{8}-b21467a0$` 正则唯一匹配 | B | MMDDHHMM 时戳在合同期未知，正则含 task short id 防撞库 | 验错分支或漏验，全部后续 check 对象错误 |
| CI 是否全绿 | A. 解析 statusCheckRollup 逐项判读; B. gh pr checks 退出码（within 900s 轮询） | B | gh 官方语义：pending/failing 均非零退出，无需自写判读逻辑 | 红/未完成 CI 被误判绿，违规进入 merge |
| ⚠️ PR 是否未提前 merge（pre-human gate） | A. 只看 PR state; B. state==OPEN 且 mergedAt==null 且目标文档不在 origin/main（三闩） | B | 单看 state 可被 reopen/兜底合并绕过；cat-file 是最终事实 | 未经认证人审的内容进 main（不可逆），违反 review_required=true |
| 生产版本是否 1.267.67 | A. 读本地 package.json; B. curl health 生产实体自报 | B（A 仅作辅证） | 铁律 [自报对账]：判变基准用生产实体自报，禁工作区推断 | 文档写入未部署版本号，PASS 证据失真 |
| relay-run 是否归属本轮 | A. runs API 返回即算; B. jq 过滤 initiative_id + started_at ≥ 2026-07-24 时间窗 | B | 实测该端点不做服务端过滤且 R3-R5 留有历史 run，必须双条件 | 历史轮次 run 冒充 R6 留痕，主链未跑通却假绿 |

> ⚠️ 判定点「PR 是否未提前 merge」误判后果为不可逆动作；其 pre-human gate 语义已由 PrepPRD/任务描述显式拍板（judge 时尚无人工批准且 PR 未 merge 是 PASS 前置条件），无 judgment-pending-user 项。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| provider 中途退出 / quota 429（R3-R5 实际死因） | 该角色 run FAIL，失败原因如实写入 relay-runs，不得伪造 PASS 标记 | 是（重跑新增 relay-run 记录；交付文档同一路径幂等覆盖） | 无降级——主链任一角色失败即本轮 FAIL |
| PR diff 出现第二个文件 | generator 开 PR 前拦截并重做 diff；已开 PR 则 evaluator C1 FAIL | 是（重做分支/diff 后重推） | 禁止「先合了再说」，无豁免路径 |
| CI 未全绿（within 900s） | evaluator C5 FAIL，阻断 judge/merge | 是（修复后 CI 重跑） | 禁止 gh pr merge --admin 绕过 |
| Brain API 不可达 / gh 未认证 | 对应 check exit 非零 = FAIL（环境未就绪即失败，禁止 exit 0 兜底 SKIP） | 是 | 无 warning 降级（铁律 [禁降级]） |
| judge 时点发现已 merge 或已有批准 | judge 直接 FAIL（pre-human gate 前置条件被破坏） | 否（需人工介入调查） | 无 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本 sprint 无对外暴露 agent、无外部用户可写入接口；全部输入为 Brain 内部注入的任务上下文与只读 API。

## Oracle 真跑留痕（铁律 [oracle留痕]/[真跑校验] — GAN 批准前每条 manual oracle 真实 exit code）

> 真跑时间 2026-07-24（proposer round 1，delivery PR 尚不存在——B1/B2/B3/B8 与 ARTIFACT 红是预期 TDD Red；B4/B5/B6/B7 为 PRD 要求的链路/生产状态审计项，当前即绿属【预绿声明】，非交付物 oracle 单独成立，见 notes）。逐条 exit code 见本目录提交说明与下表「预期红/绿」列，evaluator 复跑以 DoD 为准：

| 条目 | 本轮真跑 exit_code | 判定 |
|---|---|---|
| B1 diff 恰一行 | 1 | 红（预期：无 delivery PR） |
| B2 PR OPEN/未 merge/形态 | 1 | 红（预期） |
| B3 CI 全绿 | 1 | 红（预期，分支缺失即刻退出非零，未空转 900s） |
| B4 task payload kernel-v1+五角色 | 0 | 预绿（PRD check 5 链路审计项，点火时已注册） |
| B5 runs 归属+时间窗 | 0 | 预绿（PRD check 6，planning run 已留痕） |
| B6 版本自报对账+祖先校验 | 0 | 预绿（PRD NFR 版本锚定，生产实体自报实测） |
| B7 文档不得已在 main | 0 | 预绿（反向闩，违规时变红） |
| B8 远端文档内容全字面 | 1 | 红（预期） |
| A1/A2/A3 本地文档内容/无凭据 | 1 | 红（预期，文件不存在） |

## E2E 验收（最终 final-e2e 跑 — 按 target_environment 选模板）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
# final-e2e — kernel-v1 mixed fire drill R6 主链验收 (local_api: curl + git + gh 全真目标)
# 每条 check 统一留痕 command / exit_code / log_tail (NFR 可观测硬条款, 对齐 judge 格式铁律)
set -uo pipefail

TASK_ID="b21467a0-5a67-4787-9d48-92f6820c6b33"
DOC="docs/fire-drills/kernel-v1-mixed-20260724-r6.md"
FAILED=0

record() {
  local name="$1" cmd="$2" code="$3" out="$4"
  echo "== CHECK ${name}"
  echo "command: ${cmd}"
  echo "exit_code: ${code}"
  echo "log_tail:"
  printf '%s\n' "${out}" | tail -n 3
  if [ "${code}" -ne 0 ]; then FAILED=1; echo "CHECK-FAIL: ${name}"; fi
}

# C0: 发现 delivery 分支 (形态 cp-MMDDHHMM-b21467a0 的 OPEN PR, 铁律[点火留痕]: 分支名带 task short id)
CMD0='gh pr list --state open --json headRefName --jq .[].headRefName | grep -E ^cp-[0-9]{8}-b21467a0$'
OUT0=$(gh pr list --state open --json headRefName --jq ".[].headRefName" 2>&1 | grep -E "^cp-[0-9]{8}-b21467a0$" | head -1 || true)
if [ -n "${OUT0}" ]; then CODE0=0; else CODE0=1; fi
record "C0-branch-shape" "${CMD0}" "${CODE0}" "${OUT0}"
if [ "${FAILED}" -ne 0 ]; then echo "FAIL: 未找到形态匹配的 OPEN delivery 分支, 后续 checks 对象缺失"; exit 1; fi
HB="${OUT0}"
git fetch -q origin main "${HB}"

# C1: diff 恰一行 = 目标文档 (禁 sprints/** .harness/** 合同产物; 字符串全等同时保证恰一行)
OUT1=$(git diff --name-only "origin/main...origin/${HB}" 2>&1); CODE1=$?
if [ "${CODE1}" -ne 0 ] || [ "${OUT1}" != "${DOC}" ]; then CODE1=1; fi
record "C1-diff-exactly-one" "git diff --name-only origin/main...origin/${HB}" "${CODE1}" "${OUT1}"

# C2: 目标文档三字面标记 (以远端已推送内容为准, 防本地未推送假绿)
OUT2=$(git show "origin/${HB}:${DOC}" 2>&1); CODE2=$?
if [ "${CODE2}" -eq 0 ]; then
  for T in KERNEL_V1_MIXED_FIRE_DRILL_PASS_R6 1.267.67 19887912bbb581597f12c714a9ed187f051e2850; do
    printf '%s' "${OUT2}" | grep -q "${T}" || CODE2=1
  done
fi
record "C2-doc-markers" "git show origin/${HB}:${DOC} + grep 三字面标记" "${CODE2}" "$(printf '%s' "${OUT2}" | head -c 200)"

# C3: 五角色 provider/account 实际运行证据摘要 (角色词与 provider/account 字面全命中)
CODE3=0; MISSING3=""
for T in planner proposer reviewer generator evaluator claude grok codex team3 account1; do
  printf '%s' "${OUT2}" | grep -qi "${T}" || { CODE3=1; MISSING3="${MISSING3} ${T}"; }
done
record "C3-five-roles-evidence" "git show origin/${HB}:${DOC} + grep 五角色与 provider/account 字面" "${CODE3}" "missing=${MISSING3:-none}"

# C4: PR OPEN 且未 merge (pre-human gate 的 evaluator 时点面; 铁律[禁自merge])
OUT4=$(gh pr view "${HB}" --json state,mergedAt 2>&1)
printf '%s' "${OUT4}" | jq -e ".state == \"OPEN\" and .mergedAt == null" >/dev/null 2>&1; CODE4=$?
record "C4-open-unmerged" "gh pr view ${HB} --json state,mergedAt" "${CODE4}" "${OUT4}"

# C5: CI 全绿 (within 900s until-loop 等待预算; gh pr checks 对 pending/failing 均退出非零)
DEADLINE=$((SECONDS + 900))
CODE5=1; OUT5=""
while true; do
  if OUT5=$(gh pr checks "${HB}" 2>&1); then CODE5=0; break; fi
  if [ ${SECONDS} -ge ${DEADLINE} ]; then OUT5="timeout after 900s; last: ${OUT5}"; break; fi
  sleep 30
done
record "C5-ci-green" "gh pr checks ${HB} (within 900s until-loop)" "${CODE5}" "${OUT5}"

# C6: Brain task payload = kernel-v1 + 五角色 role_assignments 逐字段一致 (PRD check 5)
OUT6=$(curl -sf -m 10 "localhost:5221/api/brain/tasks/${TASK_ID}" 2>&1); CODE6=$?
if [ "${CODE6}" -eq 0 ]; then
  printf '%s' "${OUT6}" | jq -e ".payload.harness_runtime == \"kernel-v1\" and .payload.role_assignments.planner.provider == \"claude\" and .payload.role_assignments.planner.account == \"account1\" and .payload.role_assignments.proposer.provider == \"claude\" and .payload.role_assignments.proposer.account == \"account1\" and .payload.role_assignments.reviewer.provider == \"grok\" and .payload.role_assignments.reviewer.account == \"grok\" and .payload.role_assignments.generator.provider == \"codex\" and .payload.role_assignments.generator.account == \"team3\" and .payload.role_assignments.evaluator.provider == \"claude\" and .payload.role_assignments.evaluator.account == \"account1\"" >/dev/null 2>&1; CODE6=$?
fi
record "C6-kernel-v1-roles" "curl tasks/${TASK_ID} + jq 五角色逐字段断言" "${CODE6}" "$(printf '%s' "${OUT6}" | jq -c '.payload.role_assignments' 2>/dev/null || printf '%s' "${OUT6}" | head -c 200)"

# C7: relay-run 归属 + 时间窗 (PRD check 6; AI_ADDED 时间窗防 R3-R5 历史 run 冒充; 端点实测不做服务端过滤, 必须 jq 过滤)
OUT7=$(curl -sf -m 10 "localhost:5221/api/brain/harness/runs?initiative_id=${TASK_ID}" 2>&1); CODE7=$?
if [ "${CODE7}" -eq 0 ]; then
  printf '%s' "${OUT7}" | jq -e "[.[] | select(.initiative_id == \"${TASK_ID}\") | select(.started_at >= \"2026-07-24\")] | length >= 1" >/dev/null 2>&1; CODE7=$?
fi
record "C7-relay-run-ownership" "curl harness/runs + jq initiative_id 过滤 + started_at 时间窗" "${CODE7}" "$(printf '%s' "${OUT7}" | head -c 200)"

# C8: 生产版本自报对账 1.267.67 + merge commit 祖先校验 (铁律[自报对账]: 生产实体自报, 禁凭记忆)
OUT8=$(curl -sf -m 10 "localhost:5221/api/brain/health" 2>&1); CODE8=$?
if [ "${CODE8}" -eq 0 ]; then
  printf '%s' "${OUT8}" | jq -e ".version == \"1.267.67\"" >/dev/null 2>&1; CODE8=$?
fi
if [ "${CODE8}" -eq 0 ]; then
  git merge-base --is-ancestor 19887912bbb581597f12c714a9ed187f051e2850 origin/main || CODE8=1
fi
record "C8-version-selfreport" "curl health + jq version==1.267.67 + git merge-base --is-ancestor 19887912b origin/main" "${CODE8}" "$(printf '%s' "${OUT8}" | head -c 200)"

# C9: 防提前 merge/历史冒充 — evaluator 时点目标文档不得已在 origin/main (AI_ADDED 反向闩)
CODE9=0
if git cat-file -e "origin/main:${DOC}" 2>/dev/null; then CODE9=1; OUT9="doc already on origin/main - premature merge or stale impersonation"; else OUT9="not on main as expected"; fi
record "C9-not-premerged" "git cat-file -e origin/main:${DOC} (期望不存在)" "${CODE9}" "${OUT9}"

if [ "${FAILED}" -eq 0 ]; then
  echo "✅ Golden Path 验证通过 KERNEL_V1_MIXED_R6_E2E_PASS"
else
  echo "❌ E2E FAIL - 失败原因按上方 CHECK-FAIL 条目如实写入 relay-runs, 不得伪造 PASS 标记"
  exit 1
fi
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| R6 交付文档标记与证据 | `sprints/07242040-kernel-fire-drill-mixed-r6/tests/fire-drill-r6-doc.test.ts` | KERNEL_V1_MIXED_FIRE_DRILL_PASS_R6 标记；生产版本 1.267.67 与 merge commit；五角色 provider/account 运行证据摘要 | → 3 failures（目标文档尚不存在） |

## notes

- contract-gate: applicable (packages/brain/src/lib/contract-gate.js 存在，cecelia 场景，走代码层 gate)
- 预绿声明（诚实标注，供 Reviewer 审）：B4/B5/B6/B7 四条在 delivery 代码「一行未写」时即绿——它们不是交付物 oracle，而是 PRD check 5/6 与 NFR 版本锚定明文要求的【链路/生产状态审计项】（task 注册态、relay-run 留痕、生产版本自报、未提前 merge 反向闩）。交付物本体的红绿由 B1/B2/B3/B8 + A1/A2/A3 + tests/ 3 failures 承担，当前全红（TDD Red 证据见 Oracle 真跑留痕表）。
- 铁律 [环境入库] 观察登记：task payload 实测无 target_environment 键（keys: base_repo/harness_runtime/orchestrator/review_required/role_assignments/sprint_dir/timeout_seconds/worktree_path），PRD 已声明 target_environment=local_api。本合同不据此设硬断言（修 payload 属 packages/brain 范围，PRD 明令不在范围内），如实上报给 controller 决定是否另开 issue。
- 铁律 [禁抄先例]：本合同全部断言基于本轮实测（tasks/runs/health 三端点真调留痕于「Oracle 真跑留痕」段），未复用历史 fire drill 合同模板。
- PRD check 7/8（judge 时点无批准+未 merge；批准后才 merge/report）属 judge/controller 时点核验，验证命令已写入 Golden Path Step 5/6，不进 evaluator E2E（evaluator 时点断言 approved==0 会在合法重跑场景误伤，时序断言归属各自执行时点）。
