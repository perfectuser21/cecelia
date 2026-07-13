## brain-deploy 真蓝绿改造——根治每次 merge 生产 Brain outage（2026-07-05）

### 根本原因
- `brain-deploy.sh` 是**先删后建、非蓝绿**：`docker rm -f cecelia-node-brain`（blue）→ `docker compose up -d`（new）。中间有一段生产 5221 完全下线的窗口。
- `Brain CI Deploy (Gate 3)` 每次 `packages/brain/` 或 `scripts/brain-deploy.sh` push:main 就**自动重部署 production**。于是 harness 自驱产出的普通 brain PR（如 #3553）一 merge 就触发生产重部署。
- 坏镜像 / 并发中断（同机 staging 部署、手动命令）撞进删建窗口 → 新容器没起回来 → 5221 长空窗，控制面（tick/dispatch/watchdog）全停。2026-07-05 实证：#3553 merge → 11:58 生产 Brain destroy → HTTP 000 直到手动重建。
- 次因：`docker-compose.staging.yml` 无 `name:` → 与生产共用 compose project `cecelia`，staging 部署把生产容器当 orphan（虽未 --remove-orphans 只警告，但隐患真实）。

### 下次预防
- [ ] 部署脚本涉及"替换正在服务的容器"时，**永远先起新实例验康健、再动旧实例**（蓝绿/canary），绝不先删后建——任何失败都要保证旧实例存活。
- [ ] canary 若连生产 DB，必须用 env 门控关掉后台调度（本次 `BRAIN_DEPLOY_CANARY=1` 关 tick），否则新旧两实例 double-dispatch 抢任务。
- [ ] 固定端口直发布（无反代）的服务做蓝绿：canary 用临时端口验证，切换仍有秒级窗口——真零 downtime 需前置反代，别假装无窗口。
- [ ] 每套环境（dev/staging/prod）在同一台机器共存时，**compose project name 必须各自独立**，否则跨环境 orphan 互扫。
- [ ] 部署路径末尾必须有"目标端口自检 + 失败告警"（本次 5221 /health + Bark），outage 最怕的是**挂了没人知道**。
- [ ] 部署脚本 echo 里的变量紧邻中文标点要用 `${var}` 花括号界定——`$var，`（全角逗号多字节）会被 bash 吞进变量名报 unbound（本次踩过）。
