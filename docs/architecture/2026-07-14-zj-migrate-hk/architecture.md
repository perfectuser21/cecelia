# ZenithJoy 整体迁移 hk-vps 方案（拆库刀3）

**Initiative**: 拆库刀3 — ZJ 整体迁 HK（c62f6bcf）
**决策来源**: 3ac02755（终局格局）/ d8366ef1（切换日）/ be038f9e（持久化漂移铁律）
**文档日期**: 2026-07-14
**状态**: T1 产出（本文档为刀3 T2-T6 执行的方案 SSOT）

---

## 背景

拆库三刀衔接：

| 刀 | 任务 | 状态 |
|---|---|---|
| **刀1** | zenithjoy schema 从 cecelia 主库迁出，落独立 `zenithjoy` 库（详见 `docs/architecture/2026-07-13-cecelia-zenithjoy-db-separation/architecture.md`）| ✅ 完成 |
| **刀2** | dev 环境隔离 | ✅ 完成 |
| **刀3** | ZenithJoy staging + prod **整体迁移 hk-vps**（本方案）| 🔄 T1 产出中 |

刀1/刀2 已把 ZenithJoy 数据从 Cecelia 主库剥离到独立库、把 dev 环境隔开，但 ZJ prod/staging 的**运行位置**仍在美国本机（mmv，38.23.47.81），与 Cecelia 同宿主。刀3 的目标是按决策 3ac02755 确立的终局格局，把 ZenithJoy 的 API 服务与数据库整体迁到 hk-vps，实现：

- ZenithJoy 与 Cecelia 在**宿主层面**彻底解耦（不再共享美国 Mac）；
- 服务形态从 launchd 直跑 node 改为 systemd/docker 容器化（3ac02755 终局方向）；
- 域名入口（Cloudflare tunnel）已在 HK，迁移后 API 与入口同机，消除跨太平洋回源。

切换日安排遵循决策 d8366ef1；所有改配置步骤遵循决策 be038f9e 的持久化漂移铁律（见「回滚预案」节）。

---

## 现状事实（三路只读调研，2026-07-14）

### 流量链现状

```
用户浏览器
   │
   ▼
Cloudflare 边缘
   │  （tunnel token 模式，ingress 托管在 Cloudflare 远端）
   ▼
HK cecelia-tunnel（hk-vps 上的 cloudflared）
   │
   ├─▶ HK nginx 容器 autopilot-dashboard :80
   │        └── proxy_pass http://100.71.151.105:5200   （美国 Mac Tailscale IP，ZJ prod API）
   │
   └─▶ HK nginx 容器 autopilot-staging :521
            └── proxy_pass http://100.71.151.105:5201   （ZJ staging API）
```

**关键事实：域名入口早已在 HK，API 回源美国。** 切流不涉及任何 DNS 变更（详见「3. 切流方案」）。

### 美国本机（mmv）

- ZJ 三个 LaunchDaemon：prod（5200 → `zenithjoy` 库，19MB，75 表）/ staging（5201 → `zenithjoy_staging` 库，12MB）/ dev（5202）；node 直跑蓝绿 release 目录。
- env（含 DB 连接与全部密钥）唯一来源 = plist `EnvironmentVariables` 明文。
- postgres 17.9（Homebrew），仅监听回环。

### hk-vps

- 无 postgres；端口 5200/5201/5432/5433 全部空闲。
- 资源：4核 / 7.6G 内存（6.2G 可用）/ 22G 磁盘空闲。
- 每日 dump + WAL 归档已落 HK：`/opt/zenithjoy-backups`、`/opt/zenithjoy-wal-archive`。
- `/opt/zenithjoy/repo` 已有完整 clone + `deploy/docker-compose.hk.yml`（deploy.yml 已有 HK docker build API 的 job 雏形）。
- 12 个 GitHub runner 全 disabled（防呆：绝不重启，名单见「Runner 防呆」节）。

### CI/CD

- deploy 类 workflow 全部 ubuntu-latest + Tailscale ssh 触达目标机。
- `promote-prod.yml` 蓝绿切 current 为人工放行闸。

---

