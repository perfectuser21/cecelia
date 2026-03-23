# Learning: CI Gate — 假 DoD Test 检测

branch: cp-03231442-ci-gate-fake-dod-test
date: 2026-03-23

## 问题

verify-step.sh 只检测了 echo/ls/cat 等基础假测试，缺少 grep|wc、wc -l 等常见伪模式。
更关键的是 CI 完全没有对应检查——假测试能通过 verify-step 后混入 CI 并永久留存。

### 根本原因

两个层面的缺失：
1. verify-step.sh 假测试正则不完整，缺 grep|wc、wc -l、printf 等模式
2. CI L1 没有对应 gate——本地通过后 CI 不再重检，假测试永久混入

## 修复

1. 新建 `check-fake-dod-tests.cjs`：共享检测脚本，覆盖 10 种假测试模式
2. verify-step.sh：扩展正则加入 wc/printf/grep|wc
3. CI L1 `fake-dod-test-check` job：stage 2+ 触发，三重降级保护（无 .dev-mode/无字段/无文件均跳过）

## 额外踩坑：spawnSync 导致 0% 覆盖率

### 根本原因

测试用 `spawnSync('node', [SCRIPT])` 运行外部进程，vitest v8 coverage 只 instrument 当前进程内 require/import 的代码，
外部进程代码完全不被覆盖，导致 L3 `变更行覆盖率 0% < 60%` 失败。

修复：将核心函数导出（`module.exports = { scanViolations }`），测试用 `createRequire` 直接 import，覆盖率从 0% → 68.93%。

### CI log 中的 "HARD GATE FAILED: DoD 文件缺失" 是误读

该行出现在 vitest 运行期间，是某个已有测试（`pr-gate-phase1.test.ts`）的期望 stderr 输出，
不是 Coverage Gate 本身报错。真正的错误是下面的覆盖率 0%。
诊断时看时间戳：vitest 运行期间的 stderr 是测试输出，不是 gate 失败。

## 下次预防

- [ ] 新增 DoD 检查时，本地 verify-step 和 CI 要同步添加
- [ ] 假测试模式要有共享定义，不能各自维护
- [ ] `console.log` 在新脚本中用 `process.stdout.write` 替代，避免 Gate 0c 误报
- [ ] 写新 `.cjs` 脚本时先导出核心函数，测试直接 import 而非 `spawnSync`，避免 0% 覆盖率
- [ ] CI log 中 vitest 运行期间的 HARD GATE 输出是测试的 stderr，不是 gate 本身失败
