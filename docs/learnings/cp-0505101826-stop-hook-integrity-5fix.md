# Learning — Stop Hook Integrity 5 修复（2026-05-05）

分支：cp-0505101826-stop-hook-integrity-5fix
版本：Engine 18.20.1 → 18.21.0
前置 PR：#2766 (verify_dev_complete P1-P7) + #2767 (Task 3/5/6)
本 PR：第 11 段 — integrity 加固

## 故障

PR #2766 + #2767 上线后 Alex 让我"深度看有没有问题 + 有没有 integrity test"。
自审发现 5 个虚假宣称：

1. **shell 测试是死代码**：32 unit + 5 integration + 8 smoke 全部不在 CI 跑
   （vitest 不识别 .test.sh，`.github/workflows/` 0 引用）— main 上有人改
   verify_dev_complete / stop-dev.sh / cleanup.sh，CI 不会发现 regression
2. **ghost 过滤缺失**：stop-dev.sh 取 dev-active-*.json 第一个就 break，
   远端 sync 来的 session_id="unknown" + 远端 worktree 路径 + 0 commit 的
   ghost 持续 block stop hook（5/4 wave2 cp-0504130848 / cp-0504131813 死锁 2 次）
3. **P5/P6 真链路 disabled**：stop-dev.sh 调 verify_dev_complete 没设
   VERIFY_*=1，P5/P6 代码合到 main 但实战不启用
4. **无 integrity 元测试**：没有"测试有没有被测"的检查
5. **无 CI 合成场景**：没有起真 Brain → mock PR merged → stop-dev.sh 真跑
   → 验 P5+P6+done 的端到端

## 根本原因

PR #2766 优先修核心决策树（verify_dev_complete 7 阶段重写），把"代码合到
main"当成"功能上线"。两个差距：
- 测试代码合了但 CI 不跑 = 假绿
- 函数定义了但 caller 没用 = 假启用

PR #2767 跟进修测试基础设施，但没自审"测试自己有没有被测"。
ghost 过滤问题积累 1+ 周（远端 worker sync 模式从 4/27 起就有）—
每次 ghost 出现都靠人工 rm，没人系统化修。

## 本次解法

### 修复 1 — engine-tests-shell CI job
.github/workflows/ci.yml 加新 job 跑所有 unit/integration/integrity/smoke
shell 脚本，加进 ci-passed required。下次 stop hook 套被改坏 CI 立即抓。

### 修复 2 — stop-dev.sh ghost 过滤
取 dev-active-*.json 时检查：
- session_id="unknown" → 自动 rm
- worktree 路径不存在 + 分支 0 commit ahead of main → 自动 rm
都是 ghost 时 dev_state="" → exit 0 普通对话。

### 修复 3 — stop-dev.sh 启用 P5/P6
调 verify_dev_complete 时 := 默认 export VERIFY_DEPLOY_WORKFLOW=1
VERIFY_HEALTH_PROBE=1。escape hatch：用户外部 export VERIFY_*=0 可禁用。

### 修复 4 — integrity 元测试
新建 `tests/integrity/stop-hook-coverage.test.sh` 11 case：
- grep CI yaml 验证关键 .test.sh 被引用（6 项）
- grep stop-dev.sh 验证 verify_dev_complete 调用 + P5/P6 启用 + ghost 过滤（4 项）
- dev-mode-tool-guard.sh 文件存在（1 项）
接 engine-tests-shell job

### 修复 5 — real-env 合成场景
新建 `tests/integration/stop-hook-e2e-real-brain.test.sh`：
- mock 主仓库 + dev-active + Learning + cleanup
- mock gh CLI 模拟 PR merged + deploy success
- 真跑 stop-dev.sh → curl 真 Brain endpoint → 验 done 路径 rm dev-active
- Brain 不健康时 exit 0 容错

## 下次预防

- [ ] **代码合到 main ≠ 功能上线**：必须有"caller 真调"的元测试。函数定义但 caller 不调 = dead code，CI 应抓
- [ ] **测试合到 main ≠ 测试在跑**：必须 grep `.github/workflows/` 验证测试文件被引用，否则测试本身是 dead code
- [ ] **任何决策路径有 env flag**：必须有元测试 grep 验证 caller 设置了 flag（如 `VERIFY_*=1`），否则 flag 路径是 dead code
- [ ] **ghost 状态文件**（远端 sync 来的）必须自动过滤：识别特征 + 自动 rm + 不依赖人工
- [ ] **大 PR 的"留后续 task"必须 ≤ 3 day 闭环**：今晚 PR #2766 的 plan Task 3/5/6 合在 #2767，但仍有这一波 5 修复才完整。下次 PR 上限 = 一次合就闭环
- [ ] **bash 双引号字符串内禁中文括号**：`echo "...（$VAR）..."` 中文圆括号让 bash 把 `VAR）` 当变量名（set -u 报 unbound）— 用方括号 `[$VAR]` 或 ASCII `( $VAR )`

## 验证证据

- engine-tests-shell job 跑通：unit + integration + integrity + smoke 全过
- stop-dev-ghost-filter 4 case 全过（session_id=unknown / worktree 不存在 / 真 worktree 保留）
- integrity 元测试 11 PASS / 0 FAIL（CI 引用 6 + stop-dev 配置 4 + dev-mode-tool-guard 1）
- real-brain 合成 3 PASS（Brain 健康场景 done 路径），本机无 Brain 时 exit 0 容错
- 8 处版本文件 18.21.0
- ci-passed needs 含 engine-tests-shell

## Stop Hook 完整闭环（11 段）

| 段 | PR | 内容 |
|---|---|---|
| 4/21 | #2503 | cwd-as-key 身份归一 |
| 5/4 | #2745 | 散点 12 → 集中 3 |
| 5/4 | #2746 | 探测失败 fail-closed |
| 5/4 | #2747 | 三态出口严格分离 |
| 5/4 | #2749 | condition 5 真完成守门 |
| 5/4 | #2752 | Ralph Loop 模式 |
| 5/4 | #2757 | 50 case 测试金字塔 |
| 5/4 | #2759 | PreToolUse 拦截 |
| 5/4 | #2761 | done schema 修正 |
| 5/4 | #2766 | 7 阶段决策树 + monitor-loop guard |
| 5/4 | #2767 | 测试基础设施完善 + cleanup 解耦 |
| 5/5 | **本 PR** | **integrity 5 修复 — 死代码激活 + ghost 过滤 + P5/P6 启用** |
