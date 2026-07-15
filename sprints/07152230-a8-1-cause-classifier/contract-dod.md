# Contract DoD — A8-1 死因分类器 + 路由骨架

- task_id: 431d24b1-de5e-4002-8581-8740c8a73232
- sprint_dir: sprints/07152230-a8-1-cause-classifier
- 日期: 2026-07-15
- 覆盖 [BEHAVIOR] 条目：8 项（[BEHAVIOR-01] ~ [BEHAVIOR-08]）

---

## [BEHAVIOR-01] 分类器纯函数签名与 cause 枚举正确

**PRD 覆盖**：FR-01、FR-02、INV-07

**断言**：
- `harness-death-classifier.js` 导出 `classifyDeath` 函数
- 接受 `{ exitCode, stdoutTail, tmuxPane }` 参数
- 返回 `{ cause, action }`，cause 值域严格为 `oom | auth | rate_limit | interactive_stuck | ci_red | green_waiting_merge | unknown`
- 模块无副作用（无 import fs/net/db，无 async，无 I/O）

**验收命令**：
```bash
# 验证文件存在且导出 classifyDeath
node -e "
import('./packages/brain/src/harness-death-classifier.js').then(m => {
  const validCauses = new Set(['oom','auth','rate_limit','interactive_stuck','ci_red','green_waiting_merge','unknown']);
  const validActions = new Set(['oom_upgrade','auth_retry','rate_limit_defer','kill_refire','ci_red_refire','await_merge','log_only']);
  console.assert(typeof m.classifyDeath === 'function', 'classifyDeath 必须导出');
  const r = m.classifyDeath({ exitCode: null, stdoutTail: null, tmuxPane: null });
  console.assert(validCauses.has(r.cause), 'cause 枚举值非法: ' + r.cause);
  console.assert(validActions.has(r.action), 'action 枚举值非法: ' + r.action);
  console.log('PASS BEHAVIOR-01');
}).catch(e => { console.error('FAIL BEHAVIOR-01', e.message); process.exit(1); });
"
```

---

## [BEHAVIOR-02] 三源取证优先级与分类准确性

**PRD 覆盖**：FR-03、FR-04、FR-05、FR-06、INV-03

**断言**：
- exit=137 → cause='oom'（高优先级，无论 stdoutTail）
- stdoutTail 含 `401` → cause='auth'
- stdoutTail 含 `429` → cause='rate_limit'
- tmuxPane 含 `Press enter` → cause='interactive_stuck'
- 全部为 null/空 → cause='unknown'
- exit=137 同时存在 stdoutTail 含 `401` → cause='oom'（exitCode 优先）

**验收命令**：
```bash
node -e "
import('./packages/brain/src/harness-death-classifier.js').then(m => {
  const c = m.classifyDeath;
  const cases = [
    [{ exitCode: 137, stdoutTail: null, tmuxPane: null }, 'oom', 'exit=137→oom'],
    [{ exitCode: 137, stdoutTail: '401 Unauthorized', tmuxPane: null }, 'oom', 'exit=137优先于auth'],
    [{ exitCode: 0, stdoutTail: '401 Unauthorized', tmuxPane: null }, 'auth', '401→auth'],
    [{ exitCode: 0, stdoutTail: 'rate limit exceeded 429', tmuxPane: null }, 'rate_limit', '429→rate_limit'],
    [{ exitCode: 0, stdoutTail: null, tmuxPane: 'Press enter to continue' }, 'interactive_stuck', 'tmux→interactive_stuck'],
    [{ exitCode: 1, stdoutTail: '', tmuxPane: null }, 'unknown', '无特征→unknown'],
  ];
  let pass = true;
  for (const [input, expected, label] of cases) {
    const got = c(input).cause;
    if (got !== expected) { console.error('FAIL', label, 'got=' + got, 'expected=' + expected); pass = false; }
  }
  if (pass) console.log('PASS BEHAVIOR-02');
  else process.exit(1);
}).catch(e => { console.error('FAIL BEHAVIOR-02', e.message); process.exit(1); });
"
```

---

## [BEHAVIOR-03] watchdog 收尸路径接分类器审计日志（INV-06）

**PRD 覆盖**：FR-07、FR-08、FR-09、FR-10、INV-06

**断言**：
- OOM 死亡路径：console.log 含 `cause=oom action=oom_upgrade initiative=<id>`
- CI 红路径：console.log 含 `cause=ci_red action=ci_red_refire initiative=<id>`
- unknown 路径：console.log 含 `cause=unknown action=log_only initiative=<id>`
- 每次收尸必打一行审计日志（不能遗漏）

**验收命令**：
```bash
# 运行 chain test，验证日志输出（grep 审计格式）
cd /workspace && node --test packages/brain/src/__tests__/harness-death-chain.test.js 2>&1 | grep -E 'cause=(oom|ci_red|unknown) action=' | head -5
# 期望至少输出 3 行（oom/ci_red/unknown 各一条）
cd /workspace && node --test packages/brain/src/__tests__/harness-death-chain.test.js 2>&1 | grep -c 'cause=.*action=.*initiative=' | xargs -I{} test {} -ge 3 && echo "PASS BEHAVIOR-03" || echo "FAIL BEHAVIOR-03"
```

---

## [BEHAVIOR-04] OOM 路由：升档参数正确 + oom_upgraded 回写（INV-02）

**PRD 覆盖**：FR-07、INV-02

**断言**：
- exit=137 且 oom_upgraded=false → spawnFn 收到 `spawnOpts.memoryTier='oom_upgrade'`
- spawnFn 调用成功后，DB tasks.payload.oom_upgraded 被回写为 true
- exit=137 且 oom_upgraded=true → 不调用 spawnFn，直接标 oom_wall（二次升档墙）

