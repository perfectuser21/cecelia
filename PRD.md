# PRD: cleanup-merged-artifacts regex 修复 + 根目录垃圾清理

## 背景

`.github/workflows/cleanup-merged-artifacts.yml` 第 28 行的 grep 正则只匹配旧命名约定 `.prd-*/.task-*`（带前导点、小写）。但实际 /dev 流程产物命名已改为 `DoD.cp-*.md / PRD.cp-*.md / TASK_CARD.cp-*.md`（大写、无前导点）。

正则失配导致根目录 30 天未清理，积累 **36 个** 遗留 md 文件。workflow 每次跑都输出"✅ 无残留"，形成"虚假绿"。

## 成功标准

1. workflow 正则兼容新旧两种命名（旧命名向后兼容，新命名全覆盖）
2. 根目录已积累的 36 个 cp- 系列 md 一次性 `git rm`
3. 活跃文件（`DoD.md`、`PRD.md`、`README.md`、`DEFINITION.md`）不被误删
4. 新增 workflow 正则单元测试全部通过

## 非目标（YAGNI）

- 不处理 `.dev-seal.*` / `.dev-gate-*` 残留（stop hook 责任，另议）
- 不处理 `docs/learnings/` 的 1117 文件归档（独立大议题）
- 不改 workflow 触发时机
- 不改提交消息格式
