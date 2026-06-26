# staging-deploy 健康检查窗口延长设计（2026-06-26）

## Bug
`scripts/staging-deploy.sh` 健康检查 `MAX_TRIES=12` × `sleep 5` = 60s 窗口。staging brain 启动需 >60s（migration 全扫 + scanner/monitor init），脚本 60s 超时退出报 [FAIL] → staging_e2e verdict=FAIL reason=deploy_failed → 内部线 promote 不触发。

但容器其实成功了（实证：staging 容器 `Up healthy` + `curl localhost:5222/api/brain/tick/status` 正常 + `curl localhost:5222/api/brain/harness-selftest` 返回 `{"ok":true,"service":"harness"}`）。纯属健康检查窗口太短的误判，且误判阻断了 promote 闭环。

## 方案
`MAX_TRIES` 12 → 36（窗口 60s → 180s），`sleep 5` 不变。staging 是"加分项"，容许慢启动，宁可多等也别误判 FAIL 阻断 promote。

方案对比：
- A（选）：MAX_TRIES 36（180s）——简单、容错足、不动启动逻辑
- B：缩短 staging brain 启动时间——动 brain init 逻辑，风险大、收益低（启动成本固有）
- C：staging 失败不阻断 promote（FAIL→SKIP）——掩盖真失败，错（真 deploy 失败也该拦）

## 测试策略：unit（解析脚本验证窗口配置）
vitest 读 `scripts/staging-deploy.sh`，正则提取健康检查的 `MAX_TRIES` 与 `sleep` 秒数，断言总窗口 `MAX_TRIES × sleep >= 180`。这是配置接缝的逻辑守卫（值退回 60s 会报红）。

## 不包含
- staging brain 凭据挂载（account ENOENT，另一层，不阻塞部署验证）
- staging brain 启动加速（固有成本）
- 生产 brain-deploy.sh（独立脚本，不受影响）
