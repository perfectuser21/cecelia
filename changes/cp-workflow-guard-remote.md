## {VERSION}

### write-guard 远程授权：修跨机器写产物失败

**事故**：2026-09-07 智能获客 final6 四次重试全挂在 `guard path was unavailable in the worker environment`。查实：**视频其实已经找到了**（`found one valid candidate and exhaustion evidence`，video_id 7682732369652108578，截图证据齐全），卡的是交不了作业。

**根因**：worker 的 `tools.exec = { host: "node", node: "XIAN-M4-PHONE" }`（西安 Mac），Commander 账本在 hk-vps 容器。Commander 把**自己容器里的绝对路径**发给 worker 让其本地执行 guard 脚本——脚本和它要读的账本都不在 worker 那侧。这套契约默认双方共享文件系统，但它们不共享。

**为什么不能靠拷脚本解决**：guard 必须读 `state/workflow-runs/<run>__<attempt>.json` 才能判定阶段是否活跃。拷脚本过去它一读账本就 `Cannot read Commander ledger`；要成立就得同步整个账本目录，那会引入并发写和一致性问题。

**改法**：授权改为向账本所在主机请求。
- `guard-core.js` 抽出全部判定逻辑，**CLI 与 HTTP 服务共用同一份**，杜绝两套实现漂移
- `server.js` HTTP 外壳；拒绝一律 403（含账本读不到——对调用方那等同于身份不对，不该让它以为服务挂了而重试风暴）
- systemd 单元**只绑 Tailscale 地址**：本机有公网 IP，绑 0.0.0.0 等于把"发写入令牌"的接口挂到公网
- 部署脚本自带暴露面自检，公网可达即失败退出

**安全模型等价、非放宽**：原来「谁能读账本文件谁能签发」，现在「谁在 tailnet 内且拿得出本次 run 的 lease_id 谁能签发」。lease_id 由 Commander 每次现签、只发当班 worker，核心里本就在校验。

**等价护栏**：把 hk-vps 上原脚本自带的测试原样搬进 CI 指向新实现，逐条通过。新旧必须签出**同一个 fence_token**，否则切换后产物校验会静默失效。28 个测试全绿。
