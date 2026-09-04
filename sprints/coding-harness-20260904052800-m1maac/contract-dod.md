---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档存在且含中文
  Test: node -e 'const s=require("fs").readFileSync("docs/current/attempt-run-bridge-guide.md","utf8");if(!/[\u3400-\u9fff]/u.test(s))process.exit(1)'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 调用方看到两个正确端点及用途
  动作: 读取说明文档的端点章节
  预期观察: POST 创建并派发、GET 按 id 查询，错误复数端点不存在
  等待预算: 0s
  留证: Vitest verbose 输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904052800-m1maac/tests/attempt-run-bridge-guide.test.ts -t "中文文档包含两个端点用途，且错误端点不能通过"'

- [ ] [BEHAVIOR] [L1] B-02: 调用方看到 loopback 与宿主远端鉴权边界
  动作: 读取说明文档的鉴权章节
  预期观察: internalAuthOrLoopback 与 Bearer CECELIA_INTERNAL_TOKEN 均出现，远端免鉴权表述不存在
  等待预算: 0s
  留证: Vitest verbose 输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904052800-m1maac/tests/attempt-run-bridge-guide.test.ts -t "鉴权区分 loopback 与宿主远端，且远端免鉴权不能通过"'

- [ ] [BEHAVIOR] [L1] B-03: 调用方看到生产角色白名单恰好九项
  动作: 读取角色白名单并逐项核对
  预期观察: 九个生产角色全在且顺序一致，额外角色不存在
  等待预算: 0s
  留证: Vitest verbose 输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904052800-m1maac/tests/attempt-run-bridge-guide.test.ts -t "角色白名单逐项列出且恰好九项，增删角色不能通过"'

- [ ] [BEHAVIOR] [L1] B-04: 调用方看到 payload 三项必填与 base_sha 可选语义
  动作: 读取 payload 章节并逐项核对
  预期观察: 必填集合恰好为 sprint_dir、base_repo、branch，base_sha 可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest verbose 输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904052800-m1maac/tests/attempt-run-bridge-guide.test.ts -t "payload 必填项逐项列出且恰好三项，base_sha 列为可省略"'

- [ ] [BEHAVIOR] [L1] B-05: 调用方看到派发失败三个回滚终态
  动作: 读取失败回滚章节并逐项核对
  预期观察: run→failed、session→closed、task→cancelled 恰好三项，错态不存在
  等待预算: 0s
  留证: Vitest verbose 输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904052800-m1maac/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚逐项列出且恰好三个终态，缺项或错态不能通过"'

- [ ] [BEHAVIOR] [L1] B-06: 最终变更范围只有单一说明文档
  动作: 相对冻结实现基线读取 Git 变更并过滤 sprint 合同产物
  预期观察: 非 sprint 变更集合恰好为 docs/current/attempt-run-bridge-guide.md
  等待预算: 0s
  留证: git diff 文件清单
  Test: manual:bash -c 'BASE_SHA=84f46709f6cf797939f6ee55b6ef790f07d3e0ef; allowed='"'"'docs/current/attempt-run-bridge-guide.md'"'"'; actual=$(git diff --name-only "$BASE_SHA"...HEAD | grep -v '"'"'^sprints/'"'"' | sort); expected=$(printf '"'"'%s\n'"'"' "$allowed" | sort); test "$actual" = "$expected"'

## Invariant 映射

- [ ] [BEHAVIOR] [L1] INV-1 端点鉴权铁律：说明不得把宿主或远端写成免鉴权
  动作: 执行鉴权正反向冻结测试
  预期观察: 正确鉴权出现，免鉴权措辞不存在
  等待预算: 0s
  留证: Vitest 输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904052800-m1maac/tests/attempt-run-bridge-guide.test.ts -t "鉴权区分 loopback 与宿主远端，且远端免鉴权不能通过"'

- [ ] [BEHAVIOR] [L1] INV-2 Brain URL 权威铁律：N/A，本 Sprint 不修改 URL、Dispatcher、Fleet Worker 或预检逻辑
  动作: 核对最终 Git 范围
  预期观察: 非 sprint 变更仅为说明文档，无运行时代码
  等待预算: 0s
  留证: git diff 文件清单
  Test: manual:bash -c 'BASE_SHA=84f46709f6cf797939f6ee55b6ef790f07d3e0ef; actual=$(git diff --name-only "$BASE_SHA"...HEAD | grep -v '"'"'^sprints/'"'"' | sort); test "$actual" = '"'"'docs/current/attempt-run-bridge-guide.md'"'"''

- [ ] [BEHAVIOR] [L1] INV-3 环境路由铁律：N/A，本 Sprint 不修改 target_environment 的生成或读取
  动作: 核对最终 Git 范围
  预期观察: 非 sprint 变更仅为说明文档，无路由代码
  等待预算: 0s
  留证: git diff 文件清单
  Test: manual:bash -c 'BASE_SHA=84f46709f6cf797939f6ee55b6ef790f07d3e0ef; actual=$(git diff --name-only "$BASE_SHA"...HEAD | grep -v '"'"'^sprints/'"'"' | sort); test "$actual" = '"'"'docs/current/attempt-run-bridge-guide.md'"'"''
