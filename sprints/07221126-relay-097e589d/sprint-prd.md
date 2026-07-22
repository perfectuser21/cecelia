# Sprint PRD — claude-headed-smoke：headed relay 链冒烟（Brain 纯函数 smoke stamp）

## OKR 对齐

- **对应 KR**：O2「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」下的 harness pipeline 可靠性
- **当前进度**：82%（O2 整体）
- **本次推进预期**：+0%（冒烟验证，不推进业务功能；验证 headed relay 链可用性）

## 背景

本任务是 headed relay 冒烟（journey：Cecelia Harness Pipeline，dev_pipeline 类型）。
目的不是交付业务功能，而是让一个对生产逻辑零风险的最小改动走完整条
planner→GAN→generator→evaluator→judge→merge→report 链路，验证 headed claude
session 下 relay 全链可跑通。payload 无 thin_prd，scope 由 relay controller 锚定为
最小 thin-slice 冒烟切片。

## Golden Path（核心场景）

系统从 [调用冒烟纯函数] → 经过 [确定性格式化] → 到达 [可断言的冒烟戳字符串]

具体：
1. 调用方（单测 / node -e）import `packages/brain/src/utils/relay-smoke.js` 并调用
   `formatSmokeStamp(taskId, date)`，传入任务 UUID 字符串与 Date 对象
2. 系统纯函数处理：取 taskId 前 8 位 + 日期 YYYYMMDD，拼接为确定性字符串
3. 可观测结果：返回形如 `smoke:097e589d:20260722` 的字符串；同输入必得同输出

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- taskId 为空字符串 / 非字符串 → 抛 TypeError（不静默返回）
- date 非合法 Date（含 Invalid Date）→ 抛 TypeError
- taskId 不足 8 位 → 使用完整 taskId，不报错

## 范围限定

**在范围内**：
- 新增 `packages/brain/src/utils/relay-smoke.js` 一个纯函数（零生产接线，不被任何现有模块 import）
- 对应单元测试（TDD：Red commit → Green commit），进入 brain-ci 常跑

**不在范围内**：
- 任何现有 Brain 路由 / 调度 / DB / API 行为改动
- 任何前端、engine hooks、部署脚本改动
- 把该函数接入任何生产调用点

## 假设

- [ASSUMPTION: payload 无 thin_prd，冒烟主题由 relay controller 指令锚定为「packages/brain 下新增纯函数冒烟目标」]
- [ASSUMPTION: 冒烟函数命名与文件路径可由 GAN 阶段微调，但必须保持零生产接线、纯函数、单文件]

## 预期受影响文件

