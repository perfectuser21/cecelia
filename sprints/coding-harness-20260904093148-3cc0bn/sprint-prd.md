# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 541dc1728c1cd6aed31701812cd4e8bdc2a35773bcaf39af521e12d23c1c7b7d

## OKR 对齐

- **对应 KR**：未配置（Brain context 未返回活跃 KR）
- **当前进度**：未提供
- **本次推进预期**：形成可直接使用和验收的 attempt-run 桥接中文说明

## 背景

为宿主与远端调用方提供统一的 attempt-run 桥接说明，减少端点用途、鉴权、角色、请求字段和失败回滚语义的误用。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 确认端点、鉴权和请求约束 → 正确发起 attempt-run 并查询结果，且能判断派发失败后的回滚终态。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 的创建用途与 `GET /api/brain/harness/attempt-run/:id` 的查询用途。
2. 文档说明鉴权为 `internalAuthOrLoopback`，并明确宿主或远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
3. 文档逐项列出完整的九项角色白名单，不使用“等角色”省略表达。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`，并说明 `base_sha` 可省略且由生产 Brain 自解析。
5. 文档说明派发失败时自动回滚为 `run→failed`、`session→closed`、`task→cancelled`。

## 边界情况

- 区分本机 loopback 与宿主/远端鉴权要求，避免把 loopback 便利误写成远端免鉴权。
- `base_sha` 仅可省略，不得描述为必填或由调用方猜测。
- 失败回滚必须同时覆盖 run、session、task 三类资源及其终态。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文使用说明，覆盖两个端点、鉴权、九项角色白名单、payload 字段和失败回滚四节。

**不在范围内**：任何产品代码、测试代码、API 行为、数据库结构或其他目录的变更。

## 假设

- [ASSUMPTION: 九项角色的准确名称以现有生产 Brain 接口合同为准，文档必须逐项照录，不新增别名。]
- [ASSUMPTION: 本任务未配置 Unified Map（payload.map_scope/map_repo 缺少有效映射），因此不作额外领域推断。]

## 预期受影响文件

- `docs/current/<attempt-run-bridge-guide>.md`：新增《attempt-run 桥接使用说明》中文文档；文件名可遵循目录现有命名约定。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 文档必须明确三类资源的失败终态

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为与本次文档合同直接相关的有效铁律 -->
- [分支归属] Planner 工作区必须保持服务端签发的 planner_branch，不得切换分支（来源: area）
- [实现基线] Harness 各角色必须沿用初始 implementation baseline，不得用角色工作区 SHA 替换（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准交付（来源: area）
- [真环境验证] 依赖生产环境或真实调用方的接缝断言必须在真实目标验证后才算完成（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# 由 proposer 转为可执行检查：确认 docs/current/ 仅新增一页中文 Markdown；正文存在四个独立主题段落，并逐字包含两个端点、internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN、九项角色、四个 payload 字段及三段回滚终态；同时确认 diff 不含任何代码文件。
```

## journey_type: autonomous
## journey_type_reason: 本 sprint 是 Cecelia 仓库内部 API 使用文档，无 UI、远端代理协议或开发流水线行为变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在对应 Mac 工作区检查中文文档内容与 git diff。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
