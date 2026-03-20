# Learning: 修复 infra-status SSH 用户名配置

## 概要
Brain 的 infra-status API 因 SSH 用户名错误导致西安所有机器显示 offline。

### 根本原因
`infra-status.js` 中的 `sshUser` 字段使用了硬编码的假设用户名（administrator/zenithjoy/root），
与实际 `~/.ssh/config` 中配置的用户名不一致。SSH 密钥只认 config 中的用户名。

### 下次预防
- [ ] infra-status 的机器配置应从 `~/.ssh/config` 动态读取，而非硬编码
- [ ] 添加 capability-probe 探针检测远程机器 SSH 连通性
- [ ] Brain 启动时自动验证所有 SERVERS 的 SSH 连通性，失败时记录告警
