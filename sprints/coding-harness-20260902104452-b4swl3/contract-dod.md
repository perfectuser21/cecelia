---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明页位于 `docs/current/attempt-run-bridge-guide.md`，包含端点、鉴权、角色白名单、payload、失败回滚四节
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');['端点','鉴权','角色白名单','payload','失败回滚'].forEach(x=>{if(!s.includes(x))process.exit(1)})"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者能区分创建与查询端点
  动作: 执行冻结测试读取说明页的端点章节
  预期观察: POST 创建派发、GET 按 id 查询的正向描述同时成立，交换或遗漏的负向情形被拒绝
  等待预算: 0s
  留证: Vitest `端点用途的正向与负向 oracle` 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "端点用途的正向与负向 oracle"'

- [ ] [BEHAVIOR] [L1] B-02: 读者不会把未授权访问理解为合法
  动作: 执行冻结测试读取说明页的鉴权章节
  预期观察: internalAuthOrLoopback 与 Bearer 占位符存在，匿名、错 token 可访问或真实 token 的反向情形被拒绝
  等待预算: 0s
  留证: Vitest `鉴权的正向与负向 oracle` 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "鉴权的正向与负向 oracle"'

- [ ] [BEHAVIOR] [L1] B-03: 角色白名单逐项且恰好九项
  动作: 执行冻结测试解析 `## 角色白名单` 下的列表
  预期观察: planner、proposer、critic、generator、generator-fix、evaluator、evaluator-fix、merger、reporter 各一次且无额外角色
  等待预算: 0s
  留证: Vitest `角色白名单恰好九项` 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "角色白名单恰好九项"'

- [ ] [BEHAVIOR] [L1] B-04: payload 必填性与 base_sha 省略语义准确
  动作: 执行冻结测试读取 payload 章节
  预期观察: sprint_dir、base_repo、branch 均为必填，base_sha 可省略且由生产 Brain 自解析；反向描述被拒绝
  等待预算: 0s
  留证: Vitest `payload 与 base_sha 的正向与负向 oracle` 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "payload 与 base_sha 的正向与负向 oracle"'

- [ ] [BEHAVIOR] [L1] B-05: 派发失败三项回滚终态准确
  动作: 执行冻结测试读取失败回滚章节
  预期观察: run→failed、session→closed、task→cancelled 逐项成立，运行中或待执行残留的反向描述被拒绝
  等待预算: 0s
  留证: Vitest `回滚状态的正向与负向 oracle` 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "回滚状态的正向与负向 oracle"'

- [ ] [BEHAVIOR] [L1] B-06: 候选变更仅新增目标说明页
  动作: 对冻结实现基线与候选 HEAD 执行 canonical git diff
  预期观察: 路径集合严格等于 docs/current/attempt-run-bridge-guide.md，且该路径为新增
  等待预算: 0s
  留证: git diff 路径输出
  Test: manual:bash -c 'B=48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3; P=docs/current/attempt-run-bridge-guide.md; [ "$(git diff --name-only "$B"...HEAD | grep -v "^sprints/coding-harness-20260902104452-b4swl3/")" = "$P" ] && git diff --diff-filter=A --name-only "$B"...HEAD | grep -Fx "$P"'

## Invariant 映射

- [ ] [BEHAVIOR] [L1] INV-1: 两个端点的鉴权说明不可回退
  动作: 复跑 B-02 的鉴权正向与负向测试
  预期观察: 两个端点共享保护方式，宿主与远端均须 Bearer，匿名或错 token 不被放行
  等待预算: 0s
  留证: Vitest `鉴权的正向与负向 oracle` 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "鉴权的正向与负向 oracle"'

- [ ] [BEHAVIOR] [L1] INV-2: 凭据不得硬编码进说明
  动作: 复跑冻结测试扫描 Bearer 示例
  预期观察: 只允许 `<CECELIA_INTERNAL_TOKEN>` 占位符，疑似真实 Bearer 值导致失败
  等待预算: 0s
  留证: Vitest `鉴权的正向与负向 oracle` 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "鉴权的正向与负向 oracle"'
- N/A：Planner 分支 invariant 属规划工作区签发规则，本 Sprint 不修改分支签发或 Planner 代码。
