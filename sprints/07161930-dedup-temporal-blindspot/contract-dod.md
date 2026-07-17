# DoD 合同 — 07161930-dedup-temporal-blindspot

## 行为断言（[BEHAVIOR] 标记）

- [BEHAVIOR] mock gh 返回 open 无命中 + merged 有命中 → 撞车检查输出『疑似已被 PR#N 完成』并 exit 1 阻断（不许静默继续）
- [BEHAVIOR] mock gh 返回 open 无命中 + merged 无命中 → 撞车检查放行（exit 0）
- [BEHAVIOR] bug-fix 路径：复现 failing test 在 latest main 不红 → 流程输出『任务过时』提示并 exit 1 禁止继续
- [BEHAVIOR] 纯新功能任务：即使 failing test 不红，流程不触发退场（豁免）
- [BEHAVIOR] 合同测试脚本 packages/engine/tests/dedup-temporal-check.sh 可独立 bash 执行，exit 0 全过
- [BEHAVIOR] 版本从 19.5.0 bump 到 19.6.0，5 文件版本号一致
- [BEHAVIOR] SKILL.md 路径 A（bug-fix 段）含『复现或退场』铁律 ≥4 条

## 验收命令（manual:bash）

```bash
# manual:bash
bash packages/engine/tests/dedup-temporal-check.sh
```

## DoD 检查项

- [ ] [ARTIFACT] worktree-manage.sh 撞车检查同时查 open + 近 7 天 merged
- [ ] [ARTIFACT] merged 命中时 exit 1（含警告信息，格式：`[COLLISION] 疑似已被 PR#N 完成`，含 PR 编号和 merged 时间）
- [ ] [ARTIFACT] SKILL.md bug-fix 路径含复现或退场铁律 ≥4 条
- [ ] [ARTIFACT] 纯新功能任务豁免条款明确写入 SKILL.md（NFR-04 满足）
- [ ] [ARTIFACT] 版本 19.6.0（5 文件）：`package.json`、`CHANGELOG.md`、`feature-registry.yml`、`SKILL.md frontmatter`、`VERSION`
- [ ] [ARTIFACT] feature-registry.yml 新增 `dedup-temporal-check` 条目
- [ ] [ARTIFACT] CHANGELOG.md 记录本次改动
- [ ] [ARTIFACT] packages/engine/tests/dedup-temporal-check.sh 存在且可执行
- [ ] CI 全绿
- [ ] PR title 以 `[CONFIG]` 开头（INV-01 满足）
