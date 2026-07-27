# Sprint PRD — Harness Reviewer Result Channel 与 Feedback Lineage 恢复

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：恢复 reviewer 反馈闭环并消除错误合并路径；不虚构百分点

## 背景

恢复任务 `225d8ea7-195c-440a-a23a-e8916ab9d8a5` 在 reviewer 正式给出 REVISION 后中断的生产闭环。合同 `f6ca642fffa9369af89a5d35286cd1745818f89c` 与 reviewer attempt `0c58a945-1314-4454-8c2a-aba8f2b87166` 只作恢复证据，不作为当前绑定权威；当前 attempt/task bundle 与远端当前合同 SHA 才是服务端权威。必须复用现有 HarnessResult v1，不新增 v2、平行 schema 或 ledger。

## Golden Path（核心场景）

在现有 HarnessResult v1 上建立 reviewer/judge read-only result channel 与 server-owned run/round/SHA feedback lineage，使真实 callback→DB→ground-truth→dispatcher 闭环可收敛。

具体五个行为：

1. Dispatcher 动态枚举真实且 `readOnly=true` 的 ACTION_SPECS（当前为 `spawn:reviewer`、`spawn:judge`），为每个 attempt 注入唯一、可写的 `BRAIN_RESULT_FILE`/result channel，同时保持 `/workspace` 只读；未来新增的真实 read-only action 自动继承，未注册的 canary/reporter 不进入该路径。路径逃逸、符号链接、硬链接或跨 attempt、非普通文件、owner/mode 错误及结果缺失均被拒绝。
2. Read-only action 输出 HarnessResult v1；`decision.review` 兼容扩展为有界的 outcome、feedback、rubric、run、round、contract_sha。服务端以当前 attempt/task bundle 与远端当前合同 SHA 绑定并校验客户端同名字段，不允许客户端覆盖；canonical digest v1 对省略 digest 字段后的 canonical JSON 计算，服务端重算并区分篡改、同 digest 重放与异 digest 冲突。
3. 真实 `POST /api/brain/harness/attempts/:attemptId/callback` 通过凭据与绑定校验后，把完整有界 reviewer decision 持久化到 `harness_attempts.result`，只把有界 binding/digest 摘要写入 `orchestrator_decision_log`。成功及 400 invalid、401 credential、404 attempt、409 scope/lineage/digest conflict、500 persistence_failed 均经真实 HTTP 与隔离 PostgreSQL 验证；错误体严格为 `{"ok":false,"error":{"key":...,"code":...}}`，响应、日志和 DB 均不得出现 secret、transcript、chain-of-thought 或禁用字段。
4. Round 2 proposer 的 `prior_review` 只从该 attempt 精确结果行构建，并要求 `decision.resolutions` 对每个 prior feedback id 恰好覆盖一次；round 2 reviewer TaskBundle 使用同一 `prior_review` 与 resolutions 判定 resolved/unresolved/disputed。首轮与真实 legacy path 分别表达无历史，非首轮缺历史则阻断派发；恢复/续跑、fresh session、并发 run 隔离、stale SHA、重放、大小/secret、REVISION 与 APPROVED 均从 result channel 经 callback、真实 DB、ground truth 到 dispatcher TaskBundle 闭环验证，worktree prose 不具权威性。
5. APPROVED 仍受服务端 current-head 人工批准权威约束：只有 evaluator、judge 与用户批准锚定同一最终 SHA 才允许后续合并/部署；批准缺失或过期、SHA 不同及任一前置未通过时，合并/部署调用数必须为零。

## 边界情况

- 并发 attempt 不能读取、链接或复用彼此 result channel；恢复/重放不得改变已绑定的 run、round、task 或 SHA。
- 结果超限、含 secret 或禁用字段时整单拒绝且不反射；持久化失败不得留下半写入权威。
- RCI 仅使用显式隔离的 `TEST_DATABASE_URL`，变更前核对 `current_database()` 与 `inet_server_addr()`；禁止默认到 `localhost/cecelia`，依赖加载后再执行 Business Red。

## 范围限定