## 1. HK postgres 承载方式

### 候选对比

| 候选 | 做法 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| **A（推荐）** | 独立 docker compose 栈：`postgres:17` 容器 + named volume + 内存限额，`COMPOSE_PROJECT_NAME=zenithjoy-db`，仅监听 127.0.0.1:5432 | 与 hk-vps 上其它 14 个容器隔离；版本钉住对齐美国 17.9；回滚 = 停删容器不留残留 | 多一个 compose 项目要管 | ✅ 采用 |
| B | 并入现有 `deploy/docker-compose.hk.yml` | 少一个 compose 文件 | 耦合前端发布生命周期，dashboard 重部署可能波及 DB | ❌ 否 |
| C | 裸机 apt postgresql | 无容器开销 | 版本随发行版走、与容器化终局（3ac02755"launchd 改 systemd/docker"）不符 | ❌ 否 |
| D | 云托管 RDS | 免运维 | 成本 + 数据出境合规复杂度 | ❌ 否 |

### 候选 A 最小 compose 片段

```yaml
# hk-vps: /opt/zenithjoy/db/docker-compose.yml
# 启动: COMPOSE_PROJECT_NAME=zenithjoy-db docker compose up -d
services:
  postgres:
    image: postgres:17
    container_name: zenithjoy-db-postgres
    restart: unless-stopped
    ports:
      - "127.0.0.1:5432:5432"
    environment:
      POSTGRES_USER: zenithjoy
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}   # 来自 .env（chmod 600），见「密钥迁移」节
      POSTGRES_DB: zenithjoy
    volumes:
      - zenithjoy_pgdata:/var/lib/postgresql/data
    mem_limit: 1g

volumes:
  zenithjoy_pgdata:
```

要点：
- **仅监听 127.0.0.1:5432**——HK 上 ZJ API 容器走本机回环连库，不暴露公网。
- **named volume**（`zenithjoy_pgdata`）——数据与容器生命周期解耦。
- **mem_limit: 1g**——库总量 31MB（19MB + 12MB），1G 上限绰绰有余，同时保护同机其它容器。
- **postgres:17** 钉大版本，与美国源库 17.9 对齐，dump/restore 无跨版本兼容问题。

---

## 2. 迁移方式

### 候选对比

| 候选 | 做法 | 切换窗口估算 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|---|
| **A（推荐）** | freeze 写入 + pg_dump/restore + compare | **5-15 分钟**（含核对；T4 演练实测校准） | 操作简单、确定性强、库仅 19MB/12MB 传输秒级 | 有停写窗口 | ✅ 采用 |
| B | 逻辑复制（publication/subscription） | 近零窗口 | 停写时间最短 | 要求源库 `wal_level=logical`（需重启生产 postgres）+ 发布/订阅运维复杂度，对 19MB 库过度工程 | ❌ 否 |
| C | 不 freeze 纯 dump | 0（无停写） | 最省事 | dump 窗口内的写入直接丢失 | ❌ 否 |

### freeze 机械动作钉死（审批意见②）

freeze = **停美国对应 LaunchDaemon**，nginx 侧不动：

```bash
# 在美国本机（mmv）执行
# staging freeze（T3 用）：
sudo launchctl bootout system/com.zenithjoy.api.staging

# prod freeze（T5 用）：
sudo launchctl bootout system/com.zenithjoy.api
```

效果：上游 502（HK nginx proxy_pass 打到已停的 520x 端口），写入侧彻底静止。

回拉（解除 freeze）：

```bash
# staging：
sudo launchctl bootstrap system /Library/LaunchDaemons/com.zenithjoy.api.staging.plist

# prod：
sudo launchctl bootstrap system /Library/LaunchDaemons/com.zenithjoy.api.plist
```

选择该动作的理由：单点操作、可逆（bootstrap 一条命令拉回）、避免改 nginx 引入第二变量。

### 迁移主命令序列（T3/T5 执行时引用）

