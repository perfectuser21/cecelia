---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增中文说明文档且实现变更范围唯一
  Test: bash -c 'test -f docs/current/attempt-run-bridge-guide.md && [ "$(git diff --name-only 5d25dcd6addb8ba30c742281b682589a3b95eaab...HEAD -- docs/current | sort)" = "docs/current/attempt-run-bridge-guide.md" ]'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 中文标题与两个端点用途完整
  动作: 从 `docs/current/` 打开说明并阅读发起与查询章节
  预期观察: POST 明确用于发起，GET 明确用于查询 attempt 状态
  等待预算: 0s
  留证: Vitest verbose 输出中的对应测试名与 PASS/FAIL
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "中文标题与两个端点用途完整"'

- [ ] [BEHAVIOR] [L1] B-02: 鉴权规则区分 loopback 与宿主远端
  动作: 阅读鉴权章节并核对远端请求要求
  预期观察: 文档写明 internalAuthOrLoopback，且宿主/远端必须携带 Bearer CECELIA_INTERNAL_TOKEN
  等待预算: 0s
  留证: Vitest verbose 输出中的对应测试名与 PASS/FAIL
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "鉴权规则区分 loopback 与宿主远端"'

- [ ] [BEHAVIOR] [L1] B-03: 角色白名单恰好列出九项固定角色
  动作: 阅读角色白名单章节并逐项计数
  预期观察: 九项角色与权威基线 ALLOWED_ROLES 完全一致，白名单外角色不受支持
  等待预算: 0s
  留证: Vitest verbose 输出中的精确数组比较结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "角色白名单恰好列出九项固定角色"'

- [ ] [BEHAVIOR] [L1] B-04: payload 字段与失败回滚链完整
  动作: 阅读 payload 与派发失败章节
  预期观察: 三项必填字段、base_sha 可省略语义以及 run/session/task 回滚顺序完整可见
  等待预算: 0s
  留证: Vitest verbose 输出中的对应测试名与 PASS/FAIL
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "payload 字段与失败回滚链完整"'

## Invariant 映射

- N/A：冻结 PRD 注入的 area 铁律均涉及代码、运行态、数据库、真机或调度；本 Sprint 仅新增静态说明，不触及对应模块。适用的「凭据安全」已映射为文档只写环境变量名、不含真实 token；「端点鉴权」已映射为 B-02，不改变端点。
