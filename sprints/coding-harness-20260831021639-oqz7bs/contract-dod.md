---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于 `docs/current/attempt-run-bridge-guide.md`
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 读者可识别两个端点用途与鉴权
  动作: 打开桥接使用说明并阅读“端点与鉴权”章节
  预期观察: POST 被说明为派发，GET 被说明为按 attempt id 轮询，远端请求带 Bearer token
  等待预算: 0s
  留证: Vitest 输出中 `说明两个端点用途与鉴权` 通过
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-guide.test.ts -t "说明两个端点用途与鉴权"'

- [ ] [BEHAVIOR] [L1] B-02: 读者可查到完整九项角色白名单
  动作: 打开说明文档并阅读“角色白名单”章节
  预期观察: 九个生产允许角色逐项出现且没有用省略号代替
  等待预算: 0s
  留证: Vitest 输出中 `列出九项角色白名单` 通过
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-guide.test.ts -t "列出九项角色白名单"'

- [ ] [BEHAVIOR] [L1] B-03: 读者可构造符合约束的 payload
  动作: 按说明文档核对 payload 字段
  预期观察: sprint_dir、base_repo、branch 标为必填，base_sha 标为可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 输出中 `说明 payload 必填字段与 base_sha 省略语义` 通过
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-guide.test.ts -t "说明 payload 必填字段与 base_sha 省略语义"'

- [ ] [BEHAVIOR] [L1] B-04: 读者可判断派发失败后的资源终态
  动作: 打开说明文档并阅读“派发失败自动回滚”章节
  预期观察: run、session、task 分别对应 failed、closed、cancelled
  等待预算: 0s
  留证: Vitest 输出中 `说明派发失败的三项自动回滚` 通过
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-guide.test.ts -t "说明派发失败的三项自动回滚"'

## Invariant 映射

- N/A：任务未注入额外铁律清单；仓库硬规则由“不改代码、只新增中文文档”范围条目覆盖。