```bash
# 1. freeze（见上）
# 2. dump（美国本机 mmv）：
pg_dump -h localhost -p 5432 -U cecelia -d zenithjoy -Fc -f /tmp/zenithjoy-cutover.dump
pg_dump -h localhost -p 5432 -U cecelia -d zenithjoy_staging -Fc -f /tmp/zenithjoy_staging-cutover.dump

# 3. 传输到 HK（走 Tailscale）：
scp /tmp/zenithjoy*-cutover.dump root@100.86.118.99:/opt/zenithjoy-backups/cutover/

# 4. restore（hk-vps）：
# ⚠️ 必须带 --no-owner --no-privileges：美国侧 dump 的对象 owner 是 cecelia，HK 容器只有 zenithjoy 用户，
#    不带该参数 pg_restore 会因 ALTER OWNER TO cecelia 报错。
# ⚠️ staging 库 compose 不自动创建（POSTGRES_DB 只建 zenithjoy），restore 前先 createdb。
docker exec zenithjoy-db-postgres createdb -U zenithjoy zenithjoy_staging   # 仅首次
docker exec -i zenithjoy-db-postgres pg_restore -U zenithjoy -d zenithjoy \
  --clean --if-exists --no-owner --no-privileges \
  < /opt/zenithjoy-backups/cutover/zenithjoy-cutover.dump
docker exec -i zenithjoy-db-postgres pg_restore -U zenithjoy -d zenithjoy_staging \
  --clean --if-exists --no-owner --no-privileges \
  < /opt/zenithjoy-backups/cutover/zenithjoy_staging-cutover.dump

# 5. compare（见「6. 数据核对方案」）
```

---

## 3. 切流方案（无 DNS 变更）

### 证据

域名入口（Cloudflare tunnel → HK cecelia-tunnel → HK nginx）**早已在 HK**。当前 API 请求的最后一跳是 HK nginx `proxy_pass` 回源美国 Tailscale IP。因此切流只需改 HK 本地 nginx 上游，**不涉及任何 DNS 记录变更**。

### 切流动作

改 HK 两份 nginx.conf 的 proxy_pass 上游 + reload：

| 环境 | 配置文件（hk-vps） | 改前上游 | 改后上游 |
|---|---|---|---|
| prod | `/opt/zenithjoy/autopilot-dashboard/nginx.conf` | `http://100.71.151.105:5200` | HK 本机 ZJ prod API 容器（127.0.0.1:5200 或容器名） |
| staging | `/opt/zenithjoy/autopilot-staging/nginx.conf` | `http://100.71.151.105:5201` | HK 本机 ZJ staging API 容器（127.0.0.1:5201 或容器名） |

reload 命令（hk-vps）：

```bash
docker exec autopilot-dashboard nginx -s reload   # prod
docker exec autopilot-staging nginx -s reload     # staging
```

### TTL 预降节（Vivian ④）

- **tunnel 托管域名事实豁免**：流量经 Cloudflare tunnel，域名解析指向 Cloudflare 边缘，切流动作不触碰 DNS，无 TTL 问题。
- **`cn.zenjoymedia.media` 不动**：唯一 A 记录直连域，本就指 HK，本次迁移不涉及。
- **终局撤 tunnel 预案**：仅当未来终局撤掉 tunnel 改直连时才涉及 DNS 变更——届时**提前 24h 将相关记录 TTL 降至 60s**（本预案在此成文，刀3 范围内不执行）。

### Brain 回连

ZJ API 迁 HK 后，`CECELIA_BRAIN_URL` 指向 HK 已有的 socat 转发（HK 本机 5221 → 美国 Brain 5221），无需新开通道。

---

## 4. 双跑 SSOT 规则

**铁律：任一时刻，每个环境（prod / staging）只有一个写入侧，由 HK nginx 的 proxy_pass 指向唯一决定；禁止双写。**

- HK 库在成为写入侧之前，只接受 dump/restore 灌入与 compare 只读核对，任何服务不得对其写入。
- 美国库在写入侧切走之后转为只读参考（compare 基线），T6 下线前不删除。

### 切换顺序

staging 先切（T3），双跑 **≥48h** 且 compare 无 WARN，才允许 prod 预迁（T4）→ 用户在场切换（T5）。

### 各阶段写入侧状态表

