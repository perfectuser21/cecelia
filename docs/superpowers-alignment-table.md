# Superpowers ↔ Cecelia Engine 对齐对照表

> 自动生成 — 升级后重跑 `bash packages/engine/scripts/generate-alignment-table.sh`

**Superpowers upstream**: v5.0.7
**Upstream 路径**: `/Users/administrator/.claude-account1/plugins/cache/superpowers-marketplace/superpowers/5.0.7/skills`
**Engine local**: `packages/engine/skills/dev/prompts/`
**生成时间**: 2026-04-19

## 图例

| 符号 | 含义 |
|---|---|
| 🟢 full | 方法论已在 Engine 落地，prompt 1:1 本地化 |
| 🟡 partial | 方法论吸收但调用时机/范围有偏离（见 notes） |
| 🔴 rejected | 刻意不吸收（Engine 自造替代，见 rejection_reason） |
| ⚫ N/A | meta skill（对 Engine 无意义） |
| ✅ | 本地 sha256 与 upstream 完全一致 |
| ❌ DRIFT | 本地与 upstream 不一致，需人工 diff 决策 |
| ⚠️ local-only | 本地有但 upstream 没有（可能 upstream 删除了该文件） |

## Skill 全景（upstream 总计 14 个）

| # | Skill | Upstream | 本地副本 | coverage | 对齐 | 决策理由 |
|---|-------|---------|---------|---------|-----|---------|
| 1 | brainstorming | 3 md | 2 个 md | 🟢 full | ✅ | 1:1 同步 |
| 2 | dispatching-parallel-agents | 1 md | 1 个 md | 🟢 full | ✅ | 1:1 同步 |
| 3 | executing-plans | 1 md | 1 个 md | 🟢 full | ✅ | 1:1 同步 |
| 4 | finishing-a-development-branch | 1 md | 1 个 md | 🟢 full | ✅ | 1:1 同步 |
| 5 | receiving-code-review | 1 md | 1 个 md | 🟢 full | ✅ | 1:1 同步 |
| 6 | requesting-code-review | 2 md | 2 个 md | 🟢 full | ✅ | 1:1 同步 |
| 7 | subagent-driven-development | 4 md | 4 个 md | 🟢 full | ✅ | 1:1 同步 |
| 8 | systematic-debugging | 9 md | 4 个 md | 🟡 partial | ✅ | 部分吸收 |
| 9 | test-driven-development | 2 md | 2 个 md | 🟢 full | ✅ | 1:1 同步 |
| 10 | using-git-worktrees | 1 md | 无副本 | 🔴 rejected | — | | Engine 自造 `worktree-manage.sh` 替代官方 using-git-worktrees sk |
| 11 | using-superpowers | 1 md | 无副本 | ⚫ N/A | — | meta skill |
| 12 | verification-before-completion | 1 md | 1 个 md | 🟢 full | ✅ | 1:1 同步 |
| 13 | writing-plans | 2 md | 2 个 md | 🟢 full | ✅ | 1:1 同步 |
| 14 | writing-skills | 4 md | 无副本 | ⚫ N/A | — | meta skill |

## 统计

- 🟢 Full 对齐（sha256 全匹配）: 11 个
- 🔴 Rejected（刻意自造）: 1 个
- ⚫ N/A（meta skill）: 2 个
- ❌ Drifted（需人工处理）: 0 个
- **总计**: 14 个 upstream skill

## 文件级详情

| Skill | 文件 | 行数 | local sha256 | upstream sha256 | 状态 |
|-------|------|-----|-------------|----------------|------|
| brainstorming | SKILL.md | 165 | `bba47904a7f6` | `bba47904a7f6` | ✅ |
| brainstorming | spec-document-reviewer-prompt.md | 50 | `12cb5ed58aef` | `12cb5ed58aef` | ✅ |
| dispatching-parallel-agents | SKILL.md | 183 | `76806091c7f9` | `76806091c7f9` | ✅ |
| executing-plans | SKILL.md | 71 | `a711f83fb762` | `a711f83fb762` | ✅ |
| finishing-a-development-branch | SKILL.md | 201 | `dd2f82c6dc85` | `dd2f82c6dc85` | ✅ |
| receiving-code-review | SKILL.md | 214 | `c9382e92b8f3` | `c9382e92b8f3` | ✅ |
| requesting-code-review | SKILL.md | 106 | `a5ff68586ccf` | `a5ff68586ccf` | ✅ |
| requesting-code-review | code-reviewer.md | 147 | `7f5328dca12c` | `7f5328dca12c` | ✅ |
| subagent-driven-development | SKILL.md | 278 | `081ad3869e55` | `081ad3869e55` | ✅ |
| subagent-driven-development | code-quality-reviewer-prompt.md | 27 | `06d1e7c2287e` | `06d1e7c2287e` | ✅ |
| subagent-driven-development | implementer-prompt.md | 114 | `a416193f881e` | `a416193f881e` | ✅ |
| subagent-driven-development | spec-reviewer-prompt.md | 62 | `631980e472ee` | `631980e472ee` | ✅ |
| systematic-debugging | SKILL.md | 297 | `4999cb851360` | `4999cb851360` | ✅ |
| systematic-debugging | condition-based-waiting.md | 116 | `e89fec8400d6` | `e89fec8400d6` | ✅ |
| systematic-debugging | defense-in-depth.md | 123 | `1e175fb86fc3` | `1e175fb86fc3` | ✅ |
| systematic-debugging | root-cause-tracing.md | 170 | `a81bee944879` | `a81bee944879` | ✅ |
| test-driven-development | SKILL.md | 372 | `7dee67b4af6b` | `7dee67b4af6b` | ✅ |
| test-driven-development | testing-anti-patterns.md | 300 | `bde453bc258f` | `bde453bc258f` | ✅ |
| verification-before-completion | SKILL.md | 140 | `ea52d15aabaf` | `ea52d15aabaf` | ✅ |
| writing-plans | SKILL.md | 153 | `90056bad3d5f` | `90056bad3d5f` | ✅ |
| writing-plans | plan-document-reviewer-prompt.md | 50 | `6fce2aa83c63` | `6fce2aa83c63` | ✅ |

## 升级 workflow

```
1. 下载 Superpowers 新版到 ~/.claude-account1/plugins/cache/superpowers-marketplace/superpowers/<new-ver>/
2. bash packages/engine/scripts/sync-from-upstream.sh       # 检测 drift
3. bash packages/engine/scripts/generate-alignment-table.sh # 刷新本表
4. 对每个 DRIFT 人工 diff upstream vs local → 决定同步 / 刻意偏离
5. 更新 alignment.yaml 对应 sha256（如同步）
6. node packages/engine/scripts/devgate/check-superpowers-alignment.cjs  # 验证
7. 推 PR，CI alignment gate 防退化
```
