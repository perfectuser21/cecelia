---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge.md`；不得修改任何实现代码。
**大小**: S

## Invariant 映射

- [Planner 分支] N/A：本实现不操作 Planner 分支。
- [基线权威] B-05 使用冻结实现基线 `71ba943ed858735e77059927fc4c2cdc25022c9e`，不使用角色 checkout SHA。
- [端点鉴权] B-01 同时断言两个端点、`internalAuthOrLoopback` 与远端 Bearer 要求及匿名反例。
- [凭据安全] B-01 仅允许 token 环境变量名，并拒绝形似真实 Bearer 值。
- [真环境验证] N/A：本 sprint 纯文档，不修改或执行真实调用方接缝。

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增中文《attempt-run 桥接使用说明》
  Test: bash -c 'grep -q "# attempt-run 桥接使用说明" docs/current/attempt-run-bridge.md && grep -q "派发失败自动回滚" docs/current/attempt-run-bridge.md'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 两个端点用途与 Bearer 鉴权正反边界
  动作: 打开说明页并阅读“端点用途与鉴权”一节
  预期观察: 创建与查询用途、loopback/宿主远端边界及 Bearer 占位符清晰，且不允许远端匿名或真实密钥
  等待预算: 0s
  留证: Vitest 对应测试输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903202123-5mg9ep/tests/attempt-run-bridge-guide.test.ts -t "两个端点用途与 Bearer 鉴权正反边界"'

- [ ] [BEHAVIOR] [L1] B-02: 角色白名单恰好九项且拒绝白名单外角色
  动作: 阅读“角色白名单”并逐项计数
  预期观察: 九项封闭集合与生产角色逐字一致，白名单外角色明确被拒绝
  等待预算: 0s
  留证: Vitest 集合相等、计数与负向成员断言输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903202123-5mg9ep/tests/attempt-run-bridge-guide.test.ts -t "角色白名单恰好九项且拒绝白名单外角色"'

- [ ] [BEHAVIOR] [L1] B-03: payload 必填集合恰好三项且 base_sha 可省略
  动作: 阅读“payload 字段”并按最小字段合同准备请求
  预期观察: 必填集合仅为 sprint_dir、base_repo、branch，base_sha 由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 封闭必填集合及 base_sha 正反语义断言输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903202123-5mg9ep/tests/attempt-run-bridge-guide.test.ts -t "payload 必填集合恰好三项且 base_sha 可省略"'

- [ ] [BEHAVIOR] [L1] B-04: 派发失败回滚三项终态完整且没有错误终态
  动作: 阅读“派发失败自动回滚”并核对三类资源
  预期观察: run→failed、session→closed、task→cancelled 恰好三项，且无成功或活跃终态
  等待预算: 0s
  留证: Vitest 转移集合相等及错误终态负向断言输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903202123-5mg9ep/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚三项终态完整且没有错误终态"'

- [ ] [BEHAVIOR] [L1] B-05: 生产范围仅新增目标文档
  动作: 从冻结实现基线比较候选提交的生产路径变化
  预期观察: docs/current 仅新增目标页，packages、apps、scripts、tests、playground 均无变化
  等待预算: 0s
  留证: git diff 文件清单
  Test: manual:bash -c 'BASE_SHA=71ba943ed858735e77059927fc4c2cdc25022c9e; DOC=docs/current/attempt-run-bridge.md; mapfile -t F < <(git diff --name-only --diff-filter=ACMRT "$BASE_SHA"...HEAD -- docs/current packages apps scripts tests playground); [ "${#F[@]}" -eq 1 ] && [ "${F[0]}" = "$DOC" ] && ! git diff --name-only --diff-filter=ACMRT "$BASE_SHA"...HEAD -- packages apps scripts tests playground | grep -q .'
