# Learning: executeResearch 重构（圈复杂度 27 → ~5）

## 任务
重构 `content-pipeline-executors.js` 中的 `executeResearch`，将圈复杂度从 27 降至 10 以下。

### 根本原因
函数承担了多重职责：
1. notebook source 清空（出现**两次**相同逻辑）
2. prompt 构建（条件分支 + 字符串替换）
3. JSON 解析 + findings 提取（嵌套 try/catch + 多分支）

每增加一个 try/catch、for 循环、if 分支，圈复杂度各 +1，导致单函数复杂度飙升至 27。

### 下次预防
- [ ] 函数中出现**两次相同代码块**时立即提取为辅助函数
- [ ] try/catch 嵌套超过 2 层时拆分为独立函数
- [ ] 单函数超过 40 行时做职责检查

## 修复方案
提取 3 个辅助函数（各自复杂度 ≤ 5）：
1. `clearNotebookSources(notebookId, label)` — 封装 source 清空 + 错误吞咽
2. `buildResearchPrompt(typeConfig, keyword)` — 封装 prompt 选择逻辑
3. `parseResearchFindings(raw, keyword)` — 封装 JSON 解析 + fallback

主函数 `executeResearch` 简化为纯协调器，圈复杂度降至 ~5。

## 附带修复
`DEFINITION.md` 缺少 `sprint_generate`/`sprint_evaluate`/`sprint_fix` 三个任务类型，
导致 `facts-check.mjs` 失败。顺手补全。
