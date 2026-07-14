# 小改动 PrepPRD：刀3-T3 — ZJ staging 服务迁 HK + 双跑 + 域名切流

任务：Brain task 3789d991（Initiative c62f6bcf）。执行 SSOT = docs/architecture/2026-07-14-zj-migrate-hk/architecture.md（§2 freeze/迁移、§3 切流、§4 SSOT、回滚表 T3-1~T3-4）。

## 现状事实（本次实地调研补充）
- staging 流量链：Cloudflare → HK tunnel → autopilot-staging nginx(:521) → proxy_pass 100.71.151.105:5201（美国 launchd）
- apps/api 有现成 Dockerfile（node:20-alpine 两段构建，容器内 5200 + /health healthcheck）；legacy HK API job 全 if:false
- staging plist 49 个 env（无 DATABASE_PASSWORD——美国本机 trust 认证）；路径类：CONTENT_OUTPUT_DIR、INSTALL_PACK_*（美国本地路径，容器要卷映射）
- 现行 staging 部署 = deploy-us-vps.yml（GHA→Tailscale ssh→美国 build release→launchd 切 5201）
- HK：zenithjoy-db-postgres 已跑（T2），/opt/zenithjoy/repo 完整 clone，nginx 容器在 zenithjoy-net

## 改什么

### A. zenithjoy-workspace PR（[CONFIG]）
1. `deploy/docker-compose.staging-api.yml`（新）：服务 `zenithjoy-api-staging`——本地 build（apps/api/Dockerfile）、网络 zenithjoy-net、`127.0.0.1:5201:5200`、`env_file: /opt/zenithjoy/staging-api/.env`、`TZ=Asia/Shanghai`、卷：/opt/zenithjoy/staging-api/content-output → 容器内 /data/content-output、/opt/zenithjoy/staging-api/install-pack → /data/install-pack
2. `deploy/nginx.staging.conf`：所有 `100.71.151.105:5201` → `zenithjoy-api-staging:5200`（同 docker 网络容器名，17 处）；9998/8899/5221/5690 上游**不动**（这些服务本次不迁）
3. `.github/workflows/deploy-staging-hk.yml`（新，[CONFIG]）：push apps/api → ssh HK → git pull → docker build + compose up staging-api → 容器 /health 检查
4. `deploy-us-vps.yml` 降级为 workflow_dispatch-only + 顶部弃用注释（staging 已迁 HK）

### B. cecelia PR
`scripts/zj-migrate-hk/docker-compose.db.yml` 给 postgres 加入 external network `zenithjoy-net`（staging API 容器按名连库）+ 证据/handoff docs

### C. HK/美国 实操序列（每步回滚见 T1 回滚表）
1. HK：db compose 加网络后 `docker compose up -d`（不重建卷）；准备 /opt/zenithjoy/staging-api/{.env,content-output,install-pack}——env 从美国 staging plist 提取转换（ssh 管道传输不落中间文件不回显），覆盖：DATABASE_HOST=zenithjoy-db-postgres/USER=zenithjoy/PASSWORD=HK密码/PORT(容器内)=5200/CECELIA_BRAIN_URL=http://host.docker.internal:5221（HK socat→美国 Brain）/CECELIA_SKILL_EVAL_URL=http://host.docker.internal:9100/eval-api（9100 本来就在 HK）/ZENITHJOY_API_URL=http://localhost:5200/路径类改 /data/*；install-pack 内容从美国 rsync 一次
2. HK：build 镜像 + up → 容器 healthy（连 HK 库）
3. **freeze**：美国 `sudo launchctl bootout system/com.zenithjoy.api.staging` → 5201 拒连（T1 §2 钉死动作）
4. 终态迁移：pg_dump staging → scp → restore → `compare-us-hk.sh zenithjoy_staging` **零漂移 exit 0**
5. **切流**：repo 最新 `nginx.staging.conf` 覆盖 `/opt/zenithjoy/autopilot-staging/nginx.conf` + `docker exec autopilot-staging nginx -s reload`（持久化判据：文件 grep + 容器 restart 后仍指 HK）
6. **E2E**：`https://staging-autopilot.zenjoymedia.media/health` 200 且由 HK 容器应答（停美国服务后仍 200 = 铁证）+ dashboard 首页 200 + /auth 路由响应 + 容器内 `date` = CST（TZ 验证）
7. 美国 staging 永久停用：bootout 已生效 + plist 归档（cp 到 /Library/LaunchDaemons/archive/ 原文件加 .migrated-to-hk 后缀，不删）
8. 写入路由唯一性证据（T1 §4）：美国 staging 库 max(created_at) 静止不再前进 + HK 侧随使用前进；每日 compare 观察 ≥48h 由 T4 前置检查承接

## TTL 预降（DoD 逐字对账）
T1 §3 已成文：tunnel 托管域名事实豁免（切流不触 DNS）；生效验证 = 切流前后 `dig staging-autopilot.zenjoymedia.media` 输出一致（仍指 Cloudflare anycast）+ 切流仅改 nginx 上游。此为「TTL 已预降且生效验证过」的落地形态（预降对象不存在，豁免证据代替）。

## 判定点登记表
| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 「响应来自 HK 实例」判定 | 响应头注入 / 停美国侧后仍 200 | freeze 后（美国 5201 已死）domain /health 200 即必为 HK | 美国侧拒连时旧路径必 502 | 误判=切流未生效而误报成功；有 nginx conf grep+restart 双判据兜底 |
| staging「数据终态」判定 | compare 零漂移 | compare-us-hk.sh exit 0（freeze 后跑） | T2 已验证工具 | 误判=带脏数据切流；freeze 后源库静止，误判概率≈0 |

## 影响范围 / 铁律
- staging 无客户流量（死规矩：生产 autopilot 完全不碰，nginx.conf(prod)/5200/com.zenithjoy.api 零改动）
- 12 个 disabled runner 不触碰；美国生产侧只读
- 回滚保底：nginx 上游改回 100.71.151.105:5201 + bootstrap 美国 plist（T1 回滚表 T3-1/T3-4）

## 验收标准（任务 DoD 原文对账）
- [ ] 双跑期间写入路由符合 T1 SSOT 规则（美国库时间戳静止证据）
- [ ] 切流前 TTL 已预降且生效验证过（豁免证据：dig 前后一致）
- [ ] 域名切 HK 后 golden-path E2E 绿（/health+dashboard+auth，freeze 铁证法）
- [ ] 本机 staging launchd 停用（bootout，plist 归档不删）
- [ ] HK 容器 TZ=Asia/Shanghai 验证（容器内 date）
- [ ] CI 全绿（两 repo PR）
