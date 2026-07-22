# Design: bluegreen TEMP_PORT 与 dashboard-slot-server SLOT_PORT 端口撞车

## 背景

`scripts/lib/bluegreen.sh` 的 `bluegreen_swap()` 用 `TEMP_PORT`（默认 5223）给 green canary
容器发布临时端口；`scripts/brain-deploy.sh:354` 又硬编码了一份 `TEMP_PORT=5223`。同一台机器上
`scripts/dashboard-slot-server.cjs`（常驻 staging 预览服务，`SLOT_PORT` 默认同为 5223，
`SLOT_HOST` 默认 `0.0.0.0`）经常长期占用这个端口。

Gate3 蓝绿部署里，探测 green canary 健康状态走 `host.docker.internal:${TEMP_PORT}`（这条路径是
之前一次事故的修复遗留——脚本本身在 blue 容器内执行，必须走 `host.docker.internal` 才能连回宿主机
发布的端口）。已现场验证：在 OrbStack 下，容器内解析 `host.docker.internal` 访问宿主机端口时，
如果宿主机上已经有一个**原生（非容器）进程**绑定了同一端口，请求会命中那个原生进程，而不是新发布的
容器端口。dashboard-slot-server 正是这样一个原生长驻进程。结果：只要它占着 5223，green canary 的
pre-swap smoke 检查（healthz/version/harness-ping/harness-echo）全部打到 slot-server 返回的前端
HTML 上，4/5 条必然失败，蓝绿部署判定"green 未通过"，保留旧生产容器（生产安全，但新版本上不了线）。

## 方案

把 `TEMP_PORT` 的默认值从 5223 改成 5233（`scripts/lib/bluegreen.sh` 的默认值 + 注释，
`scripts/brain-deploy.sh:354` 的硬编码值），避开 `dashboard-slot-server.cjs` 的默认端口 5223。
不改 `SLOT_PORT`——它是常驻服务的既定端口，改它影响面更大（Alex 日常从自己电脑访问
`perfect21:5223` 看 staging），而 `TEMP_PORT` 只是蓝绿部署内部的临时探测端口，语义上更适合挪动，
改动范围也更小（两个文件，纯常量）。

评估过其他方案：
- **改探测路径不走 host.docker.internal，改成走 docker 内部网络直连 green 容器 IP**——更彻底，但
  这条路径是 07-15 那次事故特意加上的修复（当时的问题是 green 落在默认 bridge 网络与 blue 隔离），
  改探测机制本身风险更高、超出本次 bug 的最小修复范围，不做。
- **让 dashboard-slot-server 探测端口占用后自动跳到下一个可用端口**——treats 症状而非两边"撞了同一
  默认值"这个根因，且改动落在一个语义完全不同的模块（预览服务）里，不做。

## 回归测试

新增 `scripts/__tests__/bluegreen-temp-port-collision.test.sh`：静态断言
`scripts/lib/bluegreen.sh` 里 `TEMP_PORT` 的默认值、`scripts/brain-deploy.sh` 里硬编码的
`TEMP_PORT=` 值，都不等于 `scripts/dashboard-slot-server.cjs` 里 `SLOT_PORT` 的默认值。
这条测试在修复前会真实失败（三处当前都是 5223），修复后变绿，并且此后任何一方再改回撞车的默认值
都会被这条测试拦下。

## 影响范围

仅 `scripts/lib/bluegreen.sh` + `scripts/brain-deploy.sh` 两个文件的一个常量值 + 一条新测试。
不改任何业务逻辑、不改 Brain 源码（`packages/brain/` 不涉及，无需 DEFINITION.md 版本 bump）。
