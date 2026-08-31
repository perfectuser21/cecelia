---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于约定路径，且本 Sprint 不修改应用代码
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者能确认两个端点用途与鉴权说明完整
  动作: 打开 attempt-run 桥接说明，阅读“端点用途”和“鉴权方式”两节
  预期观察: 文档说明 POST 异步派发、GET 轮询结果，并要求宿主或远端携带 Bearer 内部 token
  等待预算: 0s
  留证: 文档解析命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'POST /api/brain/harness/attempt-run'"'"','"'"'GET /api/brain/harness/attempt-run/:id'"'"','"'"'internalAuthOrLoopback'"'"','"'"'Authorization: Bearer $CECELIA_INTERNAL_TOKEN'"'"','"'"'宿主'"'"','"'"'远端'"'"'])if(!s.includes(x))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-02: 读者能取得九项角色白名单
  动作: 阅读“角色白名单”一节并逐项核对角色名
  预期观察: 九项允许角色全部出现，且 commander 和 publisher 不被列为允许角色
  等待预算: 0s
  留证: 角色清单解析命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'canary'"'"','"'"'planner'"'"','"'"'proposer'"'"','"'"'reviewer'"'"','"'"'generator'"'"','"'"'generator-fix'"'"','"'"'evaluator'"'"','"'"'evaluator-evidence-repair'"'"','"'"'judge'"'"'])if(!s.includes(x))process.exit(1);if(/允许角色[^#]*(commander|publisher)/s.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-03: 读者能构造符合 payload 约束的请求
  动作: 阅读“payload 字段”一节，核对三个必填字段和 base_sha 规则
  预期观察: sprint_dir、base_repo、branch 标为必填；base_sha 标为可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: payload 语义解析命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'payload.sprint_dir'"'"','"'"'payload.base_repo'"'"','"'"'payload.branch'"'"','"'"'payload.base_sha'"'"'])if(!s.includes(x))process.exit(1);if(!/base_sha[\\s\\S]{0,80}可省略[\\s\\S]{0,80}生产 Brain/.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] B-04: 读者能确认派发失败自动回滚映射
  动作: 阅读“派发失败自动回滚”一节，核对三个资源终态
  预期观察: 文档逐项说明 run→failed、session→closed、task→cancelled
  等待预算: 0s
  留证: 回滚映射解析命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');if(!/run[^\\n]*failed/.test(s)||!/session[^\\n]*closed/.test(s)||!/task[^\\n]*cancelled/.test(s))process.exit(1)"'

## 铁律映射

- N/A：任务输入未提供额外铁律清单；“仅文档、不修改应用代码”由 E2E 变更范围断言执行。
