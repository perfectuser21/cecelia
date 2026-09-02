---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**冻结实现基线**: `48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3`（所有 canonical diff oracle 必须使用此 SHA，不得替换为 workspace checkout SHA）
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明页位于 `docs/current/attempt-run-bridge-guide.md`，包含端点、鉴权、角色白名单、payload、失败回滚四节
  Test: node -e "const fs=require('fs');const s=fs.readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');['端点','鉴权','角色白名单','payload','失败回滚'].forEach(x=>{if(!s.includes(x))process.exit(1)})"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 端点用途逐项正确且反向描述被拒绝
  动作: 执行冻结测试读取端点章节
  预期观察: POST 创建派发、GET 按 id 查询均成立，交换或遗漏时测试失败
  等待预算: 0s
  留证: Vitest `端点用途逐项正向并拒绝反向描述` 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "端点用途逐项正向并拒绝反向描述"'

- [ ] [BEHAVIOR] [L1] B-02: 鉴权逐项正确且未授权描述被拒绝
  动作: 执行冻结测试读取鉴权章节
  预期观察: internalAuthOrLoopback、宿主与远端 Bearer 占位符成立；匿名、错 token 或真实凭据表述被拒绝
  等待预算: 0s
  留证: Vitest `鉴权逐项正向并拒绝匿名错误 token 与真实凭据` 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "鉴权逐项正向并拒绝匿名错误 token 与真实凭据"'

- [ ] [BEHAVIOR] [L1] B-03: 角色白名单逐项且恰好九项
  动作: 执行冻结测试解析角色列表
  预期观察: planner、proposer、critic、generator、generator-fix、evaluator、evaluator-fix、merger、reporter 各一次，无遗漏、重复或额外项
  等待预算: 0s
  留证: Vitest `角色白名单九项逐项正向并拒绝重复遗漏与额外项` 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "角色白名单九项逐项正向并拒绝重复遗漏与额外项"'

- [ ] [BEHAVIOR] [L1] B-04: payload 每个字段语义正确且反向必填描述被拒绝
  动作: 执行冻结测试读取 payload 章节
  预期观察: sprint_dir、base_repo、branch 逐项必填；base_sha 可省略并由生产 Brain 自解析；反向语义被拒绝
  等待预算: 0s
  留证: Vitest `payload 每个字段逐项正向并拒绝 base_sha 必填语义` 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "payload 每个字段逐项正向并拒绝 base_sha 必填语义"'

- [ ] [BEHAVIOR] [L1] B-05: 回滚三状态逐项正确且非终态残留被拒绝
  动作: 执行冻结测试读取失败回滚章节
  预期观察: run→failed、session→closed、task→cancelled 逐项成立；运行中或待执行残留描述被拒绝
  等待预算: 0s
  留证: Vitest `回滚三状态逐项正向并拒绝非终态残留` 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "回滚三状态逐项正向并拒绝非终态残留"'

- [ ] [BEHAVIOR] [L1] B-06: canonical diff 仅新增目标说明页
  动作: 对冻结实现基线与候选 HEAD 执行 canonical git diff
  预期观察: 路径集合严格等于目标文档；额外路径或目标缺失都失败
  等待预算: 0s
  留证: git diff 路径输出
  Test: manual:bash -c 'B=48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3; P=docs/current/attempt-run-bridge-guide.md; [ "$(git diff --name-only "$B"...HEAD | grep -v "^sprints/coding-harness-20260902104452-b4swl3/")" = "$P" ] && git diff --diff-filter=A --name-only "$B"...HEAD | grep -Fx "$P"'

## Invariant 映射

- [ ] [BEHAVIOR] [L1] INV-1: 两端点鉴权说明不可回退
  动作: 复跑鉴权正向与负向测试
  预期观察: 两端点共享保护方式，未授权访问不被描述为合法
  等待预算: 0s
  留证: 鉴权 Vitest 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "鉴权逐项正向并拒绝匿名错误 token 与真实凭据"'

- [ ] [BEHAVIOR] [L1] INV-2: 凭据不得硬编码
  动作: 复跑 Bearer 示例扫描
  预期观察: 只允许 `<CECELIA_INTERNAL_TOKEN>` 占位符，疑似真实值导致失败
  等待预算: 0s
  留证: 鉴权 Vitest 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "鉴权逐项正向并拒绝匿名错误 token 与真实凭据"'

- N/A：Planner 分支 invariant 属规划工作区签发规则，本 Sprint 不修改分支签发或 Planner 代码。