| 阶段 | staging 写入侧 | prod 写入侧 | 说明 |
|---|---|---|---|
| T2（HK 承载就绪） | 美国 | 美国 | HK postgres 栈起好，空库待灌 |
| T3（staging 切换） | **HK** | 美国 | staging freeze → dump/restore → compare 零漂移 → 改 staging nginx proxy_pass → 解冻观察 |
| T3 后双跑 ≥48h | HK | 美国 | 每日 compare 无 WARN 才允许进 T4 |
| T4（prod 预迁演练） | HK | 美国 | prod 数据预灌 HK + 演练计时校准窗口；**不切 prod 流量** |
| T5（prod 切换，用户在场，d8366ef1） | HK | **HK** | prod freeze → 增量 dump/restore → compare 零漂移 → 改 prod nginx proxy_pass |
| T6（美国侧下线） | HK | HK | 确认稳定后才卸载美国 launchd 服务与本机库 |

---

## 5. 回滚预案

**核心保底**：
1. nginx proxy_pass 改回美国 Tailscale 上游，一条命令可回；
2. 美国 launchd 服务与本机库 **T6 之前全程保活不卸载**——任何时刻回滚都有活的旧侧可指。

**持久化漂移铁律（be038f9e）**：每个改配置的步骤必须同时给出「运行时验证 + 持久化验证」两条判据——运行时验证证明改动已生效，持久化验证证明改动写进了重启后仍会加载的文件/卷，二者缺一不可。

### 逐步回滚表

