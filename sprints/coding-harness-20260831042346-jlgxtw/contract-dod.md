---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`；不修改任何代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `docs/current/attempt-run-bridge-guide.md` 存在且为中文 Markdown
  Test: node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者看到两个 attempt-run 端点的用途
  动作: 打开文档的“端点用途”一节
  预期观察: POST 被说明为异步派发角色 attempt，GET 被说明为按 attempt_id 轮询结构化结果
  等待预算: 0s
  留证: Vitest 输出中的端点断言结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831042346-jlgxtw/tests/attempt-run-bridge-guide.test.ts -t "文档覆盖端点、鉴权、九项角色、payload 与失败回滚"'

- [ ] [BEHAVIOR] [L1] B-02: 读者看到 internalAuthOrLoopback 鉴权规则
  动作: 打开文档的“鉴权方式”一节
  预期观察: 文档说明 loopback 边界，且宿主/远端示例带 Authorization Bearer CECELIA_INTERNAL_TOKEN
  等待预算: 0s
  留证: 文档测试的鉴权关键字断言输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'internalAuthOrLoopback'"'"','"'"'Authorization: Bearer'"'"','"'"'CECELIA_INTERNAL_TOKEN'"'"','"'"'loopback'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-03: 读者可从白名单选择九个合法角色
  动作: 打开文档的“角色白名单”一节并逐项核对
  预期观察: 九个角色逐字列出，不包含 commander
  等待预算: 0s
  留证: 角色集合断言命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');const r=['"'"'canary'"'"','"'"'planner'"'"','"'"'proposer'"'"','"'"'reviewer'"'"','"'"'generator'"'"','"'"'generator-fix'"'"','"'"'evaluator'"'"','"'"'evaluator-evidence-repair'"'"','"'"'judge'"'"'];if(!r.every(x=>s.includes(x)))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-04: 读者可填写 payload 必填字段并省略 base_sha
  动作: 打开文档的“payload 字段”一节并照示例构造请求
  预期观察: sprint_dir、base_repo、branch 标为必填，base_sha 标为可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: payload 字段断言命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'sprint_dir'"'"','"'"'base_repo'"'"','"'"'branch'"'"','"'"'base_sha'"'"','"'"'可省略'"'"','"'"'生产 Brain 自解析'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-05: 读者理解派发失败的自动回滚终态
  动作: 打开文档的“派发失败自动回滚”一节
  预期观察: 文档明确 run→failed、session→closed、task→cancelled
  等待预算: 0s
  留证: 回滚状态断言命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'run → failed'"'"','"'"'session → closed'"'"','"'"'task → cancelled'"'"'])if(!s.includes(x))process.exit(1)"'
