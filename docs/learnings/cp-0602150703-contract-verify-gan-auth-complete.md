## verifyContractProposerOutput private repo auth（2026-06-02）

### 根本原因

PR #3238 只修了 `verifyProposerOutput` 的 `ls-remote`/`fetch` 认证，漏了同文件的 `verifyContractProposerOutput`（同样的 bug 在不同函数）。

### 下次预防

- [ ] 修同一类 bug 时必须全局搜函数名 pattern，确保同文件所有同类函数都修到
- [ ] `contract-verify.js` 现在所有函数（verifyProposerOutput + verifyContractProposerOutput）的 git 操作都已注入 githubToken
- [ ] 遇到 "ls-remote failed" 错误，检查调用路径是哪个 verify 函数，不要假设只有一个
