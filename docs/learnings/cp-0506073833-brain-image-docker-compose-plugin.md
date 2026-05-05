# Learning: Brain image 加 docker compose plugin

## 概述

PR #2789 修了 deploy webhook 的失败黑盒（log 落盘到 /tmp/cecelia-deploy-*.log），
log 第一时间暴露了一个之前被 stdio:'ignore' 掩盖、可能存在很久的 bug：

```
[7/8] Starting container...
unknown shorthand flag: 'f' in -f
[FAIL] docker compose up -d failed. Rolling back...
```

## 根本原因

Brain image runtime stage 只装 `docker-cli`（alpine apk 包），**没装 docker-cli-compose
plugin**。container 内执行 `docker compose -f docker-compose.yml up -d` 时，docker
CLI 不识别 compose 子命令，把 `compose` 当成参数，于是把 `-f` 解析为 `docker -f`，
触发 "unknown shorthand flag: 'f' in -f"。

为什么手动跑 deploy-local.sh 能成功？因为 host 装了 docker compose plugin。webhook
spawn 的 detached child 在 Brain container 内跑 → 用的是 container 内的 docker CLI。

## 下次预防

- [ ] **container 内任何工具命令依赖**都要在 Dockerfile 显式装。docker-cli vs docker-cli-compose 是两个独立 alpine 包，前者只有主 binary 不含 plugin
- [ ] **Webhook spawn 命令链路**应该 enumerate 一遍验证：所有命令的 args 在目标环境（container 内）能识别。本次 docker compose 在 host 能跑误导我们以为 container 内也能跑
- [ ] **失败黑盒是元 bug**：PR #2789 stdio 落盘前这个 bug 一直藏着每次 deploy 都失败但看不到原因。运维链路任何 detached spawn 都必须落盘，不能 stdio:'ignore'

## 改动

- packages/brain/Dockerfile — apk add 加 docker-cli-compose
- packages/engine/tests/integration/brain-image-docker-compose.test.sh — 新建 4 case
  - grep Dockerfile / 真 build image 验 docker compose 命令可用

## 测试结果

- brain-image-docker-compose.test.sh: 4/4 ✅（含真 build image 验证 docker compose version）

## 这是三 PR 链的最后一刀

- PR #2785 stop hook session_id 路由（多 session 不串线）
- PR #2789 build context 隔离 + log 落盘（让黑盒变白盒）
- PR #2791 build 用 origin/main（工具链对 cwd 免疫）
- **本 PR：image 含 docker compose plugin**（让 webhook deploy 真能跑通）

四个 PR 共同治"deploy 链路对环境不一致敏感"这一类病。本 PR merged 并经手动 deploy
让新 image 上线后，webhook deploy 链路彻底可用。
