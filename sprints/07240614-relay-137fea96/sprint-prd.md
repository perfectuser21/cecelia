# Sprint PRD — postdeploy-verifier smoke 任务清理机制真正生效

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（进度 82%）
- **当前进度**：可信赖性/告警质量维护，非新增能力，不计百分比推进
- **本次推进预期**：消除一类自触发的假 P1 告警噪音，提升告警链路信噪比

## 背景

Brain task 17c9d62d（title="smoke: pending_postdeploy test"）连续 3 次 postdeploy 验证失败，触发 P1
告警自动开出本任务。根因（已独立复核确认）：`postdeploy-verifier-smoke.sh` Step 2 插入真实
`pending_postdeploy` 任务，Step 3 `curl -X DELETE ... || true` 清理；`grep router.delete
routes/*.js` 复核确认 task-tasks.js **无 DELETE 路由**，清理请求 404 被静默吞掉（PATCH 理论可用
status=cancelled 代替，但脚本硬编码 DELETE verb，路径不通）。残留任务被 `fetchPendingBatch`（无
title 过滤）当真实部署任务扫描，`curl localhost:5221/api/brain/health` 连续 3 次
`spawnSync ETIMEDOUT`（复核当前返回 200 healthy，非 Brain 故障，是环境资源瞬时紧张）→
`recordRetryOrFail` exceeded：标 failed + P1。task 17c9d62d 现状：`status="failed"`（终态），已不
在扫描范围，**保持现状不做变更**，留作历史证据。

## Golden Path（核心场景）

**场景 1 — 清理机制真正生效**：运维/测试脚本对残留 `pending_postdeploy` 任务发起
`DELETE /api/brain/tasks/:id` → Brain 校验（不存在→404；已终态 completed/cancelled→409 防误删；
其余→软删除 `status='cancelled'`，200 + 更新后记录）→ 任务不再出现在 `pending_postdeploy` 列表，
下轮 tick 扫描捡不到它，不消耗重试预算、不触发 P1。

**场景 2 — 纵深防御**：smoke 脚本插入 title 前缀 `smoke:` 的测试任务（验证 pending_postdeploy 写入
路径本身可用）→ 即便场景 1 清理未执行/失败，`fetchPendingBatch` 在 SQL 层排除 `smoke:` 前缀任务
→ 该任务不被消费/重试/标 failed/告警，只静置 pending_postdeploy，不产生 P1 噪音。

## 边界情况

- 目标任务不存在 → 404；已是 completed/cancelled → 409（防误删历史记录）
- title 恰好以 `smoke:` 开头的真实生产任务（极低概率巧合命名）→ 不在本 sprint 处理

## 范围限定

**在范围内**：
- `task-tasks.js`：新增 `DELETE /:id`，软删除 `status='cancelled'`，复用 `TERMINAL_STATUSES` 保护
- `postdeploy-verifier.js`：`fetchPendingBatch` 加 `WHERE title NOT LIKE 'smoke:%'`
- 对应单元测试（DELETE 200/404/409；fetchPendingBatch 排除 smoke 前缀）
- 任务 17c9d62d：不做任何变更（已是 failed 终态，明确保留）

**不在范围内**：
- 不重构 postdeploy-verifier 整体机制；不引入通用"测试数据标记"框架（如全局 is_test 字段）
- 不处理 ETIMEDOUT 环境资源问题本身（已复核非 Brain 故障，外部环境偶发）
- 不为 tasks 路由新增鉴权改造（新 DELETE 与本文件现有 POST/PATCH/GET 同一现状：无显式 auth，
  依赖 Brain 内网部署边界，见 Invariant 段"端点鉴权"张力说明）
- 不给其他资源（goals/projects/areas）补 DELETE 路由

## 假设

- [ASSUMPTION: DELETE 用软删除(status=cancelled)，不物理删行，同 conversations.js 现有模式]
- [ASSUMPTION: smoke 任务识别用 title 前缀 `smoke:`（大小写敏感）精确匹配，与脚本硬编码 title 一致]
- [ASSUMPTION: task 17c9d62d 保持现状不变，不需额外清理]

## 预期受影响文件

- `packages/brain/src/routes/task-tasks.js`：新增 DELETE /:id 路由
- `packages/brain/src/postdeploy-verifier.js`：fetchPendingBatch 排除 smoke 前缀任务
- `packages/brain/src/__tests__/postdeploy-verifier.test.js` + task-tasks 测试（新建/复用）：补测试

## NFR 约束

NFR: N/A（decisions 表 category=nfr 无匹配记录；运维 Bug 修复，无 PrepPRD 显式性能/频控指标；沿用
下方 Invariant 作为质量门槛）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级；已过滤 smoke-invariant 测试污染数据与
     [agent-offline-alert] 不相关 learning 条目 -->
- [单slot串行] 一个 slot/会话内严格串行执行任务，同一 slot 同时只允许一个任务在跑（来源: area）
- [禁止写死环境假设值] 环境假设值禁止写死，要么从环境推导要么真机校准（来源: area）
- [真环境验证才算done] 依赖真机/生产 env 的接缝断言必须在真目标上验证过才算 done（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种≥2个租户并断言互不串（来源: area，本任务无租户维度不适用）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area——与本文件现有
  POST/PATCH/GET 路由现状一致的已知张力，本 sprint 不新增认证改造，见"不在范围内"）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户（来源: area，tasks 表非租户数据不适用）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 本任务无 journey_id/ability_id 锚定（P1 告警自动路由任务，非 Golden Path 迭代） -->
- （本 line 暂无历史）

## E2E 验收

> 最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl + psql）。

```bash
# 期望验收点（自然语言）：
# 1. DELETE 真实存在的 pending_postdeploy 任务 → 200，psql 查该行 status='cancelled'
# 2. DELETE 不存在的 id → 404；DELETE 已 completed 的任务 → 409（未被误改）
# 3. 插入 title='smoke: xxx' 的 pending_postdeploy 任务，手动触发 runPostdeployVerifier → 不出现在本
#    轮 verified/failed 计数，psql 查其 status 仍为 pending_postdeploy（未被消费）
# 4. postdeploy-verifier-smoke.sh 全脚本跑一遍，Step 3 清理用新 DELETE 路由，响应码 200，脚本清理
#    后 psql 确认任务 status='cancelled'
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain/ 后端 Bug 修复，无 UI/前端/agent 远程协议涉及
## target_environment: local_api
## target_environment_reason: 验证只需 curl + psql 全链路（本地 evaluator），不涉浏览器/真机，命中 Step 0.5「仅 packages/brain/ 或纯 API/后台任务 → local_api」
## journey_id: none
## step_id: none（PrepPRD 未锚定，P1 告警自动路由任务，非 Golden Path 迭代）

## 锚定声明（供 controller 评估 gear=hotfix）

范围极小、边界明确，符合 hotfix 候选条件：改动仅 2 个文件（task-tasks.js 新增 1 路由；
postdeploy-verifier.js 改 1 个 SQL WHERE 子句）；断言可机械验证（HTTP 状态码 200/404/409 + psql 字段值
+ tick 扫描计数），无主观判断空间；无 UI/多服务协同，验收链路短；复用既有代码模式（软删除仿
conversations.js，状态机保护仿现有 PATCH），无新架构决策；风险面单一，不触碰核心调度/派发逻辑。
是否采纳 gear=hotfix 由 controller 最终裁定。
