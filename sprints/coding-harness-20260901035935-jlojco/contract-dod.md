---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge.md` 与本 Sprint 冻结合同/测试，不修改生产代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于 `docs/current/attempt-run-bridge.md`
  Test: node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge.md','utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

- [ ] [ARTIFACT] 相对 implementation baseline 只新增约定文档，不改任何代码
  Test: bash -c "git diff --name-only 46221f91778af50e1be078f1e542ec5c17360126...HEAD | grep -v '^sprints/coding-harness-20260901035935-jlojco/' | grep -qx 'docs/current/attempt-run-bridge.md'"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者能区分 POST 派发与 GET 轮询用途
  动作: 打开文档并阅读“端点用途”一节
  预期观察: 同时看到 POST 异步派发与 GET 按 attempt id 轮询结构化结果的说明
  等待预算: 0s
  留证: 文档解析命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'POST /api/brain/harness/attempt-run'"'"','"'"'GET /api/brain/harness/attempt-run/:id'"'"','"'"'异步派发'"'"','"'"'轮询'"'"'])if(!s.includes(x))throw Error(x)"'

- [ ] [BEHAVIOR] [L1] B-02: 读者能按位置使用 internalAuthOrLoopback 鉴权
  动作: 阅读“鉴权”一节并检查远端请求示例
  预期观察: 文档说明宿主/远端必须携带 Bearer CECELIA_INTERNAL_TOKEN
  等待预算: 0s
  留证: 文档解析命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'internalAuthOrLoopback'"'"','"'"'宿主'"'"','"'"'远端'"'"','"'"'Authorization: Bearer $CECELIA_INTERNAL_TOKEN'"'"'])if(!s.includes(x))throw Error(x)"'

- [ ] [BEHAVIOR] [L1] B-03: 读者能从封闭白名单选择九个角色
  动作: 阅读“角色白名单”一节
  预期观察: 九个生产角色逐项出现，且 commander/publisher 不被列为合法角色
  等待预算: 0s
  留证: 文档解析命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge.md'"'"','"'"'utf8'"'"');const roles=['"'"'canary'"'"','"'"'planner'"'"','"'"'proposer'"'"','"'"'reviewer'"'"','"'"'generator'"'"','"'"'generator-fix'"'"','"'"'evaluator'"'"','"'"'evaluator-evidence-repair'"'"','"'"'judge'"'"'];for(const x of roles)if(!s.includes(x))throw Error(x);if(/合法角色[^#]*(commander|publisher)/s.test(s))throw Error('"'"'出现非法角色'"'"')"'

- [ ] [BEHAVIOR] [L1] B-04: 读者能构造最小 payload
  动作: 阅读“payload”一节并核对字段要求
  预期观察: sprint_dir、base_repo、branch 标为必填；base_sha 标为可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: 文档解析命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'sprint_dir'"'"','"'"'base_repo'"'"','"'"'branch'"'"','"'"'base_sha'"'"','"'"'必填'"'"','"'"'可省略'"'"','"'"'生产 Brain'"'"','"'"'自解析'"'"'])if(!s.includes(x))throw Error(x)"'

- [ ] [BEHAVIOR] [L1] B-05: 读者能识别派发失败自动回滚终态
  动作: 阅读“派发失败自动回滚”一节
  预期观察: 明确看到 run → failed、session → closed、task → cancelled
  等待预算: 0s
  留证: 文档解析命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge.md'"'"','"'"'utf8'"'"').replace(/\\s/g,'"'"''"'"');for(const x of ['"'"'run→failed'"'"','"'"'session→closed'"'"','"'"'task→cancelled'"'"'])if(!s.includes(x))throw Error(x)"'

- [ ] [BEHAVIOR] [L1] B-06: 交付范围不修改代码
  动作: 对 implementation baseline 与候选 HEAD 做文件级差异检查
  预期观察: 唯一产品交付文件是 docs/current/attempt-run-bridge.md
  等待预算: 0s
  留证: git diff --name-only 输出
  Test: manual:bash -c 'git diff --name-only 46221f91778af50e1be078f1e542ec5c17360126...HEAD | grep -v '"'"'^sprints/coding-harness-20260901035935-jlojco/'"'"' | grep -qx '"'"'docs/current/attempt-run-bridge.md'"'"''

## 铁律映射

- N/A：bundle 未注入额外铁律清单；仓库 AGENTS.md 的分支、凭据与文档范围规则由 B-02、B-06 及 Git 流程约束覆盖。
