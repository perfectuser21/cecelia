# Sprint PRD — Kernel read-only result channel 与 reviewer feedback lineage 恢复

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（运行时未提供 KR 编号）
- **当前进度**：82%
- **本次推进预期**：恢复 fresh-session GAN 的反馈闭环，并保持人工审批权不被绕过

## 背景

恢复任务 `0cb0dd5b` / run `c761d3f5` 未能把 reviewer feedback 传入下一轮的问题。Round 1 contract commit `6f184cd08` 与 reviewer attempt `63ef1610` 仅作证据，不继承批准；本 sprint 建立 Kernel read-only result channel 与 run/round/SHA 绑定 reviewer feedback lineage。

## Golden Path（核心场景）

Harness 从服务端创建只读角色 attempt → 角色通过 attempt-scoped 可写结果通道回传结构化结果 → 服务端校验并持久化 reviewer feedback → 下一轮 fresh-session proposer/reviewer 获得精确历史 → 最终 SHA 由既有审批权链决定是否放行。

具体：
1. 服务端为每个 read-only Harness role 提供仅限当前 attempt 的可写结果通道，同时 `/workspace` 保持只读；越界路径、symlink 与跨 attempt 访问均拒绝。
2. callback 鉴别服务端拥有的 attempt，并仅接受有界的 outcome、feedback、rubric、run、round、contract SHA 与 digest；错误以对应 HTTP 状态及 `{ok:false, error:{key,code}}` 稳定形态返回，且不反射 secret、transcript、chain-of-thought 或其他禁区内容。
3. dispatcher 与 ground truth 把上一轮的精确 review 注入下一次 fresh-session proposer；下一位 reviewer 同时收到 `prior_review` 和逐条一一对应的 `resolution_map`。首轮与 legacy 明示可区分的 no-history，非首轮缺历史则 fail closed。
4. stale SHA、错误 run/round、过大输入、敏感输入与伪造 attempt 均不能写入；replay、recovery、resume 和并发 run 按 run/round/attempt/SHA 隔离且幂等。
5. `APPROVED` 复用既有 server-owned review authority 与 current-head binding，不新增平行可变 verdict ledger；首个 P0 controller 变更保持 `review_required=true`，merge/deploy 等待服务端对精确最终 SHA 的人工批准。

## 边界情况

- 第一轮、legacy no-history 与非第一轮历史丢失必须可区分；只有前两者可继续。
- 相同 callback 重放不产生重复记录；相邻 round、恢复 attempt 与并发 run 不互相读取或覆盖。
- callback 所有拒绝路径都校验 HTTP 状态、稳定 error key/code、`ok=false` 和禁区字段不被反射。
- RCI 不得默认连接 `postgresql://localhost/cecelia` 或其他生产式 DSN；变更前必须确认隔离库可达、库名满足 `_test` 或 `preview_*`，并核验 `current_database()` 与 `inet_server_addr()`。

## 范围限定

**在范围内**：attempt-scoped result channel；server-owned callback 校验与有界持久化；review feedback lineage 注入；一一对应 resolution map；no-history 语义；fail-closed、隔离、幂等与恢复；既有审批权链及最终 SHA 人工门；新 RCI artifact 与 Red/Green 验证。

**不在范围内**：重写 reviewer rubric；新增 verdict ledger；继承旧 run 的批准；改变 `/workspace` 只读属性；放宽人工审批；生产数据库验收；与最小 Golden Path 无关的 Kernel 重构。

## 假设

- [ASSUMPTION: 结构化 payload 的具体字节上限与字段枚举由 proposer 根据现有 registry/authority contract 锁定，未指定值不得静默采用无限制。]
- [ASSUMPTION: Generator 新增的 RCI artifact 固定命名为 `scripts/harness/rci-reviewer-feedback-lineage.sh`；Red 阶段以文件缺失或行为未实现证明失败，不要求脚本预先存在。]

## 预期受影响文件

