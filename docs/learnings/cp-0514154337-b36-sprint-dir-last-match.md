# B36 — parsePrdNode sprint_dir regex 取第一个而非最后一个

### 根本原因

B35 用 `.match()` 取 plannerOutput 中 `"sprint_dir"` 的第一个匹配。但 planner agent 在输出 verdict 之前可能列举了现有 sprint 目录（含旧的 w19-playground-sum），导致第一个匹配取到旧目录而非正确的新 sprint。

W46 实证：proposer 收到 `HARNESS_SPRINT_DIR=sprints/w19-playground-sum`，是 planner 在扫描现有目录时输出的第一个 `"sprint_dir"` 引用。

### 下次预防

- [ ] regex 从 LLM 输出提取字段时，优先用最后一个匹配（verdict/result 在末尾）
- [ ] 新增提取逻辑后必须测试「输出含多个同名字段」的情形
