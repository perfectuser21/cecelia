# 设计:fleet 探针容器内 ssh 无身份修复

## 问题(已复现)
Brain 容器内 fleet 探针 sshExec 失败:OpenSSH 按 /etc/passwd 解析 root 家目录 = /root/.ssh(只读且无 key),
不看挂载在 $HOME(/Users/administrator)/.ssh 的 key → Permission denied → xian-mac-m4 永远 fetch_failed →
codex 产能算 0。显式 `-i /Users/administrator/.ssh/air2` + `UserKnownHostsFile=/dev/null` 实测成功
(公钥已授权到 xian-m4)。关联 Issue 92d23693 / decision c9222248。

## 方案(三选一,选 A)
- **A(选定)**:sshExec 抽出纯函数 `buildSshCommand(server, cmd)`:恒加 `-o UserKnownHostsFile=/dev/null`;
  identity 取 `process.env.CECELIA_SSH_IDENTITY` 或默认 `${HOME}/.ssh/air2`,fs.existsSync 存在才加 `-i`。
  改动集中一处,主机/容器两态兼容,可单测。
- B:ssh 逃逸到主机再跳西安(照 #3441)——双跳脆弱,探针每 30s 一次,放大故障面,弃。
- C:改走 bridge HTTP 拉 stats——bridge 无 stats 端点,要动两端,超出 bug fix 范围,弃。

## 组件与接口
- `packages/brain/src/routes/infra-status.js`:新增导出 `buildSshCommand(server, cmd, {identityPath?})`,
  `sshExec` 改为消费它。行为不变项:ConnectTimeout=5/StrictHostKeyChecking=no/BatchMode=yes 保留。
- `packages/brain/src/selfcheck.js`:新增自检项 `compute_ssh_reachability`——对 COMPUTE_SERVERS 逐台
  buildSshCommand+exec `echo ok`(超时 5s),失败机器列入 warnings(红日志 + /health 可见),不阻塞启动。

## 错误处理
identity 文件不存在 → 不加 -i(退回默认行为)+ 启动时打一条 warn。自检失败不 crash,只降级可见。

## 测试策略
- **unit(CI 逻辑守卫)**:buildSshCommand 三条断言——含 UserKnownHostsFile=/dev/null;identity 存在时含 -i <path>;
  不存在时不含 -i。TDD:commit-1 failing test,commit-2 实现。
- **环境守卫(proven-to-fire)**:selfcheck compute_ssh_reachability 上线后故意用错 identity 跑一次,亲眼看它报红。
- **E2E 手工验收**:部署后 curl /api/brain/fleet 确认 xian-mac-m4 online:true 且 effectiveSlots>0。
- 运维前置(已完成):air2.pub 已授权 xian-m4;xian-m1 真宕机,自检会如实报红,属预期(另案)。
