# Sprint PRD — cecelia-run dry-run 恢复 --session-id

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：恢复 launcher 会话标识透传的既有行为，解除父任务的 engine-tests 前置阻塞

## 背景

最新 `origin/main` 的 `cecelia-run --dry-run` 未把 session id 作为 CLI 参数传给 launcher，导致 engine-tests 回归。本 sprint 只修复这条独立回归，以单独 PR 合入 main，供依赖方随后更新分支。

## 锚定声明

- [BEHAVIOR] 在最新 `origin/main` 上执行 `bash packages/brain/scripts/cecelia-run.sh --dry-run`，输出必须包含 `--session-id <uuid>`。
- [BEHAVIOR] session id 只生成一次，并由 `cecelia-run` 原样传给 `scripts/claude-launch.sh`；不得只写在 `CLAUDE_SESSION_ID` 环境变量中代替 CLI 参数。
- [BEHAVIOR] `packages/engine/tests/launcher/launcher-dry-run.test.ts` 先在 Red commit 复现失败，Green commit 后通过。
- [BEHAVIOR] `packages/engine` 全量测试及 GitHub `engine-tests` 全绿。

## Golden Path（核心场景）

维护者从最新 `origin/main` 执行 `cecelia-run --dry-run` → 系统生成一次 session id → launcher 命令行携带同一个 `--session-id <uuid>` → launcher 回归测试和 engine-tests 全绿。

具体：

1. 在独立分支的 Red commit 中，launcher dry-run 测试复现缺少 `--session-id <uuid>` 的失败。
2. Green 后再次执行 dry-run，输出中出现一次有效 UUID 形式的 `--session-id` 参数。
3. 同一个 session id 原样到达 `scripts/claude-launch.sh`，不以仅设置环境变量冒充 CLI 透传。
4. 目标回归、`packages/engine` 全量测试与 GitHub `engine-tests` 通过后，独立 PR 合入 main。

## 边界情况

- session id 缺失、为空、不是 UUID 或出现多个不同值，均不得判通过。
- 仅存在 `CLAUDE_SESSION_ID` 环境变量而 launcher CLI 缺 `--session-id`，不得判通过。
- Red/Green 不得合并成同一 commit；Red 必须先真实失败，Green 才允许修复。
- 父任务 PR 的合同、门禁与实现变更不属于本 sprint，不得进入本分支 diff。

## 范围限定

**在范围内**：恢复 `cecelia-run --dry-run` 到 `scripts/claude-launch.sh` 的单次 session id CLI 透传；补强既有 launcher regression test；验证 engine 全量测试与 GitHub `engine-tests`。

**不在范围内**：修改父任务 PR；改变其他 launcher 参数语义；新增 API、DB、UI 或生产部署行为；修改生产数据库。

## 假设

- [ASSUMPTION: `scripts/claude-launch.sh` 继续接受 `--session-id <uuid>` 作为既有 CLI 契约，本 sprint 仅恢复调用方透传。]
- [ASSUMPTION: 独立修复合入 main 后，由父任务负责 update-branch；本 sprint 不操作父任务分支。]

## 预期受影响文件

- `packages/brain/scripts/cecelia-run.sh`：恢复 dry-run launcher 命令的 session id 参数。
- `packages/engine/tests/launcher/launcher-dry-run.test.ts`：以 Red→Green 锁定单次生成与 CLI 原样透传。

## 完成判据

- [ ] dry-run 输出包含且仅包含一个有效的 `--session-id <uuid>`。
- [ ] session id 只生成一次，并以同值传给 `scripts/claude-launch.sh`。
- [ ] launcher regression test 有独立 Red commit 与后续 Green commit。
- [ ] `packages/engine` 全量测试通过。
- [ ] GitHub `engine-tests` required check 全绿。
- [ ] 独立 PR 合入 main，且 diff 不含父任务 PR 的文件。

## NFR 约束

