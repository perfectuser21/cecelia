# Sprint PRD — attempt-run 桥接使用说明

task_request_hash: 83916a00537fa91361e9226d897605f62da559f9c65f04cdac3badec865baf81

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 attempt-run 桥接的可操作说明，降低接入与故障处置歧义

## 背景

为宿主与远端调用方提供一页中文的《attempt-run 桥接使用说明》，明确调用入口、身份校验、角色边界、请求载荷和派发失败后的状态回滚。本文档只描述现有接口的使用合同，不改变接口或运行时行为。

## Golden Path（核心场景）

宿主或远端调用方从阅读 `docs/current/` 下的 attempt-run 桥接使用说明进入 → 按鉴权与九项角色白名单准备请求 → 使用 `POST /api/brain/harness/attempt-run` 创建 attempt-run → 使用 `GET /api/brain/harness/attempt-run/:id` 查询结果 → 能识别成功状态或派发失败后的完整回滚状态。

具体：
1. 文档分别说明 `POST /api/brain/harness/attempt-run` 与 `GET /api/brain/harness/attempt-run/:id` 的用途。
2. 文档说明接口使用 `internalAuthOrLoopback`；宿主或远端请求必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
3. 文档以九个独立条目完整列出 attempt-run 支持的角色白名单。
4. 文档明确 payload 必填 `sprint_dir`、`base_repo`、`branch`，并说明 `base_sha` 可省略且由生产 Brain 自解析。
5. 文档明确派发失败时系统自动完成 `run→failed`、`session→closed`、`task→cancelled`，读者可据此判断回滚完成。

## 边界情况

- 区分 loopback 与宿主/远端调用，避免把 loopback 条件误写成远端免鉴权。
- 不把 `base_sha` 误列为调用方必填字段。
- 不把九项白名单写成开放角色集合或仅给示例。
- 回滚说明必须同时覆盖 run、session、task 三个对象及其最终状态。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文说明文档，覆盖两个端点、鉴权、九项角色白名单、payload 字段和派发失败自动回滚。

**不在范围内**：不修改任何代码、测试、接口行为、鉴权策略、角色白名单或数据库状态；不新增其他文档。

## 假设

- [ASSUMPTION: 九项角色的准确名称以当前生产 Brain 的 attempt-run 合同为准；成品文档必须逐项列出，不得自行增删或改名。]
- [ASSUMPTION: 新文档文件名采用能清晰表达 attempt-run 桥接主题的中文或英文名称，且唯一落在 `docs/current/`。]
- Unified Map 未配置：task payload 缺少可用的 `map_scope/map_repo` 显式映射，本 PRD 仅按 thin_prd 锚定范围。

## 预期受影响文件

- `docs/current/<attempt-run-bridge-guide>.md`：新增《attempt-run 桥接使用说明》的唯一交付文件。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 文档内容与生产 Brain 当前 attempt-run 合同一致
- 可观测: 文档必须让读者通过 GET 查询结果识别派发失败后的三对象终态

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；以下为与本说明范围直接相关的 area 级铁律 -->
- [语义判定] 通知或写库接口的成功判定必须检查语义字段，不能只凭 `ok:true` 判定成功（来源: area）
- [环境来源] target_environment 必须从 DB tasks.payload 读取，不从本地文件读取（来源: area）
- [真实历史] 复用历史合同验收断言前必须核对本次任务的真实派发与执行历史（来源: area）
- [共享禁区] 未经合同显式授权，不得修改共享 CI 基础设施文件（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
set -euo pipefail
DOC=$(find docs/current -maxdepth 1 -type f -name '*.md' -newer "sprints/coding-harness-20260902140724-6b5mog/sprint-prd.md" -print)
[ "$(printf '%s\n' "$DOC" | sed '/^$/d' | wc -l)" -eq 1 ]
grep -q 'POST /api/brain/harness/attempt-run' "$DOC"
grep -q 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -q 'internalAuthOrLoopback' "$DOC"
grep -q 'Bearer CECELIA_INTERNAL_TOKEN' "$DOC"
grep -q 'sprint_dir' "$DOC" && grep -q 'base_repo' "$DOC" && grep -q 'branch' "$DOC"
grep -q 'base_sha' "$DOC" && grep -Eq '可省略|非必填' "$DOC" && grep -q '生产 Brain' "$DOC"
grep -q 'run.*failed' "$DOC" && grep -q 'session.*closed' "$DOC" && grep -q 'task.*cancelled' "$DOC"
[ "$(git diff --name-only 084ebbbc7a4213b4c2d5eb3cf01bd814b54215bf...HEAD | grep -vc '^docs/current/')" -eq 0 ]
# 角色白名单章节须由 proposer 补充基于九个权威角色名的逐项精确断言，并机械确认恰好九项。
```

验收结果必须证明：新增文档位于 `docs/current/`、正文为中文、四节内容齐全、角色白名单恰好九项，且相对实现基线 `084ebbbc7a4213b4c2d5eb3cf01bd814b54215bf` 没有任何代码变更。

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 仓库内部 Harness API 的使用说明，不涉及用户界面或远端 Agent 协议变更。
## target_environment: mac_web
## target_environment_reason: task payload 显式指定 mac_web；验收在仓库检出环境中执行文档与 git diff 检查。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
