### 根本原因

实现 Harness v4.0 自优化 Sprint Workstream 1，新增 CI 合同校验机制并强化 Reviewer 证伪能力。两项改动均针对过去发现的问题：(1) DoD 条目中混入了 grep/ls 等 CI 白名单外的命令，导致 CI 拒绝但人工难以发现；(2) Reviewer 覆盖率仅 60% 且缺乏可执行的证伪代码，无法有效拦截弱验证命令。

### 下次预防

- [ ] 写 lint 脚本时，先从"最后一个条目没有下一行"的边界情况入手测试解析逻辑，避免 off-by-one 导致第一版漏过末尾条目
- [ ] CI yml 多行输出用 `<<DODEOF ... DODEOF` heredoc 而非单行 echo，避免换行被截断
- [ ] SKILL.md 的 proof-of-falsification 字段必须是可执行代码片段，模板中明确写"禁止纯文字描述"
