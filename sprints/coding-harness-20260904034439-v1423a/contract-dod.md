---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增中文说明页及冻结测试均存在
  Test: node -e "const f=require('fs');for(const p of ['docs/current/attempt-run-bridge-guide.md','sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts'])f.accessSync(p)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 端点与鉴权信息完整
  动作: 读取“端点与鉴权”章节并核对创建、查询和 Bearer 要求
  预期观察: 四项正向信息存在，宿主或远端免鉴权误导不存在
  等待预算: 0s
  留证: Vitest verbose 输出中的 B-01 对应用例
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "端点与鉴权章节同时说明创建查询用途和远端 Bearer 要求" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: 九角色是封闭集合
  动作: 从“角色白名单”章节逐行提取角色并现场计数
  预期观察: 条目恰好九项、集合相等且不存在额外角色
  等待预算: 0s
  留证: Vitest verbose 输出中的 B-02 对应用例
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "角色白名单章节是恰好九项的封闭集合且拒绝额外角色" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-03: payload 与冻结基线规则完整
  动作: 从 payload 章节提取所有标记为必填的字段并核对 base_sha 规则
  预期观察: 必填列表严格为三项，base_sha 可省略且 workspace SHA 不能替代实现基线
  等待预算: 0s
  留证: Vitest verbose 输出中的 B-03 对应用例
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "payload 章节限定三个必填字段并说明 base_sha 省略与冻结基线" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: 派发失败回滚终态完整
  动作: 从失败回滚章节提取对象状态迁移并现场计数
  预期观察: 严格得到 run→failed、session→closed、task→cancelled，且无部分成功语义
  等待预算: 0s
  留证: Vitest verbose 输出中的 B-04 对应用例
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "派发失败自动回滚章节声明三个且仅三个关联终态" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-05: 唯一交付范围未越界
  动作: 相对冻结基线列出全部变更，排除 sprints 治理产物后现场计数
  预期观察: 交付文件恰好一项且仅为新增 docs/current/attempt-run-bridge-guide.md
  等待预算: 0s
  留证: git diff 文件清单和 exit code
  Test: manual:bash -c 'BASE=bdaca81b5cbf78929fa3d8eeac2a24cae6113b98; mapfile -t F < <(git diff --name-only "$BASE"...HEAD -- . ":(exclude)sprints/**"); [ "${#F[@]}" -eq 1 ] && [ "${F[0]}" = docs/current/attempt-run-bridge-guide.md ] && [ "$(git diff --diff-filter=A --name-only "$BASE"...HEAD -- docs/current/attempt-run-bridge-guide.md)" = docs/current/attempt-run-bridge-guide.md ]'

## Invariant 覆盖

- [规划分支] N/A：本 Sprint 不修改 Planner workspace 或 Provider 分支行为；范围 oracle 禁止代码变更。
- [权威地址] N/A：本 Sprint 不修改 Dispatcher、Fleet Worker 或 HARNESS_BRAIN_URL；范围 oracle 禁止代码变更。
