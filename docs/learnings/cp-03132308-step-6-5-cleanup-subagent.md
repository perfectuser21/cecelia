## Step 6.5 升级为 Cleanup Sub-Agent（2026-03-13）

**失败统计**：CI 失败 2 次，本地测试失败 0 次

**CI 失败 #1**：Learning Format Gate — Learning 文件在初次 push 中缺失
**CI 失败 #2**：Learning Format Gate — Learning 文件格式不符合要求（缺少规定标题结构）

### 根本原因

Learning Format Gate 要求 `docs/learnings/<branch>.md` 在初次 push 时就存在，且必须使用特定格式（`## 标题`、`### 根本原因`、`### 下次预防`、`- [ ]` checklist）。本次开发错误地在 CI 反馈后才补充 Learning 文件，且首次补充的格式使用了自由格式（粗体标题），不符合 CI 检查的标题格式要求。

### 下次预防

- [ ] Learning 文件（`docs/learnings/<branch>.md`）必须和代码变更放在同一个初始 commit 中，初次 push 时一起提交
- [ ] Learning 文件必须使用规定格式：`## 标题（日期）`、`### 根本原因`、`### 下次预防`、`- [ ] 具体措施`
- [ ] 在本地用 `bash packages/engine/scripts/devgate/check-learning.sh` 验证格式后再 push
- [ ] 不要等"CI 通过后再补 Learning"——Learning Format Gate 是 L1 的一部分，初次 push 就触发
