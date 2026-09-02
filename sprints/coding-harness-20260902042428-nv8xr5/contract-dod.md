---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-usage.md`，不修改代码、配置或既有文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增中文说明且实现 diff 仅含目标文档
  Test: bash -c 'DOC=docs/current/attempt-run-bridge-usage.md; test -f "$DOC"; mapfile -t f < <(git diff --name-only f9634a9c99096d934044cf1f6ab968627cf4e82c...HEAD | grep -v "^sprints/coding-harness-20260902042428-nv8xr5/"); [ "${#f[@]}" -eq 1 ] && [ "${f[0]}" = "$DOC" ]'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者能找到两个端点用途与鉴权要求
  动作: 打开 `docs/current/attempt-run-bridge-usage.md` 并阅读端点与鉴权两节
  预期观察: `## 端点用途与鉴权` 独立章节分别说明 POST 创建/派发、GET 按 id 查询，并区分 loopback 与宿主/远端 Bearer 鉴权
  等待预算: 0s
  留证: Vitest 输出中的 `包含两个端点用途与鉴权要求` 用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902042428-nv8xr5/tests/attempt-run-bridge-usage.test.ts -t "包含两个端点用途与鉴权要求"'

- [ ] [BEHAVIOR] [L1] B-02: 读者能核对冻结的九项角色白名单
  动作: 阅读角色白名单章节并逐项核对角色
  预期观察: `## 角色白名单` 独立章节按 planner、proposer、challenger、generator、evaluator、judge、fixer、reporter、merger 的固定顺序逐行列出且仅列出这九项，并明确白名单外角色不被接受
  等待预算: 0s
  留证: Vitest 输出中的 `包含且仅声明冻结的九项角色白名单` 用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902042428-nv8xr5/tests/attempt-run-bridge-usage.test.ts -t "包含且仅声明冻结的九项角色白名单"'

- [ ] [BEHAVIOR] [L1] B-03: 读者能构造 payload 且不会误填 base_sha
  动作: 阅读 payload 章节并区分必填字段与可省略字段
  预期观察: `## payload 字段` 独立章节将 `sprint_dir`、`base_repo`、`branch` 标为必填，`base_sha` 标为可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 输出中的 `包含 payload 必填字段与 base_sha 省略语义` 用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902042428-nv8xr5/tests/attempt-run-bridge-usage.test.ts -t "包含 payload 必填字段与 base_sha 省略语义"'

- [ ] [BEHAVIOR] [L1] B-04: 读者能识别派发失败的完整回滚结果
  动作: 阅读派发失败自动回滚章节
  预期观察: `## 派发失败自动回滚` 独立章节完整列出 `run→failed`、`session→closed`、`task→cancelled`
  等待预算: 0s
  留证: Vitest 输出中的 `包含派发失败的三类回滚终态` 用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902042428-nv8xr5/tests/attempt-run-bridge-usage.test.ts -t "包含派发失败的三类回滚终态"'

## Invariant 覆盖

- [ ] [ARTIFACT] INV-1 规划分支：合同提交保持在 Harness 签发的 proposer 分支。
  Test: bash -c 'test "$(git branch --show-current)" = "cp-harness-propose-r3-2a748f96-r344f0e3d-a3"'
- [ ] [ARTIFACT] INV-2 凭据安全：文档不包含疑似硬编码 Bearer token。
  Test: node -e "const f=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8');if(/Bearer\\s+[A-Za-z0-9_-]{32,}/.test(f))process.exit(1)"
- [ ] [ARTIFACT] INV-3 端点鉴权：两个端点说明 `internalAuthOrLoopback`。
  Test: node -e "const f=require('fs').readFileSync('docs/current/attempt-run-bridge-usage.md','utf8');if((f.match(/internalAuthOrLoopback/g)||[]).length<1)process.exit(1)"
- [ ] [ARTIFACT] INV-4 真环境验证：N/A，PRD 明确排除实际端点调用，本 sprint 只交付文档。
