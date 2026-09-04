---
skeleton: false
journey_type: autonomous
target_environment: mac_web
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-usage.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增中文说明文档包含四个独立章节：端点用途与鉴权、角色白名单、payload 必填字段、派发失败自动回滚
  Test: `BASE_SHA=e0a56e2efaa96a5e9b1759f6b1086282121454dd npx vitest run sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.test.ts --reporter=verbose`

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者能按正确信任边界选择创建/查询端点并鉴权
  动作: 阅读“端点用途与鉴权”章节，分别定位创建、查询及非回环鉴权说明
  预期观察: 两个端点用途明确，宿主/远端携带 Bearer token，缺失或错误 token 不被描述为可访问
  等待预算: 0s
  留证: Vitest 中该用例的 stdout 与退出码
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.test.ts -t "端点用途与鉴权正向内容完整，且负向边界明确"'

- [ ] [BEHAVIOR] [L1] B-02: 读者得到不多不少的生产九角色清单
  动作: 阅读“角色白名单”章节，先逐项核对名称，再核对总数
  预期观察: 九项名称与生产 ALLOWED_ROLES 精确同集，无重复、缺项、额外项或别名
  等待预算: 0s
  留证: Vitest 集合差异输出与退出码
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.test.ts -t "角色白名单先完整列名再计数，且与生产集合不多不少"'

- [ ] [BEHAVIOR] [L1] B-03: 读者正确构造 payload
  动作: 阅读“payload 必填字段”章节并区分必填字段与可省略字段
  预期观察: sprint_dir、base_repo、branch 均为必填，只有 base_sha 可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 字段语义断言输出与退出码
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.test.ts -t "payload 正确区分三个必填字段与 base_sha 可省略"'

- [ ] [BEHAVIOR] [L1] B-04: 读者完整判断派发失败回滚
  动作: 阅读“派发失败自动回滚”章节并逐项核对三个关联对象
  预期观察: 同时看到 run → failed、session → closed、task → cancelled，且明确三者全部完成
  等待预算: 0s
  留证: Vitest 回滚映射断言输出与退出码
  Test: manual:bash -c 'node ./node_modules/vitest/vitest.mjs run sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.test.ts -t "派发失败列全三组回滚终态且禁止部分成功解释"'

- [ ] [BEHAVIOR] [L1] B-05: 候选范围严格保持为唯一新增中文 Markdown
  动作: 以冻结实现基线比较候选 HEAD 的 name-status diff，并读取唯一文档
  预期观察: 只有 docs/current/attempt-run-bridge-usage.md 为 A，且正文含中文；任何代码或其他文件变化均失败
  等待预算: 0s
  留证: git diff --name-status 输出与 Vitest 退出码
  Test: manual:bash -c 'BASE_SHA=e0a56e2efaa96a5e9b1759f6b1086282121454dd node ./node_modules/vitest/vitest.mjs run sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-usage.test.ts -t "冻结基线范围只允许新增一页 docs/current 中文 Markdown"'

## Invariant 映射

- N/A：端点鉴权运行时 invariant 未被本 Sprint 修改；其文档准确性已由 B-01 的正负 oracle 覆盖。
- N/A：分支权威仅约束 Planner workspace，本 Sprint 不修改或说明 Planner checkout 行为。
- N/A：凭据隔离运行时 invariant 未被本 Sprint 修改；B-01 另行禁止文档出现 token 示例值。
