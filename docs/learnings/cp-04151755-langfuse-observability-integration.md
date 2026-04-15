## Langfuse 可观测接入（2026-04-15）

### 根本原因
Brain LLM 调用无集中观测，Token 消耗/延迟分布/prompt 异常排查全靠 console.log 散落在代码里。

### 下次预防
- [ ] 第三方可观测接入默认走 env 白名单，缺一个 env 就禁用整个上报，避免崩 Brain 启动
- [ ] 上报必须非阻塞（Promise.catch 吃错误不上抛），防止外部服务挂影响主链
