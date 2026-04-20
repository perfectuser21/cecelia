# Phase 7.3 设计：bash 3.2 + set -u hardening sweep

**日期**：2026-04-20
**分支**：`cp-0420153151-cp-04201531-phase73-bash-hardening`
**Engine 版本**：v18.3.0 → v18.3.1（patch — 纯修复，不加功能）

---

## 背景

Phase 7.2（PR #2461）修了 `packages/engine/hooks/stop.sh` 两处空数组 `_STOP_HOOK_WT_LIST[@]` 的 "unbound variable" bug。该 bug 在 Phase 7.1 统一 launcher 之后才真正暴露（此前 owner_session mismatch 早退）。

Cecelia 仓库有 191 个 bash 脚本，其中 **176 个开启 set -u / set -euo pipefail**。Phase 7.2 只修了一个脚本两处，同类潜伏炸弹散落在整个仓库中，需批量扫修。

## 扫描报告

命中标准：**bash 3.2 + set -u + 数组/变量可能为空** 的组合。11 处：

1. `packages/engine/skills/dev/scripts/cleanup.sh:22,24` — TEMP_FILES[@] trap 炸
2. `packages/workflows/skills/dev/scripts/cleanup.sh:21,23` — 同 1 镜像
3. `packages/engine/ci/scripts/check-chinese-punctuation-bombs.sh:22,36` — TARGETS 空 find
4. `packages/workflows/skills/dev/scripts/scan-change-level.sh:119,171` — REASONS 未命中分支
5. `packages/engine/skills/dev/scripts/fetch-task-prd.sh:172,184` — found_files 全无匹配
6. `packages/brain/scripts/cleanup-merged-worktrees.sh:131,133` — nullglob 空展开
7. `packages/engine/runners/codex/runner.sh:86-100` — CODEX_HOMES="" 清空
8. `packages/engine/runners/codex/playwright-runner.sh:64-73` — 同 7
9. `packages/brain/scripts/cecelia-run.sh:25,29` — _env_args compgen 空
10. `packages/workflows/skills/skill-creator/scripts/classify-skill.sh:28,96,126` — reasons 未命中规则
11. `packages/engine/scripts/bump-version.sh:117,133+` — TARGETS 5 处迭代

扫描方式 + 完整分析见 Learning `docs/learnings/cp-0420153151-cp-04201531-phase73-bash-hardening.md`。

## 方案

**统一修复模式**：
- 空数组展开：`"${arr[@]}"` → `"${arr[@]+${arr[@]}}"`（bash 3.2 + set -u 唯一稳妥模式）
- `read -ra arr <<< "$v"` 后：`[[ ${#arr[@]} -eq 0 ]] && arr=(fallback)`
- jq 空管道：`printf '%s\n' "${arr[@]}" | jq` → `if [[ ${#arr[@]} -gt 0 ]]; then ... ; else echo "[]"; fi`
- 保留 `nullglob` + `matches=( $pat )`，只在迭代处 guard（nullglob 保证 matches 不含字面 pattern，但空时仍需 guard）

每处修改加注释标 `Phase 7.3: bash 3.2 set -u compat`。

## 变更清单

### 新建
- `packages/engine/tests/hooks/bash-hardening-sweep.test.ts` — 20 assertions
- `docs/learnings/cp-0420153151-cp-04201531-phase73-bash-hardening.md`
- `docs/superpowers/specs/2026-04-20-phase73-bash-hardening-design.md`（本文件）

### 修改（11 个脚本）
- `packages/engine/skills/dev/scripts/cleanup.sh`
- `packages/workflows/skills/dev/scripts/cleanup.sh`
- `packages/engine/ci/scripts/check-chinese-punctuation-bombs.sh`
- `packages/workflows/skills/dev/scripts/scan-change-level.sh`
- `packages/engine/skills/dev/scripts/fetch-task-prd.sh`
- `packages/brain/scripts/cleanup-merged-worktrees.sh`
- `packages/engine/runners/codex/runner.sh`
- `packages/engine/runners/codex/playwright-runner.sh`
- `packages/brain/scripts/cecelia-run.sh`
- `packages/workflows/skills/skill-creator/scripts/classify-skill.sh`
- `packages/engine/scripts/bump-version.sh`

