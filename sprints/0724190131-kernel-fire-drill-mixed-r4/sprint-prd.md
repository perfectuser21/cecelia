# Sprint PRD — Kernel v1 mixed provider 主链 fire drill（docs/fire-drills/kernel-v1-mixed-20260724-r4.md）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（okr_initiative: dbe02914）
- **当前进度**：82%
- **本次推进预期**：83%（mixed-provider 主链跑通并留下可核查证据）

## 背景

PR #4294（fix(kernel): close live generator branch and callback gaps）已合并部署，生产版本 1.267.67。本 sprint 是合并部署后的正式 mixed-provider 主链 fire drill：用一次 docs-only 变更验证 planner/proposer/reviewer/generator/evaluator/judge 全链在混合 provider 分配（claude + grok + codex）下端到端可用，并把运行证据沉淀成文档。近期 runs 历史显示多次失败（no_progress_same_sha、evaluator quota 429、generator_fix_callback_missing、watchdog_overdue），本次 r4 需产出干净的 PASS 证据。

## Golden Path（核心场景）

系统从 [Brain 派发 harness_initiative 91db186d] → 经过 [六角色接力 + 分支纪律机械确认] → 到达 [仅含一个 fire-drill 文档的 PR 经 authenticated human review 后 merge]

具体：
1. Brain 派发本 task（orchestrator=skill-relay），planner（claude/account1）产出本 PRD
2. proposer（claude/account1）起草合同，独立 reviewer（grok/grok）审合同
3. generator（codex/team3）读取服务端注入的 HARNESS_TASK_ID，从 origin/main 创建全新合规 cp-MMDDHHMM-<task-short-id> 分支（严禁复用 cp-harness-propose/contract 分支），仅新增 docs/fire-drills/kernel-v1-mixed-20260724-r4.md，文件包含标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R4、生产版本 1.267.67、merge commit 19887912bbb581597f12c714a9ed187f051e2850，以及各角色 provider/account 的实际运行证据摘要
4. generator 创建 PR 前用 `git diff --name-only origin/main...HEAD` 机械确认输出恰好一行 = docs/fire-drills/kernel-v1-mixed-20260724-r4.md（严禁 sprints/**、.harness/** 或合同产物进 PR）
5. 独立 evaluator（grok/grok）执行验收命令全部 PASS，independent judge 独立复核 PASS
6. authenticated human review 批准后才 merge；human review 前禁止 merge（出口）

## 边界情况

- 目标文档已存在（r4 重跑）→ 内容以本次 run 实际证据覆盖，不留旧轮次残渣
- 任一角色 provider/account 不可用（如 quota 429）→ 该角色失败如实上报，禁止换号伪装或跳过角色
- PR diff 出现第二个文件 → 分支纪律硬失败，generator 必须重建分支，不得追加 commit 掩盖

## 范围限定

**在范围内**：新增 docs/fire-drills/kernel-v1-mixed-20260724-r4.md 一个文件；全链角色运行证据的收集与摘要
**不在范围内**：packages/brain 任何改动、现有合同测试、迁移、产品逻辑；sprints/**、.harness/** 进 PR

## 假设

- [ASSUMPTION: 文档中生产版本 1.267.67 与 merge commit 19887912bbb581597f12c714a9ed187f051e2850 以 task description 为准，evaluator 按"生产实体自报"铁律对账]
- [ASSUMPTION: 各角色证据摘要来源 = payload.role_assignments（planner/proposer=claude·account1，reviewer/evaluator=grok·grok，generator=codex·team3）+ 各角色实际运行日志]

## 预期受影响文件

- `docs/fire-drills/kernel-v1-mixed-20260724-r4.md`: 本 sprint 唯一新增产物（PR 中唯一允许的 diff）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step 级 + journey_feature 级均为空），PrepPRD 显式值优先 -->
- 超时/延迟: 整链 timeout 28800 秒（payload.timeout_seconds）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 生产版本 1.267.67（task description 显式要求写入文档）
- 可观测: 各角色 provider/account 实际运行证据必须写入文档；失败角色如实记录

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重（step/feature 级为空，以下均为 area 级） -->
- [oracle留痕] 合同批准前必须记录 manual oracle 真实 exit code，并确认目标解释器确实启动（来源: area）
- [真跑验证] manual:node -e 双引号内 JS `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获（来源: area）
- [smoke占位] smoke-invariant-1784808160-58494（演练占位铁律）（来源: area）
- [smoke占位] smoke-invariant-1784806023-5054（演练占位铁律）（来源: area）
- [热态用例] 测试若全依赖"重置状态=冷启动"写法，要专门补热态用例（来源: area）
- [防重复扣费] 周期性重扫同批数据且含外部付费调用时，必须有"是否已处理"前置检查（来源: area）
- [时间常数] 跨模块时间常数有隐含大小关系依赖时，必须显式写不变量断言或注释（来源: area）
- [theater检查] contract 含 android 关键词即使在排除列表也会触发 theater_mismatch，需核对（来源: area）
- [环境读DB] target_environment 从 DB tasks.payload 读取不从文件读，任务注册时必须正确设置（来源: area）
- [judge结果] Brain judge .brain-result.json 必须有顶层 exit_code + log_tail + behavior（来源: area）
- [字段截断] varchar 长度约束字段写入前若来源无天然长度保证，必须显式截断（来源: area）
- [复活先考古] 复活曾死过的功能前先 git log --diff-filter=D + git show 查历史（来源: area）
- [else必写] 调用"失败返回 null/false"契约函数时，成功分支后必须显式写 else（来源: area）
- [smoke占位] smoke-invariant-1784543934-2387（演练占位铁律）（来源: area）
- [report兜底] journey_features.updated_at 长期停滞可作 report 阶段漏跑的兜底探针（来源: area）
- [report必跑] relay 容器可能在 Step 6 merge 后异常退出跳过 Step 7 report，需兜底（来源: area）
- [headed核对] 起草 host/环境白名单类断言时强制核对 headed 人工接管场景（来源: area）
- [headed点火] headed relay 点火必须把 base_repo/pr_url 写入 payload，分支名带 task short id（来源: area）
- [退役实锤] 退役判断依据查生产库实锤（状态分布/行数/消费方 grep），不靠记忆（来源: area）
- [吞错计数] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（来源: area）
- [表认领] 建新表/复用表前先 grep 全部写入方，双写方必须 schema 对齐评审（来源: area）
- [消费方] 新增后台 job 必须同时声明消费方，无下游读方的落库 job 不允许上线（来源: area）
- [多设备UI] 多设备类型(os_type/device_platform) UI 区分必须在设计/审查阶段强制检查（来源: area）
- [语义一致] 同一语义（如 git_sha=unknown）判变端与终验端必须同一处理策略（来源: area）
- [ref校验] git rev-parse 判 ref 存在必须带 --verify "<ref>^{commit}"（来源: area）
- [worktree隔离] smoke 用真实 worktree 当 CECELIA_DEPLOY_ROOT 时必须核对不触碰生产资源（来源: area）
- [禁降级] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（来源: area）
- [自报对账] 判变基准永远用生产实体自报（build-info.json/health.git_sha）对账 origin/main（来源: area）
- [lint要求] lint-test-quality 要求 await fn() ≥1，读源码必须包 async function（来源: area）
- [合同表格] Test Contract 固定 4 列格式，testFile 用 backtick 包裹，checker 从第 3 列解析路径（来源: area）
- [精确add] Red commit 必须只 git add 精确路径，禁止 git add . 或 git add .harness（来源: area）
- [源码检验] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [cron接线] 新增 cron 功能先查 scheduler-jobs.js JOBS；tick-runner.js 是 deprecated 路径（来源: area）
- [禁自merge] 禁止 generator 自行 merge PR，merge 权归 controller（来源: area）
- [tmux环境] headed relay tmux 子 shell 不继承父环境变量，需要的变量必须显式传递（来源: area）
- [禁抄模板] Proposer 复用历史合同模板（尤其 E2E 断言）前必须核对本次任务真实派发/执行历史（来源: area）
- [CI禁区] generator 默认禁改共享 CI 基础设施文件（.github/workflows/*.yml）（来源: area）
- [提前合并] PR 被 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR 实际状态对账（来源: area）
- [smoke占位] smoke-invariant-1783850042-79911（演练占位铁律）（来源: area）
- [smoke登记] feat+brain/src PR 开 PR 前一次带齐 smoke.sh + smoke-allowlist 登记（来源: area）
- [七点清单] 新 task_type 接线用七点清单（CHECK 约束/task-router 四表/EXECUTOR_KIND_FOR 等）（来源: area）
- [双信号] 服务"该活着"判定用双信号：launchctl 状态 + 端口监听（来源: area）
- [禁LaunchAgents] 美国 Mac mini 禁止再往 ~/Library/LaunchAgents 放常驻服务（来源: area）
- [巡逻登记] 新增常驻宿主服务必须同步加进 launchd-patrol.js manifest（来源: area）
- [smoke占位] smoke-invariant-1783693282-93097（演练占位铁律）（来源: area）
- [串行slot] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [禁写死] 禁止写死环境假设值（来源: area）
- [真环境] 真环境验证才算 done（来源: area）
- [多租户] 测试默认多租户（来源: area）
- [凭据安全] 凭据以 1Password 为唯一源，绝不提交 git（来源: area）
- [日志脱敏] 日志必须脱敏（来源: area）
- [端点鉴权] 端点必须鉴权（来源: area）
- [租户隔离] 记忆/数据按租户隔离（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

> Planner 初稿占位；最终可执行脚本由 proposer 按 target_environment=local_api 在 GAN 阶段产出。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl/test/grep 本地机械检查）
# 期望验收点（自然语言）：
# 1. test -f docs/fire-drills/kernel-v1-mixed-20260724-r4.md 通过
# 2. grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS_R4 docs/fire-drills/kernel-v1-mixed-20260724-r4.md 通过
# 3. 文件含字面 "1.267.67" 与 "19887912bbb581597f12c714a9ed187f051e2850"
# 4. 文件含各角色 provider/account 实际运行证据摘要（planner/proposer=claude·account1，reviewer/evaluator=grok·grok，generator=codex·team3）
# 5. git diff --name-only origin/main...HEAD 输出恰好一行且为 docs/fire-drills/kernel-v1-mixed-20260724-r4.md
# 6. merge 发生在 authenticated human review 批准之后（human review 前禁止 merge）
```

## journey_type: autonomous
## journey_type_reason: docs-only fire drill，不涉及 dashboard/agent 协议/engine，验证的是 Brain 侧 harness 主链自治运转
## target_environment: local_api
## target_environment_reason: 验收全部为本地机械检查（test -f + grep + git diff 对 localhost 工作区），无 UI/Windows/生产服务器依赖
## journey_id: none
## step_id: none（PrepPRD 未锚定）
