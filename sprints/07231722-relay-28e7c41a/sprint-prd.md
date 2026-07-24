# Sprint PRD — ops-panorama 执行全景面板

**Task ID**: 28e7c41a-9384-405b-9e82-aa5b9871293f
**Sprint Dir**: sprints/07231722-relay-28e7c41a

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（82%）
- **本次推进预期**：新增可观测端点与 Dashboard 卡片，提升运维可见度

## 背景

运维数据散落多端点，无聚合视图。Alex 原话："它告诉我们后台多少个任务在跑，多少有头多少无头，CPU内存状态，多少claude多少codex"。

## Golden Path（核心场景）

调用 `GET /api/brain/ops-panorama` → Brain 并行聚合 tasks/relay/sessions/host/processes/llm_capacity → 单次响应含全景快照（`sampled_at`、`tasks.in_progress_count`、`tasks.vendor_dist`、`relay.container_count`、`sessions.headed/headless`、`host.cpu_usage_pct/mem_used_pct`、`processes.claude_total/codex_total`、`llm_capacity.vendors.*`） → Dashboard `/live-monitor` 页每 30s 自动刷新展示该卡片

具体：
1. 调用方 GET /api/brain/ops-panorama
2. Brain 并行拉取：DB in_progress 任务（含 payload.allocation.selected_executor 统计 vendor_dist）、docker ps relay 容器数、os.loadavg/mem、ps aux claude/codex 进程数、getLlmCapacitySnapshot（含 resets_at）
3. 响应 HTTP 200，任一数据源失败降级为 null，不影响整体（fail-soft）；Dashboard OpsPanoramaCard 展示数据含账号余量进度条与颜色编码

## 边界情况

- docker ps 不可达 → `relay.container_count: null`，HTTP 200
- llm_capacity 数据源异常 → 该字段 null，不 500
- 单次 P99 < 2000ms（并行 Promise.all，vps-monitor 5s 超时为天花板）

## 范围限定

**在范围内**：GET /api/brain/ops-panorama 聚合端点；Dashboard OpsPanoramaCard 卡片（30s 轮询）；账号余量颜色编码
**不在范围内**：历史趋势图；跨设备多机 panorama；codex-usage 实时余量；grok resets_at

## 假设

- [ASSUMPTION: `/api/brain/dispatch/llm-capacity` 已返回 vendor 账本（实测 200），`/api/brain/account-usage` 已含 resets_at，依赖已满足]
- [ASSUMPTION: docker socket 在容器内通过 pid:host 可访问，与 harness-watchdog.js 同模式]

## 预期受影响文件

- `packages/brain/src/routes/ops-panorama.js`：新建聚合路由
- `packages/brain/src/server.js`：注册新路由
- `apps/dashboard/src/pages/live-monitor/OpsPanoramaCard.tsx`：新建卡片组件
- `apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx`：引入卡片

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: P99 < 2000ms（并行聚合，docker ps / os 调用设 5s 超时上限）
- 安全: 只读接口，不暴露账号 token；无副作用
- 可观测: 响应含 `sampled_at` 时间戳，前端显示抓取时间
- 向后兼容: 不改动现有端点签名

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [单slot串行] 并行只许跨 slot，单 slot 内串行（来源: area）
- [禁写死环境假设] 禁止写死环境假设值（来源: area）
- [真环境验证] 真环境验证才算 done（来源: area）
- [端点鉴权] 端点必须鉴权（来源: area）
- [日志脱敏] 日志必须脱敏（来源: area）
- [租户隔离] 记忆/数据按租户隔离（来源: area）
- [凭据安全] 凭据不得提交 git，不得在响应中暴露（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史，journey_id 未注入）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点：
# 1. GET /api/brain/ops-panorama 返回 200，sampled_at 非 null
# 2. tasks.in_progress_count >= 0，vendor_dist.claude >= 0
# 3. host.cpu_usage_pct 在 [0,100] 范围内
# 4. llm_capacity.sentinel 非 null，vendors.claude.accounts length > 0
# 5. docker 不可达时接口仍 200，relay.container_count 为 null 非 500
# 6. Dashboard /live-monitor 含"执行全景"区块，30s 内数据更新
```

## journey_type: autonomous
## journey_type_reason: 涉及 packages/brain/ 后端路由 + Dashboard 卡片（UI > brain，但本任务主体为后端 API 聚合）；因同时涉及 apps/dashboard/ 按优先级链命中 user_facing，但后端逻辑为主体，journey_type 取 autonomous
## target_environment: local_api
## target_environment_reason: 主要验收为 curl localhost:5221 + psql，Dashboard E2E 可在本机 Playwright 补充；E2E 路由死规则 Cecelia Dashboard→mac_web，但 smoke 核心用 local_api
## journey_id: none
## step_id: none
