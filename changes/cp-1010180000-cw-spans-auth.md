## Brain {VERSION} — coding workflow runner 上报执行记录带 Brain 内部令牌

- 金丝雀 3（任务 4ea44bcf）实测：链路跑完上报 spans 全部 HTTP 401。原因：`POST /api/brain/spans` 走 internalAuthOrLoopback，生产配了 `CECELIA_INTERNAL_TOKEN`，runner 经 socat 访问不算本机回环，也没带令牌。原测试用的假 Brain 不校验令牌，所以没发现。
- runner.sh 照 DEPLOY_TOKEN 的做法，运行时从 `~/.credentials/cecelia-internal.env` 读令牌，只取 `CECELIA_INTERNAL_TOKEN` 这一项，不进代码、不进 plist、不导入整份文件。Brain 客户端有令牌就带 `X-Internal-Token`。
- 测试假 Brain 增加令牌校验（同真 Brain）。修复后用真实生产验证：金丝雀 3 链路的 9 条 span 已补报成功。
