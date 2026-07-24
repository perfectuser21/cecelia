---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: [FIRE DRILL 2026-07-24] Kernel v1 mixed provider 上岗考试

**范围**: 仅新增 `docs/fire-drills/kernel-v1-mixed-20260724.md` 一个文件（目录不存在，由本 sprint 创建）；packages/brain、现有合同测试、migrations、共享 CI 工作流零改动
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] docs/fire-drills/kernel-v1-mixed-20260724.md 存在且非空
  Test: node -e "const c=require('fs').readFileSync('docs/fire-drills/kernel-v1-mixed-20260724.md','utf8');if(c.trim().length===0)process.exit(1)"

- [ ] [ARTIFACT] 文档含 5 条 role_assignments 计划分配对照字面（planner=claude/account1 等，来自 PRD GP 第 1 条）
  Test: node -e "const c=require('fs').readFileSync('docs/fire-drills/kernel-v1-mixed-20260724.md','utf8');for(const a of ['planner=claude/account1','proposer=claude/account1','reviewer=grok/grok','generator=codex/team3','evaluator=claude/account2'])if(!c.includes(a))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令，evaluator 直接跑；全部为逻辑断言，仓库根目录执行）

- [ ] [BEHAVIOR] [L2] 演练文档存在且含 fire drill 标记（任务规定最低验收命令 1+2 — Golden Path Step 1）
  动作: generator 在分支上新增 docs/fire-drills/kernel-v1-mixed-20260724.md 并提交
  预期观察: 仓库根目录下该文件存在，内容含字面标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS
  验证命令: Test: manual:bash -c 'test -f docs/fire-drills/kernel-v1-mixed-20260724.md && grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS docs/fire-drills/kernel-v1-mixed-20260724.md && echo OK'
  期望: OK（红证据 2026-07-24：交付物缺失时 exit=1）

- [ ] [BEHAVIOR] [L2] 演练文档含生产版本与 merge commit 字面（Golden Path Step 1）
  动作: generator 把生产版本与 PR #4226 merge commit 写入文档
  预期观察: 文档含字面 1.267.65 与 4ff4112ae55bbab9467dcecff6be0ba222a67cd8
  验证命令: Test: manual:bash -c 'grep -q "1\.267\.65" docs/fire-drills/kernel-v1-mixed-20260724.md && grep -q 4ff4112ae55bbab9467dcecff6be0ba222a67cd8 docs/fire-drills/kernel-v1-mixed-20260724.md && echo OK'
  期望: OK（红证据：exit=2 文件不存在）

- [ ] [BEHAVIOR] [L2] 六角色证据段结构齐全且含 role_assignments 对照（Golden Path Step 2）
  动作: generator 为 planner/proposer/reviewer/generator/evaluator/judge 各写一个 `## role: <name>` 段，段内含 - provider: / - account: / - evidence: 三行（角色不可用时 evidence 如实记录失败/替补），并写入 5 条计划分配对照字面
  预期观察: 六段齐全，每段三字段行齐全，5 条对照字面在文档中可 grep 到
  验证命令: Test: manual:bash -c 'node sprints/07241410-kernel-fire-drill-mixed/tests/check-roles.cjs'
  期望: stdout OK，exit 0（红证据：exit=1 FAIL 文件不存在；绿路径已用样例文档校验 exit=0）

- [ ] [BEHAVIOR] [L2] 越界零改动 — 三点 diff 仅新增交付物，禁区零触碰（Golden Path Step 3）
  动作: generator 提交后，分支相对 origin/main 的 diff 仅含允许路径
  预期观察: diff 含状态 A 的 docs/fire-drills/kernel-v1-mixed-20260724.md；packages/brain/、migrations/、.github/workflows/ 零触碰；无现有测试（*.test.*/*.spec.*/__tests__/，含 tests/regression/relay-50170af2/ kernel 回归契约）被修改或删除
  验证命令: Test: manual:bash -c 'node sprints/07241410-kernel-fire-drill-mixed/tests/check-scope.cjs'
  期望: stdout OK，exit 0（红证据：exit=1 FAIL diff 中未新增交付物；git 基线不可达时显式 FAIL 不跳过）

- [ ] [BEHAVIOR] [L2] error path — oracle 敏感性负向自证：剔除标记后 grep 必不中（Golden Path Step 4）
  动作: 从文档剔除含 KERNEL_V1_MIXED_FIRE_DRILL_PASS 的行生成临时副本，在副本上复跑标记断言
  预期观察: 副本上标记 grep 不中（证明标记断言真在检内容、非恒真；对应 PRD 边界情况"遗漏字面量→验收 FAIL"的可检测性）
  验证命令: Test: manual:bash -c 'TMP=$(mktemp); grep -v KERNEL_V1_MIXED_FIRE_DRILL_PASS docs/fire-drills/kernel-v1-mixed-20260724.md > "$TMP" && if grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS "$TMP"; then echo "FAIL: oracle 不敏感"; exit 1; else echo OK; fi'
  期望: OK（红证据：exit=2 文件不存在）

