---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明文档

**范围**: 实现仅新增 `docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md`；不修改代码、配置或既有文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于 docs/current/
  Test: node -e "const fs=require('fs');const p='docs/current/ATTEMPT_RUN_BRIDGE_GUIDE.md';const s=fs.readFileSync(p,'utf8');if(!/[\u4e00-\u9fff]/.test(s))process.exit(1)"

## BEHAVIOR 条目（五行剧本）

- [ ] [BEHAVIOR] [L1] B-01: 说明 POST 与 GET 两个端点用途
  动作: 打开 attempt-run 桥接使用说明并阅读端点章节
  预期观察: 同时看到 POST 异步派发用途和 GET 按 attempt id 轮询结构化结果用途
  等待预算: 0s
  留证: Vitest 输出中对应测试为 passed
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts -t "说明 POST 与 GET 两个端点用途" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L1] B-02: 说明 internalAuthOrLoopback 与远端 Bearer 鉴权
  动作: 阅读鉴权章节，区分回环与宿主/远端调用
  预期观察: 文档明确宿主或远端必须发送 Bearer CECELIA_INTERNAL_TOKEN
  等待预算: 0s
  留证: Vitest 输出中对应测试为 passed
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts -t "说明 internalAuthOrLoopback 与远端 Bearer 鉴权" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L1] B-03: 完整列出九项角色白名单
  动作: 阅读角色白名单章节并逐项核对现有路由
  预期观察: 九个允许角色各出现且无遗漏
  等待预算: 0s
  留证: Vitest 输出中对应测试为 passed
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts -t "完整列出九项角色白名单" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L1] B-04: 说明 payload 必填字段与 base_sha 省略语义
  动作: 按文档准备 POST payload
  预期观察: sprint_dir、base_repo、branch 标为必填，base_sha 标为可省略且由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 输出中对应测试为 passed
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts -t "说明 payload 必填字段与 base_sha 省略语义" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L1] B-05: 说明派发失败自动回滚三类终态
  动作: 阅读失败处理章节
  预期观察: 文档明确 run→failed、session→closed、task→cancelled
  等待预算: 0s
  留证: Vitest 输出中对应测试为 passed
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-guide.test.ts -t "说明派发失败自动回滚三类终态" --no-cache --reporter=dot'

## 铁律映射

- 语言铁律：全部交付说明为简体中文；由 ARTIFACT 与冻结测试验证。
- 分支铁律：仅在 `cp-harness-propose-r1-1d9e4552-r554edd60-a1` 起草合同，不操作 main。
- 文档任务范围铁律：实现只改 `docs/current/`；由 E2E 基线 diff 断言验证。
- 其余代码、Brain DevGate、数据库、凭据与真机铁律：N/A，本 sprint 不触及对应模块或资源。

