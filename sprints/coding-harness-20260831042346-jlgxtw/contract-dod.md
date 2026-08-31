---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`，不修改实现代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于指定路径并包含四个二级章节
  Test: node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');for(const h of ['## 端点用途与鉴权','## 角色白名单','## payload 字段','## 派发失败自动回滚'])if(!s.includes(h))throw new Error('缺少 '+h);if(!/[\u4e00-\u9fff]/.test(s))throw new Error('缺中文')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 读者能按说明识别两个端点用途与远端 Bearer 鉴权
  动作: 打开说明页并阅读「端点用途与鉴权」一节
  预期观察: 页面同时说明 POST 异步派发、GET 轮询结果，以及宿主/远端 Bearer token 要求
  等待预算: 0s
  留证: 文档内容断言命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'POST /api/brain/harness/attempt-run'"'"','"'"'GET /api/brain/harness/attempt-run/:id'"'"','"'"'internalAuthOrLoopback'"'"','"'"'Bearer'"'"','"'"'CECELIA_INTERNAL_TOKEN'"'"'])if(!s.includes(x))throw new Error('"'"'缺少 '"'"'+x)"'

- [ ] [BEHAVIOR] [L2] B-02: 读者能从说明取得完整的九项角色白名单
  动作: 打开说明页并阅读「角色白名单」一节
  预期观察: 九个生产允许角色逐项可见，且说明白名单外角色会被拒绝
  等待预算: 0s
  留证: 九项角色逐字断言命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const r of ['"'"'canary'"'"','"'"'planner'"'"','"'"'proposer'"'"','"'"'reviewer'"'"','"'"'generator'"'"','"'"'generator-fix'"'"','"'"'evaluator'"'"','"'"'evaluator-evidence-repair'"'"','"'"'judge'"'"'])if(!s.includes('"'"'`'"'"'+r+'"'"'`'"'"'))throw new Error('"'"'缺少角色 '"'"'+r)"'

- [ ] [BEHAVIOR] [L2] B-03: 读者能区分三个 payload 必填字段与可省略 base_sha
  动作: 打开说明页并阅读「payload 字段」一节
  预期观察: sprint_dir、base_repo、branch 标为必填，base_sha 明确可省略并由生产 Brain 解析
  等待预算: 0s
  留证: 字段与反向误导断言命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'sprint_dir'"'"','"'"'base_repo'"'"','"'"'branch'"'"','"'"'base_sha'"'"','"'"'可省略'"'"','"'"'生产 Brain'"'"'])if(!s.includes(x))throw new Error('"'"'缺少 '"'"'+x);if(/base_sha[^\\n]{0,20}(必须|必填)/.test(s))throw new Error('"'"'base_sha 被误写为必填'"'"')"'

- [ ] [BEHAVIOR] [L2] B-04: 读者能识别派发失败的三个资源回滚终态
  动作: 打开说明页并阅读「派发失败自动回滚」一节
  预期观察: 页面说明派发抛错或未 LAUNCHED 时 run、session、task 分别进入 failed、closed、cancelled
  等待预算: 0s
  留证: 回滚终态断言命令输出
  Test: manual:bash -c 'node -e "const s=require('"'"'fs'"'"').readFileSync('"'"'docs/current/attempt-run-bridge-guide.md'"'"','"'"'utf8'"'"');for(const x of ['"'"'run → failed'"'"','"'"'session → closed'"'"','"'"'task → cancelled'"'"','"'"'LAUNCHED'"'"'])if(!s.includes(x))throw new Error('"'"'缺少回滚语义 '"'"'+x)"'

## 铁律映射

- 语言铁律：B-01 至 B-04 与 ARTIFACT 断言要求目标说明页为中文。
- 分支与提交铁律：实现必须在 feature/cp 分支经 PR 合入，不允许直接推 main。
- Brain DevGate：N/A，本 Sprint 禁止修改 `packages/brain`。
- Bug failing test：N/A，本任务是新增文档而非 bug 修复；冻结测试在实现前仍为 RED。
- 凭据铁律：文档仅引用环境变量名，不写入 token 字面值。
- 其余仓库硬规则：N/A，不涉及其约束模块或操作。

