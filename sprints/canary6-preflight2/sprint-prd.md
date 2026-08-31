# Sprint PRD — attempt-run 桥接使用说明

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：补齐 V4 画布 Worker 的 attempt-run 桥接操作契约

## 背景

V4 画布 Worker 需要一页可直接依循的中文说明，以正确调用 attempt-run 桥接、携带鉴权信息和必填 payload，并理解派发失败后的状态回滚结果。

## Golden Path（核心场景）

Worker 开发者从 `docs/current/` 的《attempt-run 桥接使用说明》进入 → 按说明发起 attempt-run 并查询状态 → 能判断派发成功或自动回滚后的最终状态。

具体：
1. 读者识别 `POST /api/brain/harness/attempt-run` 的发起用途，以及 `GET /api/brain/harness/attempt-run/:id` 的查询用途。
2. 读者确认环回请求与宿主/远端请求的鉴权差异；宿主或远端请求携带 `Bearer CECELIA_INTERNAL_TOKEN`，鉴权机制标明为 `internalAuthOrLoopback`。
3. 读者从文档获得完整且恰好九项的角色白名单，并按白名单选择角色。
4. 读者构造包含 `sprint_dir`、`base_repo`、`branch` 的 payload；知晓 `base_sha` 可省略并由生产 Brain 自解析。
5. 若派发失败，读者能确认回滚终态为 run → `failed`、session → `closed`、task → `cancelled`。

## 边界情况

- 不把环回免 Bearer 误写成宿主或远端免鉴权。
- 不把可省略的 `base_sha` 写成必填，也不遗漏三个必填字段。
- 不省略、合并或扩充九项角色白名单。
- 派发失败的三个对象及其终态必须一一对应，不以笼统的“失败”替代。

## 范围限定

**在范围内**：仅在 `docs/current/` 新增一页中文使用说明，覆盖端点用途与鉴权、九项角色白名单、payload 必填字段与 `base_sha` 省略规则、派发失败自动回滚四节。

**不在范围内**：任何代码、接口、鉴权、数据库、配置或既有文档修改；桥接功能行为变更；新增端点。

## 假设

- [ASSUMPTION: 文档中的九项角色名称必须逐项采用当前 attempt-run 接口的权威白名单，不创造别名。]
- [ASSUMPTION: 最终文件名可由实现者在 `docs/current/` 下选择清晰且唯一的名称。]

## 预期受影响文件

- `docs/current/<attempt-run-桥接说明文件>.md`：新增唯一的中文 attempt-run 桥接使用说明。

## DoD

- `docs/current/` 下存在且仅新增一页目标中文说明文档，git diff 不含代码变更。
- 文档分别出现 POST 与 GET 两个端点原文，并说明发起、查询用途。
- 鉴权节同时包含 `internalAuthOrLoopback`、`Bearer CECELIA_INTERNAL_TOKEN` 及宿主/远端必须携带 Bearer 的规则。
- 角色白名单节列出恰好九项权威角色，无别名和额外角色。
- payload 节将 `sprint_dir`、`base_repo`、`branch` 标为必填，并说明 `base_sha` 可省略、由生产 Brain 自解析。
- 回滚节逐项写明 run → `failed`、session → `closed`、task → `cancelled`。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 语言：简体中文。
- 准确性：接口名、鉴权名、环境变量名、字段名和状态值保持字面一致。
- 可维护性：四类信息分节呈现，便于检索。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- （未读取到本任务的历史 invariant）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

- （本 line 暂无历史）

## E2E 验收

```bash
set -euo pipefail
DOC=$(git diff --name-only --diff-filter=A d7b83cdf24231d1b3fdaaa23465c8f3f84a22675...HEAD -- 'docs/current/*.md')
test "$(printf '%s\n' "$DOC" | sed '/^$/d' | wc -l)" -eq 1
test -f "$DOC"
git diff --name-only d7b83cdf24231d1b3fdaaa23465c8f3f84a22675...HEAD | awk '$0 !~ /^docs\/current\/[^/]+\.md$/ {bad=1} END {exit bad}'
grep -Fq 'POST /api/brain/harness/attempt-run' "$DOC"
grep -Fq 'GET /api/brain/harness/attempt-run/:id' "$DOC"
grep -Fq 'internalAuthOrLoopback' "$DOC"
grep -Fq 'Bearer CECELIA_INTERNAL_TOKEN' "$DOC"
for token in sprint_dir base_repo branch base_sha failed closed cancelled; do grep -Fq "$token" "$DOC"; done
grep -Eq '九项|9 项|9项' "$DOC"
```

## journey_type: autonomous
## journey_type_reason: 交付物是 Cecelia 仓库内部 API 桥接说明文档，不涉及用户界面或远端 agent 执行。
## target_environment: local_api
## target_environment_reason: 仅需在本地仓库对文档路径、内容和 diff 范围执行机械验收。
## journey_id: none
## step_id: none（PrepPRD 未锚定）
