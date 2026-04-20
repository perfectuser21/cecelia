# PRD: Phase 7.5 死 DoD sweep + CI 回归测试

**日期**：2026-04-20
**分支**：cp-0420161725-cp-04201617-phase75-dod-sweep
**Engine 版本**：v18.3.2 → v18.3.3（patch）

## 背景

Phase 8.3 实施时（PR #2463）撞到死 DoD 命令 — DoD 文件里有 `manual:node -e "...readFileSync('~/.claude/skills/harness-report/SKILL.md')..."`，CI runner 上该路径不存在，repo 内对应文件也没有断言要找的内容，导致无关 PR 的 CI 失败。

仓库根目录 + packages/ 内累积了 **152 个历史 `.task-*.md` / `.dod-*.md` / `.prd-*.md` / `DoD.cp-*.md` / `PRD.cp-*.md` 残留文件**，这些是已合并 PR 遗留的 per-PR DoD/PRD 副本，`cleanup-merged-artifacts.yml` 本应自动清理但漏抓 `.dod-*` 前缀，导致残留。

## 目标

1. 清理仓库里所有历史 per-PR DoD/PRD/TASK 副本（152 个）
2. 修 `.github/workflows/cleanup-merged-artifacts.yml` 清理正则漏 `.dod-` 前缀的 bug
3. 清理根目录的 stale `.dod.md` / `.prd.md` / `.prd.md.old` / `TASK.md`（这些是 Jan 前的历史）+ packages/ 内同类 stale
4. 增加 vitest 回归测试：验证 `check-manual-cmd-whitelist.cjs` 能抓住常见死 DoD 模式
5. Engine 版本 patch bump：18.3.2 → 18.3.3

## 扫描报告

全 repo 扫描了 404 个含 `Test: manual:` 的 md 文件，共 460 个 `node -e` 命令。执行结果：

- **PASS**：285（62%）
- **DEAD**：175（38%）

死命令分布：
- **历史 per-PR 残留**：145 个（82%）— 均在待删除的 `.task-*` / `.dod-*` / `DoD.cp-*` / `sprints/*/task-card.md` 中
- **设计文档示例**（false positive）：8 个 — `docs/instruction-book/` / `docs/superpowers/specs/` / skill 模板，含 `"..."` / `path/to/file` 占位符，不是真 DoD
- **活跃 sprints/ 旧 task-card.md**：11 个 — 保留（sprints/ 是 harness 活跃输出目录，不是 per-PR 副本）

当前 `DoD.md` (Phase 7.4) 和 `.dod.md`（Brain memory-health）的 node 命令**全部通过**，无真实活跃死 DoD。

## 做

1. `git rm` 152 个历史残留（仓库根 + packages/brain/ + packages/quality/ + packages/workflows/）
2. `git rm` 根目录 stale 4 个 + packages/ 内 stale 5 个（`.dod.md` / `.prd.md` / `.prd.md.old` / `TASK.md`）
3. 修 `cleanup-merged-artifacts.yml` regex：`^(\.prd-|\.task-|DoD\.cp-|PRD\.cp-|TASK_CARD\.cp-)` → `^(\.prd-|\.task-|\.dod-|DoD\.cp-|PRD\.cp-|TASK_CARD\.cp-)`
4. 新增 `packages/engine/tests/dod/dod-manual-commands.test.ts`：验证 `check-manual-cmd-whitelist.cjs` 能抓住：
   - `~/.claude/skills/...` 路径（虚构路径）
   - `grep -q` / `ls` / `cat` 等非白名单 prefix
   - `npm test` 完整路径
5. Engine 版本 7 处同步：18.3.2 → 18.3.3
6. feature-registry.yml 追加 18.3.3 changelog
7. Learning 文件

## 不做

- 不改 `hooks/*.sh` / scripts（B agent 已做）
- 不改 `autonomous-research-proxy.md`（A agent 已做）
- 不改 `tests/integration/dev-flow-e2e.test.ts`（C agent 已做）
- 不碰 `DEFINITION.md`
- 不删除 `sprints/` 下活跃目录（harness 活跃输出）
- 不删除 `docs/archive/` 下已归档 DoD/PRD（归档有意保留）

## 成功标准

- git 仓库减少 150+ 个历史 DoD/PRD 残留
- cleanup-merged-artifacts.yml 下次 main push 时能匹配 `.dod-*` 前缀
- 新增 vitest 回归覆盖 manual-cmd 白名单边界 case
- CI L1/L2/L3 通过
