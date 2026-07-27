# Sprint PRD — read-only reviewer 结果通道与反馈血缘

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：83%

## 背景

Kernel 的 proposer/reviewer 每轮使用 fresh session，但服务端未把上一轮 reviewer 的完整结构化结果送入下一跳；同时 read-only reviewer 没有受控可写结果位置，详细 rubric/feedback 只能落到临时目录并在 callback 时丢失。当前运行历史已有 `gan_feedback_lineage_missing_round25_nonconvergent` 失败实证。本 sprint 必须“修复 read-only reviewer 结构化结果丢失，并把其 run/round/SHA 绑定反馈传入 fresh-session 后续轮次。”，使反馈成为可核验的服务端事实。

## Golden Path（核心场景）

Kernel 从派发 read-only reviewer attempt → 接收并持久化该 attempt 的结构化结果 → 将绑定 run/round/contract SHA 的不可变反馈送入下一轮 fresh-session proposer/reviewer → 得到可审计的修订闭环。

具体：

1. Kernel 为每个 read-only proposer/reviewer attempt 提供仅该 attempt 可写、与工作树和秘密隔离的结果通道；角色提交 verdict、feedback、rubric、contract SHA 与 round。
2. callback 只接受当前服务端 attempt 授权且符合 schema/大小限制的结果；路径逃逸、错误 run/round、stale SHA、秘密、transcript/chain-of-thought 或缺失结果均被拒绝或形成明确 `no-history`，不得静默降级成成功。
3. 服务端把通过校验的完整结构化结果作为不可变事实持久化；重放、recovery 与 resume 对同一 attempt 幂等，并发 run 之间互不读取或覆盖。
4. 下一轮 fresh-session proposer 收到与当前 run、上一 round、上一 contract SHA 精确绑定的 reviewer verdict/feedback/rubric；下一轮 reviewer 同时收到 prior-review 与逐条 resolution map，可核验每条反馈是否解决。
5. `APPROVED` 结果进入同一权威链；legacy 调用方在 rollout 期间得到明确兼容行为，但客户端自报或工作树散文永远不能取得 authority。
6. 主理人可从服务端 attempt result/decision log 追溯每轮输入、反馈、修订与批准关系；首次 P0 Controller contract 变更在人工批准前不得 merge/deploy。

## 边界情况

- 结果路径逃逸、软链接绕行、跨 attempt 写入、结果文件缺失或超限时 fail-closed，且不泄露宿主秘密。
- stale branch/contract SHA、wrong run/round、反馈与当前 contract 不匹配时不得注入后续 bundle。
- 无历史的首轮与 legacy rollout 必须显式标记 `no-history`，不能伪造空反馈为已解决。
- 并发 run、同 run 并发 callback、重放、recovery、resume 与确定性截断均保持隔离和幂等。
- `APPROVED`、`NEEDS_REVISION` 以及无效 verdict 都要经过相同的服务端 authority 校验。

## 范围限定

**在范围内**：所有 read-only Harness 角色的 attempt-scoped 结果通道；callback 校验与清理；结构化 reviewer 结果持久化；decision-log/ground-truth 接线；run/round/SHA 反馈血缘；prior-review/resolution map；legacy rollout；proven-to-fire 回归；execution contract、容器 mount/env、DEFINITION/version 与 RCI 同步。

**不在范围内**：改变 reviewer 的产品判断标准；保存完整对话、transcript 或 chain-of-thought；信任客户端或工作树文件作为 authority；修改非 Kernel 的业务功能；绕过主理人首次 P0 审批。

## 假设

- [ASSUMPTION: 本任务锚定 journey `bb8cc561-b3ee-4fec-b74d-2255694bd963` 的 step `0cdadc1a-e3a0-46a1-8333-ebbc102883f7`。]
- [ASSUMPTION: 结构化结果的精确 schema、字节上限与 rollout 时间窗由 proposer 基于现有 execution contract/registry 固化，但必须满足确定性截断和禁止敏感内容入账。]
- [ASSUMPTION: 本地 evaluator 可在不修改生产数据的条件下覆盖 callback、dispatcher、持久化与重放路径。]

## 预期受影响文件

