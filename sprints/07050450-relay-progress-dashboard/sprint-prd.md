# Sprint PRD — Relay 进度条 Dashboard 页面

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+2%（新增 harness relay 可视化监控能力）

## 背景

主理人需要在 Dashboard 上实时观察 harness relay 任务进度，当前只能翻 API 或日志。
本 sprint 在 `apps/dashboard/` 新增一个「Harness 进度」页面，读 relay-runs API 渲染七棒横向进度条。

## Golden Path（核心场景）

用户从 [Harness 进度页入口] → 经过 [读 relay-runs API + 渲染七棒进度条] → 到达 [一眼看到每条 relay 跑到哪一棒]

具体：
1. 用户打开 Cecelia Dashboard 的「Harness 进度」页 → 系统请求 `GET /api/brain/orchestrator/relay-runs` → 渲染活跃 initiative 列表（无活跃时显示"暂无进行中的 relay"空态）
2. 每个 initiative 显示一条七段横向进度条，段标签依次：`planning → gan → generate → evaluate → judge → merge → report`；当前 phase 高亮，已完成段变实色，未到段变灰
3. 每行附 initiative_id 短码（前 8 位）+ 当前 phase 文字 + verdict（若有）+ cost（若有）
4. 页面每 15 秒自动刷新，进度条随 relay 推进移动

## 边界情况

- 无活跃 relay：显示"暂无进行中的 relay"空态文案
- API 请求失败：显示错误提示，不崩溃
- phase 值含前缀（如 `A_planning`）：UI 剥离前缀显示为 `planning`

## 范围限定

**在范围内**：Relay 进度可视化页面（新增 thin），`apps/dashboard/` 内的页面组件 + 路由接入
**不在范围内**：修改 Brain 后端 API、历史归档查看、多 journey 筛选、移动端适配优化

## 假设

- [ASSUMPTION: relay-runs API 返回字段含 initiative_id / phase / judge_verdict / cost_usd，已从真实 API 确认]
- [ASSUMPTION: apps/dashboard/src/pages/ 目录下已有 harness-pipeline 页，路由机制可参照]
- [ASSUMPTION: phase 字段可能含 `A_` 前缀，UI 需规范化展示]

## 预期受影响文件

- `apps/dashboard/src/pages/harness-pipeline/`（或新建 `relay-progress/`）：新增进度页组件
- `apps/dashboard/src/App.tsx`（或路由文件）：注册新页面路由

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟：自动刷新间隔 15 秒（PrepPRD 明确）
- 频控：待定（PrepPRD 未指定）
- 版本要求：无特殊要求
- 可观测：API 失败需在页面显示错误提示，不静默失败

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [禁止写死环境假设值] 屏幕坐标/阈值/env 假设值禁止写死，API URL 从配置读取（来源: area）
- [真环境验证才算done] 接缝断言必须在真目标上验证；未真验只能标 logic-done-pending（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种 ≥2 个租户并断言互不串（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII 不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组 -->
- （本 line 暂无历史已完成 ability）

## E2E 验收

> 最终可执行 E2E 脚本由 proposer 在 GAN 阶段产出（target_environment: mac_web → Playwright）。

```bash
# 占位：proposer 将按 mac_web 填入 Playwright 脚本
# 期望验收点：
# 1. Playwright 打开进度页 → 断言页面出现进度条容器元素（data-testid="relay-progress-container"）
# 2. 七段 phase 标签在 DOM 中可见：planning/gan/generate/evaluate/judge/merge/report
# 3. 数据来自真实 relay-runs API → 断言 initiative 短码（前8位）渲染在页面上
# 4. 无活跃 relay 时，断言空态文案"暂无进行中的 relay"可见
# 5. CI 全绿（mac_web Playwright，localhost:5174）
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ 前端页面，优先级链第一位命中 user_facing
## target_environment: mac_web
## target_environment_reason: Cecelia Dashboard Web UI，本机 Playwright，localhost:5174
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: relay-progress-dashboard
