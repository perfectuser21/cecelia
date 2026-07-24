# Sprint PRD — Kernel v1 mixed-provider fire drill 演练文档（docs/fire-drills/kernel-v1-mixed-20260724.md）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（okr_initiative: dbe02914）
- **当前进度**：82%
- **本次推进预期**：+1%（Harness Kernel v1 mixed-provider 接力链首次全角色实证）

## 背景

PR #4226（Harness Kernel 有界运行与正确恢复，merge commit 4ff4112ae55bbab9467dcecff6be0ba222a67cd8）已合并，生产版本 1.267.65。本 sprint 是合并后的正式 mixed-provider fire drill：用一次真实接力链运行证明各角色能按 role_assignments 在混合 provider/account 上运转，并把运行证据固化成一份演练文档。

## Golden Path（核心场景）

系统从 [Brain 派发 harness_initiative fire drill 任务] → 经过 [各角色按 mixed provider 分配依次执行并留下证据] → 到达 [演练文档合入且验收命令通过]

具体：
1. Brain 派发本 fire drill 任务（trigger_source=manual_fire_drill），role_assignments：planner=claude/account1、proposer=claude/account1、reviewer=grok/grok、generator=codex/team3、evaluator=claude/account2，另有 independent judge 与 authenticated human review。
2. 接力链依次运行 planner → proposer → 独立 reviewer → generator → 独立 evaluator → independent judge，任何角色不得跳过；human review 通过前禁止 merge。
3. generator 新增唯一交付物 `docs/fire-drills/kernel-v1-mixed-20260724.md`，内容必须包含：
   - 字面标记 `KERNEL_V1_MIXED_FIRE_DRILL_PASS`
   - 生产版本字面 `1.267.65`
   - merge commit 字面 `4ff4112ae55bbab9467dcecff6be0ba222a67cd8`
   - 各角色 provider/account 的实际运行证据摘要（每角色一段：角色名、provider、account、实际执行动作/产物指针）
4. 可观测结果：验收命令在仓库根目录通过；PR 进入 authenticated human review 状态等待人工确认。

## 边界情况

- 某角色 provider/account 实际不可用 → 该角色证据段必须如实记录失败/替补情况，不得编造"全绿"
- `docs/fire-drills/` 目录当前不存在 → 由本 sprint 创建
- 演练文档遗漏三个字面量（标记/版本/commit）之一 → 验收 FAIL

## 范围限定

**在范围内**：仅新增 `docs/fire-drills/kernel-v1-mixed-20260724.md` 一个文件
**不在范围内**：packages/brain 任何改动、现有合同测试、迁移（migrations）、产品逻辑、共享 CI 工作流

## 假设

- [ASSUMPTION: 各角色"实际运行证据"以本次 run（run_id b932ad01）各阶段产物/日志摘要为准，不要求外部审计格式]

## 预期受影响文件

