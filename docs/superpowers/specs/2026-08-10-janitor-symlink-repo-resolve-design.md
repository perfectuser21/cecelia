# janitor.sh 软链解析修复 + ops 测试接入 CI — 设计

任务 4490d132 · 锚 factory/f4_fault_selfheal keep-green · PrepPRD: sprints/08102014-janitor-symlink-repo-resolve/

## 问题（已实证）
1. `scripts/ops/janitor.sh:39` 用 `$(dirname "$0")/../..` 反推仓库根；生产 cron 经 `~/bin/janitor.sh` 软链调用时 `$0` 是软链路径，反推出 `$HOME`（无 .git）→ 步骤8 "✗ 跳过（git 仓库不存在）"，上线首日即静默失效。
2. `:604-606` 该跳过分支未调 `step_fail` → 不计入 FAILED_STEPS，违反本仓刚立的"环境断裂不许静默"自验断言。
3. **`scripts/ops/__tests__/janitor/*.test.sh` 全部 4 个测试未接任何 CI job，零执行**（ci.yml 的 shell job 只 glob engine/brain 两处固定目录；smoke-allowlist 里 janitor 条目因 run-smoke-ratchet.sh 写死 SMOKE_DIR+basename 匹配而是死条目）。
4. `janitor_orphan.test.sh:101-111` 验证12 仍断言软链指向 zenithjoy-skills（迁移前旧断言），接 CI 后 `CI=true` 恒跳过、本地必红。

## 修法
1. `janitor.sh`：照 `packages/brain/scripts/cecelia-run.sh:417` 生产验证过的先例——
   `SCRIPT_PATH="$0"; [[ -L "$SCRIPT_PATH" ]] && SCRIPT_PATH="$(readlink -f "$SCRIPT_PATH" 2>/dev/null || echo "$SCRIPT_PATH")"`，CECELIA_REPO 从 SCRIPT_PATH 反推。macOS≥12.3 与 ubuntu 均支持 readlink -f。
2. `:604` else 分支加 `step_fail "8" "git 仓库不存在（CECELIA_REPO=...解析失败）"`。
3. `ci.yml` 新增 `ops-tests-shell` job，照 `brain-tests-shell`（:394）的 glob 写法跑 `scripts/ops/__tests__/janitor/*.test.sh`——新增测试自动捡起。
4. 修正 `janitor_orphan.test.sh` 验证12：断言软链指向 cecelia 仓 scripts/ops（或存在即可），去掉 zenithjoy-skills 旧断言，去掉 CI 跳过失真。

## 测试策略（integration 档）
新增 `scripts/ops/__tests__/janitor/janitor_symlink_repo_resolve.test.sh` 三用例：
- 软链调用复现：tmp 假仓库+软链为 $0，sed 提取脚本真实 SCRIPT_PATH/CECELIA_REPO 赋值行执行 → 断言解析到真实仓库根（修复前红）
- 真实路径直调 → 同样正确（防修复顾此失彼）
- grep 断言步骤8跳过分支含 step_fail（修复前红）
CI 注册后由 ops-tests-shell 执行；生产宿主软链真跑一次 daily 作 proven-to-fire 证据。

## TDD 顺序
commit-1: red test（本地验红）→ commit-2: janitor.sh 两处修复 + ci.yml job + orphan 测试修正（本地验绿）。
