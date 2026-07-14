# Spec：拆库刀3-T1 — ZJ 整体迁 HK 迁移方案文档

- 任务：Brain task `dfeae60e`（Initiative c62f6bcf 刀3-T1）
- 决策来源：3ac02755（终局格局）/ d8366ef1（切换日）/ be038f9e（持久化漂移铁律）
- 类型：纯 docs PR（零代码），交付物 = `docs/architecture/2026-07-14-zj-migrate-hk/architecture.md`
- 设计审批：Research Subagent APPROVE（autonomous Tier 1）

## 目标

产出刀3（ZJ staging+生产整体迁 hk-vps）的方案 SSOT，T2-T6 全部引用。覆盖任务 DoD 六项：承载方式、迁移方式、切流、SSOT 规则、回滚、数据核对。

## 调研已确立的事实（文档的证据基座）

1. **流量链现状**：Cloudflare 边缘 → HK `cecelia-tunnel`（token 模式，ingress 托管 Cloudflare 远端）→ HK nginx（autopilot-dashboard:80 / autopilot-staging:521）→ `proxy_pass http://100.71.151.105:5200|5201`（美国 Mac Tailscale IP）。**域名入口早已在 HK，API 回源美国。**
2. **美国本机**：ZJ prod(5200→zenithjoy 库,19MB,75表)/staging(5201→zenithjoy_staging,12MB)/dev(5202) 三个 LaunchDaemon，node 直跑蓝绿 release 目录；env（含 DB 连接与全部密钥）唯一来源 = plist EnvironmentVariables 明文；postgres 17.9 Homebrew 仅监听回环。
3. **hk-vps**：无 postgres；5200/5201/5432/5433 空闲；4核/7.6G 内存（6.2G 可用）/22G 磁盘空闲；每日 dump + WAL 归档已落 HK `/opt/zenithjoy-backups` `/opt/zenithjoy-wal-archive`；`/opt/zenithjoy/repo` 已有完整 clone + `deploy/docker-compose.hk.yml`（deploy.yml 已有 HK docker build API 的 job 雏形）；12 个 GitHub runner 全 disabled（防呆：绝不重启）。
4. **CI/CD**：deploy 类 workflow 全 ubuntu-latest + Tailscale ssh 触达目标机；`promote-prod.yml` 蓝绿切 current 为人工放行闸。

## 方案文档的六个结论（章节骨架）

### 1. HK postgres 承载 — 推荐候选 A
- **A（推荐）**：独立 docker compose 栈（`postgres:17` 容器 + named volume + 内存限额，`COMPOSE_PROJECT_NAME=zenithjoy-db`，仅监听 127.0.0.1:5432）。理由：与其它 14 个容器隔离、版本钉住对齐美国 17.9、回滚=停删容器不留残留。
- B：并入现有 `deploy/docker-compose.hk.yml`——耦合前端发布生命周期，dashboard 重部署可能波及 DB，否。
- C：裸机 apt postgresql——版本随发行版走、与容器化终局（3ac02755"launchd 改 systemd/docker"）不符，否。
- D：云托管 RDS——成本 + 数据出境合规复杂度，否。

### 2. 迁移方式 — 推荐候选 A
- **A（推荐）**：freeze 写入 + pg_dump/restore + compare。库仅 19MB/12MB，窗口预估 5-15 分钟（含核对），T4 演练实测校准。
- B：逻辑复制——近零窗口，但要求源库 `wal_level=logical`（需重启生产 postgres）+ 发布/订阅运维复杂度，对 19MB 库过度工程，否。
- C：不 freeze 纯 dump——窗口内写入丢失风险，否。
- **freeze 机械动作钉死**（审批意见②）：停美国对应 LaunchDaemon（`sudo launchctl bootout system/com.zenithjoy.api[.staging]`）= 上游 502，nginx 侧不动。理由：单点操作、可逆（bootstrap 拉回）、避免改 nginx 引入第二变量。

### 3. 切流 — 无 DNS 变更
- 切流 = 改 HK 两份 nginx.conf 的 proxy_pass 上游（`100.71.151.105:520x` → HK 本机容器）+ `docker exec nginx -s reload`。
- TTL 预降（Vivian ④）：tunnel 托管域名不涉及 DNS TTL（事实豁免）；唯一 A 记录直连域 `cn.zenjoymedia.media` 本就指 HK 不动；仅当终局撤 tunnel 改直连时才涉及——届时提前 24h 将 TTL 降至 60s（预案成文）。
- ZJ API 迁 HK 后 `CECELIA_BRAIN_URL` 指 HK 已有 socat 5221→美国 Brain。

### 4. 双跑 SSOT 规则
- 铁律：任一时刻每个环境（prod/staging）只有一个写入侧，由 HK nginx proxy_pass 指向**唯一决定**；禁双写。
- 顺序：staging 先切（T3），双跑 ≥48h compare 无 WARN，才允许 prod 预迁（T4）→ 用户在场切换（T5）。

### 5. 回滚预案
- 每步"动作 + 判据 + 回滚命令"表格。
- 核心保底：nginx proxy_pass 改回美国 Tailscale 上游一条命令可回；美国 launchd 服务与本机库 **T6 之前全程保活不卸载**。

### 6. 数据核对
- 复用 `scripts/zenithjoy-db-compare.sh`（#3900 重写版：information_schema 动态枚举全量表 + count 对比 + 关键表 max(created_at) + schema_migrations）。迁移前后各跑一次，零漂移才算过。
- **前置依赖显式声明**（审批意见①）：T2-T6 依赖 cecelia #3900 合并（脚本当前只在 PR 分支）；文档写明"若 #3900 未合并，先合并或 cherry-pick 该脚本"。

### 附带节
- 密钥迁移：plist 明文 env → HK compose `.env`（chmod 600），1Password CS Vault 为源，禁提交 git。
- 资源风险：内存/磁盘余量评估 + 迁后 janitor 加 HK 巡检建议。
- runner 防呆（Vivian ⑤）：12 个 disabled runner 名单 + "任何步骤不得重启"声明。
- 持久化漂移铁律（be038f9e）：每个改配置步骤必须同时给出"运行时验证 + 持久化验证"两条判据。

## 测试策略

docs-only PR，档位 **trivial**：
- CI：ci.yml changes 过滤后重活全 skipped，轻量 job（gitleaks/dod-format-check 等）须绿；不携带根 DoD.md。
- 验收自检（manual:）：`node -e` readFileSync 断言 architecture.md 存在且包含六个必需章节标题与"≥3 候选"表格。

## 不做

- 不改任何代码/配置/生产（只读调研已完成，写作阶段零外部访问）。
- 不执行迁移动作（T2-T6 的事）。
- 不清理 CI 里 PGDATABASE 变量名（已另立 P1）。
