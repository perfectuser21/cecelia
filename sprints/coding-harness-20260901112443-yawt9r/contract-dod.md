---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文说明；不改代码、配置或既有文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 唯一产品交付物为中文说明页
  Test: bash -c 'test "$(git diff --name-only d4ae8c6d2b777f5762c4cd88a8e8d56004c66750 -- docs/current | sort)" = "docs/current/attempt-run-bridge-guide.md" && node -e "const s=require(\"fs\").readFileSync(\"docs/current/attempt-run-bridge-guide.md\",\"utf8\");if(!/[\\u4e00-\\u9fff]/.test(s))process.exit(1)"'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 两个端点用途与鉴权说明完整
  动作: 读者打开说明页，查看创建、查询与鉴权章节。
  预期观察: POST 明确用于创建并派发，GET 明确用于按 id 查询；宿主/远端 Bearer 要求清晰且无真实 token。
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试 PASS。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "两个端点用途与 internalAuthOrLoopback 鉴权说明完整" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: 九项角色白名单逐项列全
  动作: 读者查看角色白名单章节并逐项核对可派发角色。
  预期观察: planner、proposer、critic、generator、generator-fix、evaluator、evaluator-fix、judge、reporter 九项全部出现。
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试 PASS。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "九项角色白名单逐项列全且无缺项" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-03: payload 必填与 base_sha 省略语义正确
  动作: 读者查看 payload 章节并据此准备创建请求。
  预期观察: sprint_dir、base_repo、branch 明确必填；base_sha 明确可省略并由生产 Brain 自解析。
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试 PASS。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "payload 必填字段与 base_sha 可省略语义完整" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: 派发失败三对象回滚状态完整
  动作: 读者查看派发失败章节并核对 run、session、task 的最终状态。
  预期观察: 同时看到 run→failed、session→closed、task→cancelled，不存在部分回滚说明。
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试 PASS。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "派发失败自动回滚三对象最终状态完整" --reporter=verbose'

## Invariant 覆盖

- [ ] [BEHAVIOR] [L2] INV-1: 凭据安全与环境值不硬编码
  动作: 扫描新增说明中的 Bearer 示例。
  预期观察: 只出现环境变量占位符，不出现疑似真实 token。
  等待预算: 0s
  留证: 扫描命令 exit code=0。
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"docs/current/attempt-run-bridge-guide.md\",\"utf8\");if(!s.includes(\"Authorization: Bearer \\$CECELIA_INTERNAL_TOKEN\")||/Bearer\\s+(?!\\$CECELIA_INTERNAL_TOKEN)[A-Za-z0-9_-]{16,}/.test(s))process.exit(1)"'

- [ ] [BEHAVIOR] [L2] INV-2: 端点鉴权未被文档弱化
  动作: 执行 B-01 冻结测试核对 internalAuthOrLoopback 与宿主/远端 Bearer 要求。
  预期观察: 两端点的鉴权要求均有明确说明。
  等待预算: 0s
  留证: Vitest verbose 输出中 B-01 PASS。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260901112443-yawt9r/tests/attempt-run-bridge-guide.test.ts -t "两个端点用途与 internalAuthOrLoopback 鉴权说明完整" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] INV-3: 唯一产品变更且无代码修改
  动作: 将候选提交与冻结实现基线比较。
  预期观察: docs/current 只新增目标页，packages/apps/scripts 下无代码文件变化。
  等待预算: 0s
  留证: git diff 文件清单命令 exit code=0。
  Test: manual:bash -c 'test "$(git diff --name-only d4ae8c6d2b777f5762c4cd88a8e8d56004c66750 -- docs/current | sort)" = "docs/current/attempt-run-bridge-guide.md"; test -z "$(git diff --name-only d4ae8c6d2b777f5762c4cd88a8e8d56004c66750 -- packages apps scripts -- "*.js" "*.ts" "*.tsx" "*.cjs" "*.mjs")"'

- [ ] [BEHAVIOR] [L2] INV-4: Planner 分支规则不受影响
  动作: 检查候选产品 diff 是否触及 Planner 或 Brain 实现。
  预期观察: packages/brain 与分支签发逻辑均无变更。
  等待预算: 0s
  留证: git diff 文件清单为空。
  Test: manual:bash -c 'test -z "$(git diff --name-only d4ae8c6d2b777f5762c4cd88a8e8d56004c66750 -- packages/brain)"'
