# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 035450cdd94bafddc0ab53ea4a2ff99b86f230e8cb74043cee9112c8fc97da4f

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可操作说明，降低错误派发风险

## 背景

生产 Brain 已提供 attempt-run 桥接能力，但需要一页中文说明锁定端点用途、鉴权、角色白名单、payload 合同和失败回滚语义。

## Golden Path（核心场景）

维护者从 `docs/current/` 打开《attempt-run 桥接使用说明》→ 按文档构造并鉴权提交 attempt-run → 用返回的 id 查询状态 → 在派发失败时确认关联资源均已回滚到终态。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 用于创建并派发一次角色执行，以及 `GET /api/brain/harness/attempt-run/:id` 用于按 id 查询执行状态。
2. 文档说明两个端点使用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Authorization: Bearer <CECELIA_INTERNAL_TOKEN>`，不得展示真实凭据。
3. 文档以九个独立条目完整列出生产角色白名单，名称与生产白名单逐项一致，不得使用别名或遗漏。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，省略时由生产 Brain 自解析。
5. 文档说明派发失败会自动形成 `run→failed`、`session→closed`、`task→cancelled` 三项终态。
6. 读者仅凭该页即可识别创建入口、查询入口、合法角色、最小 payload 和失败后的可观察结果。

## 边界情况

- 非 loopback 的宿主或远端请求缺少或使用错误 Bearer token 时，不得暗示可匿名访问。
- `base_sha` 省略只代表由生产 Brain 自解析，不得描述为固定值或由调用方猜测。
- 派发失败不能描述为部分成功；run、session、task 三类资源的终态必须全部写明。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，覆盖两个端点、鉴权、九项角色白名单、payload 字段和失败回滚。

**不在范围内**：不修改代码、路由、鉴权逻辑、数据库、测试运行逻辑或其他文档；不改变实现基线 `187bc35c8e9bc1b88997a224e9079819d9dfed5a`。

## 假设

- [ASSUMPTION: 文档中的九个角色名称以生产 Brain 当前白名单为唯一判定源，验收测试逐项比对，而非只检查数量。]
- [ASSUMPTION: 新文档文件名可由实现者按 `docs/current/` 既有命名约定确定。]

## 预期受影响文件

- `docs/current/<attempt-run-usage>.md`：新增《attempt-run 桥接使用说明》；唯一允许的交付文件。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 语言：全文使用简体中文。
- 安全：只展示环境变量名 `CECELIA_INTERNAL_TOKEN` 和占位符，不出现真实 token。
- 一致性：端点、字段名、状态名和九项角色名称必须可被测试文件逐字断言。
- 可观测：失败回滚的三个资源终态必须分别可检索。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；仅保留与本纯文档 sprint 有直接约束关系的条目 -->
- [规划分支] Planner 必须停留在服务端签发的 planner_branch，不得自行切换分支（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
# proposer 应将以下验收点翻译为可执行测试：
# 1. docs/current/ 下恰有本 sprint 新增的中文说明页，且没有代码文件变化。
# 2. 文档逐字包含 POST 与 GET 两个端点、internalAuthOrLoopback、Bearer、CECELIA_INTERNAL_TOKEN。
# 3. 文档存在九个独立角色白名单条目，逐项等于生产白名单。
# 4. 文档逐字包含 sprint_dir、base_repo、branch、base_sha 及“可省略并由生产 Brain 自解析”语义。
# 5. 文档逐字覆盖 run→failed、session→closed、task→cancelled。
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia Brain attempt-run 后端桥接的使用说明，不涉及用户界面。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；文档验收在该角色环境的仓库工作区执行。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
