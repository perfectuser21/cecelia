---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: Kernel v1 mixed provider 最终主链验收 R6（fire drill 交付文档）

**范围**: 仅新增 docs/fire-drills/kernel-v1-mixed-20260724-r6.md 一个文件 + 七角色全链留痕；禁改 packages/brain、既有测试、迁移、产品逻辑；禁 sprints/**、.harness/**、合同产物入 delivery PR
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 目标文档存在且含三字面标记（PASS 标记 + 生产版本 + merge commit）
  Test: node -e "const c=require('fs').readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r6.md','utf8');['KERNEL_V1_MIXED_FIRE_DRILL_PASS_R6','1.267.67','19887912bbb581597f12c714a9ed187f051e2850'].forEach(m=>{if(!c.includes(m))process.exit(1)})"

- [ ] [ARTIFACT] 目标文档含五角色 provider/account 实际运行证据摘要（角色词与 provider/account 字面全命中）
  Test: node -e "const c=require('fs').readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r6.md','utf8').toLowerCase();['planner','proposer','reviewer','generator','evaluator','claude','grok','codex','team3','account1'].forEach(m=>{if(!c.includes(m))process.exit(1)})"

- [ ] [ARTIFACT] 目标文档不含凭据/secret 模式（铁律 [凭据安全]：secrets 不进 git）
  Test: node -e "const c=require('fs').readFileSync('docs/fire-drills/kernel-v1-mixed-20260724-r6.md','utf8');if(/(ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|BEGIN [A-Z ]*PRIVATE KEY)/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，journey_type = autonomous，全部真调生产 Brain/GitHub/git，零 mock）

- [ ] [BEHAVIOR] [L2] delivery PR diff 恰一行且为目标文档（Golden Path Step 3）
  动作: generator 从 origin/main 在独立 delivery worktree 建 cp-MMDDHHMM-b21467a0 分支，仅新增目标文档并推送开 PR
  预期观察: origin/main...origin/<HB> 的 name-only diff 与目标文档路径字符串完全相等（恰一行，无 sprints/**、.harness/**、合同产物）
  Test: manual:bash -c 'HB=$(gh pr list --state open --json headRefName --jq ".[].headRefName" | grep -E "^cp-[0-9]{8}-b21467a0$" | head -1); [ -n "$HB" ] || { echo "FAIL: 无形态匹配 OPEN PR"; exit 1; }; git fetch -q origin main "$HB"; D=$(git diff --name-only "origin/main...origin/$HB"); [ "$D" = "docs/fire-drills/kernel-v1-mixed-20260724-r6.md" ] || { echo "FAIL: diff=[$D]"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] delivery PR 分支形态正确且 OPEN、未 merge（Golden Path Step 2/5 前置；铁律 [点火留痕]/[禁自merge]）
  动作: generator 推送分支并开 PR，等待人审前任何角色不得 merge
  预期观察: 恰有 head 分支匹配 `^cp-[0-9]{8}-b21467a0$` 的 PR，state=OPEN 且 mergedAt=null
  Test: manual:bash -c 'HB=$(gh pr list --state open --json headRefName --jq ".[].headRefName" | grep -E "^cp-[0-9]{8}-b21467a0$" | head -1); [ -n "$HB" ] || exit 1; gh pr view "$HB" --json state,mergedAt | jq -e ".state == \"OPEN\" and .mergedAt == null" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] delivery PR CI 全绿，within 900s（until-loop 等待预算；gh pr checks 对 pending/failing 均退出非零）
  动作: PR 推送后 CI 自动触发
  预期观察: within 900s 内 gh pr checks 退出码变 0（全部 required checks 通过）
  Test: manual:bash -c 'HB=$(gh pr list --state open --json headRefName --jq ".[].headRefName" | grep -E "^cp-[0-9]{8}-b21467a0$" | head -1); [ -n "$HB" ] || exit 1; DEADLINE=$((SECONDS + 900)); until gh pr checks "$HB" >/dev/null 2>&1; do [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: CI within 900s 未全绿"; exit 1; }; sleep 30; done; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] Brain task payload 为 kernel-v1 且五角色 role_assignments 逐字段一致（PRD check 5；真调生产 Brain 5221）
  动作: controller 点火时按 mixed-provider 方案注册 task（claude/grok/codex 三 provider 五角色）
  预期观察: GET /api/brain/tasks/:id 返回 payload.harness_runtime=kernel-v1，planner=claude/account1、proposer=claude/account1、reviewer=grok/grok、generator=codex/team3、evaluator=claude/account1
  Test: manual:bash -c 'curl -sf -m 10 "localhost:5221/api/brain/tasks/b21467a0-5a67-4787-9d48-92f6820c6b33" | jq -e ".payload.harness_runtime == \"kernel-v1\" and .payload.role_assignments.planner.provider == \"claude\" and .payload.role_assignments.planner.account == \"account1\" and .payload.role_assignments.proposer.provider == \"claude\" and .payload.role_assignments.proposer.account == \"account1\" and .payload.role_assignments.reviewer.provider == \"grok\" and .payload.role_assignments.reviewer.account == \"grok\" and .payload.role_assignments.generator.provider == \"codex\" and .payload.role_assignments.generator.account == \"team3\" and .payload.role_assignments.evaluator.provider == \"claude\" and .payload.role_assignments.evaluator.account == \"account1\"" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] relay-run 归属本 initiative 且落在本轮时间窗（PRD check 6；端点实测不做服务端过滤，必须 jq 过滤 + started_at ≥ 2026-07-24 防 R3-R5 历史 run 冒充）
  动作: 七角色接力过程中 Brain 持续写 harness runs 留痕
  预期观察: runs API 中 initiative_id=b21467a0-5a67-4787-9d48-92f6820c6b33 且 started_at ≥ 2026-07-24 的记录 ≥ 1 条
  Test: manual:bash -c 'curl -sf -m 10 "localhost:5221/api/brain/harness/runs?initiative_id=b21467a0-5a67-4787-9d48-92f6820c6b33" | jq -e "[.[] | select(.initiative_id == \"b21467a0-5a67-4787-9d48-92f6820c6b33\") | select(.started_at >= \"2026-07-24\")] | length >= 1" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] 生产版本自报 1.267.67 且 merge commit 为 origin/main 祖先（PRD NFR 版本锚定；铁律 [自报对账]：以生产实体自报为准，禁凭记忆）
  动作: evaluator 直调生产 Brain health 端点并对账 git 历史
  预期观察: health.version=1.267.67；19887912bbb581597f12c714a9ed187f051e2850 是 origin/main 祖先
  Test: manual:bash -c 'curl -sf -m 10 "localhost:5221/api/brain/health" | jq -e ".version == \"1.267.67\"" || exit 1; git fetch -q origin main; git merge-base --is-ancestor 19887912bbb581597f12c714a9ed187f051e2850 origin/main || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] 目标文档在 merge 前不得已在 origin/main（AI_ADDED 反向闩：防提前 merge/历史冒充；PRD 边界第 3 条 + 铁律 [SHA锚定]）
  动作: 无（反向断言——只要 pre-human gate 未破坏，此条恒真；提前 merge/兜底合并即变红）
  预期观察: evaluator/judge 时点 git cat-file 在 origin/main 上找不到目标文档
  Test: manual:bash -c 'git fetch -q origin main; if git cat-file -e "origin/main:docs/fire-drills/kernel-v1-mixed-20260724-r6.md" 2>/dev/null; then echo "FAIL: 文档已在 main - 提前 merge 或历史冒充"; exit 1; fi; echo OK'
  期望: OK

- [ ] [BEHAVIOR] [L2] 远端已推送的目标文档内容全字面命中（以 origin/<HB> 为准，防本地未推送假绿；含三标记 + 五角色证据）
  动作: generator 完成文档并推送
  预期观察: git show origin/<HB>:目标文档 能取到内容，三标记与五角色/provider/account 字面全命中
  Test: manual:bash -c 'HB=$(gh pr list --state open --json headRefName --jq ".[].headRefName" | grep -E "^cp-[0-9]{8}-b21467a0$" | head -1); [ -n "$HB" ] || exit 1; git fetch -q origin "$HB"; C=$(git show "origin/$HB:docs/fire-drills/kernel-v1-mixed-20260724-r6.md") || exit 1; for T in KERNEL_V1_MIXED_FIRE_DRILL_PASS_R6 1.267.67 19887912bbb581597f12c714a9ed187f051e2850 planner proposer reviewer generator evaluator claude grok codex team3 account1; do echo "$C" | grep -qi "$T" || { echo "FAIL: 缺 $T"; exit 1; }; done; echo OK'
  期望: OK

## 铁律映射（Step 1.3 三源之一 — PRD Invariant 53 条逐条处置，禁无声消失）

- INV-1 [oracle留痕] → 已履约：contract-draft.md「Oracle 真跑留痕」段记录了每条 manual oracle 本轮真实 exit_code，目标解释器（bash/node/jq/curl/gh/git）均真实启动
- INV-2 [真跑校验] → 已履约：全部 oracle 在 GAN 批准前逐条真跑（见同段）；本合同无 manual:node -e 双引号 JS ${} 形态命令
- N/A：INV-3 [smoke 6041333c] 冒烟占位，无实义
- N/A：INV-4 [smoke a3989e96] 冒烟占位，无实义
- N/A：INV-5 [状态流逝] 本单无状态扫描/重置类测试，纯文档交付
- N/A：INV-6 [重扫防重] 本单无周期重扫与外部付费调用
- N/A：INV-7 [时间常数] 本单无跨模块时间常数依赖
- INV-8 [关键词误报] → 已履约：本合同不含 android 关键词，target_environment=local_api 按真实验收环境设定
- INV-9 [环境入库] → 观察登记：task payload 实测无 target_environment 键（详见 contract-draft notes），修 payload 属 packages/brain 范围（PRD 明令范围外），如实上报 controller，不设硬断言
- N/A：INV-10 [judge格式] judge 侧输出协议义务，本合同不可代为执法；E2E 已按 command/exit_code/log_tail 逐 check 留痕对齐该协议
- N/A：INV-11 [长度截断] 本单无 DB varchar 写入
- N/A：INV-12 [复活核档] 本单不复活任何退役功能
- N/A：INV-13 [错误码else] 本单无新代码逻辑（唯一 diff 为文档）
- N/A：INV-14 [smoke 33ede9f1] 冒烟占位，无实义
- N/A：INV-15 [report探针] Brain 侧兜底探针，范围外
- N/A：INV-16 [report闸门] Brain 侧判成功逻辑，范围外；本合同 Step 6 已把 report 阶段终验（文档入 main）写为可执行命令供 controller 用
- N/A：INV-17 [白名单核对] 本合同无 host/环境白名单类断言
- INV-18 [点火留痕] → 由 B2 覆盖：payload 实测含 base_repo；delivery 分支名正则强制带 task short id b21467a0
- N/A：INV-19 [退役实锤] 本单无退役判断
- N/A：INV-20 [失败计数] 本单无 catch 吞错后台 job
- N/A：INV-21 [表名认领] 本单不建表不复用表
- N/A：INV-22 [声明消费方] 本单无新后台 job
- N/A：INV-23 [语义重叠] 本单无新字段
- INV-24 [语义一致] → 已履约：版本字面 1.267.67 在判变端（B6 health 自报）与终验端（A1/B8 文档字面）同一策略同一字面，无跨脚本分叉
- INV-25 [rev-parse] → 已履约：本合同不用裸 rev-parse 判 ref，改用 git merge-base --is-ancestor 与 git cat-file -e（语义明确不回显字面量）
- INV-26 [worktree隔离] → 由 Golden Path Step 2 硬条款覆盖：generator 必须独立 delivery worktree，禁止 controller 共享 worktree checkout delivery 分支；B1 恰一行 diff 间接执法（共享 worktree 污染会把 sprints/** 带进 diff）
- INV-27 [禁降级] → 已履约：E2E record() 任一 check 失败置 FAILED=1 并最终 exit 非零，无 warning 降级路径；DoD 每条命令失败即 exit 1
- INV-28 [自报对账] → 由 B6 覆盖：health.version 生产实体自报对账 + merge commit 祖先校验，禁用工作区推断
- INV-29 [async包装] → 已履约：tests/fire-drill-r6-doc.test.ts 每个 it() 为 async 且 await fs 读取 ≥ 1
- INV-30 [契约4列] → 已履约：contract-draft.md Test Contract 表固定 4 列，testFile 用 backtick 包裹
- INV-31 [精确add] → 已履约：本轮 propose 分支只 git add 四个精确路径（contract-draft.md / contract-dod.md / tests/ / task-plan.json），无 git add . 或 .harness/
- N/A：INV-32 [源码验线] 本单无调度接线改动
- N/A：INV-33 [cron入口] 本单无 cron 功能
- INV-34 [禁自merge] → 由 B2 + Golden Path Step 5/6 覆盖：evaluator/judge 时点 mergedAt 必须为 null，认证批准后 merge 权归 controller
- INV-35 [tmux环境] → 由 Golden Path Step 2 硬条款覆盖：generator 必须显式核对 HARNESS_TASK_ID=CECELIA_TASK_ID=b21467a0-5a67-4787-9d48-92f6820c6b33，不等则 BLOCKED
- INV-36 [禁抄先例] → 已履约：全部断言来自本轮三端点实测（见 Oracle 真跑留痕），未复用历史 fire drill 合同模板
- INV-37 [CI禁区] → 由 B1 覆盖：diff 恰一行目标文档，.github/workflows/** 等共享 CI 文件不可能入 PR
- INV-38 [SHA锚定] → 由 B7 覆盖：PR 被 CI 兜底提前合并时 cat-file 反向闩变红，judge 直接 FAIL
- N/A：INV-39 [smoke 552520d0] 冒烟占位，无实义
- N/A：INV-40 [一次带齐] 本单无 feat+brain/src PR
- N/A：INV-41 [七点清单] 本单无新 task_type 接线
- N/A：INV-42 [双信号] 本单无服务存活判定
- N/A：INV-43 [禁LaunchAgents] 本单不部署常驻服务
- N/A：INV-44 [patrol登记] 本单无新增宿主服务
- N/A：INV-45 [smoke 4b73376c] 冒烟占位，无实义
- N/A：INV-46 [单slot串行] 编排层职责（kernel-v1 调度语义），非本合同可断言面；主链本身即单链串行接力
- INV-47 [禁写死假设] → 已履约：合同无屏幕坐标/UIA 阈值类环境假设值；版本与 commit 字面为 PRD NFR 显式锚定值且经生产自报实测核对（非假设）
- INV-48 [真验才done] → 已履约：接缝清单 3 项（GitHub/生产 Brain/git origin）全部在真目标验证，无 logic-done-pending 项
- N/A：INV-49 [多租户测试] 本单不碰租户数据
- INV-50 [凭据安全] → 由 A3 覆盖：目标文档反向 grep 凭据模式（ghp_/sk-/AKIA/PRIVATE KEY），命中即 FAIL
- N/A：INV-51 [日志脱敏] 交付文档为演练证据摘要，无 PII/聊天内容来源；A3 附带目检
- N/A：INV-52 [端点鉴权] 本单无新 API 端点
- N/A：INV-53 [租户隔离] 本单无租户数据查询/写入
