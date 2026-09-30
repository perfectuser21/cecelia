## Brain {VERSION} — 镜像补拷 sync-steps-from-workspace.mjs（任务 b2bba893）

- `packages/brain/Dockerfile` 按白名单风格增加 `COPY packages/brain/scripts/sync-steps-from-workspace.mjs ./scripts/`：09-30 上产 sync 44 步靠手工 `docker cp` 进容器，下次部署即丢（#5705 遗留）
- 新增 smoke `brain-image-scripts-smoke.sh`（源码层断言该 COPY 存在、两条既有 scripts/lib COPY 未丢、源文件存在；改 Dockerfile 前先报红）并登记 allowlist
