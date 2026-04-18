# Superpowers 对齐历史

> 官方 Superpowers 目录：`~/.claude-account3/plugins/cache/superpowers-marketplace/superpowers/`
> 每季度或官方发布新版本时手工补一条。
> 自动检测脚本：`scripts/check-superpowers-upgrade.sh`（cron monthly）

---

## 对齐快照表

| 日期 | Superpowers 版本 | 我们 Engine 版本 | 对齐度 | 关键变更 |
|------|------------------|------------------|--------|----------|
| 2026-04-18 | 5.0.7 | 14.17.0 | 79% skill / 95% 交互点 | F3/F4 补全 |

---

## 对齐度定义

- **skill 覆盖**：我们 engine 内等价实现 / 官方 Superpowers 所有顶层 skill 数量
- **交互点**：两边 skill 内所有行为细节（prompts/steps/gates）的 1:1 复刻率

---

## 关键变更说明

### 2026-04-18 — F3/F4 补全（PR #2382 + #2386）

F3 PR #2382 补三个核心缺口到 Implementer prompt：
1. Condition-Based Waiting（禁 setTimeout/sleep，改用 waitFor）
2. Pre-Completion Verification（完成前三项自证）
3. Root-Cause Tracing（bug fix 向上追 4+1 步）

F4 PR #2386 引入 4 新 skill + 修 4 gap：
1. receiving-code-review（Reviewer ARCHITECTURE_ISSUE 升级链）
2. requesting-code-review（PR body 5 项规范）
3. executing-plans（Critical Gap Abort + BLOCKED 升级链 v2）
4. finishing-a-development-branch（Discard 安全确认）

skill 覆盖 50% → 79%；交互点 1:1 复刻 78% → 95%。

剩余 5% 非关键路径（见 Epic F 的 F4.1）。

---

## 升级触发规则

- `scripts/check-superpowers-upgrade.sh` 每月 1 号 cron 检测
- 官方版本号变化时，脚本创 Brain task P1 告警
- 人工评估 → 决定是否启动新的 F 系列 PR