| 步骤 | 动作 | 成功判据 | 回滚命令 | 回滚判据 |
|---|---|---|---|---|
| T2-1 起 HK postgres 栈 | hk-vps 上 `COMPOSE_PROJECT_NAME=zenithjoy-db docker compose up -d` | 运行时：`docker exec zenithjoy-db-postgres pg_isready -U zenithjoy` 输出 accepting connections；持久化：`docker inspect zenithjoy-db-postgres --format '{{.HostConfig.RestartPolicy.Name}}'` = unless-stopped 且 `docker volume inspect zenithjoy-db_zenithjoy_pgdata` 存在 | `COMPOSE_PROJECT_NAME=zenithjoy-db docker compose down -v` | `docker ps -a \| grep zenithjoy-db` 无输出，5432 端口重新空闲（`ss -ltn \| grep 5432` 无输出） |
| T3-1 staging freeze | mmv 上 `sudo launchctl bootout system/com.zenithjoy.api.staging` | 运行时：`curl -s -o /dev/null -w '%{http_code}' http://100.71.151.105:5201/health` 非 200（连接拒绝或超时）；持久化：本步骤不改持久化文件（plist 保留原样），无持久化判据要求 | `sudo launchctl bootstrap system /Library/LaunchDaemons/com.zenithjoy.api.staging.plist` | `curl -s -o /dev/null -w '%{http_code}' http://100.71.151.105:5201/health` 返回 200 |
| T3-2 staging dump/restore | 按「2. 迁移方式」命令序列执行 staging 库 | 运行时：hk-vps 上 `docker exec zenithjoy-db-postgres psql -U zenithjoy -d zenithjoy_staging -c '\dt zenithjoy.*'` 表数与美国侧一致；持久化：数据在 named volume `zenithjoy_pgdata` 内，`docker compose restart postgres` 后表仍在 | hk-vps 上 `docker exec zenithjoy-db-postgres psql -U zenithjoy -c 'DROP DATABASE zenithjoy_staging;'`（HK 侧尚无流量，删库无损） | HK 侧该库不存在；美国库未被触碰（compare 基线仍可跑） |
| T3-3 compare 核对 | 跑 `scripts/zenithjoy-db-compare.sh`（见第 6 节） | 输出零漂移（无 WARN、全表 count 一致、max(created_at) 一致、schema_migrations 一致） | 不适用（只读步骤）；核对失败则回到 T3-2 回滚命令重灌 | 不适用 |
| T3-4 staging 切流 | hk-vps 改 `/opt/zenithjoy/autopilot-staging/nginx.conf` proxy_pass → HK 本机 staging API，`docker exec autopilot-staging nginx -s reload` | 运行时：`curl -s https://<staging域名>/health` 200 且响应来自 HK 实例（version/hostname 字段核对）；持久化：`grep proxy_pass /opt/zenithjoy/autopilot-staging/nginx.conf` 显示 HK 上游，且 `docker restart autopilot-staging` 后仍指 HK | 把 proxy_pass 改回 `http://100.71.151.105:5201` 后 `docker exec autopilot-staging nginx -s reload`（若美国侧仍 freeze，先执行 T3-1 的回滚命令解冻） | `curl -s https://<staging域名>/health` 200 且响应来自美国实例 |
| T4-1 prod 预迁演练 | prod 数据预灌 HK（dump/restore 全程计时），不切流量 | 运行时：HK 侧 `zenithjoy` 库 compare 与演练时刻快照一致；计时结果落文档校准 T5 窗口；持久化：数据在 named volume | hk-vps 上 `docker exec zenithjoy-db-postgres psql -U zenithjoy -c 'DROP DATABASE zenithjoy;'` 后重建空库（预灌数据可丢弃，T5 会重灌） | HK 侧 prod 库回到空库状态；prod 流量全程未受影响（美国侧 `curl http://100.71.151.105:5200/health` 持续 200） |
| T5-1 prod freeze | mmv 上 `sudo launchctl bootout system/com.zenithjoy.api` | 运行时：`curl -s -o /dev/null -w '%{http_code}' http://100.71.151.105:5200/health` 非 200；持久化：本步骤不改持久化文件（plist 保留原样），无持久化判据要求 | `sudo launchctl bootstrap system /Library/LaunchDaemons/com.zenithjoy.api.plist` | `curl -s -o /dev/null -w '%{http_code}' http://100.71.151.105:5200/health` 返回 200 |
| T5-2 prod 增量 dump/restore + compare | 按第 2 节命令序列执行 prod 库，再跑 compare | 运行时：compare 零漂移；持久化：named volume | HK 侧 `DROP DATABASE zenithjoy;` 重灌或放弃本次切换窗口，执行 T5-1 回滚命令解冻美国侧 | 美国侧恢复服务（health 200），HK 侧数据废弃待下次窗口 |
| T5-3 prod 切流 | hk-vps 改 `/opt/zenithjoy/autopilot-dashboard/nginx.conf` proxy_pass → HK 本机 prod API，`docker exec autopilot-dashboard nginx -s reload` | 运行时：`curl -s https://autopilot.zenjoymedia.media/health` 200 且响应来自 HK 实例；持久化：`grep proxy_pass /opt/zenithjoy/autopilot-dashboard/nginx.conf` 显示 HK 上游，且 `docker restart autopilot-dashboard` 后仍指 HK | 把 proxy_pass 改回 `http://100.71.151.105:5200` 后 `docker exec autopilot-dashboard nginx -s reload`，同时执行 T5-1 回滚命令解冻美国侧 | `curl -s https://autopilot.zenjoymedia.media/health` 200 且响应来自美国实例 |
| T6-1 美国侧下线 | 确认 HK 稳定后卸载美国 launchd 服务与本机库 | 运行时：HK 侧连续稳定（health 200 + 日 compare 无 WARN）；持久化：美国 plist 已移除、launchctl 列表无 com.zenithjoy.api* | **T6 前禁止执行本步骤**；若 T6 后需回滚，从 HK dump 反向 restore 回美国库 + bootstrap plist 拉回服务 + nginx 指回美国 | 美国侧 health 200 且数据与 HK 停写时刻一致 |

---

## 6. 数据核对方案

复用 `scripts/zenithjoy-db-compare.sh`（PR #3900 重写版）：

- `information_schema` 动态枚举全量表（非硬编码表清单）；
- 逐表 count 对比；
- 关键表 `max(created_at)` 对比；
- `schema_migrations` 记录对比。

**通过标准：迁移前后各跑一次，零漂移（无任何 WARN）才算过。**

### 前置依赖显式声明（审批意见①）

