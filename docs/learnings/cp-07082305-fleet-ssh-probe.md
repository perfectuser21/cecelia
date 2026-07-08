# Learning: fleet 探针容器内 ssh 无身份,西安产能误判为 0

### 根本原因
Brain 容器内 OpenSSH 按 /etc/passwd 解析 root 家目录(/root/.ssh,只读且无 key),不读挂载在 $HOME
(/Users/administrator)/.ssh 的密钥;fleet-resource-cache 每 30s 的 sshExec 探针因 Permission denied
从未成功 → xian-mac-m4 永远 offline(fetch_failed)→ getCodexMaxConcurrent 把西安 3 个 codex 账号产能算 0。
与 #3441(harness 容器 spawn claude ENOENT)同族:容器用主机假设够外部世界。

### 修复
- buildSshCommand 纯函数:恒加 -o UserKnownHostsFile=/dev/null;identity(env CECELIA_SSH_IDENTITY
  或 ~/.ssh/air2)存在才加 -i。sshExec 消费之。
- selfcheck 新增 compute_ssh_reachability 环境守卫(warn 不阻塞),带 execFn 注入点保测试隔离。
- 运维:容器公钥 air2.pub 已授权 xian-m4。

### 下次预防
- [ ] Brain 内任何"从容器发起的对外连接"(ssh/curl 内网)在设计时必须先在容器内实测,不能拿主机行为当证据
- [ ] selfcheck compute_ssh_reachability 守卫部署后 proven-to-fire 一次(故意错 identity 看报红)
- [ ] 新增外联探针一律走 buildSshCommand,禁止再手拼 ssh 命令串
