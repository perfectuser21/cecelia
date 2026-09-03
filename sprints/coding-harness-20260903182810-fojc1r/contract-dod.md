---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-usage.md`，不修改代码或其他文档。
**大小**: S

## Invariant 映射

- [规划分支] N/A：Planner 分支行为不属于本实现；合同固定实现基线且 proposer 留在服务端签发分支。
- [凭据安全] 由 B-01 正向占位符与真实 token 形态负向检查覆盖。
- [端点鉴权] 由 B-01 逐字锁定两个既有端点的 `internalAuthOrLoopback` 与远端 Bearer 要求；本 sprint 不改端点。

## ARTIFACT 条目

- [ ] [ARTIFACT] 唯一生产交付物为中文说明页
  Test: bash -c 'grep -q "attempt-run 桥接" docs/current/attempt-run-bridge-usage.md'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者识别两个端点与远端鉴权正反边界
  动作: 打开说明页并阅读“端点用途与鉴权”一节
  预期观察: POST/GET 用途、internalAuthOrLoopback、Bearer 占位符及不可匿名语义均明确
  等待预算: 0s
  留证: Vitest 输出中对应测试通过记录
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-usage-doc.test.ts -t "文档包含两个端点及远端 Bearer 鉴权的正反边界"'

- [ ] [BEHAVIOR] [L1] B-02: 读者只能从封闭九项集合选择角色
  动作: 阅读“角色白名单”九个独立条目
  预期观察: 集合逐项等于生产九角色，且 commander 与 publisher 不被列为角色
  等待预算: 0s
  留证: Vitest 输出中集合相等及负向成员断言记录
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-usage-doc.test.ts -t "角色白名单封闭且逐项等于九个生产角色"'

- [ ] [BEHAVIOR] [L1] B-03: 读者构造最小 payload 且不猜 base_sha
  动作: 阅读“请求 payload”一节并辨认必填与可省略字段
  预期观察: sprint_dir、base_repo、branch 为必填，base_sha 可省略并由生产 Brain 自解析，错误语义不出现
  等待预算: 0s
  留证: Vitest 输出中字段正向与错误语义负向断言记录
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-usage-doc.test.ts -t "最小 payload 只要求三个字段并明确 base_sha 省略语义"'

- [ ] [BEHAVIOR] [L1] B-04: 读者识别派发失败的完整回滚终态
  动作: 阅读“派发失败回滚”一节
  预期观察: run→failed、session→closed、task→cancelled 全部出现，且不称为部分成功
  等待预算: 0s
  留证: Vitest 输出中三项正向及“部分成功”负向断言记录
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903182810-fojc1r/tests/attempt-run-usage-doc.test.ts -t "派发失败回滚完整列出三个资源终态且不称为部分成功"'

- [ ] [BEHAVIOR] [L1] B-05: 生产变更范围严格限制为一份说明文档
  动作: 以冻结实现基线比较候选提交的生产路径变化
  预期观察: docs/current 仅新增目标页，packages、apps、scripts、tests、playground 均无变化
  等待预算: 0s
  留证: git diff 文件清单
  Test: manual:bash -c 'BASE_SHA=565796b924487f6d5c4314703c757b32b788fdac; DOC=docs/current/attempt-run-bridge-usage.md; mapfile -t F < <(git diff --name-only --diff-filter=ACMRT "$BASE_SHA"...HEAD -- docs/current packages apps scripts tests playground); [ "${#F[@]}" -eq 1 ] && [ "${F[0]}" = "$DOC" ] && ! git diff --name-only --diff-filter=ACMRT "$BASE_SHA"...HEAD -- packages apps scripts tests playground | grep -q .'
