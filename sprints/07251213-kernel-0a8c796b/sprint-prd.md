# Sprint PRD — conversation-capture 人声闸（session 出处声明制）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：83%

## 背景

conversation-capture 应只捕获 Alex 在交互式 AI 编程会话中亲口输入的内容；当前基于目录名和消息角色的采集端黑名单无法区分真实 worktree 中的军师、tmux 派发及 harness worker，导致同一根因第三次产生机器噪音。改为由启动端声明 session 出处、采集端只放行 human，可以让未知来源失败关闭，并保持真实人声的现有捕获行为。

## Golden Path（核心场景）

conversation-capture 人声闸（session 出处声明制）：会话从启动端登记出处 → 闲置后由采集端批量核验 → 仅 human session 进入 captures，machine 或未登记 session 均可观测地跳过。

具体：
1. 系统具备 `session_provenance` 登记表，可记录 session 的 `human` / `machine` 出处、启动方及可选 Brain task。
2. Alex 经 `claude-launch.sh` 交互入口启动且无派发标记时，session 登记为 `human`；无 TTY 且无派发声明时不登记。
3. `cecelia-run.sh` 与有头 Claude relay 启动时声明 `CECELIA_DISPATCH=1`、启动方和 task，session 登记为 `machine`；登记失败不阻塞会话启动。
4. conversation-capture 在闲置过滤后一次核验本轮全部 session，仅 `kind='human'` 可继续 dedupe、原始 capture 与摘要 capture 的现有流程。
5. `machine` 与未登记 session 分别增加 `skipped_machine`、`skipped_unregistered`；登记查询失败时本轮零捕获、零摘要调用，并记录失败与错误计数。
6. Codex/Grok 未登记 worker 同样失败关闭；现有 `-private-tmp-` 排除、dedupe、capture-triage、机器信号及 dashboard 会话通道保持不变。
7. 独立评审通过后，仅主 session 先把既有 `conversation%` 记录备份到仓外 CSV，再限定范围删除；部署第 7 天人工复查新增记录不含军师、relay、harness 或部署指令。

## 边界情况

- 出处 INSERT 超时或失败：Claude 仍启动，但 session 未登记，后续不被捕获。
- provenance 批量查询失败：整轮失败关闭，不允许任一 session 进入 dedupe、capture 或摘要调用。
- 同一 session 重复登记：保持首次声明，不覆盖既有出处。
- Alex 绕过 launcher 直接启动：视为未登记并跳过；这是已接受的漏采风险。
- 存量备份失败或源数据非零但备份为空：清理必须在 DELETE 前中止。
- 生产 migration、存量删除及第 7 天抽检不由 worker 自动执行。

## 范围限定

**在范围内**：出处登记表；Claude 人工/机器启动声明；cecelia-run 与 headed relay 机器标记；Claude/Codex/Grok 共用的 human allowlist；跳过与查询失败哨兵；带确认、先备份后限定删除的人工清理 SOP；回归测试、Brain 版本同步和 Red→Green 证据。

**不在范围内**：captures 后续加工；capture-triage 四路分诊；cecelia_events；CONSCIOUSNESS_ENABLED / GUARDED_MODULES；dashboard 的 unified_conversations / conversation-consolidator；移除 `-private-tmp-` 双保险；自动 migration、自动清库、自动 merge。

## 假设

- [ASSUMPTION: 当前 task 未提供 journey_id / ability_id / step_id，本 sprint 作为独立 Brain 外围采集能力锚定。]
- [ASSUMPTION: 本地 `cecelia` PostgreSQL 与正常 Brain 部署链是最终接缝验收环境；worker 仅运行非破坏性测试。]

## 预期受影响文件

