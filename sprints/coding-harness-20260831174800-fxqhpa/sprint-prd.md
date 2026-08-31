# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: d8f32d83db3cca811cfd3d72670eff0aeeed801e31f6e20c07509a8e291a33af

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的操作者文档，降低错误鉴权、错误 payload 与失败状态误判风险

## 背景

生产 Brain 已提供 attempt-run 桥接入口与状态查询能力，但缺少一页集中说明宿主或远端调用方如何安全派发、查询及识别失败回滚。本 sprint 只新增中文文档，不改变任何运行行为。

## Golden Path（核心场景）

操作者从 `docs/current/` 打开《attempt-run 桥接使用说明》→ 按说明构造并鉴权派发请求 → 查询 attempt 状态并正确理解派发失败后的回滚出口。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 的派发用途与 `GET /api/brain/harness/attempt-run/:id` 的状态查询用途。
2. 文档说明两端点使用 `internalAuthOrLoopback`；宿主和远端请求必须携带 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，且不得展示真实 token。
3. 文档设置“角色白名单”一节，完整列出系统允许的九项角色，不多不少，并与生产接口约束一致。
4. 文档设置“payload 必填字段”一节，明确 `sprint_dir`、`base_repo`、`branch` 必填；`base_sha` 可省略并由生产 Brain 自解析。
5. 文档设置“派发失败自动回滚”一节，明确最终状态链为 `run→failed`、`session→closed`、`task→cancelled`。
6. 测试文件以文档路径、中文内容、四个主题章节、两个端点、鉴权关键词、九项角色计数、payload 字段和回滚状态链作为可执行断言。

## 边界情况

- 区分回环请求与宿主/远端请求，不能把回环可访问误写成远端免鉴权。
- `base_sha` 是可省略字段，不能列入必填字段，也不能承诺由调用方猜测或写死。
- 九项角色名称以生产接口的现行白名单为准；文档必须逐项列出，不能仅写“共九项”。
- 派发失败说明必须同时覆盖 run、session、task 三层终态，不能只描述 HTTP 错误。

## 范围限定

**在范围内**：在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》；覆盖两个端点及鉴权、九项角色白名单、payload 字段规则、派发失败自动回滚；增加或更新测试文件对文档内容作机械验收。

**不在范围内**：修改 Brain、Harness、鉴权、路由或状态机代码；修改端点行为；新增角色；更改 payload schema；改动 `docs/current/` 之外的产品文档。

## 假设

- [ASSUMPTION: 新文档采用 `docs/current/attempt-run-bridge-guide.md`，标题保持《attempt-run 桥接使用说明》。]
- [ASSUMPTION: 九项角色的精确名称由下游从生产接口现行白名单提取并逐项写入，不能凭记忆新增别名。]
- [ASSUMPTION: 文档验收测试放入仓库既有文档契约测试体系；若无对应体系，可新增单个测试文件，但不得改产品代码。]
- [ASSUMPTION: task.payload.map_scope/map_repo 未配置，因此 Unified Map scope 锚定状态如实记为未配置。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`：新增中文《attempt-run 桥接使用说明》。
- `packages/brain/test/attempt-run-bridge-doc.test.js`：机械验证文档存在、章节与关键合同内容完整；仅为预期测试路径，可按仓库既有测试布局等价落位。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 安全：示例只引用环境变量 `CECELIA_INTERNAL_TOKEN`，不得出现真实凭据。
- 一致性：端点、角色、payload 与回滚终态必须与生产 Brain 当前合同一致。
- 语言：正文使用简体中文。
- 可观测：测试失败应明确指出缺失章节或合同关键词。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；列出与本 sprint 直接相关的有效铁律 -->
- [Planner 分支] Planner 必须停留在服务端签发的 planner_branch，不得自行切换分支（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准交付（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [真环境验证] 依赖生产环境或真实调用方的接缝断言必须在目标环境验证后才算完成（来源: area）
- [禁止写死] 环境假设值不得写死，须从环境推导或校准（来源: area）
- [验证命令] 合同中的验证命令必须实跑确认退出码语义（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本。
# 期望验收点：测试文件证明 docs/current/ 下目标中文文档存在，恰好覆盖四个要求主题；
# 两个 attempt-run 端点、internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN、九项角色、
# sprint_dir/base_repo/branch 必填、base_sha 可省略并由生产 Brain 自解析，以及三层失败终态均可被机械断言；
# git diff 同时证明没有产品代码改动。
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 后端 Harness API 的操作者文档，无用户界面或远端 agent 协议行为变更。
## target_environment: local_api
## target_environment_reason: Cecelia 纯后端接口合同文档默认由本地 evaluator 对仓库文件和测试断言验收。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
