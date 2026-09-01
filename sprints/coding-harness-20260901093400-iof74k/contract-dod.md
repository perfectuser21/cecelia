---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 目标文档存在且为中文四节结构
  Test: node -e "const c=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const h of ['## 端点用途与鉴权','## 角色白名单','## POST payload 字段','## 派发失败自动回滚'])if(!c.includes(h))process.exit(1)"

- [ ] [ARTIFACT] 权威实现基线后的实现差异仅有目标文档（排除本 Sprint 冻结合同产物）
  Test: bash -c 'mapfile -t f < <(git diff --name-only 5599211397c88c3827d5ce4e9c6061b3802b4fc5...HEAD | grep -v "^sprints/coding-harness-20260901093400-iof74k/"); [ "${#f[@]}" -eq 1 ] && [ "${f[0]}" = docs/current/attempt-run-bridge-guide.md ]'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者可核对两个端点用途
  动作: 打开《attempt-run 桥接使用说明》的端点用途与鉴权节。
  预期观察: POST 被说明为创建并派发 attempt，GET 被说明为按 id 查询 attempt 状态。
  等待预算: 0s
  留证: Vitest 输出中的“两个端点用途”用例结果。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t "两个端点用途"'

- [ ] [BEHAVIOR] [L1] B-02: 读者可选择正确鉴权并获得恰好九项角色
  动作: 阅读鉴权说明和角色白名单节。
  预期观察: 文档要求宿主/远端携带 Bearer 环境变量且不泄露 token，角色列表与 PRD 九项逐字相等。
  等待预算: 0s
  留证: Vitest 输出中的“鉴权与九项角色白名单”用例结果。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t "鉴权与九项角色白名单"'

- [ ] [BEHAVIOR] [L1] B-03: 读者可构造符合约束的 payload
  动作: 阅读 POST payload 字段节。
  预期观察: 文档将 sprint_dir、base_repo、branch 标为必填，并说明 base_sha 可省略且由生产 Brain 自解析。
  等待预算: 0s
  留证: Vitest 输出中的“payload 必填字段与 base_sha 省略语义”用例结果。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t "payload 必填字段与 base_sha 省略语义"'

- [ ] [BEHAVIOR] [L1] B-04: 读者可确认派发失败已完整收口
  动作: 阅读派发失败自动回滚节。
  预期观察: 文档同时给出 run→failed、session→closed、task→cancelled，未把失败描述成运行中。
  等待预算: 0s
  留证: Vitest 输出中的“派发失败自动回滚三类终态”用例结果。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t "派发失败自动回滚三类终态"'

## Invariant 映射

- [ ] [BEHAVIOR] [L1] INV-1: 凭据安全不回退
  动作: 检查文档的 Bearer 示例与全部疑似 token 文本。
  预期观察: 示例只引用 `CECELIA_INTERNAL_TOKEN` 环境变量，不包含真实凭据。
  等待预算: 0s
  留证: 凭据安全断言的命令退出码。
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"docs/current/attempt-run-bridge-guide.md\",\"utf8\");if(!c.includes(\"Bearer \\$CECELIA_INTERNAL_TOKEN\")||/Bearer [A-Za-z0-9_-]{24,}/.test(c))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] INV-2: 端点鉴权不回退
  动作: 核对两个端点所在章节的鉴权声明。
  预期观察: 文档明确两个端点均使用 `internalAuthOrLoopback`，且远端请求必须带 Bearer token。
  等待预算: 0s
  留证: “鉴权与九项角色白名单”Vitest 输出。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t "鉴权与九项角色白名单"'

- [ ] [BEHAVIOR] [L1] INV-3: 环境假设不写死
  动作: 核对 base_sha 缺省处理说明。
  预期观察: 文档说明 base_sha 可省略并由生产 Brain 自解析，不要求固定环境 SHA。
  等待预算: 0s
  留证: “payload 必填字段与 base_sha 省略语义”Vitest 输出。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901093400-iof74k/tests/attempt-run-bridge-guide.test.ts -t "payload 必填字段与 base_sha 省略语义"'

- N/A：真环境验证——本 Sprint 是静态文档，不修改真实调用链。
- N/A：Planner 分支——本 Sprint 不修改 Planner 分支行为。
