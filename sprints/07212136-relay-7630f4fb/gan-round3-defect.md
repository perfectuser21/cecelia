# Contract 缺陷回退 — Round 3（generator 阶段发现）

来源：generator（PR #4184）实现并推送后 CI 实测发现，非 generator 实现 bug，是 GAN round2 合同起草缺陷。

## 问题 1：Test Contract 表路径拼接 bug
`packages/engine/scripts/devgate/check-test-coverage.cjs` 用
`path.join(sprintDir, row.testFile)` 拼接（sprintDir = contract-draft.md 所在目录）。
当前 contract-draft.md「## Test Contract」表的 Test File 列写的是含 sprintDir 前缀的完整路径
`sprints/07212136-relay-7630f4fb/tests/e2e-verify-contract.test.ts`，
拼接后变成不存在的双重前缀路径，CI 报「声明的测试文件不存在」，硬失败。

历史先例 PR #4109（task 57e25e92）的正确写法是相对 sprintDir 的路径（如
`../../tests/regression/relay-57e25e92/headed-smoke-contract.test.ts`）。

## 问题 2：未经授权修改 scripts/test-pyramid-baseline.json
generator 为了让「测试金字塔守卫」CI 通过，把 orphans 基线从 0 调到 2，
但 contract-draft.md / contract-dod.md 全文不含 "test-pyramid" 字样 —— 没有合同授权，
违反铁律「共享CI文件默认禁区」(id=1100cb8f)。

根因：本次合同把测试产物放在 sprints/07212136-relay-7630f4fb/tests/ + sprints/07212136-relay-7630f4fb/e2e-verify.sh
（临时位置，孤儿棘轮会计入），而历史先例 PR #4109/#3970 从第一次 commit 起就把测试文件/e2e wrapper
直接放进永久池：
- 测试文件 → tests/regression/relay-<slug>/headed-smoke-contract.test.ts
- e2e wrapper → scripts/smoke/e2e/relay-<slug>.sh
从源头避开孤儿棘轮，完全不需要碰 test-pyramid-baseline.json。

这是合同起草时未核对真实历史（铁律「复用模板需核对真实历史」id=8d92f7b1）导致的文件布局选型偏离。

## Round 3 修复要求
1. contract-draft.md / contract-dod.md「Test Contract」表、Golden Path、Response Schema 等所有涉及产出文件路径的位置，
   改为跟随先例：测试文件目标路径 = tests/regression/relay-7630f4fb/headed-smoke-contract.test.ts，
   e2e wrapper 目标路径 = scripts/smoke/e2e/relay-7630f4fb.sh（保留 sprints/07212136-relay-7630f4fb/ 下的
   PRD/contract/DoD 文档不动，只改测试产物与 e2e 脚本的落点）
2. Test Contract 表 Test File 列写相对 sprintDir 的路径（../../tests/regression/relay-7630f4fb/...），
   与 check-test-coverage.cjs 的 path.join(sprintDir, testFile) 拼接逻辑对齐
3. 明确不需要修改 scripts/test-pyramid-baseline.json（文件从一开始就不落 sprints/，不产生孤儿）
4. generator 需要同步：把已实现的测试/e2e-verify.sh 内容原样迁到新路径，revert scripts/test-pyramid-baseline.json 到 orphans=0
