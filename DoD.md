contract_branch: cp-harness-propose-r2-15338469-re2a90fce-a12
sprint_dir: sprints/08230906-kernel-15338469

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: capability preflight failed_targets 时效窗口豁免（记仇不跨修复期）

**范围**: `packages/brain/src/orchestrator/attempt-store.js` 的 `listFailedExecutionTargets` 增加基于 `created_at` 的时效窗口 WHERE 过滤 + 读 `HARNESS_FAILED_TARGET_TTL_HOURS`（默认 2h）；同步更新 repo 既有断言含第三参数。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] 冻结 sprint 测试文件存在且含 created_at make_interval 窗口断言
  Test: node -e "const c=require('fs').readFileSync('sprints/08230906-kernel-15338469/tests/failed-target-ttl.test.ts','utf8');if(!c.includes('make_interval')||!c.includes('HARNESS_FAILED_TARGET_TTL_HOURS'))process.exit(1)"
  期望: exit 0

- [x] [ARTIFACT] attempt-store.js 读取 HARNESS_FAILED_TARGET_TTL_HOURS 且 SQL 含 created_at 时效窗口
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/attempt-store.js','utf8');if(!c.includes('HARNESS_FAILED_TARGET_TTL_HOURS')||!/created_at\s*>=\s*NOW\(\)\s*-\s*make_interval/.test(c))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（内嵌可执行 manual: 命令；autonomous / local_api）

- [x] [BEHAVIOR] [L1] B-01: 默认 2 小时窗口 SQL 用 created_at make_interval 过滤且第三参数为 2
  动作: 不设 HARNESS_FAILED_TARGET_TTL_HOURS，调 listFailedExecutionTargets 并断言发往 pool.query 的 SQL 与绑定参数
  预期观察: SQL 含 `created_at >= NOW() - make_interval(hours => $3)`，params 为 `[runId, role, 2]`（对应冻结测试通过）
  等待预算: 0s
  留证: 命令输出末行（含 passed 计数）
  Test: manual:bash -c 'npx vitest run sprints/08230906-kernel-15338469/tests/failed-target-ttl.test.ts -t "默认 2 小时窗口经 created_at make_interval 过滤且第三参数为 2" 2>&1'

- [x] [BEHAVIOR] [L1] B-02: HARNESS_FAILED_TARGET_TTL_HOURS 覆盖窗口小时数进第三参数
  动作: 设 HARNESS_FAILED_TARGET_TTL_HOURS=5，调 listFailedExecutionTargets 并断言第三绑定参数
  预期观察: params 第三项为 5（env 覆盖生效）
  等待预算: 0s
  留证: 命令输出末行（含 passed 计数）
  Test: manual:bash -c 'npx vitest run sprints/08230906-kernel-15338469/tests/failed-target-ttl.test.ts -t "覆盖窗口小时数进第三参数" 2>&1'

- [x] [BEHAVIOR] [L1] B-03: 非法 HARNESS_FAILED_TARGET_TTL_HOURS 回退默认 2 小时
  动作: 设 HARNESS_FAILED_TARGET_TTL_HOURS=not-a-number，调 listFailedExecutionTargets 并断言第三绑定参数
  预期观察: params 第三项回退为 2（非法值不破坏 preflight）
  等待预算: 0s
  留证: 命令输出末行（含 passed 计数）
  Test: manual:bash -c 'npx vitest run sprints/08230906-kernel-15338469/tests/failed-target-ttl.test.ts -t "回退默认 2 小时" 2>&1'

- [x] [BEHAVIOR] [L1] B-04: 窗口边界采用窗口内含语义使用大于等于比较
  动作: 调 listFailedExecutionTargets 并断言 SQL 用 `>=` 而非 `>` 比较 created_at
  预期观察: SQL 含 `created_at >=`，不含 `created_at > NOW`（窗口内含）
  等待预算: 0s
  留证: 命令输出末行（含 passed 计数）
  Test: manual:bash -c 'npx vitest run sprints/08230906-kernel-15338469/tests/failed-target-ttl.test.ts -t "窗口内含语义使用大于等于比较" 2>&1'

- [x] [BEHAVIOR] [L1] INV-1 B-05: 窗口内失败记录仍映射为执行目标保持记仇语义不变（负向不变量）
  动作: mock pool 返回一条窗口内失败行，调 listFailedExecutionTargets 断言返回映射
  预期观察: 返回 `[{provider,account,machine}]` 逐字映射，记仇语义不变（连续新鲜失败仍计入）
  等待预算: 0s
  留证: 命令输出末行（含 passed 计数）
  Test: manual:bash -c 'npx vitest run sprints/08230906-kernel-15338469/tests/failed-target-ttl.test.ts -t "记仇语义不变" 2>&1'

- [x] [BEHAVIOR] [L1] INV-1 B-06: repo 既有终态失败执行目标 SQL 分支不回退（含更新后第三参数）
  动作: 在 packages/brain 包内跑 repo 既有 attempt-store 断言（status/error_code 豁免分支 + 更新后第三参数 2）
  预期观察: 既有 SQL 分支（failed/cancelled、blocked+infrastructure_blocked、error_code NOT IN 豁免）不变，params 更新为含第三参数
  等待预算: 0s
  留证: 命令输出末行（含 passed 计数）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/attempt-store.test.js -t "终态失败执行目标" 2>&1'

- [x] [BEHAVIOR] [L1] B-07: repo 路径回归——时效窗口默认 2h 且 env 覆盖进 SQL 第三参数
  动作: 在 packages/brain 包内跑 repo 新增 TTL 回归断言（默认 2 与 env=5 两分支）
  预期观察: 默认无 env → 第三参数 2 且 SQL 含 created_at make_interval；env=5 → 第三参数 5
  等待预算: 0s
  留证: 命令输出末行（含 passed 计数）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/attempt-store.test.js -t "覆盖进 SQL 第三参数" 2>&1'
