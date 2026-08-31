---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文文档；不修改产品代码、API 或数据库。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档存在且包含四个明确的二级章节
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const c=fs.readFileSync(p,'utf8');for(const h of ['端点用途','鉴权方式','角色白名单','payload 与失败自动回滚'])if(!c.includes('## '+h))process.exit(1)"

- [ ] [ARTIFACT] 唯一产品变更文件为目标文档
  Test: bash -c 'git diff --name-only 3c865b0f86c5f3d95bbebf6cb2d73928b565919b...HEAD | grep -v "^sprints/coding-harness-20260831052812-3dmx7y/" > /tmp/attempt-run-product-files.txt; test "$(wc -l < /tmp/attempt-run-product-files.txt | tr -d " ")" -eq 1 && grep -qx "docs/current/attempt-run-bridge-guide.md" /tmp/attempt-run-product-files.txt'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 说明两个端点属于同一 attempt-run 流程
  动作: 打开说明文档并依次阅读 POST 创建与 GET 查询用途。
  预期观察: 两个端点字面准确，且文字明确 GET 使用 POST 返回的 id 查询同一流程。
  等待预算: 0s
  留证: vitest 输出中对应测试名与断言结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831052812-3dmx7y/tests/attempt-run-bridge-guide.test.ts -t "说明两个端点属于同一 attempt-run 流程"'

- [ ] [BEHAVIOR] [L2] B-02: 鉴权与 payload 字段字面准确
  动作: 按文档核对宿主/远端鉴权及 POST payload 要求。
  预期观察: 文档写明 internalAuthOrLoopback、Bearer CECELIA_INTERNAL_TOKEN、三个必填字段及可省略 base_sha。
  等待预算: 0s
  留证: vitest 输出中对应测试名与断言结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831052812-3dmx7y/tests/attempt-run-bridge-guide.test.ts -t "鉴权与 payload 字段字面准确"'

- [ ] [BEHAVIOR] [L2] B-03: 角色白名单恰为生产 SSOT 的九项精确集合
  动作: 将文档角色列表与生产路由 ALLOWED_ROLES 做集合比对。
  预期观察: 集合恰为 canary、planner、proposer、reviewer、generator、generator-fix、evaluator、evaluator-evidence-repair、judge。
  等待预算: 0s
  留证: vitest 输出中精确集合 diff
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831052812-3dmx7y/tests/attempt-run-bridge-guide.test.ts -t "角色白名单恰为生产 SSOT 的九项精确集合"'

- [ ] [BEHAVIOR] [L2] B-04: 派发失败回滚三对象终态完整
  动作: 阅读失败自动回滚章节并核对 run、session、task 三类对象。
  预期观察: 文档逐字给出 run→failed、session→closed、task→cancelled，缺一不可。
  等待预算: 0s
  留证: vitest 输出中对应测试名与断言结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831052812-3dmx7y/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚三对象终态完整"'

- [ ] [BEHAVIOR] [L2] INV-1: Planner 分支铁律不受纯文档变更影响
  动作: 检查相对实现基线的产品变更文件集合。
  预期观察: 除 Sprint 治理产物外仅目标文档变化，planner 与 dispatcher 代码均未修改。
  等待预算: 0s
  留证: /tmp/attempt-run-product-files.txt
  Test: manual:bash -c 'git diff --name-only 3c865b0f86c5f3d95bbebf6cb2d73928b565919b...HEAD | grep -v "^sprints/coding-harness-20260831052812-3dmx7y/" > /tmp/attempt-run-product-files.txt; test "$(wc -l < /tmp/attempt-run-product-files.txt | tr -d " ")" -eq 1; grep -qx "docs/current/attempt-run-bridge-guide.md" /tmp/attempt-run-product-files.txt'

- [ ] [BEHAVIOR] [L2] INV-2: 合同角色枚举与生产 SSOT 无遗漏
  动作: 运行冻结测试解析生产 ALLOWED_ROLES 并与文档列表比对。
  预期观察: 两侧排序去重集合相等且数量均为九。
  等待预算: 0s
  留证: vitest 输出中对应精确集合测试结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831052812-3dmx7y/tests/attempt-run-bridge-guide.test.ts -t "角色白名单恰为生产 SSOT 的九项精确集合"'

