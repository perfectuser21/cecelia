---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Workstream 1: 创建 verify-b37.sh 验证脚本

**范围**: 在 `sprints/w49-b37-validation/` 创建 `verify-b37.sh`，含 ≥4 断言，脚本运行 exit 0 输出 "B37 验证全部通过"
**大小**: S(<100行)
**依赖**: 无（sprint-prd.md 由 Planner 提前创建，sprint-contract.md 由 Proposer 提前创建）

## ARTIFACT 条目（预条件 + Generator 产出物）

- [x] [ARTIFACT] `sprints/w49-b37-validation/sprint-prd.md` 存在（planner 产出，验证起点预条件）
  Test: node -e "require('fs').accessSync('sprints/w49-b37-validation/sprint-prd.md');console.log('OK')"

- [x] [ARTIFACT] `sprints/w49-b37-validation/sprint-contract.md` 存在（proposer 产出，parsePrdNode B37 fix 生效的直接证明）
  Test: node -e "require('fs').accessSync('sprints/w49-b37-validation/sprint-contract.md');console.log('OK')"

- [x] [ARTIFACT] `sprints/w49-b37-validation/verify-b37.sh` 存在（generator 产出；运行时 PASS 计数由 BEHAVIOR 3 校验）
  Test: node -e "require('fs').accessSync('sprints/w49-b37-validation/verify-b37.sh');console.log('OK')"

## BEHAVIOR 索引（测试实现见 tests/ws1/b37-validation.test.ts）

**[BEHAVIOR 1]** `git diff --name-only origin/main HEAD -- sprints/` 输出含 `sprints/w49-b37-validation/` 路径（B37 git diff 逻辑运行时验证）

**[BEHAVIOR 2]** `bash verify-b37.sh` exit 0 且 stdout 含 "B37 验证全部通过"（全链路运行时验证）

**[BEHAVIOR 3]** `bash verify-b37.sh` 输出 ≥4 条 `✅ PASS` 断言（脚本覆盖全部关键检查点）

**[BEHAVIOR 4]** Brain Docker 日志（动态查找容器名）无 ENOENT 关联 w49-b37-validation（全程无目录查找失败）
