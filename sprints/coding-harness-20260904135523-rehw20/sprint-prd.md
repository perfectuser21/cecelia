# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: ed555d50a97284231c3d3a1fef005b47e09f4183e70cc6df7762fb9733417360

## OKR 对齐

- **对应 KR**：未配置（Brain 上下文未提供可锚定 KR）
- **当前进度**：未提供
- **本次推进预期**：交付一页可核验的 attempt-run 桥接中文说明

## 背景

为调用方提供《attempt-run 桥接使用说明》，明确创建与查询 attempt-run 的合同、鉴权边界、角色范围、请求字段及派发失败后的自动回滚结果，减少错误调用与状态误判。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按鉴权要求调用 `POST /api/brain/harness/attempt-run` 创建运行 → 使用返回的标识调用 `GET /api/brain/harness/attempt-run/:id` 查询运行 → 能据文档判断正常派发结果或失败回滚后的终态。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 的创建用途与 `GET /api/brain/harness/attempt-run/:id` 的查询用途。
2. 文档说明两端点采用 `internalAuthOrLoopback`，宿主或远端调用必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
3. 文档逐项列出九项角色白名单，并说明白名单外角色不可派发。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析。
5. 文档说明派发失败会自动回滚为 `run→failed`、`session→closed`、`task→cancelled`，读者可据查询结果识别失败终态。

## 边界情况

- 区分本机 loopback 与宿主/远端请求，避免把 loopback 免令牌条件泛化到远端。
- 明确 `base_sha` 是可省略字段，不将其误列为 payload 必填项。
- 九项角色必须完整、去重且名称与现有合同一致。
- 自动回滚只描述派发失败后的三个状态结果，不承诺未给出的重试或恢复行为。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，覆盖端点用途与鉴权、九项角色白名单、payload 字段规则、派发失败自动回滚四节。

**不在范围内**：不修改代码、接口、鉴权策略、角色白名单、数据库结构、运行状态机或现有文档之外的文件。

## 假设

- [ASSUMPTION: 九项角色的准确名称以实现基线 `c8e01505b4cd8f1e6dff9fc3cdea2973191eb190` 中现有 attempt-run 合同为准，文档不得自行创造或改写角色名。]
- [ASSUMPTION: 新文档文件名采用仓库 `docs/current/` 既有中文文档命名约定，标题必须为《attempt-run 桥接使用说明》。]

## 预期受影响文件

- `docs/current/<attempt-run-桥接使用说明文档>`：新增中文使用说明；具体文件名遵循目录既有约定。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 以实现基线 `c8e01505b4cd8f1e6dff9fc3cdea2973191eb190` 的接口合同为准
- 可观测: 验收可通过文件、语言、四节内容与 git diff 机械检查

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；仅保留与本 sprint 直接适用的 area 约束 -->
- [授权隔离] 宿主或远端调用必须使用调用方获授权的 `CECELIA_INTERNAL_TOKEN`，不得混用他人凭据（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
# proposer 应生成只读验收脚本：确认 docs/current/ 新增中文文档，且存在四个独立章节。
# 脚本须逐字检查两个端点、internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN、九项角色、
# sprint_dir/base_repo/branch、base_sha 可省略且由生产 Brain 自解析，以及
# run→failed、session→closed、task→cancelled；并用 git diff 证明没有代码文件变化。
```

## journey_type: autonomous
## journey_type_reason: 本 sprint 是仓库内部接口合同文档，不包含用户界面或远端 agent 协议改动。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在工作区执行文档内容与 git diff 检查。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
