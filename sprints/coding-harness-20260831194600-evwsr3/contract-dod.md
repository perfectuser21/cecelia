---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文文档。  
**大小**: S

## Invariant 映射

- [分支归属] N/A：本实现不操作 Planner workspace；Proposer 使用服务端签发分支。
- [凭据安全] 由 B-01 断言只出现变量名，并由探索检查阻止真实 token。
- [端点鉴权] 由 B-01 断言文档明确既有 `internalAuthOrLoopback` 与远端 Bearer 要求；本 Sprint 不新增端点。

## ARTIFACT 条目

- [ ] [ARTIFACT] 唯一产品产物为中文 Markdown `docs/current/attempt-run-bridge-guide.md`
  Test: node -e "const fs=require('fs');const s=fs.readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(!s.includes('# attempt-run 桥接使用说明')||!/[\\u4e00-\\u9fff]/u.test(s))process.exit(1)"

- [ ] [ARTIFACT] 实现范围不含代码或其他产品文件
  Test: bash -c 'BAD=$(git diff --name-only c04405fcfc1b5985b90273f52dbf0eee11b3888b...HEAD | awk '\''$0 !~ /^(docs\/current\/attempt-run-bridge-guide.md|sprints\/coding-harness-20260831194600-evwsr3\/(contract-draft.md|contract-dod.md|task-plan.json|tests\/attempt-run-bridge-guide.test.ts))$/ {print}'\''); [ -z "$BAD" ]'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 阅读者能在两个端点小节分别核对用途和鉴权边界
  动作: 依次阅读 POST 与 GET 两个独立小节
  预期观察: 每个小节均独立说明自身用途、internalAuthOrLoopback、loopback 例外及宿主/远端 Authorization Bearer 要求
  等待预算: 0s
  留证: Vitest 详细输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts -t "POST 端点独立说明提交用途与 internalAuthOrLoopback 鉴权边界|GET 端点独立说明按 id 查询用途与 internalAuthOrLoopback 鉴权边界"'

- [ ] [BEHAVIOR] [L1] B-02: 阅读者看到精确九项角色白名单
  动作: 阅读「角色白名单」章节并逐项核对
  预期观察: 列表精确等于九个权威角色，顺序一致，无增漏和别名
  等待预算: 0s
  留证: Vitest 精确数组比较输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts -t "角色白名单精确等于九个权威角色且无别名"'

- [ ] [BEHAVIOR] [L1] B-03: 阅读者能区分 payload 必填与可选字段
  动作: 阅读「payload 字段」章节并分别核对每个字段
  预期观察: `sprint_dir`、`base_repo`、`branch` 各自标为必填；`base_sha` 标为可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 每字段独立断言输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts -t "payload 独立断言三个必填字段与 base_sha 可选自解析语义"'

- [ ] [BEHAVIOR] [L1] B-04: 阅读者理解派发失败的三资源回滚终态
  动作: 阅读「派发失败自动回滚」章节
  预期观察: 同一章节明确显示 `run→failed`、`session→closed`、`task→cancelled`
  等待预算: 0s
  留证: Vitest 三项终态断言输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚精确覆盖 run session task 三个终态"'

- [ ] [BEHAVIOR] [L1] B-05: 阅读者看到中文主体且文档不泄露真实凭据
  动作: 阅读整页并检查正文语言及鉴权示例
  预期观察: 正文主体为简体中文；只出现 CECELIA_INTERNAL_TOKEN 变量名，不出现其他 Bearer 值、JWT 或 token 实值赋值
  等待预算: 0s
  留证: Vitest 中文比例与敏感模式拒绝断言输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts -t "正文主体为中文且只展示凭据变量名不含真实凭据"'

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] 从实现基线到 HEAD 的产品变更仅为目标文档，完整冻结测试全绿
  期望：`npx vitest run --no-cache sprints/coding-harness-20260831194600-evwsr3/tests/attempt-run-bridge-guide.test.ts` exit 0，且范围闸 exit 0。
