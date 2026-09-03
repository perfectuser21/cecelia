---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`，不改代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增一页简体中文 Markdown，标题为《attempt-run 桥接使用说明》
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const c=fs.readFileSync(p,'utf8');if(!c.includes('# attempt-run 桥接使用说明'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 两个端点用途与鉴权形成正负闭环
  动作: 读取说明中的“端点用途与鉴权”一节。
  预期观察: POST 被描述为创建/派发，GET 被描述为按 id 查询；远端必须带 Bearer token，且未宣称远端免鉴权。
  等待预算: 0s
  留证: Vitest 输出中的对应测试结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903150511-pk4hx0/tests/attempt-run-bridge-guide.test.ts -t "两个端点用途与鉴权形成正负闭环"'

- [ ] [BEHAVIOR] [L1] B-02: 九项角色白名单是封闭集合
  动作: 读取说明中的“角色白名单”列表。
  预期观察: 合法角色逐字等于冻结基线九项，少项、多项、别名以及 commander/publisher 均不被接受。
  等待预算: 0s
  留证: Vitest 输出中的集合差异
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903150511-pk4hx0/tests/attempt-run-bridge-guide.test.ts -t "九项角色白名单是封闭集合"'

- [ ] [BEHAVIOR] [L1] B-03: payload 必填集合与 base_sha 省略语义形成正负闭环
  动作: 读取说明中的“payload 字段”一节。
  预期观察: 必填集合仅为 sprint_dir/base_repo/branch，base_sha 明确可省略并由生产 Brain 自解析。
  等待预算: 0s
  留证: Vitest 输出中的对应测试结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903150511-pk4hx0/tests/attempt-run-bridge-guide.test.ts -t "payload 必填集合与 base_sha 省略语义形成正负闭环"'

- [ ] [BEHAVIOR] [L1] B-04: 派发失败回滚集合形成正负闭环
  动作: 读取说明中的“派发失败自动回滚”一节。
  预期观察: 只声明 run→failed、session→closed、task→cancelled 三条回滚结果，缺项或额外终态均失败。
  等待预算: 0s
  留证: Vitest 输出中的对应测试结果
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903150511-pk4hx0/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚集合形成正负闭环"'

- [ ] [BEHAVIOR] [L1] INV-1: Planner 分支铁律不被交付修改
  动作: 检查本 Sprint 不修改 Planner 分支规则或相关代码。
  预期观察: 交付范围 oracle 只得到目标文档。
  等待预算: 0s
  留证: git diff 文件列表
  Test: manual:bash -c 'BASE_SHA=4d5cb2fd86d97193e729a91e64efe2a44a4a0e52; SPRINT_DIR=sprints/coding-harness-20260903150511-pk4hx0; [ "$(git diff --name-only "$BASE_SHA"...HEAD -- . ":(exclude)$SPRINT_DIR/**")" = "docs/current/attempt-run-bridge-guide.md" ]'

- [ ] [BEHAVIOR] [L1] INV-2: 凭据只出现变量名而无硬编码值
  动作: 扫描目标文档的鉴权示例。
  预期观察: 文档包含 CECELIA_INTERNAL_TOKEN 变量名，且没有 JWT 或固定 Bearer 值。
  等待预算: 0s
  留证: 扫描命令退出码
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"docs/current/attempt-run-bridge-guide.md\",\"utf8\");if(!c.includes(\"CECELIA_INTERNAL_TOKEN\")||/Bearer\\s+(?!\\$?CECELIA_INTERNAL_TOKEN\\b)[A-Za-z0-9_.-]{16,}/.test(c))process.exit(1)"'

- [ ] [BEHAVIOR] [L1] INV-3: 两个端点鉴权均有明确说明
  动作: 执行端点与鉴权合同测试。
  预期观察: POST 和 GET 均与 internalAuthOrLoopback/Bearer 要求同节出现。
  等待预算: 0s
  留证: Vitest 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903150511-pk4hx0/tests/attempt-run-bridge-guide.test.ts -t "两个端点用途与鉴权形成正负闭环"'

- [ ] [BEHAVIOR] [L1] INV-4: 接口说明忠于冻结实现基线
  动作: 对照冻结 BASE_SHA 的服务端角色集合验证文档。
  预期观察: 文档角色集合逐字等于冻结基线九项，不接受别名或额外角色。
  等待预算: 0s
  留证: Vitest 集合断言输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260903150511-pk4hx0/tests/attempt-run-bridge-guide.test.ts -t "九项角色白名单是封闭集合"'
