---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

task_request_hash: `aecb99079a0f3f82a833c6ff55d42e5903af6050d73033b574511db5dfd00e4f`

**范围**: 仅新增 `docs/current/attempt-run-bridge.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档存在且引用冻结 task_request_hash
  Test: node -e "const c=require('fs').readFileSync('docs/current/attempt-run-bridge.md','utf8');if(!c.includes('aecb99079a0f3f82a833c6ff55d42e5903af6050d73033b574511db5dfd00e4f')||!/[\\u4e00-\\u9fff]/.test(c))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者看到四个独立章节
  动作: 读取 `docs/current/attempt-run-bridge.md` 的二级标题。
  预期观察: 端点与鉴权、角色白名单、payload 字段、派发失败自动回滚四节全部存在。
  等待预算: 0s
  留证: Vitest 输出中四节断言结果。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge.test.ts -t "包含四个独立章节"'

- [ ] [BEHAVIOR] [L1] B-02: 端点与鉴权正负 oracle
  动作: 阅读端点与鉴权章节并核对生产鉴权变量。
  预期观察: 两端点、`internalAuthOrLoopback`、`Bearer $CECELIA_INTERNAL_TOKEN` 齐全，且无错误 token 名或免 Bearer 暗示。
  等待预算: 0s
  留证: Vitest 正向包含与负向排除断言输出。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge.test.ts -t "端点与鉴权正负 oracle"'

- [ ] [BEHAVIOR] [L1] B-03: 角色白名单是恰好九项封闭集合
  动作: 解析角色白名单章节中的 Markdown 列表。
  预期观察: 数组按权威顺序精确等于九项角色，无重复、缺项或额外项。
  等待预算: 0s
  留证: Vitest 深相等、集合大小及负向差集断言输出。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge.test.ts -t "角色白名单是恰好九项封闭集合"'

- [ ] [BEHAVIOR] [L1] B-04: payload 必填与可省略规则正负 oracle
  动作: 解析 payload 表格的字段名和约束列。
  预期观察: 必填集合恰为 `sprint_dir/base_repo/branch`，`base_sha` 明确可省略并由生产 Brain 自解析。
  等待预算: 0s
  留证: Vitest 集合相等、base_sha 正向说明与负向排除断言输出。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge.test.ts -t "payload 必填与可省略规则正负 oracle"'

- [ ] [BEHAVIOR] [L1] B-05: 失败回滚正负 oracle
  动作: 阅读派发失败自动回滚章节并逐项核对终态。
  预期观察: `run→failed/session→closed/task→cancelled` 全部出现，且没有相反的非终态表述。
  等待预算: 0s
  留证: Vitest 三项正向与三项负向断言输出。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge.test.ts -t "失败回滚正负 oracle"'

- [ ] [BEHAVIOR] [L1] B-06: 唯一交付文件范围 oracle
  动作: 以冻结实现基线比较候选提交的文件清单。
  预期观察: 排除冻结合同目录后，唯一变更是 `docs/current/attempt-run-bridge.md`；任何代码或既有文档变更均失败。
  等待预算: 0s
  留证: canonical git diff 文件清单与 Vitest 断言输出。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge.test.ts -t "唯一交付文件范围 oracle"'

## Invariant 映射

- [ ] [BEHAVIOR] [L1] INV-1: 凭据隔离保持成立
  动作: 对文档鉴权示例执行正向变量引用与负向字面 token 检查。
  预期观察: 仅出现 `Bearer $CECELIA_INTERNAL_TOKEN`，无错误变量名或疑似真实 token。
  等待预算: 0s
  留证: B-02 的 Vitest 正负断言输出。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge.test.ts -t "端点与鉴权正负 oracle"'

- [ ] [BEHAVIOR] [L1] INV-2: 实现基线恒定
  动作: 从冻结实现基线计算候选提交文件差异。
  预期观察: 范围 oracle 使用 `6a9030e27b6f1c7c9ab328c9c90ba08cbb74eebb`，且范围外文件集合为空。
  等待预算: 0s
  留证: B-06 的 canonical git diff 与 Vitest 输出。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge.test.ts -t "唯一交付文件范围 oracle"'
