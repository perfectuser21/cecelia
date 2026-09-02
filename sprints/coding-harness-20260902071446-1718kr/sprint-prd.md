# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: a0e238e17204e731116508f0c1dca99edeb5c7a72eee7e0a4533a338f3381f74

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的中文操作契约，降低宿主与远端调用误用风险

## 背景

为生产 Brain 的 Harness attempt-run 桥接提供单页中文使用说明，使调用方能正确创建并查询 attempt，且能理解鉴权、角色、payload 与派发失败回滚契约。

## Golden Path（核心场景）

宿主或远端调用方从阅读 `docs/current/` 下《attempt-run 桥接使用说明》进入 → 按说明鉴权并调用 `POST /api/brain/harness/attempt-run` 创建 attempt → 使用返回的 id 调用 `GET /api/brain/harness/attempt-run/:id` 查询状态 → 能据文档判断成功派发或失败回滚后的最终状态。

具体：
1. 文档分别说明 POST 创建/派发 attempt 与 GET 按 id 查询 attempt 状态的用途。
2. 文档说明两端点采用 `internalAuthOrLoopback`；宿主/远端请求必须发送 `Authorization: Bearer $CECELIA_INTERNAL_TOKEN`，示例不得暴露真实 token。
3. 文档逐项列出九项角色白名单：`planner`、`proposer`、`critic`、`judge`、`generator`、`generator-fix`、`evaluator`、`evaluator-fix`、`reporter`。
4. 文档说明 POST payload 必填 `sprint_dir`、`base_repo`、`branch`；`base_sha` 可省略并由生产 Brain 自解析。
5. 文档说明派发失败时自动回滚为 `run → failed`、`session → closed`、`task → cancelled`。
6. 读者可仅凭该页构造创建请求、查询请求，并核对失败回滚状态。

## 边界情况

- loopback 与宿主/远端鉴权边界必须明确，不得让读者误以为远端可无 Bearer token 调用。
- 不得把 `base_sha` 写成必填项，也不得承诺由调用方 checkout 推断。
- 派发失败必须同时写清 run、session、task 三种资源的终态，不能只描述部分回滚。
- 角色名必须逐项列出且总数恰为九，禁止用“等角色”省略。

## 范围限定

**在范围内**：仅新增 `docs/current/` 下的一页中文 attempt-run 桥接使用说明，覆盖端点用途、鉴权、九项角色白名单、payload 字段和失败回滚四节。

**不在范围内**：任何程序代码、路由、鉴权逻辑、数据库结构、部署配置或既有文档的行为修改；不发起真实 attempt-run。

## 假设

- [ASSUMPTION: 九项角色白名单以冻结任务证据对应的 attempt-run 生产契约为准；文档评审必须逐项与该权威契约对账。]
- [ASSUMPTION: 新文档文件名采用 `docs/current/attempt-run-bridge-guide.md`，标题固定为《attempt-run 桥接使用说明》。]

## 预期受影响文件

- `docs/current/attempt-run-bridge-guide.md`：新增中文使用说明；这是唯一允许变更的交付文件。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 文档必须明确查询状态与三资源失败终态；不得记录或示例化真实 token。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；仅保留与本 docs-only sprint 有直接约束关系的有效条目 -->
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [环境假设] 环境假设值禁止写死，必须从环境推导或在真实环境校准（来源: area）
- [真环境验证] 依赖生产环境或真实调用方的接缝断言必须真验才算 done（来源: area）
- [Brain URL] Dispatcher 与 Fleet Worker 使用服务端权威 HARNESS_BRAIN_URL，禁止为单个 Attempt 绕过（来源: area）
- [Planner 分支] Planner 必须停留在服务端签发分支，禁止自行 checkout 或 switch（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
set -euo pipefail
DOC=docs/current/attempt-run-bridge-guide.md
test -f "$DOC"
grep -q 'attempt-run 桥接使用说明' "$DOC"
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer.*CECELIA_INTERNAL_TOKEN' "$DOC"
for role in planner proposer critic judge generator generator-fix evaluator evaluator-fix reporter; do grep -q "$role" "$DOC"; done
for field in sprint_dir base_repo branch base_sha; do grep -q "$field" "$DOC"; done
grep -qE 'base_sha.*(可省略|非必填).*生产 Brain.*自解析' "$DOC"
grep -qE 'run.*failed' "$DOC"
grep -qE 'session.*closed' "$DOC"
grep -qE 'task.*cancelled' "$DOC"
git diff --name-only 041438e33a737b9b3c8cb941b6603a4f1899aff3...HEAD | grep -qv '^docs/current/' && exit 1 || true
test "$(git diff --name-only 041438e33a737b9b3c8cb941b6603a4f1899aff3...HEAD | wc -l | tr -d ' ')" -eq 1
```

## DoD

1. `docs/current/attempt-run-bridge-guide.md` 存在，标题与正文均为中文。
2. POST 与 GET 两端点的用途各自明确。
3. 鉴权节准确区分 loopback 与宿主/远端 Bearer token 要求，且无真实凭据。
4. 九项角色白名单逐项出现且与权威契约一致。
5. payload 节准确区分三个必填字段和可省略的 `base_sha`。
6. 回滚节完整给出 run/session/task 三个失败终态。
7. 基于实现基线 `041438e33a737b9b3c8cb941b6603a4f1899aff3` 的 diff 仅含这一份文档，不改代码。
8. 上述 E2E 验收脚本退出码为 0。

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 内部 Harness API 的 docs-only 使用说明，不涉及用户界面或远端 agent 协议实现。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；文档验收在该角色工作区以本地 shell 完成，不调用生产端点。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
