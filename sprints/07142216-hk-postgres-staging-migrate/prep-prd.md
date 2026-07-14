# 小改动 PrepPRD：刀3-T2 — hk-vps 起独立 postgres + zenithjoy_staging 库先行迁移

## 改什么
按 T1 方案（docs/architecture/2026-07-14-zj-migrate-hk/architecture.md 第 1/2/6 节 + 回滚表 T2-1）执行：
1. hk-vps `/opt/zenithjoy/db/` 新建独立 compose 栈（postgres:17 + named volume + 127.0.0.1:5432 + mem_limit 1g）
2. 密码走 1Password CS → 双写 `~/.credentials/`（本机）+ HK `.env`（chmod 600），绝不落 git
3. zenithjoy_staging dump（美国）→ scp → restore（HK，--no-owner --no-privileges + createdb）
4. HK 备份 cron 就位（TZ=Asia/Shanghai）
5. compare 全量表核对（#3900 版脚本，改造为可指定 HK 目标连接）
6. 证据 PR：compose 文件 + 备份脚本进 repo，compare 输出/日期核对/runner 防呆 docker ps 对比进 PR body

## 为什么改
刀3-T2（Brain task 3848bc8d，Initiative c62f6bcf），T3 staging 服务迁移的前置：先把库备好核对齐。

## 关联上下文
- T1 方案文档（PR #3905 merged）= 执行 SSOT；前置 #3900 已合并（compare 脚本动态全量表版在 main）
- decisions：3ac02755 / d8366ef1 / be038f9e（每步双判据）
- 前置已核对 ✅：op 凭据可用 / hk-vps 可达（22G 空闲，5432/5200/5201 空闲）/ compare 脚本在 main

## 影响范围
- HK 新增 1 个容器 + 1 个 volume + 1 条 cron；不碰现有 14 个容器、不碰 12 个 disabled runner、不碰美国生产
- staging 库在 HK 只灌不接流量（写入侧仍在美国，SSOT 规则第 4 节）；**本任务不切流、不 freeze 美国服务**（dump 用 pg_dump 一致性快照即可，正式切换的 freeze 在 T3）

## 错误路径（来自 T1 回滚表 T2-1/T3-2）
- postgres 起不来/起错 → `docker compose down -v` 全撤，5432 恢复空闲
- restore 报错 → DROP DATABASE 重灌（HK 无流量，无损）
- compare 有 WARN → 不算过，重灌直到零漂移；美国侧全程未被触碰
- 磁盘告急 → dump 中转文件用后即删；22G 余量 vs 31MB 库，风险极低

## 判定点登记表
| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| HK 库与美国对齐的判定 | 人眼抽查 / compare 脚本全量表 | compare 脚本零 WARN | #3900 动态枚举全表 count+max(created_at)+migrations | 误判=T3 带脏数据切流；有 T3 前再跑一次兜底 |

## 验收标准（任务 DoD 原文）
- [ ] HK psql 可连，schema+行数与本机对齐（compare 输出在 PR）
- [ ] 备份 cron 就位且 TZ=Asia/Shanghai（date 输出核对在 PR）
- [ ] 部署前后 docker ps 对比：已停用 runner 未被触碰（防呆证据在 PR）
- [ ] 凭据不落 git
- [ ] CI 全绿