- `docs/fire-drills/kernel-v1-mixed-20260724.md`: 新增（唯一交付物）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 双源均为空数组），PrepPRD/payload 显式值优先 -->
- 超时/延迟: 单阶段执行超时 1800 秒（payload.timeout_seconds）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 生产版本 1.267.65（文档必须字面包含）
- 可观测: review_required=true — evaluator PASS 后必须经 authenticated human review 才能 merge；文档须含各角色真实运行证据

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature 两源为空，area 级 53 条全量注入（其中 5 条 smoke-invariant-* 为冒烟测试占位行，折叠为末尾一行） -->
- [oracle留证] 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动（来源: area）
- [模板真跑] manual:node -e 双引号中的 JS `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure（来源: area）
- [热态测试] 全依赖"重置状态=冷启动"写法的测试，须补至少一条真实多轮扫描、状态不重置、时间真实流逝的集成测试（来源: area）
- [防重扫计费] 周期性重扫数据且含外部付费调用时，必须设计"是否已处理过"前置检查（来源: area）
- [时间常数] 跨模块时间常数有隐含大小关系依赖时，必须显式写不变量断言或注释（来源: area）
- [theater检查] contract 文本出现 android 关键词即触发 theater 不匹配警告，即使在排除说明列表内（来源: area）
- [环境字段] target_environment 由 Brain 从 DB tasks.payload 读取，注册时必须写入 payload（来源: area）
- [judge格式] Brain judge API 必须有顶层 exit_code + log_tail + behavior_tests[]，每条含 exit_code + log_tail（来源: area）
- [长度截断] DB varchar 字段写入无天然长度保证的来源数据必须显式截断（来源: area）
- [复活核对] 复活曾死过的功能前先 git log --diff-filter=D 读退役前真实代码核对（来源: area）
- [失败分支] 调用"返回 null/false 表示失败"契约的函数必须显式写 else 失败分支（来源: area）
- [停滞探针] journey_features.updated_at 长期停滞可作为 report 阶段漏跑的兜底探针（来源: area）
- [report闸门] relay 容器可能 merge 后异常退出跳过 report，硬约束不能只写 prompt，需机械闸门（来源: area）
- [白名单核对] 起草 host/环境白名单类断言时强制核对 headed 人工接管场景（来源: area）
- [点火payload] headed relay 点火必须把 base_repo/pr_url 写入 payload，分支名带 task short id（来源: area）
- [退役实锤] 退役判断依据查生产库实锤（状态分布/行数/消费方 grep），不靠记忆（来源: area）
- [失败计数] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（来源: area）
- [表名认领] 建新表/复用表前 grep 全部写入方，同表多写方必须 schema 对齐评审（来源: area）
- [消费方] 新后台 job 必须声明真实消费方，无下游读方的落库 job 不上线（来源: area）
- [设备区分] 多设备类型（os_type/device_platform）UI 区分必须在设计/审查阶段强制检查（来源: area）
- [语义重叠] 新字段与既有字段语义重叠须本 sprint 内消解或建正式 decision 挂任务队列，禁止只写文档留债（来源: area）
- [语义一致] 同一语义在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [rev-parse] git rev-parse 判 ref 存在必须带 --verify "<ref>^{commit}"，裸 rev-parse 失败回显字面量（来源: area）
- [worktree隔离] smoke/测试用真实 worktree 当部署根时，必须核对被测脚本不向上触碰生产共享资源（来源: area）
- [禁降级] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（来源: area）
- [自报对账] 判变基准用生产实体自报（build-info.json / health.git_sha）对账 origin/main，禁用工作区 diff（来源: area）
- [await包装] lint-test-quality 要求 await fn() ≥1，读源码必须包装 async function（来源: area）
- [表格四列] Test Contract 表格固定 4 列，testFile 用 backtick 包裹，checker 从第 3 列解析路径（来源: area）
- [red精确add] Red commit 必须只 git add 精确测试路径，禁止 git add . 或 git add .harness/（来源: area）
- [源码验证] 回归测试用 source-code inspection 验证调度接线，比 mock 覆盖更直接有效（来源: area）
- [cron入口] 新增 cron 功能先查 scheduler-jobs.js JOBS；tick-runner.js 是 deprecated 路径（来源: area）
- [禁自merge] generator 禁止自行 merge PR，merge 权归 controller，generator 只推 branch 并报告（来源: area）
- [tmux环境] headed relay tmux 子 shell 不继承父环境变量，harness 上下文变量必须显式传递（来源: area）
- [禁抄先例] proposer 复用历史合同模板（尤其 E2E 断言）必须先核对本次任务真实派发/执行历史（来源: area）
- [CI禁区] 共享 CI 基础设施文件（.github/workflows/*.yml、smoke-allowlist 等）为 generator 默认禁区（来源: area）
- [SHA核对] PR 被 CI 兜底机制提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict（来源: area）
- [一次带齐] feat+brain/src PR 开 PR 前一次带齐 smoke.sh + smoke-allowlist 登记（来源: area）
- [七点清单] 新 task_type 接线走七点清单（CHECK 约束/task-router 四表/EXECUTOR_KIND_FOR/dispatch 分支等）（来源: area）
- [双信号] 服务存活判定用双信号：launchctl 状态 + 端口监听（来源: area）
- [禁LaunchAgents] 美国 Mac mini 禁止往 ~/Library/LaunchAgents 放常驻服务，用系统域 LaunchDaemon（来源: area）
- [巡检manifest] 新增常驻宿主服务必须同步加进 launchd-patrol.js 的 manifest（来源: area）
- [slot串行] 一个 slot/会话内严格串行执行任务，前一个收口后才起下一个；并行用多 slot（来源: area）
- [禁写死] 屏幕坐标/UIA 阈值/环境假设值禁止写死，从环境推导或真机校准（来源: area）
- [接缝真验] 依赖真机/生产 env 的接缝断言必须在真目标上验证过才算 done，否则只能标 logic-done-pending（来源: area）
- [多租户测试] 单元/E2E 测试默认种 ≥2 租户并断言互不串（来源: area）
- [secrets] secrets 不硬编码、不进 git、不进日志（来源: area）
- [PII] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [必须auth] 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area）
- [租户scope] 碰租户数据的查询/写入必须 scope 到当前租户，跨租户绝不混读/混写（来源: area）
- [smoke占位] smoke-invariant-* 冒烟测试占位铁律 ×5（来源: area，测试产物，无业务约束）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；task.payload 无 journey_id，优雅降级为仅 step/feature/area 级 -->
（本 line 暂无历史）

## E2E 验收

> 占位：最终可执行 E2E 脚本由 proposer 在 GAN 阶段产出（target_environment=local_api → bash 本地模板）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. 文件存在：test -f docs/fire-drills/kernel-v1-mixed-20260724.md（任务规定最低验收命令之一）
# 2. 标记存在：grep -q KERNEL_V1_MIXED_FIRE_DRILL_PASS docs/fire-drills/kernel-v1-mixed-20260724.md（最低验收命令之二）
# 3. 版本与 commit 字面存在：grep -q '1\.267\.65' 与 grep -q 4ff4112ae55bbab9467dcecff6be0ba222a67cd8
# 4. 六角色（planner/proposer/reviewer/generator/evaluator/judge）provider+account 证据段齐全
# 5. 越界检查：diff 仅新增 docs/fire-drills/ 下一个文件；packages/brain、现有测试、migrations 零改动
```

## journey_type: autonomous
## journey_type_reason: 交付物为 docs 文档、流程为后台接力链自证，无 dashboard/engine/agent-bridge 代码路径，与 Brain run 记录（journey_type=autonomous）一致
## target_environment: local_api
## target_environment_reason: 验收命令为仓库本地 test -f + grep，evaluator 在本地工作区（localhost）执行即可，无需外部机器
## journey_id: none
## step_id: none（PrepPRD 未锚定）
