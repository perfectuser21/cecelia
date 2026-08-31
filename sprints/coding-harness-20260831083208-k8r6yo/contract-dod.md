---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — attempt-run 桥接使用说明文档

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文文档；不修改应用代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档位于 docs/current 固定路径
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const c=fs.readFileSync(p,'utf8');if(!/[\u4e00-\u9fff]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 实现产出无应用代码改动
  Test: bash -c 'set -o pipefail; BAD=$(git diff --name-only 5c12d2af68e2b2e4b8dcaaa2c87e50efab743291...HEAD -- . ":(exclude)sprints/coding-harness-20260831083208-k8r6yo/**" | awk '\''$0 != "docs/current/attempt-run-bridge-guide.md"'\''); [ -z "$BAD" ]'

## BEHAVIOR 条目（五行剧本）

- [ ] [BEHAVIOR] [L2] B-01: 读者可确认 POST/GET 用途与远端鉴权
  动作: 真读取目标文档并运行端点与鉴权冻结用例
  预期观察: 文档同时说明 POST 异步派发、GET 按 id 轮询、internalAuthOrLoopback，以及远端 Bearer token 写法
  等待预算: 0s
  留证: Vitest 指定用例输出（1 passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts -t "文档说明 POST 与 GET 端点用途和 internalAuthOrLoopback 鉴权" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-02: 读者可查到完整九角色白名单
  动作: 真读取目标文档并逐项校验九个角色字面值
  预期观察: canary 到 judge 九项全部存在，无“等”字省略
  等待预算: 0s
  留证: Vitest 指定用例输出（1 passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts -t "文档逐项列出九个角色白名单" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-03: 读者可构造 payload 并正确省略 base_sha
  动作: 真读取文档 payload 段，校验三个必填字段与基线省略语义
  预期观察: sprint_dir/base_repo/branch 同段出现，base_sha 明确可省略并由生产 Brain 自动解析
  等待预算: 0s
  留证: Vitest 指定用例输出（1 passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts -t "文档说明 payload 三个必填字段和 base_sha 省略语义" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-04: 读者可确认派发失败的三资源回滚终态
  动作: 真读取文档失败处理段并校验 run/session/task 三项终态
  预期观察: 文档明确 run→failed、session→closed、task→cancelled，且说明只回滚本次新建资源
  等待预算: 0s
  留证: Vitest 指定用例输出（1 passed）
  Test: manual:bash -c 'cd /workspace && npx vitest run sprints/coding-harness-20260831083208-k8r6yo/tests/attempt-run-bridge-doc.test.ts -t "文档说明派发失败自动回滚 run session task" --no-cache --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-05: 交付范围不包含任何应用代码
  动作: 对冻结实现基线与候选 HEAD 执行路径级 diff，并排除本 Sprint 冻结合同产物
  预期观察: 实现产出差异只有 docs/current/attempt-run-bridge-guide.md
  等待预算: 0s
  留证: git diff 路径检查退出码 0；异常时输出范围外路径
  Test: manual:bash -c 'set -o pipefail; cd /workspace && BAD=$(git diff --name-only 5c12d2af68e2b2e4b8dcaaa2c87e50efab743291...HEAD -- . ":(exclude)sprints/coding-harness-20260831083208-k8r6yo/**" | awk '\''$0 != "docs/current/attempt-run-bridge-guide.md"'\''); [ -z "$BAD" ] || { echo "$BAD"; exit 1; }'

## 铁律映射

- [ ] INV-1 输出语言为简体中文：由 ARTIFACT 中文字符检查与文档人工审阅验证。
- [ ] INV-2 不修改 Brain 代码：由 B-05 相对冻结基线的路径集合检查验证。
- [ ] INV-3 不提交凭据：文档仅使用环境变量占位 `$CECELIA_INTERNAL_TOKEN`，不出现真实 token。
