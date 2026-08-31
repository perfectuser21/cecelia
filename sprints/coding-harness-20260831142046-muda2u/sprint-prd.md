# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 2a10ef8a3a51fe51bfc46b259bc583b8bae14f029bdd0cc204c1ccea8bb27b95

## OKR 对齐

- **对应 KR**：未配置（Brain 上下文未返回可锚定 KR）
- **当前进度**：未提供
- **本次推进预期**：交付一页可独立使用的 attempt-run 桥接中文说明

## 背景

宿主或远端调用方需要一页统一说明，了解 attempt-run 的发起、查询、鉴权、角色限制、payload 合同与派发失败后的自动回滚结果。

## Golden Path（核心场景）

调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按说明鉴权并调用 `POST /api/brain/harness/attempt-run` 发起运行 → 使用返回标识调用 `GET /api/brain/harness/attempt-run/:id` 查询 → 明确看到正常状态或派发失败后的闭环状态。

具体：
1. 文档分别说明 POST 发起端点与 GET 查询端点的用途。
2. 文档说明两端点采用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
3. 文档以独立章节完整列出服务端允许的九项角色白名单，不增写未获支持的角色。
4. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`，并说明 `base_sha` 可省略且由生产 Brain 自解析。
5. 文档说明派发失败会自动收口为 `run→failed`、`session→closed`、`task→cancelled`。

## 边界情况

- 区分 loopback 与宿主/远端鉴权要求，避免把 loopback 条件误写为远端免鉴权。
- 区分必填字段与可省略的 `base_sha`，不得把后者写成必填或要求调用方自行解析。
- 九项角色必须与服务端白名单一致，不能只写数量。
- 回滚必须覆盖 run、session、task 三层最终状态。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，包含端点与鉴权、九项角色白名单、payload 字段、失败回滚四节。

**不在范围内**：不修改代码、测试、配置、接口行为或其他文档；不新增端点或角色。

## 假设

- [ASSUMPTION: 九项角色的精确名称以实施基线 `5c12d2af68e2b2e4b8dcaaa2c87e50efab743291` 中服务端实际白名单为准；输入仅规定数量，未给出名称。]
- [ASSUMPTION: 新文档的具体文件名由实现者选择，但必须位于 `docs/current/` 且标题为《attempt-run 桥接使用说明》。]

## 预期受影响文件

- `docs/current/<attempt-run-bridge-guide>.md`：新增中文说明页；实际文件名可读且能表达 attempt-run 桥接用途。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 以实施基线 `5c12d2af68e2b2e4b8dcaaa2c87e50efab743291` 为准
- 可观测: 文档必须明确三层失败收口状态

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为与本次文档合同直接相关的有效铁律 -->
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [Planner 分支] Planner workspace 必须保持服务端签发的 planner_branch（来源: area）
- [真实验证] 依赖真实调用方的接缝断言必须在真实目标验证后才算 done（来源: area）
- [禁止写死] 环境假设值不得写死，应从环境推导（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
set -euo pipefail
DOC=$(find docs/current -maxdepth 1 -type f -name '*.md' -print | xargs grep -l 'attempt-run 桥接使用说明' | head -n 1)
test -n "$DOC"
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer CECELIA_INTERNAL_TOKEN' "$DOC"
grep -q '角色白名单' "$DOC"
grep -q 'sprint_dir' "$DOC" && grep -q 'base_repo' "$DOC" && grep -q 'branch' "$DOC"
grep -q 'base_sha' "$DOC" && grep -qE '可省略|选填' "$DOC" && grep -q '生产 Brain' "$DOC"
grep -q 'run→failed' "$DOC" && grep -q 'session→closed' "$DOC" && grep -q 'task→cancelled' "$DOC"
test "$(git diff --name-only 5c12d2af68e2b2e4b8dcaaa2c87e50efab743291...HEAD | grep -vc '^docs/current/')" -eq 0
echo 'attempt-run 桥接使用说明验收通过'
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Brain attempt-run 后端接口的中文说明文档，不含用户界面变化。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在已签发的 Cecelia 仓库工作区执行。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