- `packages/brain/migrations/<next>_session_provenance.sql`：提供 session 出处登记表。
- `scripts/claude-launch.sh`：为可判定的 Claude 启动声明出处。
- `packages/brain/scripts/cecelia-run.sh`：声明无头派发为 machine。
- `packages/brain/src/harness-skill-relay.js`：声明 headed Claude relay 为 machine。
- `packages/brain/src/conversation-capture.js`：只放行已登记 human session 并记录哨兵。
- `packages/brain/scripts/cleanup-conversation-captures.sh`：提供不可自动触发的备份与清理 SOP。
- `packages/brain/src/__tests__/`、`scripts/__tests__/`、`packages/brain/scripts/__tests__/`：覆盖登记、派发、allowlist、失败关闭与清理边界。
- `packages/brain/DEFINITION.md`、`.brain-versions` 及既有版本位置：同步 Brain 版本。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: launcher 的同步 `psql` 连接上限 2 秒，登记失败不得阻塞 Claude 启动。
- 频控: 每次可判定的 session 启动至多尝试一次登记；采集每轮对全部不同 session_id 仅做一次批量出处查询。
- 版本要求: PostgreSQL migration 必须可重复应用；Brain 四处版本与版本账本一致。
- 可观测: 哨兵必须暴露 sessions_seen、sessions_processed、skipped_machine、skipped_unregistered、provenance_lookup_failed 与 errors。
- 安全/数据: 默认失败关闭；凭据与聊天正文不得进入日志；生产删除必须显式 `--confirm`、仓外 CSV 备份成功后才可执行。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [失败恢复] watchdog_overdue 误标 failed 的 relay run 应经 orphan requeue、PR/sprint 产物核查后从头安全重跑。（来源: area）
- [语义成功] 通知或写库接口必须检查 sent/accepted 等语义字段，不能只凭 ok:true 判成功。（来源: area）
- [依赖修复] dep-audit 新 advisory 先查 fixAvailable；可兼容修复时先用 npm audit fix，不急于加白名单。（来源: area）
- [长等心跳] headed relay 长 CI 等待必须周期更新 relay-runs 心跳，避免活 session 被 reaper 误标 failed。（来源: area）
- [毕业校验] 测试入册 rename 后、push 前必须运行 lint-tdd-commit-order 与 check-test-coverage。（来源: area）
- [手工证据] 合同批准前必须记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。（来源: area）
- [命令真跑] `node -e` 双引号中的 JavaScript 模板表达式必须在 GAN 批准前逐条真跑，bash -n 不足以验证。（来源: area）
- [烟测铁律] smoke 铁律。（来源: area）
- [烟测铁律] smoke 铁律。（来源: area）
- [多轮扫描] 测试不能全依赖重置状态的冷启动，至少覆盖一次状态不重置、时间真实流逝的多轮扫描。（来源: area）
- [重扫幂等] 周期重扫引入付费调用时，必须先检查是否已处理，不能假设重扫罕见。（来源: area）
- [时间关系] 跨模块时间常数存在大小依赖时必须显式声明不变量，并覆盖跨任务组合审查。（来源: area）
- [剧场匹配] theater_mismatch 判断应基于真实功能环境，排除说明中的平台词不得驱动错误路由。（来源: area）
- [环境来源] target_environment 由 Brain task payload 提供，任务注册时必须正确设置。（来源: area）
- [Judge格式] Brain judge 结果必须含顶层 exit_code、log_tail、behavior_tests，且每条行为含 exit_code 与 log_tail。（来源: area）
- [字段长度] DB 有限长字段接收无天然上限的数据时，写入前必须显式处理长度边界。（来源: area）
- [退役追溯] 复活退役功能前必须读取删除历史与退役前代码，核对真实 death cause。（来源: area）
- [失败分支] 返回 null/false 表示失败的函数调用必须显式处理失败分支，不能只依赖 try/catch。（来源: area）
- [烟测铁律] smoke 铁律。（来源: area）
- [停滞探针] journey_features.updated_at 明显早于对应 PR 合并时间可作为 report 漏跑探针，应定期巡检。（来源: area）
- [产物核验] Brain 不得仅凭 harness-controller exit code 0 判完成，必须核验 report 产物确实写入。（来源: area）
- [有头核对] 环境白名单断言必须核对 headed 人工接管场景，不能直接复用无头先例。（来源: area）
- [派发锚点] headed relay 点火必须在 payload 写 base_repo 或 pr_url，分支名带 task short id。（来源: area）
- [退役实证] 退役判断必须核查生产数据、表行数和真实消费方，不依赖记忆或同名推断。（来源: area）
- [后台告警] catch 吞错的后台 job 必须有失败计数，连续失败超过阈值必须告警。（来源: area）
- [表名认领] 建表或复用表前必须核对全部写入方，多模块共表须经 schema 对齐评审。（来源: area）
- [消费闭环] 新增后台落库 job 必须同时声明真实消费方，无下游读方不得上线。（来源: area）
- [多端完整] 涉及多个 os_type/device_platform 时，数据字段、合同和展示层必须逐端完整区分。（来源: area）
- [语义一致] 同一语义在判变端与终验端必须采用同一处理策略，禁止跨脚本分叉。（来源: area）
- [引用核验] `git rev-parse` 判断 ref 必须使用 `--verify "<ref>^{commit}"`。（来源: area）
- [测试隔离] smoke 用真实 worktree 时必须核对生产资源接缝并显式设置全部 SKIP 钩子。（来源: area）
- [部署失败] 部署链失败不得降级为 warning，必须显式失败、告警并非零退出。（来源: area）
- [生产真相] 部署判变基准使用生产实体自报信息与 origin/main 对账，禁止依赖工作区 diff。（来源: area）
- [测试质量] lint-test-quality 要求异步调用时，源码读取测试应通过可等待的函数契约完成。（来源: area）
- [合同表格] Test Contract 固定四列，testFile 用反引号包裹并保持 checker 可解析。（来源: area）
- [红灯提交] Red commit 只能精确 add 测试路径，禁止 git add . 或把非测试文件混入。（来源: area）
- [接线回归] 调度接线回归应以可执行生产命令构造器为准，必要时辅以源码契约检查。（来源: area）
- [定时入口] 新增 cron 首先核对 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径。（来源: area）
- [合并权限] harness-generator 禁止自行 merge，只能推 branch 并报告 ready，merge 权归 controller。（来源: area）
- [环境透传] headed relay 的 tmux innerCmd 必须显式 export session 内需要的 harness 环境变量。（来源: area）
- [历史合同] Proposer 复用历史合同前必须核对本任务真实派发与执行历史，不能假设路径相同。（来源: area）
- [共享禁区] 共享 CI 基础设施未经合同显式授权不可修改，自身触发的 CI 问题应另立 sprint。（来源: area）
- [提前合并] PR 若在 evaluator/judge 前被兜底机制合并，必须按 head SHA 核对 verdict 与合并代码一致。（来源: area）
- [烟测铁律] smoke 铁律。（来源: area）
- [源码烟测] feat 且修改 brain/src 的 PR 在开 PR 前必须带齐 smoke.sh 与 smoke allowlist 登记。（来源: area）
- [类型接线] 新 task_type 必须核对约束、路由、executor、relay 映射及 dispatcher 防线的完整接线。（来源: area）
- [服务存活] 宿主服务存活判定必须结合 launchctl 状态与端口监听双信号。（来源: area）
- [宿主服务] 美国 Mac mini 常驻服务不得放入不存在的 GUI LaunchAgent 域，应使用合适的系统服务域。（来源: area）
- [巡检清单] 新增常驻宿主服务必须同步加入 launchd-patrol 对应 manifest。（来源: area）
- [烟测铁律] smoke 铁律。（来源: area）
- [单槽串行] 单个 slot 同时仅推进一个任务；任务内只读工种可扇出，但同时只能有一个代码实现者。（来源: area）
- [环境假设] 环境相关假设值不得写死，应从环境推导或在真实目标校准。（来源: area）
- [真境完成] 依赖真实环境的接缝断言必须在目标环境验证；未真验只能标 logic-done-pending。（来源: area）
- [多租户测] 单元与 E2E 默认使用至少两个租户并断言互不串读串写。（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志。（来源: area）
- [日志脱敏] 客户隐私、PII、聊天内容不得明文进入日志。（来源: area）
- [端点鉴权] 每个 API 端点必须有鉴权，无鉴权端点不得交付。（来源: area）
- [租户隔离] 涉及租户数据的查询与写入必须限定当前租户，禁止跨租户混读混写。（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

