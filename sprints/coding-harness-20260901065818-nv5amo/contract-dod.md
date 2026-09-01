---
skeleton: false
journey_type: dev_pipeline
target_environment: local_api
implementation_baseline: 5599211397c88c3827d5ce4e9c6061b3802b4fc5
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**：只新增 `docs/current/attempt-run-bridge-guide.md` 中文文档。
**大小**：S

## Invariant 映射

- [分支签发] N/A：本合同不改变 Planner 分支；Proposer 保持服务端签发分支。
- [凭据安全] 由 B-02 断言占位符且拒绝疑似真实 Bearer token。
- [端点鉴权] 由 B-02 断言两个既有端点的 `internalAuthOrLoopback` 与远端 Bearer 要求。
- [禁止写死] 由 B-02 只允许环境变量占位符，不写死 token；其余环境假设 N/A。
- [真环境验证] N/A：纯文档改动，不新增生产接缝；文档事实取实现基线生产代码。

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增一页中文文档 `docs/current/attempt-run-bridge-guide.md`
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/[\\u4e00-\\u9fff]/.test(s))process.exit(1)"

- [ ] [ARTIFACT] 冻结 Vitest 测试可解析且使用 Vitest 测试栈
  Test: node -e "const fs=require('fs');const s=fs.readFileSync('sprints/coding-harness-20260901065818-nv5amo/tests/attempt-run-bridge-guide.test.ts','utf8');if(!s.includes(\"from 'vitest'\")||!s.includes('describe(')||!s.includes('it('))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 读者能区分创建与查询端点
  动作: 打开新增说明页，阅读“端点用途”章节
  预期观察: POST 被说明为创建/异步派发 attempt，GET 被说明为按 id 查询状态/结果
  等待预算: 0s
  留证: Vitest verbose 输出中 `说明两个端点的用途` 结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901065818-nv5amo/tests/attempt-run-bridge-guide.test.ts -t "说明两个端点的用途"'

- [ ] [BEHAVIOR] [L2] B-02: 读者能采用远端安全鉴权且文档不泄露凭据
  动作: 阅读“鉴权方式”章节并核对远端 Authorization 示例
  预期观察: 页面明确 internalAuthOrLoopback、宿主/远端必须带 Bearer CECELIA_INTERNAL_TOKEN，且仅展示占位符
  等待预算: 0s
  留证: Vitest verbose 输出中 `说明鉴权且不泄露凭据` 结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901065818-nv5amo/tests/attempt-run-bridge-guide.test.ts -t "说明鉴权且不泄露凭据"'

- [ ] [BEHAVIOR] [L2] B-03: 读者看到恰好九项规范角色
  动作: 阅读“角色白名单”章节并逐项核对角色值
  预期观察: 列表恰好九项，逐项等于实现基线 ALLOWED_ROLES
  等待预算: 0s
  留证: Vitest verbose 输出中 `角色白名单恰好九项` 结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901065818-nv5amo/tests/attempt-run-bridge-guide.test.ts -t "角色白名单恰好九项"'

- [ ] [BEHAVIOR] [L2] B-04: 读者能区分 payload 必填字段与 base_sha 可选语义
  动作: 阅读“payload 字段”章节，分别查看必填和可选列表
  预期观察: sprint_dir、base_repo、branch 为必填，base_sha 可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest verbose 输出中 `区分 payload 必填字段和 base_sha 可选语义` 结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901065818-nv5amo/tests/attempt-run-bridge-guide.test.ts -t "区分 payload 必填字段和 base_sha 可选语义"'

- [ ] [BEHAVIOR] [L2] B-05: 读者能确认派发失败的三类回滚终态
  动作: 阅读“派发失败自动回滚”章节
  预期观察: 同一章节显示 run → failed、session → closed、task → cancelled，并说明不留运行中孤儿
  等待预算: 0s
  留证: Vitest verbose 输出中 `说明派发失败自动回滚三类终态` 结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901065818-nv5amo/tests/attempt-run-bridge-guide.test.ts -t "说明派发失败自动回滚三类终态"'

- [ ] [BEHAVIOR] [L2] B-06: Sprint 保持文档-only 范围
  动作: 对实现基线与候选 HEAD 做文件级 diff
  预期观察: 仅出现目标文档和本 Sprint 冻结合同产物，不出现产品代码
  等待预算: 0s
  留证: git diff 文件清单
  Test: manual:bash -c 'FILES=$(git diff --name-only 5599211397c88c3827d5ce4e9c6061b3802b4fc5...HEAD); BAD=$(printf "%s\n" "$FILES" | awk '"'"'!/^(docs\/current\/attempt-run-bridge-guide\.md|sprints\/coding-harness-20260901065818-nv5amo\/)/'"'"'); [ -z "$BAD" ] || { printf "越界文件:\n%s\n" "$BAD"; exit 1; }; [ "$(printf "%s\n" "$FILES" | grep -c "^docs/current/attempt-run-bridge-guide\.md$")" -eq 1 ]'
