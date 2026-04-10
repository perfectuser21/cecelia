### 根本原因

Workstream 1 的产出物是 Proposer 对 harness-self-check-v2 sprint 的初始合同草案（contract-draft.md）及 DoD 文件（contract-dod-ws1.md、contract-dod-ws2.md）。contract-dod-ws 文件中的 [BEHAVIOR] Test: 字段不能包含字面量 `[BEHAVIOR]`，否则验证脚本扫描文件行时会产生误计数（false positive），导致 BEHAVIOR 计数 > 实际条目数。

### 下次预防

- [ ] contract-dod-ws 文件的 Test: 字段：如需引用 `[BEHAVIOR]` 字符串，须用字符串拼接（`'[BEH'+'AVIOR]'`）或改用 regex 构造方式，避免字面量出现
- [ ] DoD 验证先在本地跑 Test: 命令，再提交
