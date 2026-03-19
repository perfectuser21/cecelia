# Learning: Brain Session 隔离 + 飞书发送日志

## 分支
cp-03191023-fix-brain-session-feishu

### 根本原因
1. cecelia-bridge 的 `/llm-call` 端点 spawn `claude -p` 时没有指定 `cwd`，继承了 bridge 进程所在的 cecelia 仓库目录。每次丘脑/嘴巴/记忆调用都在 cecelia 项目下创建 session，导致用户 `/resume` 列表被几百个自动 session 淹没。
2. `sendFeishuMessage` 调用飞书 API 后不检查返回值也不打印错误，发送失败完全无声。用户反馈"没收到回复"时无法从日志定位问题。
3. `FEISHU_OWNER_OPEN_IDS` 存储的 open_id 是旧 App 的，与当前 App 不匹配。open_id 在飞书里是 per-app 的，换 App 后必须更新。

### 下次预防
- [ ] 任何 spawn 子进程调用 `claude -p` 时，都应显式设置 `cwd` 到非项目目录
- [ ] 调用外部 API（飞书/微信等）发送消息时，必须检查返回值并记录失败日志
- [ ] 切换飞书 App 时，检查所有使用 open_id 的地方是否需要同步更新
