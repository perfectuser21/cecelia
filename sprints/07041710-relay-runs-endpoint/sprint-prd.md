# Sprint PRD — GET /api/brain/orchestrator/relay-runs 观测端点

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：83%（新增 v2 run 可观测性，skill-relay 对照验证可进行）

## 背景

N4 对照验证阶段需要观测 orchestrator_version='v2' 的 initiative_runs 记录，以确认 skill-relay 双轨路由是否正确写入 v2 run。Brain API 目前无专用端点列出 v2 runs，运维者只能查 DB，阻塞 N4 对照验证工作。

## Golden Path（核心场景）

运维者从 [curl GET /api/brain/orchestrator/relay-runs] → 经过 [Brain 查 initiative_runs WHERE orchestrator_version='v2'] → 到达 [拿到 JSON 数组，可确认 v2 run 已创建]

具体：
1. 运维者发送 `GET /api/brain/orchestrator/relay-runs`（可选 `?limit=N`）
2. Brain 查询 `initiative_runs WHERE orchestrator_version='v2'`，按 `started_at DESC` 排序，返回指定条数
3. 运维者看到 JSON 数组，每项含 `{id, initiative_id, phase, orchestrator_heartbeat_at, orchestrator_host, pr_url, started_at, deadline_at}`；无 v2 run 时返回空数组 `[]`

## 边界情况

- 无 v2 run → 返回 `[]`，HTTP 200，不报错
- `?limit=N` → 最多返回 N 条（默认 20，上限由调用方决定）
- DB 查询失败 → HTTP 500 + `{"error": "<message>"}` JSON，不崩进程

## 范围限定

**在范围内**：
- 新增 `GET /api/brain/orchestrator/relay-runs` 只读端点
- `limit` query param 支持
- 单元测试覆盖：空结果 / limit / DB 错误 500

**不在范围内**：
- 不做 UI
- 不改 `initiative_runs` 表结构
- 不动 v1 查询逻辑
- 不加写入/删除操作

## 假设

- [ASSUMPTION: `initiative_runs` 表已有 `orchestrator_version` 列（migration 312 已合并，见 harness-skill-relay.js + migration-312-orchestrator.test.js）]
- [ASSUMPTION: `pr_url` 列存在于 `initiative_runs`；若不存在则 SELECT 列表去掉该字段，不阻塞端点实现]
- [ASSUMPTION: 端点无需鉴权（内网运维观测端点，与现有 /api/brain/harness/runs 保持一致）]

## 预期受影响文件

- `packages/brain/src/routes/initiatives.js`（或新建 `packages/brain/src/routes/orchestrator.js`）：新增路由
- `packages/brain/src/server.js`：注册新路由（如新建文件）
- `packages/brain/src/__tests__/relay-runs.test.js`：单元测试（新建）

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟：待定（PrepPRD 未指定）
- 频控：无
- 版本要求：无
- 可观测：DB 查询失败必须返回 JSON 格式错误，不裸 throw

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [禁止写死环境假设] 屏幕坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准（来源: area）
- [真环境验证才算done] 依赖真机/生产env/真实调用方的接缝断言必须在真目标上验证过才算done；未真验的只能标 logic-done-pending（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种 ≥2 个租户并断言互不串（让隔离漏洞当场暴露）（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [租户隔离] 涉租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path -->
（本 line 暂无历史已验收 ability）

## E2E 验收

> 最终可执行脚本由 proposer 在 GAN 阶段产出。以下为 planner 框定的验收点。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. curl localhost:5221/api/brain/orchestrator/relay-runs 返回 HTTP 200 且 body 为 JSON 数组
# 2. curl localhost:5221/api/brain/orchestrator/relay-runs?limit=5 返回最多 5 条，按 started_at DESC
# 3. 无 v2 run 时返回 [] (200)
# 4. 单元测试覆盖：空结果 / limit 参数 / DB 错误返回 500+JSON
# 5. CI 全绿
```

## journey_type: autonomous
## journey_type_reason: 纯 Brain 后端端点，packages/brain/src/routes/ 实现，无 UI/前端交互
## target_environment: local_api
## target_environment_reason: Brain 内部纯 API 端点，curl localhost:5221 + 单元测试，本地 evaluator 即可验收
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: N4-relay-runs-endpoint