- `packages/brain/src/utils/relay-smoke.js`: 新增冒烟纯函数
- `packages/brain/src/utils/relay-smoke.test.js`（或 tests/ 约定位置）: 新增单元测试

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step 级 + feature 级均为空数组），PrepPRD 缺失 -->
- N/A（冒烟切片：decisions 无 NFR 记录，PrepPRD 未指定；纯函数无超时/频控/版本要求）
- 可观测：单元测试必须进入 brain-ci 并通过（非本地一次性验证）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重（step/feature 为空，area 49 条全量） -->
- [测试设计] 测试不得全依赖"冷启动式重置"写法，须补至少一条真实多轮、状态不重置的集成测试（来源: area）
- [防重复付费] 周期性重扫同批数据且含外部付费调用时，必须设计"是否已处理过"前置检查（来源: area）
- [时间常数] 跨模块时间常数有隐含大小关系依赖时，必须显式写不变量断言（来源: area）
- [环境断言] contract 中 android 关键词即使在排除列表也触发 theater_mismatch，可用 windows_cloud 绕过（来源: area）
- [环境读取] target_environment 从 DB tasks.payload 读取，不从文件读，注册时必须正确设置（来源: area）
- [judge格式] .brain-result.json 必须有顶层 exit_code + log_tail + behavior_tests[]，每条含 exit_code + log_tail（来源: area）
- [字段截断] varchar 长度约束字段写入前，来源无天然长度保证的必须显式截断（来源: area）
- [复活考古] 复活曾删除功能前先 git log --diff-filter=D 考古旧实现（来源: area）
- [else兜底] 调用"返回 null/false 表示失败"契约的函数，if 成功分支后必须显式写 else（来源: area）
- [冒烟占位] smoke-invariant-1784543934-2387（历史冒烟占位铁律）（来源: area）
- [report兜底] journey_features.updated_at 长期停滞可作 report 阶段漏跑的兜底探测（来源: area）
- [relay收尾] harness-controller relay 可能在 merge 后异常退出跳过 report，必须有兜底（来源: area）
- [白名单断言] proposer 起草 host/环境白名单断言时强制核对 headed 人工接管场景（来源: area）
- [点火载荷] headed relay 点火必须把 base_repo 或 pr_url 写入 payload，分支名带 task short id（来源: area）
- [退役实证] 退役判断依据查生产库实锤，不靠记忆，避免误删活模块（来源: area）
- [失败计数] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（来源: area）
- [表认领] 建新表/复用表前先 grep 全部写入方，两模块写同表须 schema 对齐评审（来源: area）
- [消费方] 新增后台 job 必须声明消费方，无下游读方的落库 job 不允许上线（来源: area）
- [多设备UI] os_type/device_platform 的 UI 区分必须在设计/审查阶段强制检查（来源: area）
- [语义一致] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略（来源: area）
- [ref校验] git rev-parse 判 ref 存在必须带 --verify "<ref>^{commit}"（来源: area）
- [烟测隔离] smoke 用真实 worktree 当 CECELIA_DEPLOY_ROOT 时必须核对不触碰生产资源（来源: area）
- [禁降级] 部署链失败路径禁止 warning 降级：显式 FAIL + Bark + exit 非零（来源: area）
- [判变基准] 判变基准用生产实体自报（build-info/health.git_sha）对账 origin/main（来源: area）
- [测试质量] lint-test-quality 要求 await fn() ≥1：读源码须包装 async function（来源: area）
- [合同表格] Test Contract 固定 4 列格式，testFile 用 backtick，checker 从第 3 列解析路径（来源: area）
- [Red提交] Red commit 只 git add 精确测试路径，禁止 git add .（来源: area）
- [接线验证] 回归测试用 source-code inspection 验证调度接线，优于 mock 覆盖（来源: area）
- [cron接线] 新增 cron 功能先查 scheduler-jobs.js JOBS；tick-runner.js 是 deprecated 路径（来源: area）
- [禁自合] 禁止 generator 自行 merge PR，merge 权归 controller（来源: area）
- [tmux环境] headed relay 的 tmux 子 shell 不自动继承父环境变量，需要的必须显式传递（来源: area）
- [模板核对] proposer 复用历史合同模板前必须核对本次任务真实派发/执行历史（来源: area）
- [CI禁区] generator 默认禁改共享 CI 基础设施文件（.github/workflows/*.yml）（来源: area）
- [提前合并] PR 被 CI 侧兜底提前合并时，evaluator/judge 必须用 PR 实际状态复核（来源: area）
- [冒烟占位] smoke-invariant-1783850042-79911（历史冒烟占位铁律）（来源: area）
- [smoke登记] feat+brain/src PR 开 PR 前一次带齐 smoke.sh + smoke-allowlist 登记（来源: area）
- [接线清单] 新 task_type 接线走七点清单（CHECK 约束/task-router 四表/EXECUTOR_KIND_FOR 等）（来源: area）
- [双信号] 服务存活判定用双信号：launchctl 状态 + 端口监听（来源: area）
- [驻留位置] 本机禁止再往 ~/Library/LaunchAgents 放需要常驻的服务（来源: area）
- [驻留巡检] 新增常驻宿主服务必须同步加进 launchd-patrol.js 的 manifest（来源: area）
- [冒烟占位] smoke-invariant-1783693282-93097（历史冒烟占位铁律）（来源: area）
- [串行] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [环境值] 禁止写死环境假设值（来源: area）
- [真验证] 真环境验证才算 done（来源: area）
- [多租户] 测试默认多租户（来源: area）
- [凭据安全] 凭据安全：1Password 唯一源，绝不提交 git（来源: area）
- [日志脱敏] 日志脱敏（来源: area）
- [端点鉴权] 端点鉴权（来源: area）
- [租户隔离] 租户隔离（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块可留空占位。最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（node 单测 + node -e 直调断言）
# 期望验收点（自然语言）：
# 1. 在 repo 根目录用 node 直调 formatSmokeStamp('097e589d-ec53-4102-b8d1-9aa582b88ebd', new Date('2026-07-22'))
#    输出恰为 smoke:097e589d:20260722
# 2. brain 单测套件包含 relay-smoke 测试且全绿（进入 brain-ci 常跑，非一次性）
# 3. 非法输入（空 taskId / Invalid Date）抛 TypeError
```

## journey_type: autonomous
## journey_type_reason: 冒烟切片仅涉及 packages/brain 纯函数（无 dashboard/agent 协议/engine 路径），按路径优先级链命中 autonomous；relay 链本身由本次全链运行自证
## target_environment: local_api
## target_environment_reason: Brain 纯后端纯函数，本地 node 单测 + node -e 直调即可验证（localhost，无需远端机器）
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: none（PrepPRD 未锚定）