<!-- 来源: PrepPRD 主源；step/feature category=nfr 副源均为空 -->
- 正确性：session id 必须是 UUID，单次生成、同值透传，不接受仅环境变量假绿。
- 回归强度：必须保留 Red→Green 两 commit，并真跑 launcher 目标测试与 engine 全量测试。
- 隔离性：独立 PR，不混入父任务 PR 的合同、门禁或实现 diff。
- 数据安全：`production_db_mutation_allowed=false`，不得修改生产数据库。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant；step 与 journey_feature 为空，area 级共 58 条，按 id 去重 -->
- [孤儿恢复] watchdog_overdue 标 failed 的 relay run 应经 orphan requeue 与 PR/sprint 外部真相核查后恢复（来源: area）
- [语义成功] 通知或写库接口须检查 sent/accepted 等语义字段，不得仅凭 ok:true 判成功（来源: area）
- [依赖审计] 新 advisory 导致 dep-audit 翻红时先查 fixAvailable，兼容修复优先于加白名单（来源: area）
- [等待心跳] headed relay 长 CI 等待期间须周期性更新 relay-runs 心跳（来源: area）
- [测试毕业] 测试毕业 rename 后必须先本地跑 lint-tdd-commit-order 与 check-test-coverage 再推送（来源: area）
- [命令证据] 合同批准前必须记录 manual oracle 的真实 exit code，并确认目标解释器确实启动（来源: area）
- [手工命令] manual:node -e 双引号中的 JavaScript 模板表达式须在 GAN 批准前逐条真跑（来源: area）
- [烟测铁律甲] smoke 铁律（来源: area）
- [烟测铁律乙] smoke 铁律（来源: area）
- [多轮扫描] 测试不能全部依赖冷启动式状态重置；跨扫描周期逻辑须有真实多轮集成测试（来源: area）
- [付费幂等] 周期性重扫若调用 LLM 或第三方付费 API，必须先检查是否已处理（来源: area）
- [时间关系] 跨模块时间常数存在大小关系依赖时必须显式写出不变量断言或注释（来源: area）
- [剧场匹配] contract 的目标环境关键词须与真实验收剧场一致，排除说明中的关键词也可能触发不匹配（来源: area）
- [环境来源] target_environment 由 Brain task payload 提供，注册任务时必须正确写入（来源: area）
- [裁判格式] Brain judge 的结果须含顶层 exit_code、log_tail 与逐项 behavior test 证据（来源: area）
- [字段长度] DB 字段有长度约束且来源无天然上限时，写入前必须显式处理长度（来源: area）
- [退役考证] 复活已退役功能前须读删除历史与退役前真实代码，逐字核对死亡原因（来源: area）
- [失败返回] 调用以 null/false 表示失败的函数时必须显式处理失败分支（来源: area）
- [烟测铁律丙] smoke 铁律（来源: area）
- [报告探针] journey feature 的 updated_at 长期早于对应 PR 合并时间可作为 report 漏跑兜底信号（来源: area）
- [合后报告] controller 在 merge 后仍须完成 report；Brain 不得仅凭容器 exit code 0 判整条链成功（来源: area）
- [环境白名单] 合同起草 host/环境白名单断言时必须覆盖 headed 人工接管场景（来源: area）
- [点火标识] headed relay 点火必须把 base_repo 或 pr_url 写入 payload，且分支名带 task short id（来源: area）
- [退役数据] 退役判断必须基于生产数据与真实消费方核查，不得依赖记忆（来源: area）
- [后台告警] catch 吞错的后台 job 必须有失败计数指标并在连续失败超阈值时告警（来源: area）
- [表名认领] 建表或复用表前须核对全部写入方；多模块写同表必须做 schema 对齐评审（来源: area）
- [任务消费] 新增后台 job 必须声明真实消费方，无下游读方的落库 job 不得上线（来源: area）
- [设备区分] 多设备类型或操作系统字段必须在设计与审查阶段核对 UI 区分并消解语义重叠（来源: area）
- [未知SHA] git_sha=unknown 等同一语义在判变端与终验端必须采用同一处理策略（来源: area）
- [引用核验] git rev-parse 判断 ref 存在必须使用 --verify "<ref>^{commit}"（来源: area）
- [部署根安全] smoke/测试把真实 worktree 作为部署根时，须核对被测脚本不会触碰生产资源（来源: area）
- [部署失败] 部署链失败路径不得降级为 warning，须显式失败、告警并非零退出（来源: area）
- [生产自报] 部署判变以生产实体自报信息对账 origin/main，不得依赖部署工作区 diff（来源: area）
- [测试质量] lint-test-quality 要求测试包含真实异步调用，不得仅以同步源码读取冒充行为测试（来源: area）
- [合同四列] Test Contract 表固定四列，Test File 使用反引号包裹，checker 从第三列解析路径（来源: area）
- [Red精确暂存] Red commit 只能暂存精确测试路径，禁止 git add . 或把 .harness 混入（来源: area）
- [调度回归] 调度接线回归可用源码检查建立直接证据，但不得替代需要真跑的行为验收（来源: area）
- [定时任务] 新增 cron 功能应先检查 scheduler-jobs.js 的 JOBS，tick-runner.js 是退役路径（来源: area）
- [生成器边界] generator 只推送分支并报告 ready，绝对不得自行 merge PR（来源: area）
- [环境透传] headed relay 的 tmux 子 shell 所需 harness 环境变量必须显式透传（来源: area）
- [合同先例] Proposer 复用历史合同模板前须核对本任务真实派发与执行历史，不得假设路径相同（来源: area）
- [共享CI禁区] 跨 sprint 共享 CI 基础设施文件未经合同显式授权不得修改（来源: area）
- [提前合并] CI 兜底提前合并时须以 PR head SHA 核对 evaluator/judge verdict 锚定 SHA（来源: area）
- [烟测铁律丁] smoke 铁律（来源: area）
- [烟测登记] feat+brain/src PR 应一次带齐 smoke 脚本与 smoke allowlist 登记（来源: area）
- [任务类型] 新 task_type 接线须覆盖约束、路由、executor、override、relay 映射及 dispatcher 防线（来源: area）
- [服务双信号] 服务存活判定必须同时核对 launchctl 状态与端口监听（来源: area）
- [主机常驻] 美国 Mac mini 的常驻服务不得放入 ~/Library/LaunchAgents，须使用系统域 LaunchDaemon（来源: area）
- [常驻清单] 新增常驻宿主服务须同步登记 launchd-patrol.js manifest（来源: area）
- [烟测铁律戊] smoke 铁律（来源: area）
- [单槽串行] 单 slot 内任务严格串行；任务内只读角色可扇出，但同一时刻只有一个代码实现者（来源: area）
- [环境推导] 环境假设值不得写死，必须从环境推导或在真机校准（来源: area）
- [真环境] 依赖真机、生产环境或真实调用方的接缝断言必须真验；未真验只能标 logic-done-pending（来源: area）
- [多租户测试] 单元与 E2E 测试默认至少种两个租户并断言互不串数据（来源: area）
- [凭据安全] secrets 不得硬编码、进入 git 或写入日志（来源: area）
- [日志脱敏] 客户隐私、PII 与聊天内容不得明文写入日志（来源: area）
- [端点鉴权] 每个 API 端点必须有鉴权，无鉴权端点不得交付（来源: area）
- [租户隔离] 涉及租户数据的查询与写入必须限定当前租户，禁止跨租户混读混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey fcfd34bd-218b-4b65-a0e7-0bd2d62c7189 的 golden paths -->
- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本
# 期望验收点：在最新 origin/main 的独立分支真跑 cecelia-run --dry-run，
# 观察唯一 UUID session id 作为 CLI 参数原样到达 launcher，并确认目标回归、engine 全量测试与 GitHub engine-tests 全绿。
```

## journey_type: agent_remote
## journey_type_reason: 需求修改 cecelia-run 到 launcher 的远端 agent 启动协议，按优先级归入 agent_remote
## target_environment: local_api
## target_environment_reason: payload 明确指定 local_api；在本地 worktree 验证 shell launcher 与 engine 测试
## journey_id: fcfd34bd-218b-4b65-a0e7-0bd2d62c7189
## step_id: none（PrepPRD 未锚定）
