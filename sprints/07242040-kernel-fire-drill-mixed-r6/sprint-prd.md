# Sprint PRD — Kernel v1 mixed provider 最终主链验收 R6（fire drill 交付文档）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：83%（kernel-v1 mixed-provider 主链拿到最终 PASS 证据）

## 背景

PR #4294（19887912b，关闭 kernel 活体 generator 分支与 callback 缺口）已合并并部署至生产 1.267.67。此前 R3-R5 fire drill 均因 provider/quota 问题失败（R5: fire_drill_evaluator_grok_arg_max_repeated_provider_exit；R3: evaluator_account2_quota_429）。本 R6 为 mixed-provider（claude/grok/codex 三 provider 五角色）主链最终验收：以一份带机器可检标记的 fire drill 文档为唯一交付物，跑通 planner→proposer→独立 reviewer→generator→独立 evaluator→independent judge→认证人审的完整接力链。

## Golden Path（核心场景）

系统从 [controller 点火 planning] → 经过 [七角色接力] → 到达 [认证批准后 merge + report]

具体：
1. planner（claude/account1）产出本 sprint-prd.md；proposer（claude/account1）起草合同；独立 reviewer（grok/grok）审合同
2. generator（codex/team3）读取并核对 HARNESS_TASK_ID=CECELIA_TASK_ID=b21467a0-5a67-4787-9d48-92f6820c6b33，从 origin/main 在独立 delivery worktree 创建 cp-MMDDHHMM-b21467a0 分支（禁止在 controller 共享 worktree checkout delivery 分支，保住 sprint-prd/合同观察态）
3. generator 仅新增 docs/fire-drills/kernel-v1-mixed-20260724-r6.md，内容含标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R6、生产版本 1.267.67、merge commit 19887912bbb581597f12c714a9ed187f051e2850、五角色 provider/account 实际运行证据摘要；创建 PR 前机械核对 origin/main...HEAD diff 恰一行目标文档
4. 独立 evaluator（claude/account1）逐条执行验收 checks，每条记录 command、exit_code、log_tail
5. independent judge 作为 pre-human gate：judge 时尚无人工批准且 PR 未 merge 是 PASS 前置条件，禁止要求未来批准或 judge 自己尚未产生的输出
6. judge PASS 后才创建 human review request，认证人工批准后才 merge/report（review_required=true）

## 边界情况