- `packages/brain/src/`：承载 Kernel 服务端 attempt、callback、dispatcher、ground truth 与既有审批权链的可观察行为
- `packages/brain/tests/`：覆盖 feedback lineage、错误响应、隔离、幂等、恢复与最终 SHA 门
- `scripts/harness/rci-reviewer-feedback-lineage.sh`：Generator 交付的独立验收入口；生成后须通过 `bash -n` 并在隔离测试库真实执行

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先；step/feature 两源均为空 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 重放必须幂等；具体阈值待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 拒绝结果具稳定 HTTP 状态与 error key/code，不记录或反射 secret、transcript、chain-of-thought；任何数据库写入仅限经自证的隔离测试库

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant；step 与 journey_feature 为空，area 共 58 条，按 decision id 去重 -->
- [超时恢复] watchdog_overdue 误标失败后，须经 orphan requeue、外部产物真相核查后才可从头重跑（来源: area）
- [语义成功] 通知/写库成功须校验 sent/accepted 等语义字段，不能只看 ok=true（来源: area）
- [依赖修复] 新 advisory 先检查 fixAvailable，存在兼容修复时不得先加白名单（来源: area）
- [等待心跳] headed relay 长等待须持续回报心跳，避免存活 session 被误标失败（来源: area）
- [毕业双检] 测试入册提交后、push 前须运行 lint-tdd-commit-order 与 check-test-coverage（来源: area）
- [真实退出码] 合同批准前须记录 manual oracle 真实 exit code 并确认解释器启动（来源: area）
- [命令真跑] 双引号 node -e 内含 `${}` 的命令须真实执行，bash -n 不足以替代（来源: area）
- [冒烟铁律一] smoke 铁律 1784808160-58494（来源: area）
- [冒烟铁律二] smoke 铁律 1784806023-5054（来源: area）
- [多轮状态] 测试须覆盖状态不重置、时间真实流逝的多轮扫描（来源: area）
- [付费幂等] 周期重扫触发外部付费调用前须检查是否已处理（来源: area）
- [时间关系] 跨模块时间常数的大小关系须显式断言或说明（来源: area）
- [环境措辞] contract 环境关键词须与实际 target_environment 一致，不以文字绕过检查（来源: area）
- [环境来源] target_environment 以 task payload 为准，注册任务时必须明确写入（来源: area）
- [Judge格式] Brain judge 结果须含顶层 exit_code、log_tail 与完整 behavior_tests 证据（来源: area）
- [字段有界] 写入有限长度 DB 字段前，所有无天然上限的来源值须显式限制（来源: area）
- [复活核因] 恢复退役功能前须以历史代码核对真实 death cause（来源: area）
- [显式失败] 返回 null/false 表示失败的调用必须显式处理失败分支（来源: area）
- [冒烟铁律三] smoke 铁律 1784543934-2387（来源: area）
- [报告哨兵] journey_features updated_at 长期早于对应交付可作为 report 漏跑信号（来源: area）
- [收账真相] controller 退出码不能替代 Step 7 report 与外部产物核验（来源: area）
- [接管场景] host/环境白名单断言须覆盖 headed 人工接管场景（来源: area）
- [点火标识] headed relay 点火须携带 base_repo 或 pr_url，分支须可关联 task（来源: area）
- [退役证据] 退役判断须查真实生产数据与全部消费方，不凭记忆（来源: area）
- [吞错告警] catch 吞错后台任务须有失败计数与连续失败告警（来源: area）
- [表名认领] 建表或复用表前须核对全部写入方并完成 schema 对齐（来源: area）
- [消费方] 新后台落库 job 必须同时声明真实消费方（来源: area）
- [多端完整] 多设备字段与展示语义须在同 sprint 消解或形成正式决策（来源: area）
- [未知值同义] 同一 unknown 语义在判变端与终验端必须采取一致策略（来源: area）
- [Ref校验] git ref 存在性须用 `git rev-parse --verify "<ref>^{commit}"`（来源: area）
- [测试隔离] 真实 worktree 测试前须确认脚本不会触碰生产资源（来源: area）
- [部署失败] 部署链失败路径必须告警并非零退出，不得降级为 warning（来源: area）
- [生产自报] 部署判变基准须用生产实体自报 SHA 对账 origin/main（来源: area）
- [异步测试] lint-test-quality 要求源码读取测试包含真实 await 调用（来源: area）
- [合同表格] Test Contract 表格固定四列且测试路径须用反引号包裹（来源: area）
- [Red精确提交] Red commit 只可 add 精确测试路径，不得使用 git add .（来源: area）
- [接线回归] 调度接线可用 source-code inspection 形成直接回归断言（来源: area）
- [调度入口] 新 cron 功能须接 scheduler-jobs.js，不走 deprecated tick-runner.js（来源: area）
- [合并权] generator 只能推送 ready branch，不得自行 merge（来源: area）
- [会话环境] headed relay 子 shell 所需 Harness 变量须显式传入（来源: area）
- [历史核对] 复用历史合同前须核对本次真实派发与执行历史（来源: area）
- [共享禁区] 未经合同显式授权，generator 不得修改跨 sprint 共享 CI 判定文件（来源: area）
- [提前合并] 若 PR 提前合并，须核对 evaluator/judge 锚定 SHA 与真实 merge SHA（来源: area）
- [冒烟铁律四] smoke 铁律 1783850042-79911（来源: area）
- [Brain冒烟] feat 且修改 brain/src 时须同时带齐 smoke 与 allowlist 登记（来源: area）
- [任务接线] 新 task_type 须完整覆盖约束、路由、executor、relay 与容量锁接线（来源: area）
- [服务双信号] 常驻服务存活须同时核验服务管理状态与端口监听（来源: area）
- [常驻域] 美国 Mac mini 常驻服务不得放入不可用的用户 LaunchAgents 域（来源: area）
- [巡检清单] 新常驻宿主服务须登记到 launchd-patrol manifest（来源: area）
- [冒烟铁律五] smoke 铁律 1783693282-93097（来源: area）
- [单槽串行] 一个 slot 仅推进一个任务；任务内只读可扇出但同刻仅一个写代码实现者（来源: area）
- [环境推导] 环境假设值不得写死，须从环境推导或在真实目标校准（来源: area）
- [真环境] 依赖真实环境的接缝断言未真验只能标 logic-done-pending（来源: area）
- [多租户测试] 单元与 E2E 默认至少使用两个租户并断言互不串扰（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII 与聊天内容不得明文进入日志（来源: area）
- [端点鉴权] 每个 API 端点必须鉴权，无鉴权端点不得交付（来源: area）
- [租户隔离] 涉及租户数据的读写必须限定当前租户，禁止跨租户混读混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