- [ ] [BEHAVIOR] [L2] INV-1 [secrets]/[PII] — 演练文档不含明文凭据模式（Golden Path Step 4）
  动作: generator 写角色证据摘要时只写角色名/provider/account 别名/产物指针，不落任何密钥或聊天内容
  预期观察: 文档不命中常见凭据模式（sk-*/ghp_*/xoxb-/AKIA*/PRIVATE KEY）
  验证命令: Test: manual:bash -c 'test -f docs/fire-drills/kernel-v1-mixed-20260724.md || exit 1; if grep -qE "(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xoxb-|AKIA[0-9A-Z]{16})" docs/fire-drills/kernel-v1-mixed-20260724.md; then echo "FAIL: 疑似明文凭据"; exit 1; fi; echo OK'
  期望: OK（红证据：exit=1 文件不存在时先挂 test -f）

## 铁律映射（Invariant 覆盖 — Step 1.3 三源之一，逐条声明）

**有 INV 条目**：
- [secrets] → INV-1（上方 BEHAVIOR 第 6 条，凭据模式机检）
- [PII] → INV-1 同条覆盖（证据摘要限定为角色/provider/account/产物指针，无聊天内容明文）

**过程纪律已履行（本合同流程内完成，证据见 contract-draft.md notes）**：
- [oracle留证] 已履行：六条 manual oracle 红路径 exit code 已记录（1/2/1/1/2/1），解释器启动已确认
- [模板真跑] 已履行：全部 oracle 红/绿双路径真跑（绿路径用临时样例文档，验后已删）
- [禁抄先例] 已履行：断言全部从本 PRD 字面派生，未复用历史合同 E2E 模板
- [red精确add] 已履行：本轮 commit 仅 add 精确合同/测试路径
- [表格四列] 已履行：Test Contract 固定 4 列，testFile backtick 包裹
- [await包装] 已履行：vitest 测试每个 it 均 async 且含 await
- [theater检查] 已核对：合同全文不含该触发关键词
- [禁写死] 已核对：无屏幕坐标/UIA 阈值/环境假设值
- [语义一致] 已覆盖：判变端（DoD manual 命令）与终验端（E2E 脚本）复用同一组断言/同一 cjs 脚本，无跨脚本语义分叉
- [自报对账] 已覆盖：越界判定用三点 diff origin/main...HEAD，禁用工作区 diff
- [禁降级] 已覆盖：E2E 与 check-scope.cjs 全部失败路径显式 FAIL + exit 非零，基线不可达不跳过
- [失败分支] 已覆盖：check-scope.cjs 对 git diff 失败显式 else FAIL 分支
- [接缝真验] 已覆盖：接缝清单为空（全逻辑断言），无 logic-done-pending 项
- [CI禁区] 已覆盖：.github/workflows/ 列入 check-scope.cjs 禁区
- [禁自merge] 已写入 Golden Path 流程性说明：merge 权在 controller，human review 前禁 merge

**N/A（本 sprint 仅新增一份 docs 文档，无对应面）**：
- [热态测试] N/A：无周期扫描/状态重置代码
- [防重扫计费] N/A：无外部付费调用
- [时间常数] N/A：无跨模块时间常数
- [环境字段] N/A：不注册新任务，target_environment 已在 payload（local_api）
- [judge格式] N/A：不改 judge API
- [长度截断] N/A：无 DB 写入
- [复活核对] N/A：无功能复活
- [停滞探针] N/A：不涉 journey_features
- [report闸门] N/A：不改 relay/report 机制，本单机械闸门为 review_required=true
- [白名单核对] N/A：无 host/环境白名单断言
- [点火payload] N/A：非 headed relay 点火
- [退役实锤] N/A：无退役判断
- [失败计数] N/A：无后台 job
- [表名认领] N/A：无建表/写表
- [消费方] N/A：无新后台 job
- [设备区分] N/A：无多设备 UI
- [语义重叠] N/A：无新字段
- [rev-parse] N/A：合同命令未使用 git rev-parse
- [worktree隔离] N/A：不以 worktree 为部署根
- [源码验证] N/A：无调度接线
- [cron入口] N/A：无 cron 功能
- [tmux环境] N/A：非 headed relay
- [SHA核对] N/A：合同层无 merge 动作，PR 合并核对由 controller/judge 层执行
- [一次带齐] N/A：非 brain/src PR（packages/brain 为禁改区）
- [七点清单] N/A：无新 task_type
- [双信号] N/A：无服务存活判定
- [禁LaunchAgents] N/A：不涉 Mac 常驻服务
- [巡检manifest] N/A：无新增宿主服务
- [slot串行] N/A：流程层约束由 Harness kernel 承载
- [多租户测试] N/A：无租户数据面
- [必须auth] N/A：无新 API 端点
- [租户scope] N/A：无租户数据查询/写入
- [smoke占位 smoke-invariant-* ×5] N/A：冒烟测试占位行，无业务约束
