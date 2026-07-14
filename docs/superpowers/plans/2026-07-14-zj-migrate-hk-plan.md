# 刀3-T1 ZJ 迁 HK 方案文档 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 产出 `docs/architecture/2026-07-14-zj-migrate-hk/architecture.md`，作为刀3 T2-T6 执行的方案 SSOT。

**Architecture:** 纯 docs PR，零代码。全部事实与结论已在 spec（`docs/superpowers/specs/2026-07-14-zj-migrate-hk-design.md`）固化，本计划把 spec 展开成正式方案文档（仿 `docs/architecture/2026-07-13-cecelia-zenithjoy-db-separation/architecture.md` 的结构惯例），再加机械自检。

**Tech Stack:** Markdown；验收自检用 `node -e` readFileSync 断言。

---

### Task 1: 写 architecture.md

**Files:**
- Create: `docs/architecture/2026-07-14-zj-migrate-hk/architecture.md`
- 输入（必须先读）: `docs/superpowers/specs/2026-07-14-zj-migrate-hk-design.md`（六个结论+全部调研事实）、`docs/architecture/2026-07-13-cecelia-zenithjoy-db-separation/architecture.md`（结构惯例参照）

- [ ] **Step 1: 读两个输入文件**

- [ ] **Step 2: 写文档**，章节骨架与必须内容如下（spec 是内容 SSOT，此处列结构与硬性要素；写作时把 spec 每条结论展开成含证据与命令的正式章节）：

```markdown
# ZenithJoy 整体迁移 hk-vps 方案（拆库刀3）

头部元信息：Initiative c62f6bcf / 决策 3ac02755+d8366ef1+be038f9e / 日期 2026-07-14 / 状态 T1 产出

## 背景
（拆库三刀衔接：刀1 schema→独立库、刀2 dev 隔离已完成；刀3 = ZJ staging+prod 整体迁 HK。为什么迁：3ac02755 原文理由）

## 现状事实（三路只读调研，2026-07-14）
（流量链 ASCII 图：Cloudflare → HK cecelia-tunnel → HK nginx(80/521) → proxy_pass 100.71.151.105:5200/5201；
美国：3 个 LaunchDaemon + plist 明文 env + postgres 17.9 回环监听，zenithjoy 19MB/75表、zenithjoy_staging 12MB；
HK：无 postgres、5200/5201/5432/5433 空闲、4核/7.6G/22G、/opt/zenithjoy/repo 已有 clone + docker-compose.hk.yml、
每日 dump+WAL 归档已落 HK、12 个 runner 全 disabled）

## 1. HK postgres 承载方式（4 候选对比表 + 推荐 A：独立 compose 栈）
（表格：候选|做法|优点|缺点|结论；A 附最小 compose 片段：postgres:17 + named volume + 127.0.0.1:5432 + mem_limit）

## 2. 迁移方式（3 候选对比表 + 推荐 A：freeze + pg_dump/restore + compare）
（各候选切换窗口估算；freeze 机械动作钉死 = sudo launchctl bootout system/com.zenithjoy.api[.staging]，
回拉 = bootstrap；窗口预估 5-15 分钟，T4 演练实测校准）

## 3. 切流方案（无 DNS 变更）
（证据：域名入口已在 HK；切流 = 改两份 nginx.conf proxy_pass 上游 + reload，给出确切文件路径
/opt/zenithjoy/autopilot-dashboard/nginx.conf、/opt/zenithjoy/autopilot-staging/nginx.conf 与 reload 命令；
TTL 预降节：tunnel 域名事实豁免 + cn.zenjoymedia.media 不动 + 终局撤 tunnel 预案（提前 24h 降 60s）；
CECELIA_BRAIN_URL 迁后指 HK socat 5221）

## 4. 双跑 SSOT 规则
（铁律：单写入侧由 nginx proxy_pass 唯一决定、禁双写；staging 先切跑 ≥48h compare 无 WARN 才动 prod；
T3/T4/T5 各阶段"谁是写入侧"状态表）

## 5. 回滚预案
（逐步表格：步骤|动作|成功判据|回滚命令|回滚判据；核心保底：proxy_pass 一条命令改回 +
美国 launchd 服务与本机库 T6 前保活不卸载；每个改配置步骤给"运行时验证 + 持久化验证"双判据（be038f9e））

## 6. 数据核对方案
（复用 scripts/zenithjoy-db-compare.sh（#3900 动态全量表版）；迁移前后各跑一次零漂移；
前置依赖显式声明：T2-T6 依赖 #3900 合并，未合并则先合并或 cherry-pick）

## 密钥迁移
（plist 明文 env → HK compose .env chmod 600，1Password CS 为源，禁提交 git；列 env 类别不列值）

## 资源风险与运维
（内存/磁盘余量评估；janitor 加 HK 巡检建议；WAL 归档增长）

## Runner 防呆
（12 个 disabled runner 名单，任何迁移步骤不得重启）

## T2-T6 执行索引
（每个任务引用本文档哪几节）
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/2026-07-14-zj-migrate-hk/architecture.md
git commit -m "docs(architecture): 刀3 ZJ 整体迁 HK 迁移方案（T1 产出）"
```

### Task 2: 验收自检

**Files:** 无新文件（机械断言，不进 repo）

- [ ] **Step 1: 跑断言**（六项 DoD 章节齐全 + ≥3 候选 + 关键铁律词出现）

```bash
node -e "
const s = require('fs').readFileSync('docs/architecture/2026-07-14-zj-migrate-hk/architecture.md','utf8');
const must = ['承载方式','迁移方式','切流','SSOT','回滚','数据核对','TTL','launchctl bootout','zenithjoy-db-compare.sh','runner'];
const miss = must.filter(k => !s.includes(k));
if (miss.length) { console.error('缺失:', miss); process.exit(1); }
const candidates = (s.match(/候选/g)||[]).length;
if (candidates < 3) { console.error('候选对比不足3'); process.exit(1); }
console.log('自检通过');
"
```

Expected: `自检通过`

- [ ] **Step 2: 缺失则补写后重跑，直到通过**
