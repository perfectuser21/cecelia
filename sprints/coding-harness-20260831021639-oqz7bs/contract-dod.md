---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文文档及 Sprint 冻结测试，不改代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于 `docs/current/attempt-run-bridge-guide.md`
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

- [ ] [ARTIFACT] Sprint 冻结测试已提交
  Test: node -e "require('fs').accessSync('sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-guide.test.ts')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 覆盖两个端点的用途与鉴权方式
  动作: 读取 attempt-run 桥接说明的端点与鉴权章节
  预期观察: POST/GET 用途、internalAuthOrLoopback 及宿主/远端 Bearer 要求均清晰可见
  等待预算: 0s
  留证: Vitest verbose 输出中的 B-01 用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-guide.test.ts -t "覆盖两个端点的用途与鉴权方式" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-02: 完整列出九项角色白名单
  动作: 读取说明中的角色白名单章节
  预期观察: 九个生产角色逐字出现且数量恰好为九
  等待预算: 0s
  留证: Vitest verbose 输出中的 B-02 用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-guide.test.ts -t "完整列出九项角色白名单" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-03: 说明 payload 必填字段与 base_sha 省略语义
  动作: 读取请求 payload 章节
  预期观察: sprint_dir、base_repo、branch 标为必填，base_sha 标为可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest verbose 输出中的 B-03 用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-guide.test.ts -t "说明 payload 必填字段与 base_sha 省略语义" --reporter=verbose'

- [ ] [BEHAVIOR] [L1] B-04: 说明派发失败自动回滚的三个终态
  动作: 读取派发失败章节
  预期观察: 派发抛错或未 LAUNCHED 时显示 run→failed、session→closed、task→cancelled
  等待预算: 0s
  留证: Vitest verbose 输出中的 B-04 用例结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260831021639-oqz7bs/tests/attempt-run-bridge-guide.test.ts -t "说明派发失败自动回滚的三个终态" --reporter=verbose'

## 历史铁律映射

- N/A：bundle 未注入额外铁律清单；仓库 AGENTS.md 规则由变更范围与 E2E 基线差异检查守护。