**在范围内**：现有 v1 contract 的 reviewer/judge result channel、callback 绑定/摘要、真实隔离 PostgreSQL 持久化、round 2 feedback/resolution lineage、恢复与最终 SHA 人工批准闸。

**不在范围内**：HarnessResult v2、平行 schema/ledger、虚构 `spawn:canary`、未注册 reporter 路由、生产 DB 写入、未获最终批准的 merge/deploy、与五个行为无关的重构。

## 假设

- [ASSUMPTION: 当前 dispatcher 的 read-only ACTION_SPECS 以运行时注册表为唯一枚举源，现存集合为 spawn:reviewer 与 spawn:judge。]
- [ASSUMPTION: “真实 legacy path 无历史”已有可识别的服务端标志；不得用缺行推断 legacy。]

## 风险与缓解

| 风险 | 缓解与验收信号 |
|---|---|
| lineage 错绑 | 服务端 bundle 与当前 SHA 等值校验；跨 run/round/task/SHA 返回稳定 409 |
| digest 歧义 | 固定 canonical digest v1 且省略 digest 字段；覆盖篡改、同 digest 重放、异 digest 冲突 |
| result-channel 逃逸 | attempt 隔离并校验路径、链接、普通文件、owner/mode、缺失结果 |
| 测试库污染 | 显式 TEST_DATABASE_URL，写前核对数据库名与服务端地址，禁止 localhost/cecelia |
| 批准绕过 | evaluator、judge、用户批准绑定同一 final SHA；负路径 merge/deploy 调用数为零 |

## 预期受影响文件

- `packages/brain/src/`：dispatcher read-only action、callback、v1 合同归一化、feedback lineage 与 final-SHA approval 所属现有模块。
- `packages/brain/` 的测试目录：真实 HTTP、隔离 PostgreSQL、RCI、恢复/并发及批准闸的行为测试。
- 现有 `execution-contract.js`：仅做 HarnessResult v1 兼容扩展，不建立替代合同。
- `packages/brain/DEFINITION.md`：Brain 行为变更对应版本与定义同步。

## NFR 约束

- 超时/延迟：不新增未约定 SLA；测试等待必须有界。
- 频控：沿用现有 callback 策略，不新增未定义规则。
- 兼容性：HarnessResult contract_version 保持 v1，现有 legacy 首轮路径可区分且不误阻断。
- 安全/隐私：secret、transcript、chain-of-thought 与禁用字段不得进入响应、日志或 DB；结果与反馈均有界。
- 可观测：稳定错误仅暴露 key/code；服务端可用有界 binding/digest 摘要追踪 attempt，不记录敏感正文。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [真实成功] 写库成功必须验证语义结果，不能只依赖表面 ok（来源: area）
- [合并权] generator 不得自行 merge，合并权归 controller（来源: area）
- [SHA一致] evaluator/judge 结论必须与实际最终 SHA 一致（来源: area）
- [环境路由] target_environment 以 Brain task payload 为准（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# proposer 必须生成 local_api 可执行脚本：先加载依赖，再以唯一的显式隔离 TEST_DATABASE_URL 启动 Brain/测试。
# 写库前断言 current_database() 为本次隔离库且 inet_server_addr() 符合测试环境；任一不符立即退出，绝不回退 localhost/cecelia。
# 以 fresh sessions 覆盖五个 Golden Path 行为，走真实 dispatcher result channel → HTTP callback → PostgreSQL → ground truth → round2 TaskBundle。
# 精确断言成功持久化、400/401/404/409/500 错误体、无敏感反射、并发隔离、恢复/续跑、stale SHA、digest 重放/冲突、大小/secret、REVISION/APPROVED。
# 对批准负路径注入 merge/deploy spy 并断言调用数为 0；仅 final SHA 的 evaluator+judge+用户批准同锚点时断言一次正向调用。
```

## journey_type: autonomous
## journey_type_reason: 目标是 Brain 内部 dispatcher、callback、PostgreSQL 与批准状态机闭环，无用户界面。
## target_environment: local_api
## target_environment_reason: task payload 显式指定 local_api，在本地 Brain HTTP 与显式隔离 PostgreSQL 执行。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 0cdadc1a-e3a0-46a1-8333-ebbc102883f7
## review_required: true