**T2-T6 全部依赖 cecelia PR #3900 合并**——该脚本当前只在 PR 分支上。若执行 T2 时 #3900 尚未合并，必须先合并该 PR，或将 `scripts/zenithjoy-db-compare.sh` cherry-pick 到 main 后再开工。此依赖不满足时禁止进入任何迁移步骤。

---

## 密钥迁移

- 现状：美国侧 env（含 DB 连接与全部密钥）唯一来源 = LaunchDaemon plist `EnvironmentVariables` 明文。
- 目标：HK 侧改为 compose `.env` 文件，`chmod 600`，**1Password CS Vault 为源**（双写规范），**禁止提交 git**（.gitignore 已含 `.env`）。

迁移的 env 类别（只列类别不列值）：

| 类别 | 说明 |
|---|---|
| DB 连接 | DATABASE_HOST / DATABASE_PORT / DATABASE_NAME / DATABASE_USER / DATABASE_PASSWORD（改指 HK 本机 postgres 容器） |
| Brain 回连 | CECELIA_BRAIN_URL（指 HK socat 5221，见第 3 节） |
| 第三方 API 密钥 | plist 中全部第三方服务密钥，逐条从 1Password CS Vault 取值写入 `.env` |
| 运行参数 | PORT（5200/5201）、NODE_ENV 等非敏感运行配置 |

---

## 资源风险与运维

| 维度 | 现状 | 迁移增量 | 评估 |
|---|---|---|---|
| 内存 | hk-vps 7.6G 总 / 6.2G 可用 | postgres 容器 mem_limit 1G + ZJ API 两容器（node，估 <1G） | 余量充足 |
| 磁盘 | 22G 空闲 | 库总量 31MB + named volume 增长 + dump 中转 | 余量充足；关注 WAL 归档 |
| WAL 归档增长 | `/opt/zenithjoy-wal-archive` 已在持续接收 | 迁移后 HK 本机库也可能产生归档需求 | 纳入巡检项，设磁盘水位告警 |
| 巡检 | janitor 目前只巡美国本机 | — | **建议：janitor 加 HK 巡检**（postgres 容器存活、5432 回环监听、磁盘水位、`/opt/zenithjoy-backups` 与 `/opt/zenithjoy-wal-archive` 增长速率） |

---

## Runner 防呆（Vivian ⑤）

hk-vps 上 12 个 GitHub runner 当前**全部 disabled**。

**铁律：刀3 任何迁移步骤（T2-T6）不得重启其中任何一个 runner。** 迁移全程 deploy 类 workflow 走 ubuntu-latest + Tailscale ssh 触达目标机（现有 CI/CD 事实），不需要自托管 runner。

12 个 disabled runner 名单：

1. hk-cecelia
2. hk-cecelia-2
3. hk-cecelia-3
4. hk-cecelia-4
5. hk-cecelia-5
6. hk-cecelia-6
7. hk-cecelia-7
8. hk-cecelia-8
9. hk-ci-templates
10. hk-vps-VM-0-8-ubuntu
11. hk-platform-scrapers
12. hk-pressure-test-repo

---

## T2-T6 执行索引

| 任务 | 内容 | 引用本文档章节 |
|---|---|---|
| **T2** | HK postgres 承载栈就绪 + 密钥落 `.env` | 第 1 节（承载方式 + compose 片段）、密钥迁移节、第 6 节前置依赖（#3900）、回滚表 T2-1 |
| **T3** | staging 迁移 + 切流 + 双跑观察 | 第 2 节（freeze/dump/restore 命令）、第 3 节（切流）、第 4 节（SSOT 顺序）、第 6 节（compare）、回滚表 T3-1~T3-4 |
| **T4** | prod 预迁演练（计时校准窗口，不切流量） | 第 2 节（窗口估算校准）、第 6 节（compare）、回滚表 T4-1 |
| **T5** | prod 切换（用户在场，d8366ef1） | 第 2 节、第 3 节、第 4 节（状态表）、第 6 节、回滚表 T5-1~T5-3 |
| **T6** | 美国侧下线（launchd 卸载 + 本机库清理） | 第 5 节核心保底（T6 前保活铁律）、回滚表 T6-1、Runner 防呆节 |