1. Red 合同证明 result channel/lineage 或指定 RCI artifact 尚未实现，且不要求 Red 审批前预先存在该脚本。
2. Generator 后对 RCI 执行 `bash -n`，再在可达的 `_test` 或 `preview_*` 数据库真实运行；写入前验证 `current_database()` 与 `inet_server_addr()`，无生产式默认 DSN。
3. 用两个并发 run、相邻 round 和恢复 attempt 证明通道与反馈隔离；同一合法 callback 重放结果幂等。
4. 证明 fresh proposer 收到上一轮精确 review，fresh reviewer 收到相同 `prior_review` 及逐条一一对应 `resolution_map`；首轮/legacy no-history 可区分。
5. stale SHA、错误 run/round、伪造 attempt、非首轮缺历史、路径逃逸、symlink、过大与敏感输入全部 fail closed。
6. 每个 callback 错误测试断言 HTTP 状态、`ok=false`、稳定 error key/code、精确 body shape，并断言响应及日志没有 forbidden reflected fields。
7. APPROVED 仅通过现有 server-owned authority 与 current-head binding 生效，旧 contract/reviewer evidence 不携带批准。
8. 最终 P0 controller SHA 保持 `review_required=true`，无该 SHA 的服务端人工批准时 merge/deploy 均不可发生。

```bash
# 占位：proposer 将按 local_api 填入真实脚本；脚本必须创建或显式要求隔离 _test|preview_* 数据库，
# 在任何写操作前核验 current_database()/inet_server_addr()，并覆盖以上 8 个验收点。
```

## journey_type: autonomous
## journey_type_reason: 需求是 Cecelia Kernel/Harness 服务端回调、调度与审批权链的纯后端行为。
## target_environment: local_api
## target_environment_reason: task payload 显式指定 local_api；在本地 Kernel/Brain API 与隔离测试数据库验收。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 0cdadc1a-e3a0-46a1-8333-ebbc102883f7
