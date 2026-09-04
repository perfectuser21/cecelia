---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 只新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明页存在且四个固定章节可定位
  Test: node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const h of ['端点与鉴权','角色白名单','payload 与实现基线','派发失败自动回滚'])if(!s.includes('## '+h))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 文档是冻结基线之外唯一交付文件
  动作: 从冻结 SHA 计算 diff，并排除 Sprint 合同产物。
  预期观察: 交付清单恰好只有 docs/current/attempt-run-bridge-guide.md，且正文含中文。
  等待预算: 0s
  留证: Vitest 输出与 git diff 文件清单
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "文档为 docs/current 下唯一交付文件且内容为中文"'

- [ ] [BEHAVIOR] [L2] B-02: 创建、查询与鉴权指引可被机械识别
  动作: 读取「端点与鉴权」章节并逐项核对端点、用途和认证标识。
  预期观察: 四个关键字与 loopback、宿主/远端边界同时成立，删去任一关键字会失败。
  等待预算: 0s
  留证: Vitest 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "创建与查询端点及鉴权说明完整"'

- [ ] [BEHAVIOR] [L2] B-03: 角色白名单为恰好九项的封闭集合
  动作: 只从「角色白名单」章节提取反引号角色并与生产白名单比较。
  预期观察: 顺序与内容全等、去重计数为 9，追加 reporter 会被拒绝。
  等待预算: 0s
  留证: Vitest 输出中的集合断言
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "角色白名单是恰好九项的封闭集合"'

- [ ] [BEHAVIOR] [L2] B-04: payload 与冻结实现基线规则完整
  动作: 读取 payload 章节并核对三个必填字段、可省略字段与两种 base_sha 的边界。
  预期观察: sprint_dir、base_repo、branch 必填；base_sha 可省略且生产 Brain 自解析；workspace base_sha 不替代实现基线。
  等待预算: 0s
  留证: Vitest 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "payload 必填字段与 base_sha 规则完整"'

- [ ] [BEHAVIOR] [L2] B-05: 派发失败三个回滚终态完整
  动作: 读取「派发失败自动回滚」章节并核对三个对象的终态。
  预期观察: run→failed、session→closed、task→cancelled 全部存在，删去任何一个会失败。
  等待预算: 0s
  留证: Vitest 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "派发失败自动回滚的三个终态完整"'

- [ ] [BEHAVIOR] [L2] B-06: 四个章节名称与合同完全一致
  动作: 从整页文档定位四个二级标题。
  预期观察: 四个固定标题全部存在，以同义标题替换会被拒绝。
  等待预算: 0s
  留证: Vitest 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "四个必需章节均存在且不接受同义标题"'

## Invariant 映射

- [ ] [BEHAVIOR] [L2] INV-1: 规划分支铁律不受文档提交影响
  动作: 以冻结基线核对排除 Sprint 目录后的交付文件。
  预期观察: 无 dispatcher、provider 或分支控制代码变更。
  等待预算: 0s
  留证: git diff 文件清单
  Test: manual:bash -c 'X=$(git diff --name-only bdaca81b5cbf78929fa3d8eeac2a24cae6113b98 -- . ":(exclude)sprints/**"); [ "$X" = "docs/current/attempt-run-bridge-guide.md" ]'

- [ ] [BEHAVIOR] [L2] INV-2: 权威地址与 fail-closed 铁律不受文档提交影响
  动作: 以冻结基线核对排除 Sprint 目录后的交付文件。
  预期观察: 无 Dispatcher、Fleet Worker 或网络配置代码变更。
  等待预算: 0s
  留证: git diff 文件清单
  Test: manual:bash -c 'X=$(git diff --name-only bdaca81b5cbf78929fa3d8eeac2a24cae6113b98 -- . ":(exclude)sprints/**"); [ "$X" = "docs/current/attempt-run-bridge-guide.md" ]'

