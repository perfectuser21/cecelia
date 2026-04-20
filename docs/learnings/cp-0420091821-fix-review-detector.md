# fix-review-detector（2026-04-20）

### 根本原因

`scripts/devgate/detect-review-issues.js` 策略二的 `noIssuesDeclared` 正则写死了"没有发现严重问题|未发现严重问题"两种紧连句式。DeepSeek 实际输出文本是"未发现需要标记为🔴的严重问题"（中间有 9 个字），被判定为"没有声明无问题"+"含 🔴" → 误判为真实严重问题 → 阻塞 PR 合并。

PR #2453（恢复 archive tarball）就因为此 bug 被卡住。

### 下次预防

- [ ] 检测器针对自然语言判断时，"未发现...X"这类结构必须留中间浮动距离（0-40 字，可调），不能写死紧连
- [ ] 任何"基于字符串 hit 就 exit 1"的 CI 门禁，第一次上线要配对单元测试覆盖真假阳性各至少 3 条
- [ ] DeepSeek review 每周抽查一次 raw 输出，看看是否有新的"无问题"句式模板没被匹配
