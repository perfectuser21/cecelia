# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 048e8dc149c3b83d0a540bcc4f295dbd1bbf716d1c283ab29bb47458eaebf536

## OKR 对齐

- **对应 KR**：未配置（Brain context 未返回活跃 KR）
- **当前进度**：未配置
- **本次推进预期**：形成可直接使用、可机械验收的 attempt-run 桥接中文说明

## 背景

宿主或远端调用方需要一页集中说明，正确使用 attempt-run 创建与查询端点，并理解鉴权、角色、payload 及派发失败后的自动回滚语义。

## Golden Path（核心场景）

宿主或远端调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按说明鉴权并提交 `POST /api/brain/harness/attempt-run` → 使用返回的 id 调用 `GET /api/brain/harness/attempt-run/:id` 查询 → 能依据文档识别合法角色、完整 payload 和派发失败后的最终状态。

具体：
1. 文档分别说明 POST 创建/派发 attempt-run 与 GET 按 id 查询 attempt-run 的用途，并写明两者采用 `internalAuthOrLoopback`；宿主及远端调用必须发送 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`。
2. 文档列出角色白名单九项：`planner`、`proposer`、`challenger`、`generator`、`evaluator`、`judge`、`fixer`、`reporter`、`merger`，且明确白名单外角色不被接受。
3. 文档说明 payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略，省略时由生产 Brain 自解析，不要求调用方自行补值。
4. 文档说明派发失败会自动回滚为 `run→failed`、`session→closed`、`task→cancelled`，避免读者把部分创建状态误判为可继续执行。

## 边界情况

- 区分本机 loopback 与宿主/远端访问：后两者不得省略 Bearer token。
- 不把 `base_sha` 误写成必填字段，也不把其他字段误写成可替代三个必填字段。
- 派发失败时三类对象的状态及顺序必须完整呈现，不只描述 run 失败。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文《attempt-run 桥接使用说明》，覆盖两个端点、鉴权、九项角色白名单、payload 字段和失败回滚四节。

**不在范围内**：修改任何代码、路由、鉴权、状态机、测试、配置或既有文档；实际调用 attempt-run 端点。

## 假设

- [ASSUMPTION: 文档文件名采用 `docs/current/attempt-run-bridge-usage.md`，标题为《attempt-run 桥接使用说明》。]
- [ASSUMPTION: 九项角色的展示名按 payload 冻结语义采用 planner/proposer/challenger/generator/evaluator/judge/fixer/reporter/merger；实现阶段须以生产 Brain 接受的白名单拼写为准，不得增减为非九项。]
- [ASSUMPTION: task 未提供 journey_id 或 Step UUID，文档规划锚点使用 `none(docs)`。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-usage.md`：新增中文使用说明；除此之外不得变更文件。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 文档须明确派发失败后的 run、session、task 三类状态

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；仅保留与本 sprint 直接相关的全局铁律 -->
- [规划分支] Planner workspace 必须停留在服务端签发的 planner_branch，不得 checkout 或 switch（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth，无鉴权端点不准 ship（来源: area）
- [真环境验证] 依赖真实调用方的接缝断言必须在目标环境验证才算 done（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；task 未提供 journey_id -->
- （本 line 暂无历史）

## E2E 验收

```bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge-usage.md
test -f "$DOC"
grep -q 'attempt-run 桥接使用说明' "$DOC"
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer.*CECELIA_INTERNAL_TOKEN' "$DOC"
for role in planner proposer challenger generator evaluator judge fixer reporter merger; do grep -q "$role" "$DOC"; done
for field in sprint_dir base_repo branch base_sha; do grep -q "$field" "$DOC"; done
grep -q 'base_sha.*可省略\|base_sha.*省略' "$DOC"
grep -q 'run.*failed' "$DOC"
grep -q 'session.*closed' "$DOC"
grep -q 'task.*cancelled' "$DOC"
test "$(git diff --name-only 5599211397c88c3827d5ce4e9c6061b3802b4fc5...HEAD | wc -l | tr -d ' ')" -eq 1
test "$(git diff --name-only 5599211397c88c3827d5ce4e9c6061b3802b4fc5...HEAD)" = "$DOC"
echo 'attempt-run 桥接使用说明验收通过'
```

## journey_type: autonomous
## journey_type_reason: 本 sprint 仅新增后端 Harness API 的中文说明文档，无用户界面或远端 agent 协议改动。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在本机仓库工作区执行文档与 diff 检查。
## journey_id: none
## step_id: none(docs)
