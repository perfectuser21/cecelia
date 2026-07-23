# Contract Draft — ops-panorama 执行全景面板

**Task ID**: 28e7c41a-9384-405b-9e82-aa5b9871293f
**Sprint Dir**: sprints/07231722-relay-28e7c41a
**Contract Round**: 1（首轮，无 reviewer feedback）
**Target Environment**: local_api
**Date**: 2026-07-23

---

## 1. 行为清单（[BEHAVIOR]）

### 后端 API

**[BEHAVIOR-01]** `GET /api/brain/ops-panorama` 返回 HTTP 200，响应体含 `sampled_at`（ISO8601 字符串，非 null）。

**[BEHAVIOR-02]** 响应体顶层结构符合以下 schema：
```json
{
  "sampled_at": "<ISO8601>",
  "tasks": {
    "in_progress_count": <integer >= 0>,
    "vendor_dist": {
      "claude": <integer >= 0>,
      "codex": <integer >= 0>,
      "grok": <integer >= 0>,
      "unknown": <integer >= 0>
    }
  },
  "relay": {
    "container_count": <integer >= 0> | null
  },
  "sessions": {
    "headed": <integer >= 0>,
    "headless": <integer >= 0>
  },
  "host": {
    "cpu_usage_pct": <number in [0,100]>,
    "mem_used_pct": <number in [0,100]>
  },
  "processes": {
    "claude_total": <integer >= 0>,
    "codex_total": <integer >= 0>
  },
  "llm_capacity": {
    "sentinel": "ok" | "degraded" | "exhausted",
    "vendors": {
      "claude": { "available_count": <integer>, "total_count": <integer>, "accounts": <array> },
      "codex": { "available_count": <integer>, "total_count": <integer>, "accounts": <array> },
      "grok": { "available_count": <integer>, "total_count": <integer>, "accounts": <array> }
    }
  }
}
```

**[BEHAVIOR-03]** `tasks.in_progress_count` 等于 DB 中 `status = 'in_progress'` 的任务数（`>= 0`）。

**[BEHAVIOR-04]** `tasks.vendor_dist` 统计 `payload->>'allocation'->>'selected_executor'` 字段值，按 `claude / codex / grok / unknown` 分桶，仅统计 `status = 'in_progress'` 的任务。

**[BEHAVIOR-05]** `host.cpu_usage_pct` 取值范围 `[0, 100]`，来源 `os.loadavg()[0] / os.cpus().length * 100`（上限 clip 100）。

**[BEHAVIOR-06]** `host.mem_used_pct` 取值范围 `[0, 100]`，来源 `(1 - os.freemem()/os.totalmem()) * 100`。

**[BEHAVIOR-07]** `processes.claude_total` 为整数 >= 0，来源 `countClaudeProcesses()`（`platform-utils.js`）。

**[BEHAVIOR-08]** `processes.codex_total` 为整数 >= 0，来源对 `ps aux | grep codex` 的计数（忽略 grep 自身）。

**[BEHAVIOR-09]** `relay.container_count` 为整数（`docker ps` 返回行数），当 docker 不可达时为 `null`，整体请求仍返回 HTTP 200。

**[BEHAVIOR-10]** `llm_capacity` 数据源异常时该字段为 `null`，整体请求仍返回 HTTP 200（fail-soft）。

**[BEHAVIOR-11]** `llm_capacity.sentinel` 非 null 时取值为 `"ok" | "degraded" | "exhausted"` 之一。

**[BEHAVIOR-12]** `llm_capacity.vendors.claude.accounts` 为数组，正常情况下 `length > 0`。

**[BEHAVIOR-13]** 并行聚合（`Promise.all`）：所有数据源并行请求，P99 响应时间 < 2000ms；单个数据源超时上限 5000ms，超时降级为 null 而非 500。

**[BEHAVIOR-14]** 响应不暴露任何账号 token、私钥、密码或凭据字符串（字段只读，无副作用）。

**[BEHAVIOR-15]** 端点需通过 Brain 已有的鉴权中间件（与其他 `/api/brain/` 路由一致），不可裸露无鉴权。

### 前端 Dashboard

**[BEHAVIOR-16]** Dashboard `/live-monitor` 页面存在 `OpsPanoramaCard` 区块，区块标题含"执行全景"字样。

**[BEHAVIOR-17]** `OpsPanoramaCard` 每 30s 自动轮询 `/api/brain/ops-panorama` 并更新展示数据（`setInterval` 30000ms）。

**[BEHAVIOR-18]** `OpsPanoramaCard` 展示 `host.cpu_usage_pct` 和 `host.mem_used_pct` 的进度条（含数值）。

**[BEHAVIOR-19]** `OpsPanoramaCard` 展示 `llm_capacity.vendors.claude.accounts` 的余量进度条，颜色编码：< 50% 绿，50-80% 黄，> 80% 红。

**[BEHAVIOR-20]** `OpsPanoramaCard` 展示 `sampled_at` 的抓取时间（相对时间，如"30s 前"）。

**[BEHAVIOR-21]** 后端返回 `relay.container_count: null` 时，前端显示"—"而非报错或崩溃。

**[BEHAVIOR-22]** `OpsPanoramaCard` 展示 `tasks.in_progress_count` 和 `processes.claude_total / codex_total`。

---

## 2. 铁律覆盖声明

| 铁律 | 覆盖方式 |
|------|----------|
| [单slot串行] 并行只许跨slot，单slot内串行 | ops-panorama 聚合跨数据源并行（合规），单个数据源内串行访问 |
| [禁写死环境假设] | 路由不写死 CPU 核数/内存大小，动态读取 `os.*` |
| [真环境验证] | E2E 测试对 `localhost:5221` 真实发请求 |
| [端点鉴权] | 路由挂载在已有 Brain auth 中间件后，与其他端点一致 |
| [日志脱敏] | 路由日志只打印 sampled_at 和数值，不打印账号 token |
| [租户隔离] | 只读聚合，不存在多租户数据混淆风险（单租户 Cecelia） |
| [凭据安全] | 响应体不含 token/key 字段，llm_capacity.vendors.*.accounts 只含状态字段（available/is_spending_capped 等） |

---

## 3. 累积 FR 回归声明

本 line 暂无历史累积 FR（journey_id=none），无回退风险。

---

## 4. 预期受影响文件

| 文件 | 变更类型 |
|------|----------|
| `packages/brain/src/routes/ops-panorama.js` | 新建 |
| `packages/brain/src/routes.js` | 注册新路由 |
| `apps/dashboard/src/pages/live-monitor/OpsPanoramaCard.tsx` | 新建 |
| `apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx` | 引入卡片 |

---

## 5. 范围限定确认

**包含**：
- GET /api/brain/ops-panorama 聚合端点（tasks + relay + host + processes + llm_capacity）
- Dashboard OpsPanoramaCard（30s 轮询 + 余量颜色编码）

**不包含**：
- 历史趋势图
- 跨设备多机 panorama
- codex-usage 实时余量（仅进程数）
- grok resets_at（llm_capacity.vendors.grok 结构已包含但不特殊展示 resets_at）
