# Learning — Stop Hook 单一 exit 0 重构

分支：cp-0504114459-single-exit-stop-hook
日期：2026-05-04
Brain Task：24152bde-41d6-49c4-9344-78f60477e570

## 背景

Stop Hook trio（stop.sh + stop-dev.sh + devloop-check.sh）在 cwd-as-key 切线（4/21）声明"99 commit 终结"后，13 天内又出 5+ 次"再终结"修复（Phase 7.x bash 加固、5/2 v4.6.0 harness 单一 exit 0、5/3 self-drive-health 衍生）。表面是 corner case 不断暴露，深层是**散点 exit 0 = 多攻击面**。

### 根本原因

stop-dev.sh 7 处 `exit 0`（bypass / cwd 不是目录 / git rev-parse 失败 ×2 / 主分支 / 无 .dev-mode / done）+ devloop-check.sh 4 处 `return 0`（cleanup_done / PR merged + step4 / PR merged + cleanup ok / auto-merge 成功）= 11 个独立"真停"出口。任何一处误放行就 PR 没合就退场。

历史最经典案例：4/21 修的是 stop.sh 一处 session_id 不匹配 → exit 0 早退，导致**所有** dev session 全放行，stop-dev 业务逻辑从未被调用。99 commit 的 fix 全在修 stop-dev 内部 bug，真凶在 stop.sh 第 100 行的散点出口。每加一条业务条件就在原本散点的基础上多一处早退，攻击面线性增长。

### 本次解法

把出口拓扑归一到"全文唯一 1 个 exit 0 / return 0"：

- 新增 `classify_session(cwd)` 函数承载所有"非 dev 上下文"判断（bypass / cwd / git / 主分支 / 无 .dev-mode / 格式异常），输出 status JSON
- `devloop_check()` 主函数用 `while :; do ... break; done` 模式收敛多分支到末尾单一 `echo + return 0`，状态由 result_json 的 status 字段携带
- `stop-dev.sh` 退化为 `case "$status"` 单一 exit 0（85 行 → 60 行）
- 业务逻辑（auto-merge / cleanup.sh / CI 等待 / harness 分叉 / Brain 回写 / DoD）一字不动
- 辅助函数 `_mark_cleanup_done` / `_increment_and_check_ci_counter` 的参数早退 `return 0` 改为 `return`（不带数字），与"业务出口"语义区分

CI 守护（机器化阻止散点复活）：

- `scripts/check-single-exit.sh` — 注释行剔除后 grep 卡 `\bexit 0\b` = 1、`\breturn 0\b` = 2
- `.github/workflows/ci.yml` 接入 `lint-single-exit` job

### 数据

- stop-dev.sh：7 处 exit 0 → 1 处（只在末尾 case `not-dev|done` 分支）
- devloop-check.sh：4 处 return 0 → 2 处（classify_session + devloop_check 各 1）
- 12 场景 E2E（packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts）100% 绿灯
- 8 分支 integration（packages/engine/tests/integration/devloop-classify.test.sh）100% 绿灯
- 重构前后行为零差异（business logic 一字不动）

### 下次预防

- [ ] 任何 hook 脚本严禁多于 1 个独立 `exit 0` / 主函数多于 1 个独立 `return 0`，CI lint-single-exit 强制
- [ ] 新增分支判定 → 加新 status 取值 + while:; break 分支，禁止散点 return/exit
- [ ] 辅助函数（如 `_mark_cleanup_done` 这类参数早退）的 `return` 不带数字，与业务出口分离
- [ ] check-single-exit.sh 永久守护：grep 卡死出现次数，永不放宽
- [ ] 任何 stop-*.sh / devloop-check.sh / classify_session 改动必须跑 12 场景 E2E + 8 分支 integration

### 路线终结声明

本 Learning 与 4/21 cp-0421154950-stop-hook-final.md（cwd-as-key 切线）配套，构成 Stop Hook 架构改造的两段终结：
- 4/21：身份判定层归一（cwd-as-key 替换 owner_session 多字段匹配）
- 5/4：业务出口拓扑归一（散点 11 → 单一 1）

任何回滚以上两个里程碑的 PR 必须先废止本文件 + cp-0421154950-stop-hook-final.md。
