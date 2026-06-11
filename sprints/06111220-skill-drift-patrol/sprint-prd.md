# Sprint PRD — skill-drift 巡检告警（smoke 注册 + 日巡消费者）

## OKR 对齐

- **对应 KR**：Harness Pipeline 可观测性（Brain API 离线，KR 编号标注 [ASSUMPTION]）
- **当前进度**：未知
- **本次推进预期**：漂移从"静默"→"自动告警可查"

## 背景

`GET /api/brain/harness/skill-drift` 端点已上线（PR #3338/#3339），`skill-drift-smoke.sh` 已存在但未注册到 post-deploy 钩子；漂移发生时无人知晓，端点价值为零。本 sprint 补两件事：smoke 正式挂入 post-deploy 自动执行链路，以及每日巡检消费者（漂移→告警记录可查）。

## Golden Path（核心场景）

运维者从 [部署后/手动触发] → 经过 [smoke 校验/日巡检测] → 到达 [漂移可查、无漂移静默]

1. 运维者执行 `bash packages/brain/scripts/smoke/smoke-skill-drift.sh` → 输出 PASS（断言：HTTP 200、skills 恰 6 项、snapshot_version 全部非 null、any_drift 与逐项 drifted 一致）
2. 运维者把任意一份快照 SKILL.md 的 `version:` 值改掉制造漂移 → 调用巡检触发入口（Brain 定时器手动触发 API 或等价方式，由实现决定）→ 系统产生一条可查的告警记录，内容指明漂移 skill 名
3. 运维者恢复快照 version → 再次触发巡检 → 不产生新告警
4. 运维者 `curl localhost:5221/api/brain/harness/skill-drift/patrol-history`（或等价端点）→ 能看到第 2 步告警记录（含 skill 名、发生时间）

## 边界情况

- Brain 重启后告警历史不丢失（DB 落库，不依赖内存缓冲）
- 同一次漂移内重复触发巡检 → 不产生重复告警（幂等，按日去重）
- 飞书静默时：只落库，不推送（尊重现有 alerting 通道配置）
- smoke 断言：任一 `snapshot_version == null` → 必须 FAIL（抓住 #3339 类 bug）

## 范围限定

**在范围内**：
- smoke 脚本正式挂入 post-deploy 自动执行钩子（注册或命名约定，由实现决定）
- `packages/brain/src/cron/skill-drift-patrol.js` 每日运行一次，复用现有端点逻辑检测漂移
- 漂移时调用 `raise('P1', 'skill_drift_<name>', '...')` + 落库一条告警记录
- `GET /api/brain/harness/skill-drift/patrol-history`（或等价）返回历史告警记录
- 注册巡检模块到 `tick-runner.js` 每日调度

**不在范围内**：
- 自动修复/同步漂移
- 6 个 harness skill 之外的 skill 检测
- Dashboard 展示
- 重新实现版本对比逻辑（复用现有端点）

## 假设

- [ASSUMPTION: Brain API 离线，OKR 进度无法实读，不影响范围锚定]
- [ASSUMPTION: `run_post_deploy_smoke` 的发现机制由 Proposer 按现有 smoke 目录约定实现]
- [ASSUMPTION: 告警记录落库复用现有 DB 连接（pool），无需新建独立存储]
- [ASSUMPTION: 每日巡检触发时间与 `cron/daily-real-business-smoke.js` 模式对齐（UTC 窗口内触发）]

## 预期受影响文件

- `packages/brain/scripts/smoke/smoke-skill-drift.sh` 或 `skill-drift-smoke.sh`：确认命名符合 post-deploy 发现约定
- `packages/brain/src/cron/skill-drift-patrol.js`：新增每日巡检模块
- `packages/brain/src/tick-runner.js`：注册巡检模块调用
- `packages/brain/src/routes/harness.js`：新增 patrol-history 查询端点
- DB migration（如需）：告警记录落库表

## E2E 验收

> 此区块为 Planner 初稿框定。最终可执行脚本由 proposer 按 `target_environment=local_api` 产出（curl + jq + psql）。

```bash
# 占位：proposer 按 local_api 模板填入真实脚本
# 期望验收点（自然语言）：
# 1. bash smoke-skill-drift.sh → exit 0 且输出 "PASS: N  FAIL: 0"
# 2. 制造漂移 → 触发巡检 → psql/curl 查到告警记录 rows=1，skill_name 指明漂移项
# 3. 恢复版本 → 触发巡检 → 查告警记录 rows 不变（无新增）
# 4. GET /api/brain/harness/skill-drift/patrol-history → HTTP 200，含步骤 2 的记录
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain/ 后端巡检模块，无 UI/bridge/engine 涉及
## target_environment: local_api
## target_environment_reason: Brain 内部模块 + curl localhost:5221 验证，无需 Playwright 或远端机器
## journey_id: （来源 = task.payload.journey_id，Cecelia Line 唯一 = Harness Pipeline）
## step_id: Deterministic Gate initiative 第 1/7 条 run
