# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: d7c22d586a5e86c721ecff4bb92c65916512a9d23161cf8d89db61bf76782605

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的中文使用说明与验收口径

## 背景

为宿主及远端调用方提供一页可直接查阅的《attempt-run 桥接使用说明》，明确端点、鉴权、角色、请求字段及失败回滚语义，降低错误派发风险。

## Golden Path（核心场景）

宿主或远端调用方从 `docs/current/` 打开《attempt-run 桥接使用说明》→ 按说明鉴权并通过 `POST /api/brain/harness/attempt-run` 创建 attempt-run → 使用 `GET /api/brain/harness/attempt-run/:id` 查询状态 → 获得运行结果或明确的派发失败回滚状态。

具体：
1. 文档分别说明 POST 创建端点与 GET 查询端点的用途，并说明二者采用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
2. 文档逐项列出九项角色白名单：`planner`、`proposer`、`reviewer`、`generator`、`generator-fix`、`evaluator`、`evaluator-fix`、`judge`、`reporter`。
3. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，并由生产 Brain 自解析。
4. 文档说明派发失败后自动回滚的最终状态：`run → failed`、`session → closed`、`task → cancelled`。
5. 读者能仅凭该页确认创建、查询及失败处置规则，且仓库代码无变化。

## 边界情况

- loopback 与宿主/远端的鉴权要求必须分开表述，不能让远端读者误以为可不带令牌。
- `base_sha` 只能描述为可省略并由生产 Brain 自解析，不能列入必填字段。
- 派发失败必须同时呈现 run、session、task 三类对象的回滚终态。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文说明文档，包含端点用途与鉴权、九项角色白名单、payload 字段和失败自动回滚四节。

**不在范围内**：修改任何代码、接口行为、鉴权策略、角色白名单、数据库结构或部署配置；编写其他语言版本。

## 假设

- [ASSUMPTION: 九项角色白名单按当前 Harness 角色命名为 planner、proposer、reviewer、generator、generator-fix、evaluator、evaluator-fix、judge、reporter；实现阶段须以现有 attempt-run 契约的权威枚举逐项核对，文档不得创造别名。]
- [ASSUMPTION: 文档文件名采用能清晰表达 attempt-run 桥接用途的中文或英文 kebab-case 名称，且唯一落在 docs/current/。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`：新增《attempt-run 桥接使用说明》中文文档。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 文档必须准确说明派发失败后三类对象的最终状态。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；下列为本 sprint 直接适用的 area 铁律 -->
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [禁止写死环境] 环境假设值不得写死，必须从环境推导或在真实环境校准（来源: area）
- [真环境验证] 依赖生产环境或真实调用方的接缝断言必须在真实目标验证后才算完成（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：docs/current/ 下恰有新增中文说明页；页面包含 POST/GET 端点用途及鉴权、九项角色白名单、payload 必填/可省略字段、三对象失败回滚四节；git diff 不含代码文件。
```

## journey_type: autonomous
## journey_type_reason: 本 sprint 仅规划 Cecelia 仓库 docs/current/ 中文说明文档，不含 UI、远端 agent 协议或 Engine 行为变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web，文档产物在 Cecelia 本机工作区验收。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
