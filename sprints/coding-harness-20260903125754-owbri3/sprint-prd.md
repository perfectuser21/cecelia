# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: ba15ca71e3cc197ab65330519dfd2e710f5b42338eefe68aec9969b8a4309b07

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可操作中文说明，降低错误调用风险

## 背景

为 Cecelia 的宿主与远端调用方提供一页统一、可核验的 attempt-run 桥接说明，使调用方能正确创建、查询运行，并理解派发失败后的状态回滚。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按鉴权和 payload 要求调用 `POST /api/brain/harness/attempt-run` → 使用返回标识调用 `GET /api/brain/harness/attempt-run/:id` 查询 → 获得运行状态；若派发失败，可从文档确认 `run→failed/session→closed/task→cancelled` 的自动回滚结果。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 的创建用途和 `GET /api/brain/harness/attempt-run/:id` 的查询用途。
2. 文档说明两端点采用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`，且不得展示真实凭据。
3. 文档单列并逐项列出系统支持的九项角色白名单，不得增删或用“等”代替。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析。
5. 文档说明派发失败会自动回滚为 `run→failed/session→closed/task→cancelled`。
6. 读者能仅凭该中文文档区分创建、查询、鉴权、角色、请求字段和失败回滚行为。

## 边界情况

- 回环调用与宿主/远端调用的鉴权要求必须明确区分，不能让远端读者误以为可免鉴权。
- `base_sha` 只能描述为可省略，不能误列为必填字段；省略后的解析主体必须是生产 Brain。
- 角色白名单必须恰为九项；本任务证据未提供各项名称，文档编写时必须以实现基线 `7984b6cfb5fd43294ece90d20257434dc917903c` 所定义的白名单为准。
- 回滚链中四个对象及其终态必须完整且顺序对应。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，覆盖两个端点、鉴权、九项角色白名单、payload 字段和派发失败自动回滚。

**不在范围内**：任何代码、测试、配置、API 行为、鉴权策略、角色白名单或既有文档的修改；不扩展 attempt-run 能力。

## 假设

- [ASSUMPTION: 九项角色的准确名称由实现基线中的服务端白名单提供；不得凭空补写。]
- [ASSUMPTION: 新文档文件名采用仓库现有 `docs/current/` 命名约定，标题必须为《attempt-run 桥接使用说明》。]

## 预期受影响文件

- `docs/current/<符合现有命名约定的文件>.md`：新增中文《attempt-run 桥接使用说明》；这是唯一允许的产品改动。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 以实现基线 `7984b6cfb5fd43294ece90d20257434dc917903c` 为准
- 可观测: 文档须明确派发失败后的四段终态链

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [禁止写死] 环境假设值不得写死，须从环境推导或在真实环境校准（来源: area）
- [真环境验证] 依赖真实调用方的接缝断言必须在目标环境验证后才算完成（来源: area）
- [Planner 分支] Planner 必须停留在服务端签发的 planner_branch，不得切换分支（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

```bash
# proposer 将补全为可执行脚本；验收必须至少做到：
# 1. 断言 docs/current/ 新增且仅新增一份 Markdown 文档，标题为“attempt-run 桥接使用说明”，正文含中文。
# 2. 断言文档分别出现 POST /api/brain/harness/attempt-run 与 GET /api/brain/harness/attempt-run/:id。
# 3. 断言鉴权节同时出现 internalAuthOrLoopback、Bearer 与 CECELIA_INTERNAL_TOKEN，且仓库 diff 不含真实 token。
# 4. 断言角色白名单节有且仅有九个逐项条目，并与实现基线中的服务端白名单集合完全相等。
# 5. 断言 payload 节把 sprint_dir、base_repo、branch 标为必填，并把 base_sha 标为可省略且由生产 Brain 自解析。
# 6. 断言失败回滚节包含 run→failed/session→closed/task→cancelled。
# 7. 断言相对实现基线 7984b6cfb5fd43294ece90d20257434dc917903c 的变更仅为 docs/current/ 下新增文档，不含代码、测试或配置改动。
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 后端桥接 API 的使用说明文档，不包含用户界面或远端代理协议变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；在 Cecelia 工作区完成文档与差异验收。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
