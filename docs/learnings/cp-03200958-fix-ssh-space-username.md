# Learning: sshExec 用户名含空格时 SSH 命令拼接错误

## 概要
infra-status 的 sshExec 函数拼接 SSH 命令时，含空格的用户名被 shell 拆开。

### 根本原因
模板字符串 `${server.sshUser}@${server.tailscaleIp}` 展开后，`xu xiao@100.103.88.66` 被 shell 解释为两个参数 `xu` 和 `xiao@100.103.88.66`。需要用双引号包裹整个 `user@host` 部分。

### 下次预防
- [ ] 所有 shell 命令拼接中涉及用户输入的部分都应加引号
- [ ] SSH 用户名测试应覆盖含空格、中文等特殊字符的场景
