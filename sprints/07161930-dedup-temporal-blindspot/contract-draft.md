# Sprint 合同 — 07161930-dedup-temporal-blindspot

## 背景

撞车检查（`worktree-manage.sh:342`）只用 `gh pr list --state open` 检测空间维度的 PR 冲突，忽略近期已 merged 的 PR——导致排队期间修复已合并时，无头 session 仍重复执行同一修复。同时，bug fix 路径缺乏"复现或退场"铁律，failing test 不红时无机制强制标记任务过时。

## 实现范围

| 文件 | 改动说明 |
|---|---|
| `packages/engine/skills/dev/scripts/worktree-manage.sh` | 撞车检查升级：同时查 open + 近 7 天 merged，merged 命中→exit 1 阻断 |
| `packages/engine/skills/dev/SKILL.md` | 路径 A（bug fix 段）插入"复现或退场"铁律 4 条 |
| `packages/engine/tests/dedup-temporal-check.sh` | 新建合同测试：mock gh cli，场景 A（Red）+ 场景 B（Green） |
| `packages/engine/package.json` | 版本 19.5.0 → 19.6.0 |
| `packages/engine/VERSION` | 版本 19.5.0 → 19.6.0 |
| `packages/engine/CHANGELOG.md` | 新增本次改动记录 |
| `packages/engine/feature-registry.yml` | 新增 `dedup-temporal-check` 条目 |
| `packages/engine/skills/dev/SKILL.md` frontmatter | 版本号同步至 19.6.0 |

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|------|-----------|---------------|------------|
| 时间撞车检测 | `../../packages/engine/tests/scripts/dedup-temporal-check.sh` | merged命中→exit 1 [COLLISION] / 无命中→exit 0 | 未修复时场景B/C失败，现版本放行 merged 命中 |
| SKILL.md 铁律 | `../../packages/engine/tests/scripts/dedup-temporal-check.sh` | 复现或退场铁律≥4条 / 版本号一致 | SKILL.md 缺铁律时场景D/E失败 |

## E2E 验收

```bash
# manual:bash（真实运行验收命令）
bash packages/engine/tests/dedup-temporal-check.sh
```

预期输出：所有场景 PASS，脚本 exit 0。

## 未覆盖真实链路清单

- **mock gh cli**：测试用本地 mock 覆盖 `gh` 命令，无法验证真实 GitHub API 返回格式变化（如 gh cli 版本升级导致 JSON schema 变化）
- **merged 查询超时 fallback**：NFR-01 要求超时 5s 降级为仅查 open，合同测试不覆盖超时场景（需在集成环境手动验证）
- **任务 short_id 关键词匹配逻辑**：mock 只模拟 PR title 命中，不测试 body 匹配及 short_id 提取逻辑的边界情况
- **regression-contract.yaml CI 注册**：测试脚本是否被正确注册进 CI 需要实际 CI 运行确认，合同文件无法静态验证

## 判定点登记（共 7 条）

| # | 判定点 |
|---|---|
| 1 | mock gh 返回 merged 命中 → exit 1 阻断，stdout 含 `[COLLISION]` 和 PR 编号 |
| 2 | mock gh 返回 merged 无命中 → exit 0 放行（正常路径不误判） |
| 3 | bug fix 路径：failing test 在 latest main 不红 → 流程输出『任务过时』提示并 exit 1 禁止继续 |
| 4 | 纯新功能任务：即使 failing test 不红，流程不触发退场（豁免条款生效） |
| 5 | 合同测试脚本 `packages/engine/tests/dedup-temporal-check.sh` 可独立 bash 执行，exit 0 全过 |
| 6 | 版本从 19.5.0 bump 到 19.6.0，5 文件版本号一致 |
| 7 | SKILL.md 路径 A（bug-fix 段）含『复现或退场』铁律 ≥4 条 |
