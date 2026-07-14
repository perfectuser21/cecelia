# 小改动 PrepPRD：拆库刀3-T1 — ZJ 整体迁 HK 迁移方案设计文档

## 改什么
新增 `docs/architecture/2026-07-14-zj-migrate-hk/` 方案文档（纯 docs PR，不动任何生产代码/配置），后续刀3 T2-T6 全部引用此文档。

## 为什么改
拆库三刀（decision 3ac02755）刀3 = ZenithJoy 整体迁 hk-vps。T2-T6 是执行任务，必须先有一份经调研的方案作为 SSOT，否则每个任务各自摸索会漂移。

## 必须覆盖（任务 DoD，Vivian 质检已吸收）
1. HK postgres 承载方式对比：独立 docker compose 实例 vs 复用现有栈，≥3 候选含理由
2. 迁移方式对比：pg_dump/restore vs 逻辑复制 vs freeze+增量，各自切换窗口估算
3. 切流方案：实地摸清 staging-autopilot/autopilot 域名与 Cloudflare tunnel 现状（cn-https/cecelia-tunnel 容器在 HK 的角色），切 HK 具体改法，含 DNS/tunnel TTL 预降步骤
4. 双跑期间写入路由与单一真源（SSOT）判定规则——T3/T4/T5 前置输入
5. 回滚预案：每一步的回滚动作+判据
6. 数据核对方案：引用 cecelia #3900 全量表 compare 脚本

## 关联上下文
- Initiative c62f6bcf（拆库刀3），decisions 3ac02755 / d8366ef1 / be038f9e
- 交接：docs/handoffs/202607142110-db-cutover-knife3-ready.md（hk-vps 容量已核查：22G 空闲、5200/5201 端口空闲）
- 撞车检查：无相关 open PR；#3854/#3900 范围不重叠

## 影响范围
纯新增文档，零代码影响。调研阶段对 hk-vps / Cloudflare 只读（ssh 查看、curl 查询），不改任何配置。

## 约束
- 禁派 Codex（核心 DB 迁移方案，本机 Claude 执行）
- 只读调研不动生产
- 8 个已停用 HK runner 防呆：方案里必须写明不得重启

## 验收标准
- [ ] ≥3 候选对比、推荐有理由
- [ ] SSOT 规则与 TTL 预降步骤成文
- [ ] 回滚预案逐步可执行
- [ ] CI 全绿
