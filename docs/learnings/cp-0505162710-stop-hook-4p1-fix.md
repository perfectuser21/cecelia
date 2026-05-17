# Learning — Stop Hook 4 个 P1 修复（2026-05-05）

分支：cp-0505162710-stop-hook-4p1-fix
版本：Engine 18.22.0 → 18.22.1
前置：PR #2777 (4 P0)
本 PR：第 13 段

## 故障

PR #2777 4 个 P0 修了主链路，Notion contract 第八章列出 4 个 P1 边缘 case：
- P1-1 engine-only PR P5 永远等不到 brain deploy（PR #2777 自己撞上）
- P1-2 devloop-classify.test.sh CI Linux fail（从 PR #2770 拖延）
- P1-3 engine-tests-shell 显式列表（新加 .test.sh 漏接风险）
- P1-4 .claude/settings 跨机器没自动 install 验证

## 根本原因

1. **P1-1**：P5 引入时（PR #2766）假设 PR merge 一定触发 brain-ci-deploy.yml workflow，没考虑 engine-only / docs-only PR 不触动 packages/brain/
2. **P1-2**：CI Linux runner 没默认 git user，`git commit` 报 "empty ident name" → branch 没创 → classify_session 返 not-dev（之前 ralph-loop-mode 同问题修过）
3. **P1-3**：每次新加 .test.sh 都要手动加 ci.yml engine-tests-shell 列表，前几个 PR 已多次踩
4. **P1-4**：BUG-3 修了 settings 进 repo，但 Claude Code 跨版本支持 repo 级 `.claude/settings.json` 没正式验证

## 本次解法

### P1-1 P5 paths skip
devloop-check.sh P5 段开头加 paths 判断：

```bash
brain_changed=$(gh pr view "$pr_number" --json files -q '[.files[].path] | map(select(startswith("packages/brain/"))) | length')
if [[ "$brain_changed" -eq 0 ]]; then
    verify_deploy=0  # not applicable
fi
```

下面原 P5 逻辑包在 `if [[ "$verify_deploy" == "1" ]]` 里。brain_changed=0 时跳 P5 → 走 P6。

### P1-2 git user 显式
sed 批量给 6 处 `git commit -q --allow-empty` 加 `-c user.email=t@t -c user.name=t`。

### P1-3 ci.yml glob
显式 7 个 .test.sh → `for t in packages/engine/tests/integration/*.test.sh`。integrity L17 grep 验证。

### P1-4 install script + integrity
- `scripts/install-claude-settings.sh` 把 repo `.claude/settings.json` jq merge 到 `~/.claude/settings.json`
- 备份用户原文件
- jq 缺失时报错引导手动编辑
- integrity L15 (`dev-mode-tool-guard.sh` 引用) + L16 (脚本存在 + 可执行)

## 下次预防

- [ ] 任何 verify 阶段加新检查必须有 "not applicable" 路径（不只 success / failure）
- [ ] 测试文件 git init/commit 必须显式 user.email/name（CI Linux runner 默认无）
- [ ] CI workflow 文件列表必须用 glob（避免显式漏接）
- [ ] repo 级配置（如 .claude/settings.json）必须有 fallback install script（CC 跨版本兼容）

## 验证证据

- 32 unit case 全过（regression-free）
- devloop-classify 10/0（CI Linux 修）
- multi-worktree 5/0 + deploy-escape 4/0 + ghost-filter 4/0 + 7stage-flow 5/0 + ralph-loop-mode 4/0
- integrity 18/0（L15-L17 验证 P1-3 + P1-4）
- smoke 9/0 + 12/0
- engine 8 处版本 18.22.1

## Stop Hook 完整闭环延续

| 段 | PR | 内容 |
|---|---|---|
| 11 | #2770 | integrity 5 修复（死代码激活）|
| 12 | #2777 | 4 P0 修（BUG-1/2/3/4）|
| **13** | **本 PR** | **4 P1 修（边缘 case + 测试基础设施）** |

stop hook 这条线上 14 段闭环全部完成。
