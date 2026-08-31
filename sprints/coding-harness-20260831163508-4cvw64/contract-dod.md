---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文文档，不修改代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档存在于 `docs/current/attempt-run-bridge-guide.md`
  Test: node -e "const fs=require('node:fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者可按文档识别两个端点与鉴权方式
  动作: 打开说明文档并阅读“端点与鉴权”一节
  预期观察: 同时看到 POST 派发、GET 轮询、internalAuthOrLoopback 与远端 Bearer token 规则
  等待预算: 0s
  留证: Vitest 输出中“说明两个端点与鉴权方式”用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831163508-4cvw64/tests/attempt-run-bridge-guide.test.ts -t "说明两个端点与鉴权方式"'

- [ ] [BEHAVIOR] [L1] B-02: 读者可取得完整九项角色白名单
  动作: 阅读文档“角色白名单”一节
  预期观察: 九项生产角色完整出现，且 commander 与 publisher 未被列为合法角色
  等待预算: 0s
  留证: Vitest 输出中“列出完整九项角色白名单”用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831163508-4cvw64/tests/attempt-run-bridge-guide.test.ts -t "列出完整九项角色白名单"'

- [ ] [BEHAVIOR] [L1] B-03: 读者可按文档填写 payload
  动作: 阅读文档“payload 字段”一节
  预期观察: sprint_dir、base_repo、branch 标为必填，base_sha 标为可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 输出中“说明 payload 必填字段与 base_sha 省略规则”用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831163508-4cvw64/tests/attempt-run-bridge-guide.test.ts -t "说明 payload 必填字段与 base_sha 省略规则"'

- [ ] [BEHAVIOR] [L1] B-04: 读者可识别派发失败后的回滚终态
  动作: 阅读文档“派发失败自动回滚”一节
  预期观察: run、session、task 分别落到 failed、closed、cancelled
  等待预算: 0s
  留证: Vitest 输出中“说明派发失败的三资源回滚状态”用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831163508-4cvw64/tests/attempt-run-bridge-guide.test.ts -t "说明派发失败的三资源回滚状态"'

## 铁律映射

- N/A：本 Sprint 只新增文档，不触及 Brain 版本、数据库、凭据文件、分支合并或生产代码。
