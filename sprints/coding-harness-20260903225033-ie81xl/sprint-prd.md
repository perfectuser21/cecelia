# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 8e3d827f15c6577c0c6b305c0800c4f9f863c34b7e140867b038893435d76e3f

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可操作说明，降低宿主与远端调用误用风险

## 背景

为 `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id` 提供一页中文使用说明，使调用方能正确鉴权、构造派发请求、查询运行状态，并理解派发失败后的自动回滚结果。

## Golden Path（核心场景）

宿主或远端调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按说明携带 Bearer `CECELIA_INTERNAL_TOKEN` 调用 POST 派发 → 使用返回的 id 调用 GET 查询 → 能判断运行状态或派发失败后的回滚状态。

具体：
1. 文档分别说明 POST 派发 attempt 与 GET 按 id 查询 attempt 的用途。
2. 文档说明两端点均使用 `internalAuthOrLoopback`；宿主/远端请求必须携带 Bearer `CECELIA_INTERNAL_TOKEN`，且不得展示真实 token。
3. 文档完整列出服务端权威的九项角色白名单，不使用“等”省略。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析。
5. 文档说明派发失败时状态自动回滚为 `run→failed`、`session→closed`、`task→cancelled`。
6. 读者可依据四个独立章节完成派发、查询及失败状态判读。

## 边界情况

- 非 loopback 的宿主/远端请求缺少或使用错误 Bearer 凭据时，不应被文档描述为可成功访问。
- 文档不得把 `base_sha` 写成调用方必填字段，也不得暗示失败后仍需调用方修补 run、session 或 task 状态。
- 九项角色必须逐项给出且与服务端白名单一致；未知角色不属于支持范围。

## 范围限定

**在范围内**：在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，覆盖端点用途与鉴权、九项角色白名单、payload 字段规则、派发失败自动回滚四节。

**不在范围内**：修改任何代码、API 行为、鉴权策略、角色白名单、数据库结构或部署配置；新增其他文档页面。

## 假设

- [ASSUMPTION: 文档中的九项角色名称以生产 Brain 当前服务端权威白名单为准，必须逐项抄录并通过机械断言核对。]
- [ASSUMPTION: 文档文件名可采用清晰的英文 kebab-case，但页面标题必须为中文《attempt-run 桥接使用说明》。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`: 新增中文桥接使用说明；这是唯一允许变化的产品文件。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 文档必须明确 GET 查询入口与失败后的三类最终状态

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [环境假设] 环境假设值不得写死，须从环境推导或真实校准（来源: area）
- [真环境验证] 依赖真实调用方的接缝断言必须在真目标验证后才算 done（来源: area）
- [分支权威] Planner workspace 必须保持服务端签发的 planner_branch，不得切换分支（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# proposer 应提供可执行文档验收脚本，至少机械断言：
# 1. docs/current/ 下恰有目标中文说明页，且 git diff 不含代码文件。
# 2. 四个独立章节存在，并同时包含两个端点、internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN。
# 3. 九个服务端权威角色逐项出现，数量与名称均一致。
# 4. sprint_dir/base_repo/branch 明示必填，base_sha 明示可省略且由生产 Brain 自解析。
# 5. run→failed、session→closed、task→cancelled 三个回滚断言完整出现。
```

## journey_type: autonomous
## journey_type_reason: 本 sprint 仅交付 Cecelia 后端桥接 API 的使用说明，无 UI 交互或执行协议改动。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；文档产物在 Cecelia 工作区执行机械验收。
## journey_id: none
## step_id: none（PrepPRD 未锚定，gp_anchor=none(docs)）