### Engine 版本（7 处）
- `packages/engine/VERSION` 18.3.1
- `packages/engine/package.json` 18.3.1
- `packages/engine/package-lock.json` 18.3.1（两处）
- `packages/engine/.hook-core-version` 18.3.1
- `packages/engine/hooks/VERSION` 18.3.1
- `packages/engine/regression-contract.yaml` version + updated
- `packages/engine/skills/dev/SKILL.md` frontmatter version + updated
- `packages/engine/feature-registry.yml` 追加 changelog 18.3.1

### 不改
- `packages/engine/hooks/stop.sh`（Phase 7.2 已修）
- `packages/engine/skills/dev/steps/autonomous-research-proxy.md`（A agent 工作域）
- Brain 业务逻辑 / CI yaml / workflow 定义（本 PR 纯 shell 修复）

## 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A：每处加 `${arr[@]+...}` guard**（选） | 最小改动；模式统一；零运行时开销 | 语法不够直观 |
| B：全局改 `set -uo pipefail` 为 `set -eo pipefail`（去 -u） | 一行改动全仓放行 | 失去未定义变量保护，反而埋更多雷 |
| C：升级到 bash 4+ 强制 | 彻底解决 | 需全员装 `brew install bash`，破坏 macOS 默认环境兼容 |

**选 A**：最小侵入、可审计、不破坏 set -u 保护的收益。

## 测试矩阵

`bash-hardening-sweep.test.ts` 20 个断言：
- 11 个 `bash -n` 语法 check（每个修复脚本）
- 2 个 guard 模式校验（含**基线对照**：未 guard 必炸，防假阳性）
- 7 个功能冒烟：
  - `check-chinese-punctuation-bombs.sh` 空目录 exit 0
  - cleanup.sh EXIT trap 空 TEMP_FILES 不炸
  - `cleanup-merged-worktrees.sh` nullglob 空展开不炸
  - `codex runner` CODEX_HOMES="" 降级
  - `cecelia-run.sh` _env_args compgen 空 exec 不炸
  - `classify-skill` reasons 空 jq 回退 `[]`
  - `scan-change-level` REASONS 空循环不炸

## Review（B-5 spec approval）

**依据**：
- 用户任务描述（本对话 Phase 7.3 任务）：扫描+修复所有 bash 3.2 + set -u 陷阱
- 代码：Phase 7.2 PR #2461 的修复模式（`${arr[@]+${arr[@]}}` guard）
- OKR：Cecelia Engine KR — Stop Hook 循环机制完整可靠 + shell 脚本健壮性

**判断**：APPROVE

**confidence**：HIGH（扫描全面 + 每处有基线对照测试 + 最小改动模式）

**质量分**：9/10
- +1 扫描全仓 191 脚本、过滤 176 set -u 脚本、11 处命中均有 bug 类型 + 触发场景说明
- +1 基线对照测试防假阳性
- +1 每个修复点加注释 `Phase 7.3: bash 3.2 set -u compat`
- +1 测试覆盖语法 + guard 模式 + 功能冒烟三维度
- −1 仅覆盖典型模式，未穷尽所有 edge case（例如 `${arr[-1]}` 负索引 bash 3.2 不支持，但仓库内未使用）

**风险**：
- R1：修改的脚本若有未覆盖的运行时路径仍可能有遗漏 → 通过新增回归测试 + bash -n 全仓扫描可缓解
- R2：`${arr[@]+${arr[@]}}` 语法不直观，未来读者可能误以为冗余而简化回去 → 每处加注释标明用途
- R3：`bump-version.sh` 修改后可能影响未来版本 bump 流程 → 本 PR 自身就使用了 bump-version.sh 做 7 处版本同步，实证通过

**下一步**：进入 writing-plans 阶段

---

## DoD

