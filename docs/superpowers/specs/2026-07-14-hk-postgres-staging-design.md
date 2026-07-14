# Spec：刀3-T2 — HK 独立 postgres 栈 + staging 库先行迁移

- 任务：Brain task 3848bc8d（Initiative c62f6bcf 刀3-T2）；执行 SSOT = docs/architecture/2026-07-14-zj-migrate-hk/architecture.md（§1 承载 / §2 迁移命令 / §6 核对 / 回滚表 T2-1）
- 类型：repo 交付物（脚本+compose）+ HK 实操 + 证据 PR；不切流、不 freeze、不碰美国生产服务

## Repo 交付物（cecelia repo，新目录 scripts/zj-migrate-hk/）

1. `docker-compose.db.yml` — T1 §1 候选 A 片段原样落地（postgres:17 / named volume zenithjoy_pgdata / 127.0.0.1:5432 / mem_limit 1g / .env 注入密码）
2. `backup-zenithjoy-hk.sh` — HK 本地每日备份：docker exec pg_dump 全部 zenithjoy* 库 → /opt/zenithjoy-backups/hk-local/，保留 14 天，输出带时间戳日志
3. `compare-us-hk.sh` — US↔HK 库对比：参数 `<db_name>`；US 侧本机 psql，HK 侧 `ssh root@100.86.118.99 docker exec zenithjoy-db-postgres psql`；方法论复用 #3900（动态枚举 zenithjoy schema 全量表 + 逐表 count + 关键表 max(created_at) + schema_migrations 条数）；任何差异输出 WARN 且 exit 1
4. `README.md` — 部署步骤（引用 T1 文档章节），含回滚命令

## HK 实操步骤（全部有回滚，T1 回滚表 T2-1）

1. 证据快照：docker ps + runner 状态（前）
2. 生成强密码 → `op item create` 存 1Password CS（"ZenithJoy HK Postgres"）→ 双写本机 ~/.credentials/zenithjoy-hk-db.env + HK /opt/zenithjoy/db/.env（均 chmod 600）
3. HK：/opt/zenithjoy/db/ 放 compose + .env → `COMPOSE_PROJECT_NAME=zenithjoy-db docker compose up -d` → pg_isready 验证
4. 美国：pg_dump zenithjoy_staging（-Fc）→ scp 到 HK → createdb + pg_restore --clean --if-exists --no-owner --no-privileges
5. compare-us-hk.sh zenithjoy_staging → 零 WARN
6. 备份 cron：HK root crontab 加 `CRON_TZ=Asia/Shanghai` 行 + 每日 03:30 跑 backup 脚本；手跑一次验证产物存在
7. 证据快照：docker ps + runner 状态（后），diff 证明只多 zenithjoy-db-postgres 一个容器
8. be038f9e 双判据：运行时（pg_isready/cron -l/compare 输出）+ 持久化（restart policy unless-stopped、volume 存在、crontab -l、docker compose restart 后重验 pg_isready）

## 安全铁律

- 密码不落 git：compose 用 `${POSTGRES_PASSWORD}`，.env 只在 HK 与 ~/.credentials；PR 全文无密钥
- 12 个 disabled runner 不触碰（前后 systemctl 状态对比为证）
- 美国侧只读（pg_dump），不停服不改配置

## 测试策略

integration（实操验证为主）+ trivial（CI）：
- CI：`bash -n` 三个脚本语法检查（DoD manual: 命令）；docs/scripts 改动不触发重活
- 实操证据全部进 PR body（compare 输出 / date / docker ps diff / crontab -l）

## 不做

- 不迁 zenithjoy 生产库（T4）；不切流（T3）；不装 ZJ API 容器（T3）；不动 WAL 归档现有机制
