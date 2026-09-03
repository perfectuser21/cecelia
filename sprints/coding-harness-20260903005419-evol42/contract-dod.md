---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

task_request_hash: 1838c4d9069d5b08f980716d3d248df5f1cd7a8d03b585d3c89b8195798071dc

## ARTIFACT 条目

- [ ] [ARTIFACT] 唯一产品产物为 `docs/current/attempt-run-桥接使用说明.md`，标题与正文为中文。
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-桥接使用说明.md';const s=fs.readFileSync(p,'utf8');if(!s.includes('# attempt-run 桥接使用说明')||!/[一-鿿]/.test(s))process.exit(1)"

- [ ] [ARTIFACT] 冻结测试与合同均携带任务请求哈希。
  Test: node -e "const fs=require('fs');const h='1838c4d9069d5b08f980716d3d248df5f1cd7a8d03b585d3c89b8195798071dc';for(const p of ['sprints/coding-harness-20260903005419-evol42/contract-draft.md','sprints/coding-harness-20260903005419-evol42/contract-dod.md','sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts'])if(!fs.readFileSync(p,'utf8').includes(h))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 文档完整描述 attempt-run 桥接合同
  动作: 读者打开目标文档并核对两个端点、用途与鉴权示例。
  预期观察: 两端点用途明确，宿主/远端示例带 Bearer 环境变量占位且不泄露真实 token。
  等待预算: 0s
  留证: Vitest 输出中的测试名与断言结果。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t "文档完整描述 attempt-run 桥接合同"'

- [ ] [BEHAVIOR] [L1] B-02: 角色白名单是恰好九项的封闭集合
  动作: 读者查看“角色白名单”章节并选择角色。
  预期观察: 清单与生产九项集合完全相等，白名单外角色明确被拒绝。
  等待预算: 0s
  留证: Vitest 集合相等断言输出。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t "角色白名单是恰好九项的封闭集合"'

- [ ] [BEHAVIOR] [L1] B-03: payload 必填集合与 base_sha 可选语义准确
  动作: 读者按 payload 章节构造 POST JSON。
  预期观察: 必填集合恰为 sprint_dir、base_repo、branch；base_sha 可省略并由生产 Brain 自解析。
  等待预算: 0s
  留证: Vitest 正向与负向 oracle 输出。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t "payload 必填集合与 base_sha 可选语义准确"'

- [ ] [BEHAVIOR] [L1] B-04: 派发失败回滚是封闭三项映射
  动作: 读者查看派发失败章节并解释 GET 所见失败终态。
  预期观察: 仅且完整列出 run → failed、session → closed、task → cancelled。
  等待预算: 0s
  留证: Vitest 封闭集合断言输出。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903005419-evol42/tests/attempt-run-doc-contract.test.ts -t "派发失败回滚是封闭三项映射"'

- [ ] [BEHAVIOR] [L1] B-05: 变更范围仅允许目标文档和本 sprint 合同产物
  动作: evaluator 以冻结 implementation baseline 比较候选 HEAD 的文件清单。
  预期观察: 产品改动仅新增目标文档，不含任何代码文件。
  等待预算: 0s
  留证: git diff --name-only 输出。
  Test: manual:bash -c 'BASE_SHA="6230da4a13fad9e43d6316b70914b5b69033ef37"; CHANGED=$(git diff --name-only "$BASE_SHA"...HEAD); printf "%s\n" "$CHANGED" | grep -qx "docs/current/attempt-run-桥接使用说明.md"; ! printf "%s\n" "$CHANGED" | grep -Ev "^(docs/current/attempt-run-桥接使用说明\.md|sprints/coding-harness-20260903005419-evol42/(contract-draft\.md|contract-dod\.md|task-plan\.json|tests/attempt-run-doc-contract\.test\.ts))$" | grep -q .'

## Invariant 映射

- [ ] [INVARIANT] INV-1 端点鉴权：文档明确两个端点均为 `internalAuthOrLoopback`；由 B-01 验证。
- [ ] [INVARIANT] INV-2 凭据安全：示例仅引用 `CECELIA_INTERNAL_TOKEN`，并由冻结测试拒绝疑似明文 token。
- [ ] [INVARIANT] INV-3 环境假设：token 从环境读取，不写死值；由 B-01 验证。
- N/A：真环境验证——PRD 明确排除真实派发副作用，本次只验文档准确性。
- N/A：Planner 分支——本任务不修改或执行 Planner 分支逻辑。
- N/A：单槽串行——本任务不修改或执行 slot 调度逻辑。
