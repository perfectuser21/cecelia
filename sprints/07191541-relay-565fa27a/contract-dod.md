# Contract DoD — smoke-verify-headless-dispatch 565fa27a

> Task ID：565fa27a-4b5b-4eb7-905e-b6fb61eb8413
> Sprint Dir：sprints/07191541-relay-565fa27a
> 生成日期：2026-07-19

---

## [BEHAVIOR] 条目

[BEHAVIOR] B-01: GET /api/brain/tasks/565fa27a 返回 payload.mode=headless | manual:bash curl -sf http://host.docker.internal:5221/api/brain/tasks/565fa27a-4b5b-4eb7-905e-b6fb61eb8413 | jq -e '.payload.mode=="headless"'

[BEHAVIOR] B-02: GET /api/brain/tasks/565fa27a 返回 payload.executor=claude | manual:bash curl -sf http://host.docker.internal:5221/api/brain/tasks/565fa27a-4b5b-4eb7-905e-b6fb61eb8413 | jq -e '.payload.executor=="claude"'

[BEHAVIOR] B-03: GET /api/brain/tasks/565fa27a 返回 payload.orchestrator=skill-relay | manual:bash curl -sf http://host.docker.internal:5221/api/brain/tasks/565fa27a-4b5b-4eb7-905e-b6fb61eb8413 | jq -e '.payload.orchestrator=="skill-relay"'

[BEHAVIOR] B-04: GET /api/brain/tasks/565fa27a 返回 status=in_progress（Brain 已认领该 headless 派发） | manual:bash curl -sf http://host.docker.internal:5221/api/brain/tasks/565fa27a-4b5b-4eb7-905e-b6fb61eb8413 | jq -e '.status=="in_progress"'

[BEHAVIOR] B-05: GET /api/brain/tasks/565fa27a 返回 dispatched_by_orchestrator=true（Brain 已确认 orchestrator 派发） | manual:bash curl -sf http://host.docker.internal:5221/api/brain/tasks/565fa27a-4b5b-4eb7-905e-b6fb61eb8413 | jq -e '.dispatched_by_orchestrator==true'

[BEHAVIOR] B-06: /api/brain/harness/phase-events 返回 initiative_id=565fa27a 的记录 ≥ 1（concern 级，不阻断） | manual:bash curl -sf "http://host.docker.internal:5221/api/brain/harness/phase-events?initiative_id=565fa27a-4b5b-4eb7-905e-b6fb61eb8413" | jq -e 'length >= 1'

---

## [ARTIFACT] 条目

[ARTIFACT] smoke 验收脚本 | sprints/07191541-relay-565fa27a/tests/contract-red.test.sh | bash 可执行，初始 Red 状态（断言当前 task 字段，在字段未写入前故意 fail）

[ARTIFACT] contract-draft.md | sprints/07191541-relay-565fa27a/contract-draft.md | 包含完整 Test Contract 表、E2E 验收 bash 脚本、未覆盖链路清单

[ARTIFACT] contract-dod.md（本文件） | sprints/07191541-relay-565fa27a/contract-dod.md | [BEHAVIOR]/[ARTIFACT]/[INVARIANT] 三类条目完整

---

## [INVARIANT] 对照（对应 PRD 7 条）

| PRD Invariant | 对应约束 | 本 sprint 处理方式 |
|---------------|---------|------------------|
| [单slot串行] 一个 slot/会话内严格串行 | 验收脚本顺序执行 B-01→B-05，无并行断言 | 脚本 set -euo pipefail，串行 curl，任一失败即中止 |
| [禁写死环境] 端口/路径/host 不得硬编码 | BRAIN_URL 由环境变量注入，默认值仅为 fallback | 脚本使用 `${BRAIN_URL:-http://host.docker.internal:5221}`，可覆盖 |
| [真验才done] 依赖 Brain API 的断言必须有真实证据 | B-01~B-05 全部 curl 真实 Brain API，无 mock | 不使用 mock；B-06 concern 不声明 done |
| [凭据安全] secrets 不硬编码、不进 git、不进日志 | 验收脚本不含任何 token/secret | 脚本仅用公开 Brain API 端点，无鉴权参数 |
| [日志脱敏] 报告不得输出 token/客户隐私/完整 prompt | contract-draft.md / contract-dod.md 不含敏感信息 | 所有输出仅包含 task_id 和状态字段，已脱敏 |
| [端点鉴权] 若触及 API 变更，所有端点必须有 auth | 本 sprint 不改 API，仅读现有端点 | 不在范围内；若后续 API 变更须补充鉴权 |
| [租户隔离] 查询必须 scope 到当前租户 | 本 smoke 不查询租户数据 | PRD 明确标注"本 smoke 不查询租户数据"，N/A |

---

## Red 初始状态说明

`contract-red.test.sh` 设计为初始 **Red** 状态：

- 若 Brain 中 `565fa27a` 的 payload 尚未包含 `dispatched_by_orchestrator=true` 字段，B-05 将 fail。
- 若 task status 尚未更新为 `in_progress`，B-04 将 fail。
- 这是有意设计：合同测试在功能未完成时必须红，完成后变绿，符合 TDD 精神。
- 初始 Red 不代表实现错误，代表合同等待被满足。

---

## 通过标准

- B-01 ~ B-05 全部 exit 0 = **合同通过（PASS）**
- B-06 可选，concern 不阻断主链路通过
- 任一 B-01~B-05 失败 = **合同未通过（FAIL）**，不可声明 headless smoke 完成
