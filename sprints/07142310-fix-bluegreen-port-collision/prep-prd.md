# Bug PrepPRD：蓝绿 green canary 三连失败——幽灵代理 + smoke 抢跑 + 5223 撞港

## 症状
1.262.1 三次部署全在 green canary 阶段失败：pre-swap smoke 对 5223 全部 0ms connect refused，但手动忠实复现 green 容器 20s 内健康。

## 根因（贴身时间线取证 23:01-23:06）
1. **幽灵代理**：dashboard staging 槽位服务器默认也占 5223 且把 /api/brain/* 代理回生产 5221——健康 poll 的裸 `curl -sf tick/status` 穿透幽灵拿到 blue 的 200，green 未监听即判 healthy；
2. **smoke 抢跑**：docker 内部 healthcheck ≠ 宿主映射可达，green 启动含迁移检查需 ~20s，smoke 无就绪等待 0ms 打空；
3. 23:02:41-23:03:51 实测 5223 在 green 不存在时返回 200（幽灵实锤）。

## 修法
- 健康判据双保险：docker health=healthy && curl 同时成立；容器退出提前止损
- pre-swap smoke 前加宿主 healthz 就绪等待（≤90s，超时保留 blue + Bark）
- TEMP_PORT 5223→5230 挪出撞港区

## Regression Test 计划
守卫已 proven-to-fire（三连真实部署失败即红证据）；修后验收=Gate3 重跑 green 过闸、生产 /health version=1.262.1。

## 验收标准
- [x] DoD.md 各断言绿
- [ ] CI 绿 merge
- [ ] Gate3 部署成功，生产 1.262.1