- `packages/brain/src/`: Kernel execution contract、容器 attempt 生命周期、callback、dispatcher、ground-truth 与 decision-log 接线。
- `packages/brain/tests/`: read-only callback、fresh-session round 2、跨 run 隔离、stale branch、缺文件、APPROVED、legacy rollout 的 proven-to-fire 验收。
- `packages/brain/DEFINITION.md`: Brain 行为合同与版本同步。
- `packages/brain/package.json`: Brain 版本同步。
- `scripts/devgate/`: RCI/交付门对新 Controller contract 的覆盖。

## DoD

1. read-only 角色可通过 attempt-scoped 通道提交完整结构化结果，工作树仍保持只读。
2. callback 对授权边界、路径逃逸、schema、大小、敏感内容、run/round/SHA 全部 fail-closed。
3. reviewer verdict/feedback/rubric/contract SHA/round 由服务端完整持久化并可按 attempt 追溯。
4. round 2 proposer bundle 必含上一轮精确绑定反馈，reviewer bundle 必含 prior-review/resolution map。
5. 并发 run、recovery、resume、callback 重放与清理均隔离且幂等。
6. 确定性截断不改变 verdict/binding，transcript、chain-of-thought 与 secret 不入账。
7. read-only callback、fresh-session round 2、跨 run、stale branch、缺文件、APPROVED、legacy rollout 测试全部 proven-to-fire。
8. execution contract、容器 mount/env、DEFINITION/version、RCI 已同步，`review_required=true` 且批准前禁止 merge/deploy。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: Brain `DEFINITION.md` 与 package 版本必须随行为变更同步
- 可观测: 完整 reviewer verdict/feedback/rubric/contract SHA/round 必须可按服务端 attempt 与 decision log 追溯
- 安全: 结果通道不得暴露 secret；不得持久化 transcript、chain-of-thought 或客户端自报 authority
- 容量: schema 与大小上限必须显式；超限采用确定性截断或拒绝，不能静默丢失关键绑定字段
- 一致性: run/round/SHA 绑定、并发隔离、recovery/resume 与重放幂等必须成立

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [超时恢复] watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（来源: area）
- [语义成功] 通知/写库接口的成功判定必须看语义字段（sent/accepted），不能只 grep ok:true（来源: area）
- [依赖修复] dep-audit 因新 advisory 翻红时先查 fixAvailable；兼容修复优先 npm audit fix（来源: area）
- [会话心跳] headed relay 长 CI 等待中应周期性写心跳，防止存活 session 被误标 failed（来源: area）
- [毕业门禁] 测试入册 commit 后必须先跑 lint-tdd-commit-order 与 check-test-coverage 再 push（来源: area）
- [真实退出] 合同批准前必须记录 manual oracle 的真实 exit code 并确认目标解释器启动（来源: area）
- [命令真跑] manual node 命令中的模板表达式必须在 GAN 批准前逐条真跑，bash -n 不足以验真（来源: area）
- [冒烟铁律] smoke 铁律（来源: area）
- [冒烟铁律] smoke 铁律（来源: area）
- [多轮测试] 跨扫描周期行为必须有状态不重置且时间真实流逝的多轮集成测试（来源: area）
- [重扫幂等] 周期重扫调用付费外部服务前必须检查是否已经处理，不能放大重复调用（来源: area）
- [时间关系] 跨模块时间常数的大小依赖必须显式成为不变量断言或注释（来源: area）
- [环境剧场] contract 的目标环境与实际功能依赖必须一致，不得通过改环境绕过 theater 检查（来源: area）
- [环境来源] target_environment 由 DB task payload 提供，任务注册时必须正确设置（来源: area）
- [结果格式] Brain judge 结果必须包含顶层 exit_code、log_tail 与逐条 behavior_tests 证据（来源: area）
- [长度边界] 无天然长度保证的数据写入定长 DB 字段前必须显式限制长度（来源: area）
- [历史实证] 复活退役功能前必须读取删除历史与真实旧代码核对 death cause（来源: area）
- [失败分支] 返回 null/false 表示失败的函数调用必须显式处理失败分支，不能只依赖异常（来源: area）
- [冒烟铁律] smoke 铁律（来源: area）
- [进度探针] journey_features.updated_at 长期停滞可作为 report 阶段漏跑的兜底探针（来源: area）
- [完成校验] Brain 不得只凭容器 exit code 0 判完成，必须校验 report 产出物（来源: area）
- [接管核对] host/环境白名单断言必须核对 headed 人工接管场景（来源: area）
- [点火锚定] headed relay 点火必须带 base_repo 或 pr_url，且分支名含 task short id（来源: area）
- [退役证据] 功能退役判断必须基于生产数据与实际消费方证据，不能靠记忆（来源: area）
- [后台告警] catch 吞错的后台 job 必须有失败计数指标与连续失败告警（来源: area）
- [表名认领] 新建或复用表前必须检查全部写入方；共享表必须经过 schema 对齐评审（来源: area）
- [真实消费] 新增后台 job 必须声明真实消费方，无下游读方的落库 job 不得上线（来源: area）
- [多端完整] 多设备类型涉及的新旧字段语义必须在本 sprint 消解或形成正式决策并覆盖展示层（来源: area）
- [语义一致] 同一语义在判变端与终验端必须采用同一处理策略（来源: area）
- [引用验真] git ref 存在性必须使用带 commit 验证的精确判定（来源: area）
- [生产隔离] 测试使用真实 worktree 时必须逐项阻断对生产资源的触碰（来源: area）
- [部署失败] 部署链任何失败路径必须告警并非零退出，不得 warning 降级（来源: area）
- [生产真相] 判变基准必须使用生产实体自报对账 origin/main，禁用工作区 diff（来源: area）
- [测试质量] 源码检查测试必须满足 lint-test-quality 的真实 await 要求（来源: area）
- [合同表格] Test Contract 表格格式与 testFile 路径列必须符合 checker 解析契约（来源: area）
- [红测提交] Red commit 只能暂存精确测试路径，禁止广泛 git add（来源: area）
- [调度回归] 调度接线回归优先用可 proven-to-fire 的源码检查证据（来源: area）
- [调度入口] 新增 cron 功能必须接 scheduler-jobs，不能接 deprecated 路径（来源: area）
- [合并权限] generator 只推分支并报告 ready，不得自行 merge（来源: area）
- [环境透传] headed relay 子 shell 所需 Harness 环境变量必须显式传入（来源: area）
- [历史核对] 复用历史合同断言前必须核对本次真实派发与执行历史（来源: area）
- [共享禁区] 未经合同授权不得修改跨 sprint 共享 CI 判定文件（来源: area）
- [提前合并] PR 若被提前合并，必须核对实际 head SHA 与 evaluator/judge 锚定 SHA 一致（来源: area）
- [冒烟铁律] smoke 铁律（来源: area）
- [源码冒烟] feat 且修改 Brain 源码时必须同步提供 smoke 与登记（来源: area）
- [类型接线] 新 task_type 必须完成约束、路由、executor、relay 与 dispatcher 全链接线（来源: area）
- [存活双信号] 宿主服务存活必须同时核对服务管理状态与端口监听（来源: area）
- [常驻域] 美国 Mac mini 常驻服务不得放入不可用的用户 LaunchAgents 域（来源: area）
- [服务清单] 新增常驻宿主服务必须同步更新 launchd-patrol manifest（来源: area）
- [冒烟铁律] smoke 铁律（来源: area）
- [单槽串行] 一个 slot 同时只推进一个任务；任务内只读可并行但写代码实现者只能有一个（来源: area）
- [环境推导] 环境假设值禁止写死，必须从环境推导或真机校准（来源: area）
- [真环境验] 接缝断言必须在真实目标环境验证才可标 done（来源: area）
- [多租户测] 单元/E2E 默认至少两个租户并断言互不串（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII 与聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须鉴权，无鉴权端点不得交付（来源: area）
- [租户隔离] 租户数据读写必须限定当前租户，严禁跨租户混读混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入可执行的 curl/测试命令与服务端持久化 oracle
# 期望验收点：read-only callback 可持久化完整 reviewer 结果；fresh-session round 2 精确收到上一轮 run/round/SHA 绑定反馈和 resolution map；跨 run、stale branch、缺文件、APPROVED、legacy rollout 的 proven-to-fire 测试通过。
```

## journey_type: autonomous
## journey_type_reason: 任务仅涉及 Kernel/Brain 后端调度、callback、持久化与合同事实传递。
## target_environment: local_api
## target_environment_reason: task payload 显式指定 local_api，由本地 evaluator 验证 Brain API 与持久化链路。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 0cdadc1a-e3a0-46a1-8333-ebbc102883f7
