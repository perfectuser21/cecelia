---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于固定路径且合同测试已冻结
  Test: node -e "require('fs').accessSync('docs/current/attempt-run-bridge-guide.md');require('fs').accessSync('sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 读者能区分创建与查询端点
  动作: 执行冻结测试，解析文档「端点与鉴权」章节的 POST 与 GET 用途
  预期观察: POST 对应创建/派发，GET 对应查询/轮询，且不存在互换措辞
  等待预算: 0s
  留证: Vitest 输出中的「创建与查询端点用途明确且不可互换」结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "创建与查询端点用途明确且不可互换"'

- [ ] [BEHAVIOR] [L2] B-02: 读者能正确区分 loopback 与远端鉴权
  动作: 执行冻结测试，解析 internalAuthOrLoopback 与 Bearer 要求及禁止措辞
  预期观察: 宿主/远端明确要求 Bearer CECELIA_INTERNAL_TOKEN，不宣称远端免鉴权
  等待预算: 0s
  留证: Vitest 输出中的「鉴权区分 loopback 与宿主远端且不可宣称远端免鉴权」结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "鉴权区分 loopback 与宿主远端且不可宣称远端免鉴权"'

- [ ] [BEHAVIOR] [L2] B-03: 九角色是恰好九项的封闭集合
  动作: 从角色章节现场提取全部反引号角色并与 PRD 九项排序集合比较
  预期观察: 集合恰好九项，无重复、无缺项、无额外角色
  等待预算: 0s
  留证: Vitest 输出中的「角色白名单恰好九项并拒绝任何额外角色」结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "角色白名单恰好九项并拒绝任何额外角色"'

- [ ] [BEHAVIOR] [L2] B-04: payload 与冻结实现基线规则完整且无反向误导
  动作: 执行冻结测试，检查三个必填字段、可省略 base_sha、生产 Brain 自解析及 workspace 禁替代规则
  预期观察: 全部正向规则存在，base_sha 必填或 workspace 替代实现基线等反向措辞不存在
  等待预算: 0s
  留证: Vitest 输出中的 payload 与实现基线两个测试结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "payload 三个字段必填且 base_sha 不可写成必填|实现基线保持不变且 workspace base_sha 不得替代"'

- [ ] [BEHAVIOR] [L2] B-05: 派发失败三个对象回滚到唯一终态
  动作: 执行冻结测试，解析失败回滚章节的三个状态箭头
  预期观察: 同时得到 run→failed、session→closed、task→cancelled，且无部分成功或冲突终态
  等待预算: 0s
  留证: Vitest 输出中的「派发失败回滚三个对象到唯一终态且不可描述为部分成功」结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚三个对象到唯一终态且不可描述为部分成功"'

- [ ] [BEHAVIOR] [L2] B-06: 四章节完整且交付范围只有一页文档
  动作: 基于冻结 SHA 执行全部测试并排除 sprints 后计算交付文件集合
  预期观察: 四章节均存在、无人工占位，文件集合严格等于 docs/current/attempt-run-bridge-guide.md
  等待预算: 0s
  留证: 完整 Vitest 输出与 git diff 文件清单
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts'

## Invariant 映射

- N/A：[规划分支] 本 Sprint 不修改 Planner workspace 或分支切换逻辑；冻结范围 oracle 禁止相关文件进入交付。
- N/A：[权威地址] 本 Sprint 不修改 Dispatcher、Fleet Worker、HARNESS_BRAIN_URL 或预检；冻结范围 oracle 禁止相关文件进入交付。