```bash
# 非破坏性自动验收
cd packages/brain
npx vitest run src/__tests__/integration/session-provenance.integration.test.js
npx vitest run src/__tests__/conversation-capture-human-gate.test.js src/__tests__/integration/conversation-capture.integration.test.js
npx vitest run src/__tests__/headed-dispatch.test.js
cd ../..
bash -n scripts/claude-launch.sh
bash -n packages/brain/scripts/cecelia-run.sh
bash scripts/__tests__/claude-launch-session-provenance.test.sh
bash packages/brain/scripts/__tests__/cleanup-conversation-captures.test.sh
bash scripts/devgate/check-version-sync.sh
```

验收出口：migration 覆盖 human、machine、非法 kind 与重复应用；launcher 覆盖 machine、human、未知、psql 失败和 dry-run；capture 覆盖 human 原始+摘要、machine/未登记零捕获、混合批次、查询失败零 LLM、Codex/Grok 未登记；清理测试证明备份失败时不删除且 DELETE 只匹配 `source LIKE 'conversation%'`。完整回归与权威 DevGate 全绿，并保留 Tasks 1–5 的 Red→Green 证据。

生产接缝验收：独立评审通过后由主 session 执行带 `--confirm` 与仓外 `--backup-dir` 的清理 SOP，记录 backup path 与 before/backed_up/deleted/after；随后按正常 Brain migration/deploy 路径上线。第 7 天查询部署后新增 `conversation%`，人工确认机器噪音为 0，并记录新增量及 skipped_machine/skipped_unregistered 汇总。worker 不执行这两步。

## journey_type: autonomous
## journey_type_reason: 变更位于 packages/brain 后台采集与启动脚本，无用户界面路径。
## target_environment: local_api
## target_environment_reason: Cecelia Brain 纯后端与本地 PostgreSQL 接缝由本地 evaluator 验证，生产数据步骤留给主 session。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