- PR diff 出现第二个文件（sprints/**、.harness/**、合同产物）→ generator 开 PR 前必须拦截并重做 diff
- provider 中途退出 / quota 429（R3-R5 实际死因）→ 失败原因如实写入 relay-runs，不得伪造 PASS 标记
- judge 阶段发现 PR 已被提前 merge → 直接 FAIL（违反 pre-human gate 前置条件）

## 范围限定

**在范围内**：新增 docs/fire-drills/kernel-v1-mixed-20260724-r6.md 一个文件；七角色全链留痕
**不在范围内**：packages/brain 任何修改、现有合同测试、迁移、产品逻辑；sprints/**、.harness/**、合同产物入 PR

## 假设

- [ASSUMPTION: 生产 Brain 版本已是 1.267.67 且 19887912b 已部署——evaluator 须以生产实体自报为准复核，不凭记忆]
- [ASSUMPTION: relay-runs 归属校验以 Brain harness runs API 中 initiative_id=b21467a0-5a67-4787-9d48-92f6820c6b33 的记录为准]

## 预期受影响文件

- `docs/fire-drills/kernel-v1-mixed-20260724-r6.md`: 唯一交付物（delivery PR 只含此一行 diff）
- `sprints/07242040-kernel-fire-drill-mixed-r6/sprint-prd.md`: 合同观察态产物，走 planner 分支，禁止入 delivery PR

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本次 step/feature 两源均为空），PrepPRD 显式值优先 -->
- 超时/延迟: 全流程 timeout 28800 秒（payload 显式）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 生产版本 1.267.67；merge commit 19887912bbb581597f12c714a9ed187f051e2850
- 可观测: 每条验收 check 必须记录 command、exit_code、log_tail；失败原因如实入 relay-runs

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重（step/feature 为空，area 53 条全量注入） -->
- [oracle留痕] 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动（来源: area）
- [真跑校验] manual:node -e 双引号中的 JS `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure（来源: area）
- [smoke] smoke 铁律（冒烟占位 6041333c）（来源: area）
- [smoke] smoke 铁律（冒烟占位 a3989e96）（来源: area）
- [状态流逝] 测试不能全依赖"重置状态=冷启动"写法，须补至少一条真实多轮扫描、状态不重置、时间真实流逝的集成测试（来源: area）
- [重扫防重] 周期性重扫同批数据一旦引入外部付费调用，必须同时设计"是否已处理过"前置检查（来源: area）
- [时间常数] 跨模块时间常数有隐含大小关系依赖时，必须在设计阶段显式写不变量断言或注释（来源: area）
- [关键词误报] theater_mismatch：contract 出现 android 关键词即使在排除列表也会触发警告，按真实环境设 target_environment（来源: area）
- [环境入库] target_environment 由 Brain 从 DB tasks.payload 读取，注册任务时必须在 payload 正确设置（来源: area）
- [judge格式] Brain judge 结果必须有顶层 exit_code + log_tail + behavior_tests[]（每条含 exit_code + log_tail）（来源: area）
- [长度截断] DB varchar 字段写入无天然长度保证的来源数据（如路径）前必须显式截断（来源: area）
- [复活核档] 复活曾退役功能前先用 git log --diff-filter=D + git show 读退役前真实代码核对 death cause（来源: area）
- [错误码else] 调用"失败返回 null/false"契约的函数必须显式写 else 失败分支，不能只靠外层 try/catch（来源: area）
- [smoke] smoke 铁律（冒烟占位 33ede9f1）（来源: area）
- [report探针] journey_features.updated_at 长期停滞可作为 report 阶段漏跑的兜底探针信号（来源: area）
- [report闸门] harness-controller relay 可能在 merge 后异常退出跳过 report，Brain 侧不应仅凭容器 exit 0 判成功（来源: area）
- [白名单核对] proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景（来源: area）
- [点火留痕] headed relay 点火必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id（来源: area）
- [退役实锤] 退役判断依据数据不靠记忆，须查生产库实锤（状态分布/行数/消费方 grep）（来源: area）
- [失败计数] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（来源: area）
- [表名认领] 建新表/复用表前先 grep 全部写入方，两模块写同一张表必须 schema 对齐评审（来源: area）
- [声明消费方] 新增后台 job 必须同时声明消费方，无下游读方的落库 job 不允许上线（来源: area）
- [语义重叠] 新字段与既有字段语义重叠必须本 sprint 内消解或建正式 decision 挂任务队列，禁止只写"留给后续技术债"（来源: area）
- [语义一致] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本分叉开假绿面（来源: area）
- [rev-parse] git rev-parse 判 ref 存在必须带 --verify "<ref>^{commit}"，裸 rev-parse 失败回显字面量（来源: area）
- [worktree隔离] smoke/测试用真实 worktree 当部署根时，必须核对被测脚本不向上触碰生产资源（来源: area）
- [禁降级] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + 告警 + exit 非零（来源: area）
- [自报对账] 判变基准永远用生产实体自报（build-info/health.git_sha）对账 origin/main，禁用工作区 diff（来源: area）
- [async包装] lint-test-quality 要求 await fn() ≥1，读源码必须包装 async function（来源: area）
- [契约4列] Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 从第 3 列解析路径（来源: area）
- [精确add] Red commit 必须只 git add 精确路径（*.test.ts），禁止 git add . 或 git add .harness/（来源: area）
- [源码验线] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [cron入口] 新增 cron 功能先查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [禁自merge] 禁止 generator 自行 merge PR；merge 权归 controller，generator 只推分支并报告 ready（来源: area）
- [tmux环境] headed relay 的 tmux 子 shell 不继承父环境变量，HARNESS_TASK_ID 等须显式注入（来源: area）
- [禁抄先例] proposer 复用历史合同模板（尤其 E2E 断言）前必须核对本次任务真实派发/执行历史（来源: area）
- [CI禁区] generator 默认禁改共享 CI 基础设施文件（.github/workflows/*.yml、smoke-allowlist.txt 等）（来源: area）
- [SHA锚定] PR 若被 CI 兜底提前合并，必须用 PR head SHA 核对 evaluator/judge verdict 锚定的 sha（来源: area）
- [smoke] smoke 铁律（冒烟占位 552520d0）（来源: area）
- [一次带齐] feat+brain/src PR 开 PR 前一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area）
- [七点清单] 新 task_type 接线用七点清单（CHECK 约束/task-router 四表/EXECUTOR_KIND/dispatch 分支等）（来源: area）
- [双信号] 服务存活判定用双信号：launchctl 状态 + 端口监听（来源: area）
- [禁LaunchAgents] 美国 Mac mini 禁止往 ~/Library/LaunchAgents 放常驻服务，用系统域 LaunchDaemon（来源: area）
- [patrol登记] 新增常驻宿主服务必须同步加进 launchd-patrol.js 的 manifest（来源: area）
- [smoke] smoke 铁律（冒烟占位 4b73376c）（来源: area）
- [单slot串行] 一个 slot/会话内严格串行执行任务，并行只许跨 slot（来源: area）
- [禁写死假设] 屏幕坐标/UIA 阈值等环境假设值禁止写死，从环境推导或真机校准（来源: area）
- [真验才done] 依赖真机/生产 env 的接缝断言必须在真目标上验证过才算 done，否则只标 logic-done-pending（来源: area）
- [多租户测试] 单元/E2E 测试默认种 ≥2 个租户并断言互不串（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户，跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本 task 无 journey_id（非路径 C 点火），优雅降级 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿占位：最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl + git + gh）。以下框定端到端必须验到的点。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221 + git + gh）
# 期望验收点（自然语言，每条 check 必须记录 command、exit_code、log_tail）：
# 1. docs/fire-drills/kernel-v1-mixed-20260724-r6.md 存在，含 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R6、1.267.67、19887912bbb581597f12c714a9ed187f051e2850 三个字面
# 2. 文档含五角色 provider/account 实际运行证据摘要（planner/proposer=claude·account1，reviewer=grok·grok，generator=codex·team3，evaluator=claude·account1）
# 3. git diff origin/main...HEAD --name-only 恰一行 = 目标文档（无 sprints/**、.harness/**、合同产物）
# 4. PR head 分支为 cp-MMDDHHMM-b21467a0 形态、状态 OPEN、未 merge、CI 全绿
# 5. Brain task API：task b21467a0 的 payload.harness_runtime=kernel-v1 且五角色 role_assignments 与实际执行一致
# 6. Brain harness runs API：relay-run 归属 initiative_id=b21467a0-5a67-4787-9d48-92f6820c6b33
# 7. judge 执行时点核验：无人工批准记录、PR 未 merge（pre-human gate 前置条件）
# 8. judge PASS 后才存在 human review request；认证批准后才 merge/report
```

## journey_type: autonomous
## journey_type_reason: 交付物为 docs 文档、验收全走 Brain API + git/gh 后台校验，无 UI/engine/远端 agent 协议代码改动，命中后端自治链路
## target_environment: local_api
## target_environment_reason: evaluator 在本地用 curl localhost:5221 + git/gh 即可完成全部 checks，无浏览器或远端机器需求
## journey_id: none
## step_id: none（PrepPRD 未锚定）
