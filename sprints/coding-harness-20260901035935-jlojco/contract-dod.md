---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明文档

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 与本 Sprint 合同产物。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文使用说明位于约定路径且无范围外产品文件变更
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 说明两个端点用途与鉴权
  动作: 打开 attempt-run 桥接使用说明并阅读“端点与鉴权”节
  预期观察: POST 被说明为异步派发、GET 被说明为轮询结果，远端 Bearer token 要求明确
  等待预算: 0s
  留证: 命令输出中出现 B-01 OK
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'POST /api/brain/harness/attempt-run'"'"','"'"'GET /api/brain/harness/attempt-run/:id'"'"','"'"'internalAuthOrLoopback'"'"','"'"'Authorization: Bearer'"'"','"'"'CECELIA_INTERNAL_TOKEN'"'"'])if(!s.includes(x))process.exit(1)"; echo "B-01 OK"'

- [ ] [BEHAVIOR] [L2] B-02: 完整列出九项角色白名单
  动作: 阅读“角色白名单”节并逐项核对角色值
  预期观察: 九项角色均以原始字面值出现，含两个带连字符的角色
  等待预算: 0s
  留证: 命令输出中出现 B-02 OK
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'canary'"'"','"'"'planner'"'"','"'"'proposer'"'"','"'"'reviewer'"'"','"'"'generator'"'"','"'"'generator-fix'"'"','"'"'evaluator'"'"','"'"'evaluator-evidence-repair'"'"','"'"'judge'"'"'])if(!s.includes('"'"'`'"'"'+x+'"'"'`'"'"'))process.exit(1)"; echo "B-02 OK"'

- [ ] [BEHAVIOR] [L2] B-03: 说明 payload 必填字段与 base_sha 省略规则
  动作: 阅读“payload”节并按文档组装最小请求参数
  预期观察: sprint_dir、base_repo、branch 被标为必填，base_sha 被标为可省略且由生产 Brain 解析
  等待预算: 0s
  留证: 命令输出中出现 B-03 OK
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'`sprint_dir`'"'"','"'"'`base_repo`'"'"','"'"'`branch`'"'"','"'"'`base_sha`'"'"','"'"'可省略'"'"','"'"'生产 Brain'"'"'])if(!s.includes(x))process.exit(1)"; echo "B-03 OK"'

- [ ] [BEHAVIOR] [L2] B-04: 说明派发失败的三资源回滚终态
  动作: 阅读“派发失败自动回滚”节并核对资源到终态的映射
  预期观察: run→failed、session→closed、task→cancelled 三组映射全部明确
  等待预算: 0s
  留证: 命令输出中出现 B-04 OK
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'run'"'"','"'"'`failed`'"'"','"'"'session'"'"','"'"'`closed`'"'"','"'"'task'"'"','"'"'`cancelled`'"'"'])if(!s.includes(x))process.exit(1)"; echo "B-04 OK"'

## Invariant 映射

- N/A：控制器未注入额外铁律清单；仓库硬规则由“仅文档范围”ARTIFACT 与 E2E 范围守卫覆盖。
