---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge.md`，不修改代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于 `docs/current/attempt-run-bridge.md`
  Test: node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge.md','utf8');if(!/[\u4e00-\u9fff]/u.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者能找到两个端点及鉴权方式
  动作: 打开文档并阅读“端点与鉴权”章节
  预期观察: POST/GET 用途、internalAuthOrLoopback 与远端 Bearer token 要求均明确
  等待预算: 0s
  留证: Test 命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'POST /api/brain/harness/attempt-run'"'"','"'"'GET /api/brain/harness/attempt-run/:id'"'"','"'"'internalAuthOrLoopback'"'"','"'"'Authorization: Bearer'"'"','"'"'CECELIA_INTERNAL_TOKEN'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-02: 读者能完整选择九项角色白名单
  动作: 阅读“角色白名单”章节并逐项核对
  预期观察: 九个生产角色逐字列出且总数为九项
  等待预算: 0s
  留证: Test 命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'canary'"'"','"'"'planner'"'"','"'"'proposer'"'"','"'"'reviewer'"'"','"'"'generator'"'"','"'"'generator-fix'"'"','"'"'evaluator'"'"','"'"'evaluator-evidence-repair'"'"','"'"'judge'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-03: 读者能组装最小 payload
  动作: 阅读“请求 payload”章节
  预期观察: sprint_dir、base_repo、branch 标为必填，base_sha 标为可省略并由生产 Brain 解析
  等待预算: 0s
  留证: Test 命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'sprint_dir'"'"','"'"'base_repo'"'"','"'"'branch'"'"','"'"'base_sha'"'"','"'"'可省略'"'"','"'"'生产 Brain'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-04: 读者能判断派发失败后的资源终态
  动作: 阅读“派发失败自动回滚”章节
  预期观察: run、session、task 分别回滚为 failed、closed、cancelled
  等待预算: 0s
  留证: Test 命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'run → failed'"'"','"'"'session → closed'"'"','"'"'task → cancelled'"'"'])if(!s.includes(x))process.exit(1)"'
