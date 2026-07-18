# 设计:刀0 照相层复活——扫描器定时重扫 + registry GET 改道 + 账龄哨兵

> 2026-07-18 | 任务 dfb27642 | 信息逻辑重建刀0(照相层/账本层分层,主理人拍板 architecture 决策×3)
> 背景:proposer 开工查询命中率 8%/3%/1%(system_registry 54 API/6 表/18 测试 vs 真实 660+/209/1816);
> 三扫描器 5/26 起无任何触发(Notion issue 2288b43c)。

## 目标

1. 照相层(api_registry / db_schema_registry / test_registry)恢复每日重拍
2. `GET /api/brain/registry?type=api|db_schema|test` 从近空的 system_registry 改道读照相层,附账龄
3. 账龄哨兵:照片超过 24h 未刷 → 响应顶层 `stale: true` + 警告文案(cron 死掉自动可见,哨兵即守卫)

## 非目标

- 不动 POST/PATCH(账本层增量:reviewer planned / report actuals 照旧写 system_registry)
- 不动 type=skill/machine/other 的 GET(照旧)
- 不做索引服务/锚点/图抽取(刀A/B/C 的事)
- 不扫 zenithjoy-workspace(扫描器现有 SCAN_DIRS 只含本仓,扩仓另刀)

## 设计

### 1. GET 改道(packages/brain/src/routes/registry.js)

现有代码已有 per-type 表路由先例(`type=skill` → skill_registry 独立查询)。照抄该模式加三个分支:

| type | 表 | items 字段映射(兼容 system_registry 消费习惯) |
|---|---|---|
| api | api_registry | name=`"${method} ${path}"`,location=`"${file_path}:${line_number}"`,description、area、scanned_at 原样 |
| db_schema | db_schema_registry | name=table_name,location=area,description=columns(截断),scanned_at 原样 |
| test | test_registry | name=file_path,location=file_path,description=`"${test_count} tests, ${test_type}"`,status、area、scanned_at 原样 |

- 响应形状(已定,消歧):现有 GET 各分支返回**裸数组**(registry.js:93/132)。三个新分支**改用包装对象** `{ items: [...], count, freshness: { latest_scan, stale, warning } }`——哨兵要顶层 stale 字段,只能包装;type=skill 及其余 type 保持裸数组不动。消费方(proposer/dev skill)是整份 JSON 喂 LLM 阅读、无 jq 字段抽取(已核查),形状差异可容忍。
- `search`/`limit`/`offset` 继续支持(search 作用于 name/path/file_path/table_name)
- **freshness 计算抽纯函数** `computeFreshness(latestScanAt, now, thresholdHours=24)` → `{stale, ageHours, warning}`,
  单测直接喂时间,不需要 mock 时钟;route 层调用它
- 表为空(从未扫过)→ `stale: true`,warning 写明"照相层无数据,先跑 scripts/scan/run-all-scans.sh"

### 2. 扫描器定时化

- 新增 `scripts/scan/run-all-scans.sh`:
  - `set -euo pipefail`;依次跑 scan-api-registry.js / scan-db-schema.js / scan-test-registry.js
  - 任一失败:继续跑完其余,最后以非零退出(让 cron 日志可见失败)
  - 开头若当前 checkout 在 main 且干净 → `git pull --ff-only`;否则跳过 pull 只记 warning(不碰别人的工作区状态)
- host crontab 新增一行(与 janitor/sync-to-hk 同模式,系统时区=America/Los_Angeles):
  `0 5 * * * cd /Users/administrator/perfect21/cecelia && bash scripts/scan/run-all-scans.sh >> /tmp/registry-scan.log 2>&1`
  (LA 05:00 = 北京 20:00,避开白天开发高峰)
- cron 安装动作在 PR 合并后手动执行一次(crontab 不入库),但 run-all-scans.sh 顶部注释写明这行 cron,作为安装说明 SSOT

### 3. 守卫(哨兵死规矩)

- 环境接缝 = "cron 会不会静默死掉"。守卫形态 = 账龄哨兵本身:cron 停摆 >24h,所有消费方的响应自动带
  `stale: true`——不需要额外监控件
- proven-to-fire:验收时人为把三表 scanned_at 改老 25h,GET 亲眼见 `stale: true`;再跑一次扫描,见它变 false
- 逻辑接缝 = freshness 计算/字段映射 → vitest 单测(照 routes/__tests__ 现有 mock pool 模式)

## 测试策略(四档:integration + unit)

- unit:computeFreshness 边界(23h59m=fresh / 24h01m=stale / null=stale)
- unit(route,mock pool):type=api 返回照相层映射字段;type=skill 行为不变;search/limit 生效
- integration(真 DB,CI 有 postgres):三分支真查 + freshness 真算
- 手动验收(PR 后):run-all-scans.sh 真跑,api_registry 行数 598→当前真实值,scanned_at=今天

## 版本

packages/brain 改动 → brain 版本 bump(四处同步,check-version-sync.sh)

## 实现注意(Research 审查提醒,必须处理)

1. 现有单测 `packages/brain/src/routes/__tests__/registry.test.js:72-82`(断言 type=api SQL 含 system_registry)及 `packages/brain/src/__tests__/registry.test.js` 相关用例会被改道打红——同 PR 内一并更新,这是 TDD 的 Red 素材而非事故
2. mock 模式照抄 routes/__tests__/registry.test.js:3-16(vi.mock db.js + mockQuery)
3. test_registry.status 列来自 migration 311,SELECT 安全;CI 的 brain-integration job 自带 pgvector/pg15 真库,integration 测试放 src/__tests__/integration/ 即被自动收录

## 影响范围

- harness-contract-proposer Step1.1 / engine dev skill 的 curl 命令零改动,返回数据从 8% 变全量
- system_registry 里 type=api/db_schema/test 的 61 行不再被 GET 返回(账本层数据,POST 侧对比流程不受影响)