**验收命令**：
```bash
cd /workspace && node --test packages/brain/src/__tests__/harness-death-chain.test.js --test-name-pattern "OOM" 2>&1 | tail -10
# 期望：✓ OOM 全链 (含 memoryTier=oom_upgrade 断言)
```

---

## [BEHAVIOR-05] CI 红路由：正常重点火，无多余参数

**PRD 覆盖**：FR-08

**断言**：
- cause='ci_red' → spawnFn 被调用
- spawnOpts 不含 memoryTier（CI 红不升档）
- out.resumed++ 计数

**验收命令**：
```bash
cd /workspace && node --test packages/brain/src/__tests__/harness-death-chain.test.js --test-name-pattern "CI.red" 2>&1 | tail -10
```

---

## [BEHAVIOR-06] unknown/其余 cause：保守 log_only，不触发 spawn

**PRD 覆盖**：FR-09、INV-03

**断言**：
- cause=unknown/auth/rate_limit/interactive_stuck/green_waiting_merge → spawnFn 不被调用
- out.resumed 不变
- console.log 含 `action=log_only`

**验收命令**：
```bash
cd /workspace && node --test packages/brain/src/__tests__/harness-death-chain.test.js --test-name-pattern "unknown" 2>&1 | tail -10
```

---

## [BEHAVIOR-07] 分类器模块规模与性能约束

**PRD 覆盖**：NFR-01、NFR-02、INV-07

**断言**：
- 文件行数 ≤ 120 行
- 分类器调用耗时 < 1ms（性能测试）
- 文件无任何 `import` 语句（纯函数，无依赖）

**验收命令**：
```bash
# 行数检查
wc -l /workspace/packages/brain/src/harness-death-classifier.js | awk '{if ($1 > 120) {print "FAIL BEHAVIOR-07: 行数超限 " $1; exit 1} else print "PASS 行数=" $1}'

# import 语句检查
grep -n "^import " /workspace/packages/brain/src/harness-death-classifier.js && echo "FAIL BEHAVIOR-07: 存在 import 语句" || echo "PASS 无 import 语句"

# 性能检查（< 1ms）
node -e "
import('./packages/brain/src/harness-death-classifier.js').then(m => {
  const t = Date.now();
  for (let i = 0; i < 10000; i++) m.classifyDeath({ exitCode: 137, stdoutTail: '429', tmuxPane: 'Press enter' });
  const elapsed = Date.now() - t;
  const avgMs = elapsed / 10000;
  if (avgMs >= 1) { console.error('FAIL BEHAVIOR-07: 平均耗时 ' + avgMs + 'ms >= 1ms'); process.exit(1); }
  console.log('PASS BEHAVIOR-07: 平均耗时 ' + avgMs.toFixed(4) + 'ms');
});
"
```

---

## [BEHAVIOR-08] L1 串链测试进 CI（NFR-03）

**PRD 覆盖**：FR-11、FR-12、NFR-03

**断言**：
- `packages/brain/src/__tests__/harness-death-chain.test.js` 存在
- brain-ci.yml 的 `__tests__` 路径覆盖该文件
- 测试全部通过（0 failing）

**验收命令**：
```bash
# 验证测试文件存在
ls /workspace/packages/brain/src/__tests__/harness-death-chain.test.js && echo "PASS: 测试文件存在" || echo "FAIL: 测试文件不存在"

# 运行全部 chain test
cd /workspace && node --test packages/brain/src/__tests__/harness-death-chain.test.js 2>&1 | tail -20

# 验证 CI 配置覆盖 __tests__ 路径
grep -r "__tests__\|harness-death" /workspace/.github/workflows/brain-ci.yml 2>/dev/null | head -5 || grep -r "packages/brain" /workspace/.github/workflows/brain-ci.yml | head -5
```

---

## PRD Invariant 覆盖矩阵

| Invariant | 覆盖的 BEHAVIOR | 验证方式 |
|-----------|----------------|----------|
| INV-01 不改 attempt cap（MAX_RELAY_ATTEMPTS=5/MAX_CODEX=2）| BEHAVIOR-06（unknown 不触发 spawn，不消耗 attempt）| chain test 验证 |
| INV-02 OOM 升档最多一级（oom_wall 保持）| BEHAVIOR-04 | chain test oom_wall 用例 |
| INV-03 分类器判不出→保守走 unknown→现行路径 | BEHAVIOR-03、BEHAVIOR-06 | manual:bash 可执行 |
| INV-04 禁 mock 真实外部命令行为 | BEHAVIOR-08（mock 边界约定）| code review + test 文件检查 |
| INV-05 新增死因场景先补 L1 用例再写处置器 | BEHAVIOR-08 | TDD 顺序（PR commit 顺序验证）|
| INV-06 每次收尸打审计日志 | BEHAVIOR-03 | manual:bash grep 验证 |
| INV-07 分类器纯函数、无副作用 | BEHAVIOR-01、BEHAVIOR-07 | manual:bash 验证 |

---

## TDD 交付顺序（硬性要求）

1. 先提交：`harness-death-chain.test.js`（failing，3 条 test，全部 red）
2. 再提交：`harness-death-classifier.js`（使 test 2/3 变 green）
3. 再提交：watchdog 集成（使 test 1/3 变 green）
4. 全部 green → PR

**验证 TDD 顺序**：
```bash
# 查看 git log，确认 test 文件 commit 在实现文件之前
git log --oneline -- packages/brain/src/__tests__/harness-death-chain.test.js packages/brain/src/harness-death-classifier.js | head -10
```
