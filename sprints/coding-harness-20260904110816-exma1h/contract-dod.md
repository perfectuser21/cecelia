---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

task_request_hash: `0207fb013c7d30227edea6e345a287b4561ac99dd9406c7b38d5501d1b078d37`

## ARTIFACT 条目

- [ ] [ARTIFACT] 只新增 `docs/current/attempt-run-bridge-usage.md`，不改代码；文档为中文且含四个约定章节。
  Test: `git diff --name-status e0a56e2efaa96a5e9b1759f6b1086282121454dd HEAD`

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者能确认文档范围、中文四节与冻结请求绑定
  动作: 从实现基线比较候选树并读取新增说明文档
  预期观察: 差异恰好是一页中文文档，且四节齐全
  等待预算: 0s
  留证: Vitest 输出中“文档范围、中文四节与 task_request_hash 绑定”通过
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-doc.test.ts -t "文档范围、中文四节与 task_request_hash 绑定"'

- [ ] [BEHAVIOR] [L1] B-02: 读者能按准确鉴权方式调用两个端点
  动作: 阅读端点用途与鉴权章节并核对精确字面量
  预期观察: 创建、查询用途清楚，宿主或远端必须携带 Bearer token，回环差异明确
  等待预算: 0s
  留证: Vitest 输出中“端点用途与鉴权精确且拒绝远端匿名表述”通过
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-doc.test.ts -t "端点用途与鉴权精确且拒绝远端匿名表述"'

- [ ] [BEHAVIOR] [L1] B-03: 读者只会选择生产认可的九个角色
  动作: 解析文档角色清单并与生产 ALLOWED_ROLES 对账
  预期观察: 先得到九个无重复角色，再确认与权威集合精确同集
  等待预算: 0s
  留证: Vitest 输出中“角色白名单恰好九项并与生产权威集合精确相等”通过
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-doc.test.ts -t "角色白名单恰好九项并与生产权威集合精确相等"'

- [ ] [BEHAVIOR] [L1] B-04: 读者能构造 payload 并辨认完整回滚终态
  动作: 核对字段必填性与派发失败后三对象状态映射
  预期观察: 三个字段只能是必填，base_sha 只能是可省略；回滚三组映射全部出现
  等待预算: 0s
  留证: Vitest 输出中“payload 必填性与三对象回滚终态完整且无反向歧义”通过
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260904110816-exma1h/tests/attempt-run-bridge-doc.test.ts -t "payload 必填性与三对象回滚终态完整且无反向歧义"'

## Invariant 映射

- 端点鉴权：B-02 正向要求 `internalAuthOrLoopback` 与 Bearer token，负向拒绝远端匿名表述。
- 分支权威：N/A，本 sprint 不改变 Planner 工作区或分支。
- 凭据隔离：N/A，本 sprint 不操作账号资源且不落盘凭据。