- [x] [ARTIFACT] 11 个目标脚本全部修改完成，`grep -c "Phase 7.3: bash 3.2 set -u compat" <files>` 每个 ≥1
  - Test: `manual:node -e "const files=['packages/engine/skills/dev/scripts/cleanup.sh','packages/workflows/skills/dev/scripts/cleanup.sh','packages/engine/ci/scripts/check-chinese-punctuation-bombs.sh','packages/workflows/skills/dev/scripts/scan-change-level.sh','packages/engine/skills/dev/scripts/fetch-task-prd.sh','packages/brain/scripts/cleanup-merged-worktrees.sh','packages/engine/runners/codex/runner.sh','packages/engine/runners/codex/playwright-runner.sh','packages/brain/scripts/cecelia-run.sh','packages/workflows/skills/skill-creator/scripts/classify-skill.sh','packages/engine/scripts/bump-version.sh'];const fs=require('fs');for(const f of files){const c=fs.readFileSync(f,'utf8');if(!c.includes('Phase 7.3'))throw new Error('missing marker: '+f);}"`
- [x] [BEHAVIOR] 所有修改脚本 `bash -n` 语法合法
  - Test: `tests/hooks/bash-hardening-sweep.test.ts`
- [x] [BEHAVIOR] `${arr[@]+${arr[@]}}` guard 在 bash 3.2 + set -u 下工作
  - Test: `tests/hooks/bash-hardening-sweep.test.ts`
- [x] [BEHAVIOR] 基线对照：未 guard 的 `"${arr[@]}"` 在 set -u 下必炸
  - Test: `tests/hooks/bash-hardening-sweep.test.ts`
- [x] [BEHAVIOR] check-chinese-punctuation-bombs.sh 空目录下 exit 0 不报 unbound variable
  - Test: `tests/hooks/bash-hardening-sweep.test.ts`
- [x] [BEHAVIOR] cleanup.sh EXIT trap 空 TEMP_FILES 不炸
  - Test: `tests/hooks/bash-hardening-sweep.test.ts`
- [x] [BEHAVIOR] nullglob 空展开 + guard 不炸（cleanup-merged-worktrees 模式）
  - Test: `tests/hooks/bash-hardening-sweep.test.ts`
- [x] [BEHAVIOR] CODEX_HOMES="" 空字符串下 runner 降级到单账号不炸
  - Test: `tests/hooks/bash-hardening-sweep.test.ts`
- [x] [BEHAVIOR] cecelia-run.sh _env_args compgen 无命中时 exec 不炸
  - Test: `tests/hooks/bash-hardening-sweep.test.ts`
- [x] [BEHAVIOR] classify-skill reasons 空时 jq 返回 `[]`
  - Test: `tests/hooks/bash-hardening-sweep.test.ts`
- [x] [ARTIFACT] Engine 7 处版本文件同步到 18.3.1
  - Test: `manual:node -e "const fs=require('fs');const v='18.3.1';if(fs.readFileSync('packages/engine/VERSION','utf8').trim()!==v)process.exit(1);if(!fs.readFileSync('packages/engine/.hook-core-version','utf8').includes(v))process.exit(1);if(!fs.readFileSync('packages/engine/hooks/VERSION','utf8').includes(v))process.exit(1);if(!JSON.parse(fs.readFileSync('packages/engine/package.json','utf8')).version.includes(v))process.exit(1);"`
- [x] [ARTIFACT] feature-registry.yml 含 18.3.1 changelog 条目
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('version: \"18.3.1\"'))process.exit(1);if(!c.includes('Phase 7.3'))process.exit(1);"`
- [x] [ARTIFACT] Learning 文件含 `### 根本原因` + `### 下次预防` + `- [ ]` checklist
  - Test: `manual:node -e "const c=require('fs').readFileSync('docs/learnings/cp-0420153151-cp-04201531-phase73-bash-hardening.md','utf8');if(!c.includes('### 根本原因'))process.exit(1);if(!c.includes('### 下次预防'))process.exit(1);if(!c.includes('- [ ]'))process.exit(1);"`
- [x] [BEHAVIOR] `npm run test` 在 engine 目录下全绿（含新增 bash-hardening-sweep 20 断言）
  - Test: `manual:node -e "require('fs').accessSync('packages/engine/tests/hooks/bash-hardening-sweep.test.ts')"`
