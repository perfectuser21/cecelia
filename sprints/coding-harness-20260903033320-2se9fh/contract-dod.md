---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

task_request_hash: `aecb99079a0f3f82a833c6ff55d42e5903af6050d73033b574511db5dfd00e4f`

**范围**: 唯一实现交付为 `docs/current/attempt-run-bridge.md`，不改代码。
**大小**: S

## Invariant 映射

- [凭据隔离] 文档只出现凭据变量名，不得出现真实 Token；由 B-01 与 B-05 验证。
- [基线恒定] 实现范围一律相对 `6a9030e27b6f1c7c9ab328c9c90ba08cbb74eebb` 计算；不得替换为 workspace checkout SHA；由 A-03 验证。

## ARTIFACT 条目

- [ ] [ARTIFACT] A-01: 中文说明文档存在且标题、四个独立章节与冻结 task_request_hash 齐全
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge.md';const s=fs.readFileSync(p,'utf8');for(const x of ['# attempt-run 桥接使用说明','## 端点与鉴权','## 角色白名单','## payload 字段','## 派发失败自动回滚','aecb99079a0f3f82a833c6ff55d42e5903af6050d73033b574511db5dfd00e4f'])if(!s.includes(x))process.exit(1)"

- [ ] [ARTIFACT] A-02: 冻结 Vitest 测试文件存在并使用 describe/it/expect
  Test: node -e "const s=require('fs').readFileSync('sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge-doc.test.ts','utf8');for(const x of ['describe(','it(','expect('])if(!s.includes(x))process.exit(1)"

- [ ] [ARTIFACT] A-03: canonical git-diff 范围仅含目标文档
  Test: bash -c 'ACTUAL=$(git diff --name-only 6a9030e27b6f1c7c9ab328c9c90ba08cbb74eebb...HEAD -- | grep -v "^sprints/coding-harness-20260903033320-2se9fh/" | sort); [ "$ACTUAL" = "docs/current/attempt-run-bridge.md" ]'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 端点与鉴权正负 oracle
  动作: 读者打开端点与鉴权章节并照示例判断宿主或远端请求要求。
  预期观察: POST 发起运行、GET 按 id 查询，且宿主或远端必须携带 `Bearer CECELIA_INTERNAL_TOKEN`。
  等待预算: 0s
  留证: Vitest 的“端点与鉴权正负 oracle”输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge-doc.test.ts -t "端点与鉴权正负 oracle"'

- [ ] [BEHAVIOR] [L1] B-02: 九项角色封闭集合正负 oracle
  动作: 读者逐项读取角色白名单。
  预期观察: 列表恰好包含九个生产角色且无重复、缺项或额外项。
  等待预算: 0s
  留证: Vitest 的“九项角色封闭集合正负 oracle”输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge-doc.test.ts -t "九项角色封闭集合正负 oracle"'

- [ ] [BEHAVIOR] [L1] B-03: payload 字段正负 oracle
  动作: 读者按 payload 章节准备请求参数。
  预期观察: `sprint_dir`、`base_repo`、`branch` 是必填，`base_sha` 可省略并由生产 Brain 自解析。
  等待预算: 0s
  留证: Vitest 的“payload 字段正负 oracle”输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge-doc.test.ts -t "payload 字段正负 oracle"'

- [ ] [BEHAVIOR] [L1] B-04: 失败回滚正负 oracle
  动作: 读者查看派发失败自动回滚章节。
  预期观察: 新建对象同时收敛为 `run→failed`、`session→closed`、`task→cancelled`。
  等待预算: 0s
  留证: Vitest 的“失败回滚正负 oracle”输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge-doc.test.ts -t "失败回滚正负 oracle"'

- [ ] [BEHAVIOR] [L1] B-05: 中文与冻结哈希 oracle
  动作: 读者打开最终文档并核对语言与需求锚点。
  预期观察: 正文包含中文，包含冻结 task_request_hash，且不包含疑似真实 Bearer 值。
  等待预算: 0s
  留证: Vitest 的“中文与冻结哈希 oracle”输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge-doc.test.ts -t "中文与冻结哈希 oracle"'

