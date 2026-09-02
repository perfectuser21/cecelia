---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明页新增且包含四个二级章节
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');const h=[...s.matchAll(/^## (.+)$/gm)].map(x=>x[1]);if(h.length!==4||!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 端点与鉴权正负 oracle
  动作: 读取第一节并核对两个端点、保护中间件与远端 Authorization 示例。
  预期观察: POST/GET 用途明确，远端必须携带 Bearer 占位符，匿名或错误 token 未被描述为可访问。
  等待预算: 0s
  留证: Vitest 输出中的“端点与鉴权正负 oracle”结果。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "端点与鉴权正负 oracle"'

- [ ] [BEHAVIOR] [L1] B-02: 角色白名单封闭集合正负 oracle
  动作: 读取第二节的角色清单并与生产 ALLOWED_ROLES 比较。
  预期观察: 白名单恰有 canary、planner、proposer、reviewer、generator、generator-fix、evaluator、evaluator-evidence-repair、judge 九项，无旧角色或额外角色。
  等待预算: 0s
  留证: Vitest 输出中的集合差异。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "角色白名单封闭集合正负 oracle"'

- [ ] [BEHAVIOR] [L1] B-03: payload 必填闭集与 base_sha 负向 oracle
  动作: 读取第三节的必填清单与 base_sha 说明。
  预期观察: 必填集合恰为 sprint_dir、base_repo、branch；base_sha 可省略并由生产 Brain 自解析。
  等待预算: 0s
  留证: Vitest 输出中的 payload 集合差异。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "payload 必填闭集与 base_sha 负向 oracle"'

- [ ] [BEHAVIOR] [L1] B-04: 失败回滚封闭集合正负 oracle
  动作: 读取第四节的派发失败回滚清单。
  预期观察: 仅含 run→failed、session→closed、task→cancelled，且否定残留 active session 或 queued task。
  等待预算: 0s
  留证: Vitest 输出中的回滚集合差异。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "失败回滚封闭集合正负 oracle"'

- [ ] [BEHAVIOR] [L1] B-05: 交付范围 canonical diff 正负 oracle
  动作: 从冻结实现基线对 HEAD 执行 canonical 三点 git diff，并排除本 sprint 冻结合同产物。
  预期观察: 实现差异恰好新增目标文档；任一额外文档、修改既有文件或代码文件都会失败。
  等待预算: 0s
  留证: Vitest 输出中的实际越界路径列表。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "交付范围 canonical diff 正负 oracle"'

## Invariant 覆盖

- [端点鉴权] B-01 锁定两个端点均由 `internalAuthOrLoopback` 保护，并含未授权负向 oracle。
- [凭据安全] B-01 拒绝疑似真实 Bearer 值，仅允许 `<CECELIA_INTERNAL_TOKEN>` 占位符。
- [Planner 分支] N/A：本 sprint 只新增文档，不触及 Planner workspace 或分支签发逻辑。
