# Phase 7.3 — bash 3.2 + set -u Hardening Sweep

## 背景

Phase 7.2（PR #2461）修了 `packages/engine/hooks/stop.sh` 两处空数组 `_STOP_HOOK_WT_LIST[@]` 在 bash 3.2 + `set -u` 下的 `unbound variable` bug。该 bug 在 Phase 7.1 统一 launcher（强制 `--session-id` + 正确 owner_session）之后才真正被触发——在此之前 Stop Hook 因 owner_session mismatch 提前 exit 0 放行，数组展开代码根本没跑到。

但 Cecelia monorepo 有 **191 个 bash 脚本**，其中 **176 个开启 `set -u` / `set -euo pipefail`**，而同类陷阱（空数组展开 / 空字符串变量 `read -ra` 清空 / `compgen` 无命中 / `nullglob` 空展开）广泛存在。如果不批量扫修，类似 bug 会在各个脚本被触发的时候陆续炸出来。

本 PR 全仓扫描所有 bash 脚本（`.sh` / `.bash` / bash shebang），识别 11 处潜伏炸弹并修复，新增 20 个测试断言作为回归保护。

## 扫描报告（11 处潜伏 bug）

所有命中都是 **bash 3.2 + `set -u`（或 `set -euo pipefail`）+ 数组可能为空** 的组合，macOS 默认 bash 3.2 上会炸成 `unbound variable`：

| # | 文件:行号 | 问题类型 | 触发场景 |
|---|---|---|---|
| 1 | `packages/engine/skills/dev/scripts/cleanup.sh:22,24` | 空数组 `TEMP_FILES[@]` 在 EXIT trap 中展开 | `set -euo pipefail` + 脚本从未 `TEMP_FILES+=()` 时 EXIT trap 炸 |
| 2 | `packages/workflows/skills/dev/scripts/cleanup.sh:21,23` | 同 1（镜像文件） | 同 1 |
| 3 | `packages/engine/ci/scripts/check-chinese-punctuation-bombs.sh:22,36` | `TARGETS=()` + 空 find 输出 + 空参数 | `set -uo pipefail`，无参数调用且 find 扫目录不存在时炸 |
| 4 | `packages/workflows/skills/dev/scripts/scan-change-level.sh:119,171` | `REASONS=()` + 循环 | `set -euo pipefail`，所有 diff 文件都是未知 ext 时 REASONS 空 |
| 5 | `packages/engine/skills/dev/scripts/fetch-task-prd.sh:172,184` | `found_files=()` + `printf "${arr[@]}"` | `set -euo pipefail`，所有 keyword grep 全无匹配时炸 |
| 6 | `packages/brain/scripts/cleanup-merged-worktrees.sh:131,133` | `nullglob` + `matches=( $pattern )` + 空展开 | `set -uo pipefail`，glob 无匹配时 matches 空，迭代炸 |
| 7 | `packages/engine/runners/codex/runner.sh:86,88,100` | `CODEX_ACCOUNT_LIST=()` + `CODEX_HOMES=""` | `set -euo pipefail`，`CODEX_HOMES` 空字符串时 `read -ra` 清空数组，`${arr[0]}` 炸 |
| 8 | `packages/engine/runners/codex/playwright-runner.sh:64-73` | 同 7 | 同 7 |
| 9 | `packages/brain/scripts/cecelia-run.sh:25,29` | `_env_args=()` + `"${_env_args[@]}"` exec | `set -euo pipefail`，compgen 无 CECELIA_* 命中时 exec 展开炸（root 切换路径） |
| 10 | `packages/workflows/skills/skill-creator/scripts/classify-skill.sh:28,96,126` | `reasons=()` + 循环 / jq 管道 | `set -euo pipefail`，description 不命中任何规则时 reasons 空，迭代/printf 炸 |
| 11 | `packages/engine/scripts/bump-version.sh:117,133,143,151,267` | `declare -a TARGETS=()` + 5 处 `"${TARGETS[@]}"` | `set -euo pipefail`，所有 6 个版本文件都不存在的极端场景 |

**扫描方式**：
- `Grep` pattern `\$\{[a-zA-Z_][a-zA-Z0-9_]*\[@\]\}` 找全部数组引用
- 过滤 `^set -.*u` 的脚本
- 人工判定每处使用是否有 guard（`[[ ${#arr[@]} -gt 0 ]]` 前置 / `${arr[@]+${arr[@]}}` 展开 / 写死非空初始化）
- 基线对照测试：`bash -c 'set -u; arr=(); for x in "${arr[@]}"; do ...'` 确认会炸；`"${arr[@]+${arr[@]}}"` 不炸

