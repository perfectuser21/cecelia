---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档是冻结基线之外唯一非 sprint 交付物
  Test: node -e "const{execFileSync}=require('node:child_process');const b='bdaca81b5cbf78929fa3d8eeac2a24cae6113b98';const a=execFileSync('git',['diff','--name-only',b+'...HEAD'],{encoding:'utf8'}).trim().split('\\n').filter(Boolean).filter(x=>!x.startsWith('sprints/'));if(JSON.stringify(a)!==JSON.stringify(['docs/current/attempt-run-bridge-guide.md']))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 读者能区分创建与查询端点
  动作: 读取说明文档的端点章节。
  预期观察: POST 被说明为创建/派发，GET 被说明为查询/轮询。
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试结果。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "文档中文标题与两个端点用途完整" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-02: 读者能正确应用鉴权边界
  动作: 读取鉴权章节并区分 loopback 与宿主/远端。
  预期观察: 宿主/远端必须携带 Bearer CECELIA_INTERNAL_TOKEN，错误免鉴权表述被负向 oracle 拒绝。
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试结果。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "鉴权说明区分 loopback 与宿主远端" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-03: 角色白名单是恰好九项的封闭集合
  动作: 从角色章节现场提取反引号列表并计数、去重、比对全集。
  预期观察: 恰好九项且任何缺项、重复或额外角色均被拒绝。
  等待预算: 0s
  留证: Vitest verbose 输出中 length=9 与集合断言结果。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "角色白名单从文档提取后恰好九项封闭集合" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-04: payload 与冻结基线规则无歧义
  动作: 读取 payload 章节并核对三个必填字段、base_sha 省略与解析规则。
  预期观察: 生产 Brain 自解析 base_sha，且 workspace base_sha 不得替代跨角色不变的实现基线。
  等待预算: 0s
  留证: Vitest verbose 输出中正向及反向变体结果。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "payload 三个必填字段与 base_sha 生产解析及冻结基线规则完整" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-05: 派发失败的三个回滚终态完整
  动作: 读取失败回滚章节。
  预期观察: 同时看到 run→failed、session→closed、task→cancelled，遗漏和部分成功表述被拒绝。
  等待预算: 0s
  留证: Vitest verbose 输出中对应测试结果。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "派发失败自动回滚三个终态完整" --reporter=verbose'

- [ ] [BEHAVIOR] [L2] B-06: 唯一交付文件范围机械收敛
  动作: 相对冻结 SHA 计算 git diff，排除 sprints 后现场形成完整清单。
  预期观察: 清单恰好只有 docs/current/attempt-run-bridge-guide.md 且无代码扩展名。
  等待预算: 0s
  留证: Vitest verbose 输出与 git diff 文件清单。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-guide.test.ts -t "交付范围相对冻结基线排除 sprints 后恰好只有 docs current 一页说明且无代码" --reporter=verbose'

## Invariant 映射

- N/A：[规划分支] 本 Sprint 只新增文档，测试以只读方式检查 git，不改变 Provider 分支行为。
- N/A：[权威地址] 本 Sprint 不修改 Dispatcher、Fleet Worker 或 HARNESS_BRAIN_URL 预检。
