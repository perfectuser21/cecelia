---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 只新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于约定路径
  Test: node -e "const fs=require('node:fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/^# attempt-run 桥接使用说明$/m.test(s)||!/[一-龥]/.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 读者能区分 POST 发起与 GET 查询用途
  动作: 打开说明并阅读两个端点段落
  预期观察: POST 被说明为发起或派发，GET 被说明为查询或轮询
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试 PASS
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "两个端点分别说明发起与查询用途"'

- [ ] [BEHAVIOR] [L2] B-02: 读者能获得精确九项角色白名单
  动作: 打开“角色白名单”章节并逐项核对
  预期观察: 章节恰好列出服务端基线中的九项角色且声明白名单外不支持
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试 PASS
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "角色白名单恰好逐项列出九个服务端角色"'

- [ ] [BEHAVIOR] [L2] B-03: 宿主远端鉴权要求不会被 loopback 例外弱化
  动作: 阅读“鉴权方式”章节
  预期观察: 同时看到 internalAuthOrLoopback、loopback 例外和宿主或远端必须携带 Bearer CECELIA_INTERNAL_TOKEN
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试 PASS
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "鉴权章节区分 loopback 与宿主远端 Bearer 要求"'

- [ ] [BEHAVIOR] [L2] B-04: payload 必填与可省略字段边界清楚
  动作: 阅读“payload 必填字段”章节
  预期观察: sprint_dir、base_repo、branch 均标为必填，base_sha 标为可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试 PASS
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "payload 必填字段章节区分三个必填字段与可省略 base_sha"'

- [ ] [BEHAVIOR] [L2] B-05: 失败回滚出口完整且有序
  动作: 阅读“派发失败自动回滚”章节
  预期观察: 看到 run→failed/session→closed/task→cancelled 完整顺序
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试 PASS
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "派发失败自动回滚章节完整写出有序状态链"'

- [ ] [BEHAVIOR] [L2] B-06: 文档标题和中文正文可读
  动作: 打开 docs/current/attempt-run-bridge-guide.md
  预期观察: 页面标题为 attempt-run 桥接使用说明且正文包含中文
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试 PASS
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "标题为 attempt-run 桥接使用说明且正文包含中文"'

- [ ] [BEHAVIOR] [L2] B-07: 示例不泄露真实 internal token
  动作: 扫描整页说明中的 token 示例
  预期观察: 只出现环境变量名或占位引用，不出现硬编码真实 token 值
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试 PASS
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "示例不得泄露真实 internal token"'

## Invariant 映射

- [ ] [INVARIANT] INV-1 凭据安全：由 B-07 断言真实 token 不进入文档。
- [ ] [INVARIANT] INV-2 端点鉴权：由 B-03 断言宿主/远端必须使用 Bearer。
- N/A：PRD 其余铁律均约束代码、运行态、数据库、真机、调度、CI 或多租户；本 Sprint 仅新增静态文档且明确禁止修改这些表面。
