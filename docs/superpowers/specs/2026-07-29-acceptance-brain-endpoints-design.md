# Acceptance 刀 1：Brain 验收公网端点 — 设计

日期：2026-07-29
Brain task：ab4efe7a-9e8a-4d29-8ebd-9ef24fd5b1a6
决策链：19f2632c（验收前端走 Notion/Zenithjoy-July，Brain DB 为唯一 SSOT）、c08c2173（独立 5223 listener 架构）
上游验证：Notion Worker pilot 已跑通（worker 019fac67-c538-70be-8fe0-b5614cef3cb1，两层表结构实弹验证）

## 目标

给 Notion Worker 验收闭环提供 Brain 侧地基：验收数据落 Brain DB（SSOT），Worker 从公网拉验收单、回写员工判定结果。

## 数据模型（migration 369_acceptance_tables.sql）

```sql
CREATE TABLE IF NOT EXISTS acceptance_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key TEXT NOT NULL UNIQUE,          -- 业务主键（harness task id / 手动 slug）
  title TEXT NOT NULL,
  gp_id TEXT,                            -- product-map golden path id
  line TEXT,                             -- line02 等
  surface TEXT,                          -- android/windows/web/api
  version TEXT,                          -- 被验收版本
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_review','passed','failed')),
  pass_rate NUMERIC(4,3),                -- 0~1，results 回写时重算（3 位小数，读回需按 3 位比较）
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','harness')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS acceptance_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES acceptance_runs(id) ON DELETE CASCADE,
  check_key TEXT NOT NULL UNIQUE,        -- 业务主键（<run_key>:<seq> 约定）
  kind TEXT NOT NULL CHECK (kind IN ('FR','NFR','Invariant','SOP')),
  name TEXT NOT NULL,
  device TEXT,
  result TEXT CHECK (result IN ('通过','不通过','无法验证')),  -- NULL=待验收
  note TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_acceptance_checks_run ON acceptance_checks(run_id);
CREATE INDEX IF NOT EXISTS idx_acceptance_runs_status ON acceptance_runs(status, created_at);
```

结尾按约定 `INSERT INTO schema_version VALUES ('369', ...) ON CONFLICT DO NOTHING`。
本地验证死规矩：`DB_NAME=cecelia_scratch node src/migrate.js`（严禁裸跑打进生产库）。

## 组件

### 1. `src/routes/acceptance.js` — 工厂注入范式（仿 harness-commander）

**`createAcceptanceInternalRouter({ pool })`** — 挂 5221 `/api/brain/acceptance`：

- `POST /runs`：建单。body `{ run_key, title, gp_id?, line?, surface?, version?, source?, checks: [{ kind, name, device? }] }`。
  - 按 run_key 幂等：已存在 → 200 返回现有（不重复建，不覆盖已有结果）
  - checks 逐条生成 check_key = `<run_key>:<3位序号>`
  - 校验：run_key/title/checks 非空，kind 枚举，整批事务
- `GET /runs/:run_key`：查单（含 checks）——调试与刀 3 用

**`createAcceptancePublicRouter({ pool })`** — 挂 5223 根：

- `GET /acceptance/pending`：返回 `{ runs: [{ run_key, title, gp_id, line, surface, version, status, pass_rate, checks: [...] }] }`，范围 status IN ('pending','in_review')
- `POST /acceptance/results`：body `{ results: [{ check_key, result, note? }] }`
  - 校验：整批先验（check_key 全部存在 + result 枚举合法），任一非法 → 400 列出坏项，整批拒绝
  - 落库：事务内逐条 UPDATE（last-write-wins，写 decided_at/updated_at）
  - 重算：受影响的每个 run —— pass/fail/pending 计数 → pass_rate = pass/total；status：存在 NULL result → 'in_review'；有不通过且全部已判 → 'failed'；全部通过（pass === total）→ 'passed'；全部已判但含"无法验证" → 停在 'in_review'（需人工重验或改判，不会自动变终态）
  - 返回 `{ updated: n, runs: [{ run_key, pass_rate, status }] }`

### 2. `src/acceptance-public-server.js` — 独立公网 listener

- `startAcceptancePublicServer({ pool, port })`：独立 express app（express.json 1mb + 限流 60s/60次 + Bearer 鉴权中间件 + public router），其余路径全 404
- 鉴权：仿 harness-pending-reviews **fail-closed** —— `ACCEPTANCE_API_TOKEN` 未配置 → **不启动 listener**（server.js 打印一行说明）；配置了 → Bearer + `timingSafeEqual`（长度不等直接拒），失败 401 恒定响应体
- server.js 接线：`const ACCEPTANCE_PUBLIC_PORT = process.env.ACCEPTANCE_PUBLIC_PORT || 5223`，在主 listen 之后调用，启动失败不拖垮主进程（catch + error log）

### 3. 部署说明（PR 内文档，不含实际开通）

`docs/current/acceptance-endpoint-deploy.md`：cloudflared ingress 加 `brain-acceptance.zenjoymedia.media → localhost:5223`；token 生成（`openssl rand -base64 32`）双写 1Password CS + `~/.credentials/acceptance.env`；Worker env 推送命令。

## 错误路径

| 场景 | 行为 |
|---|---|
| token 未配置 | 5223 不监听（fail-closed），主 Brain 正常 |
| 无/错 token | 401，恒定响应，timingSafeEqual |
| results 含未知 check_key / 非法枚举 | 400 + 坏项清单，整批拒绝（不部分落库）|
| 重复提交同 check | 幂等覆盖 last-write-wins |
| POST /runs 重复 run_key | 200 返回现有单，不覆盖 |
| Brain 重启 | cloudflared 502，Worker 下轮重试，无丢失 |
| 公网扫描 | 仅两路由，404 其余；限流 60/min |
| 公网直连 IP:5223 | listener 只绑 127.0.0.1，必须经 cloudflared |

## 测试策略

- **unit（vitest + supertest，mock pool 工厂注入）**：
  - internal：建单幂等/校验 400/checks 生成
  - public：鉴权（无 token 501/503 语义→不监听所以单测直接测中间件 401 路径）、pending 输出结构、results 整批原子拒绝、pass_rate/status 重算矩阵（全过/含挂/含待）
- **integration（`*.integration.test.js`，cecelia_test 真库）**：migration 369 建表 + 全链：POST runs → GET pending → POST results → 断言 DB pass_rate/status
- **E2E（合并后手动验收，本机）**：curl 5223 带真 token 走完整链（验收标准）
- trivial 不写：部署文档

## 不包含

Worker 改造（刀 2）、harness 自动建单+通知（刀 3）、cloudflared 域名实际开通（部署动作）、Notion 同步字段（notion_synced_at 等刀 2 需要时再加）

## 版本与门禁

- `packages/brain` patch bump + package-lock + `.brain-versions` append + `DEFINITION.md` Brain 版本行（check-version-sync.sh 三处）
- DevGate：facts-check.mjs / check-version-sync.sh / check-dod-mapping.cjs 全过再 push
- EXPECTED_SCHEMA_VERSION 是地板语义（353），本次不动