**未命中**：
- `[[ -v varname ]]`（bash 4.2+）：0 处
- `declare -A`（关联数组，bash 4+）：0 处
- `${var^^}` / `${var,,}` 大小写转换（bash 4+）：0 处
- `read -r -d ''` 带 set -e 退出：仅在 while 循环中使用（安全模式），未命中

### 根本原因

macOS 默认 shell 是 bash 3.2.57（Apple 为规避 GPLv3 锁死在这个版本）。`set -u`（nounset）在 3.2 下对空数组展开 `"${arr[@]}"` 会抛 "unbound variable"，这是 bash 4.0 才修的行为（4.0+ 允许空数组展开为零个参数）。

过去这些 bug 没被发现，原因：
1. **CI 跑在 ubuntu-latest（bash 5+）**，CI 不会炸
2. **实际执行时往往数组非空**（发布流程总能找到几个文件 / Codex 总配置了账号 / cleanup 总有临时文件）
3. **Stop Hook 路径不触发**（Phase 7.1 之前 owner_session mismatch 早退）

Phase 7.1 统一 launcher 后，Stop Hook 能精确匹配到每个 session 的 .dev-lock，更多代码路径被真实触发。Phase 7.2 暴露第一个，但其他 10 处仍未修。

### 下次预防

修复方式统一：

1. **空数组展开加 guard**：`"${arr[@]+${arr[@]}}"` —— 数组存在才展开，为空时展开为零参数。这是 bash 3.2 + set -u 唯一稳妥的空数组迭代/传参模式。
2. **`read -ra arr <<< "$MAYBE_EMPTY"` 后必须 length check**：空字符串会清空数组。修法：read 后 `[[ ${#arr[@]} -eq 0 ]] && arr=(fallback)`。
3. **`compgen`/`find` 输出给数组时预期空结果**：迭代前 `[[ ${#arr[@]} -gt 0 ]]` 或展开加 guard。
4. **`nullglob` 不能救 set -u**：shopt nullglob 只影响 glob 无匹配时的行为（$pattern 保留原文本 vs 空），不改变 `"${empty_arr[@]}"` 在 set -u 下的报错。必须加 `${arr[@]+...}` guard。

### 新写 bash 脚本前的 checklist

- [ ] 脚本顶部加了 `set -u` / `set -euo pipefail` 吗？如果加了，所有数组引用必须审：
  - [ ] 初始化 `arr=()` 为空的数组，迭代时用 `"${arr[@]+${arr[@]}}"` guard
  - [ ] `read -ra arr <<< "$v"` 后 `v` 可能为空字符串 → 加 length check
  - [ ] `compgen -v | grep ... → arr+=()` 无命中可能 → 展开 `"${arr[@]+${arr[@]}}"`
  - [ ] `nullglob + matches=( $glob )` → 展开加 guard
- [ ] 未定义 env var 引用必须加 `${FOO:-default}` 或 `[[ -n "${FOO:-}" ]]` 守护
- [ ] 禁用 bash 4+ 语法：`[[ -v var ]]` / `declare -A` / `${var^^}` / `${var,,}`
- [ ] 在 macOS 本机（bash 3.2）手测关键路径，不依赖 CI（ubuntu bash 5+ 不暴露这类 bug）
- [ ] 用 `bash -n <file>` 做语法校验（CI pre-push hook 已覆盖）

### 回归保护

`packages/engine/tests/hooks/bash-hardening-sweep.test.ts` 覆盖：
- 11 个修复脚本的 `bash -n` 语法校验
- `${arr[@]+${arr[@]}}` guard 在 set -u + 空数组下正常工作
- **基线对照**：未 guard 的 `"${arr[@]}"` 在 set -u + 空数组下**必炸**（防测试假阳性）
- 6 个功能冒烟测试：每个典型修复场景独立验证

CI L1 的 `shell syntax` 检查（`bash -n` 所有 `.sh`）自动拦截新增语法错误。

## 相关 PR 链

- Phase 7.1 (#2460): 统一 claude launcher，让 Stop Hook 能精确匹配 session
- Phase 7.2 (#2461): 修 stop.sh 两处 `_STOP_HOOK_WT_LIST[@]` 空数组 bug
- Phase 7.3 (本 PR): 扫全仓 11 处同类潜伏 bug + 测试回归保护
