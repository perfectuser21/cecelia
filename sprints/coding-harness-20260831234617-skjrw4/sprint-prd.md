# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: ba81a645243b83c61571fffa43de166b794bed36e1143778077c96d75ad88afb

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可操作中文说明，降低错误调用风险

## 背景

宿主与远端调用方需要一份统一入口文档，明确 attempt-run 桥接的端点、鉴权、角色、请求字段和失败回滚语义。

## Golden Path（核心场景）

调用方从 `docs/current/` 的《attempt-run 桥接使用说明》进入，按说明发起 attempt-run，再按返回标识查询结果，并能判断鉴权、参数或派发失败后的最终状态。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 用于发起运行，`GET /api/brain/harness/attempt-run/:id` 用于按标识查询运行。
2. 文档说明两端点使用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`，示例不得泄露真实令牌。
3. 文档单独列出且仅列出权威实现允许的九项角色白名单，角色名称与实现逐字一致，不增设别名。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，省略时由生产 Brain 自解析。
5. 文档说明派发失败会自动回滚为 `run→failed`、`session→closed`、`task→cancelled`，读者可据此核对失败收口。

## 边界情况

- 非 loopback 的宿主或远端请求缺少或使用无效 Bearer 令牌时，不得描述为可访问。
- payload 缺少任一必填字段时，不得暗示 Brain 会自动补齐；仅 `base_sha` 有省略语义。
- 九项角色白名单须来自权威实现，不得凭空推断名称或扩展为十项。
- 派发失败后的三个对象状态必须同时说明，避免只记录 run 失败而遗漏 session、task 收口。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，覆盖端点用途与鉴权、九项角色白名单、payload 字段及 `base_sha` 省略行为、派发失败自动回滚四节。

**不在范围内**：任何代码、测试、配置、接口行为或既有文档的修改；不新增端点、角色或回滚状态。

## 假设

- [ASSUMPTION: 九项角色的准确名称由后续角色从权威实现或 API registry 逐字提取；现有 PrepPRD 只规定数量，未提供名称，Planner 不编造。]
- [ASSUMPTION: Unified Map 未配置，因 task payload 缺少有效 `map_scope`/`map_repo`；本次以 PrepPRD 明示的 `docs/current/` 为唯一 scope 锚点。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`：新增中文《attempt-run 桥接使用说明》的唯一交付文件。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 语言：全文使用简体中文。
- 安全：不得写入真实 `CECELIA_INTERNAL_TOKEN`；仅展示占位符。
- 一致性：端点、角色、字段与状态名称须逐字匹配权威实现。
- 变更边界：除目标文档外不得修改任何文件。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；仅保留与本 scope 可执行相关的 area 铁律 -->
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [禁止写死] 环境假设值不得写死，应从环境推导（来源: area）
- [真环境验证] 依赖真实调用方的接缝断言必须在真目标验证后才算 done（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
# proposer 应生成只读文档验收脚本：
# 1. 断言 docs/current/ 下恰有目标中文文档。
# 2. 断言包含 POST/GET 用途与 internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN。
# 3. 解析“角色白名单”一节，断言恰有九项且与权威实现逐字一致。
# 4. 断言包含 sprint_dir/base_repo/branch 必填及 base_sha 可省略、由生产 Brain 自解析。
# 5. 断言包含 run→failed、session→closed、task→cancelled。
# 6. 以 implementation baseline 88929fa377f5bed3cd1876a575c366ff1b93c0d5 为基准，断言仅新增目标文档且无代码文件变化。
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 内部 Harness API 使用文档，不涉及 UI、远端 agent 协议或 Engine 开发流水线。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；文档验收在 Cecelia 工作区执行只读检查。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
