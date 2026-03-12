---
id: code-review-report-20260312
version: 1.0.0
created: 2026-03-12
updated: 2026-03-12
changelog:
  - 1.0.0: 3 个并行 Agent 系统性全量扫描
---

# Cecelia 系统性全量代码扫描报告

**扫描日期**：2026-03-12 上海时间
**扫描方法**：3 个并行 Explore Agent，独立扫描，无共享上下文
**扫描覆盖**：
- 模块 A：核心调度层（tick / executor / planner / thalamus / cortex / db / actions / selfcheck）
- 模块 B：Routes 安全审计（routes.js 12k行 + routes/* 29个文件 + migrations 149个）
- 模块 C：测试质量 & CI 体系（69k行代码，382个测试文件，CI 4层）

---

## 综合概览

| 模块 | L1（阻塞） | L2（功能） | L3（实践） | 综合评分 |
|------|-----------|-----------|-----------|---------|
| 核心调度层 | 6 | 5 | 6 | — |
| Routes 安全 | 3 | 6 | 4 | **4.6/10** |
| 测试 & CI | 3 | 3 | — | **3.75/10** |
| **合计** | **12** | **14** | **10** | **⚠️ 高风险** |

---

## 第一部分：核心调度层

### L1 — 阻塞性问题

**1.1 executor.js:664 — 进程存活检查竞态**
- `isProcessAlive()` 用 `process.kill(pid, 0)` 在 macOS 不确定，可能 false-positive
- **影响**：进程计数偏离 → 过度派发（OOM）或假死
- **修复**：改用 `ps` 查询真实进程状态

**1.2 tick.js:267 — setInterval 不清理失败回调**
- catch 只记日志，DB 持续异常时 setInterval 继续耗 CPU
- **修复**：失败超 N 次 → clearInterval + 触发恢复

**1.3 planner.js:345 — generateNextTask 返回 null 导致无限规划循环**
- 所有 KR 都 "needs_planning" 时，无自动告警，依赖秋米，系统永久停滞
- **修复**：超 N 小时检测告警，或降级为系统任务

**1.4 actions.js:50 — createTask 去重窗口误拦合法定期任务**
- 24h 去重窗口：同 title+goal_id 的任务 24h 内重建会被误认为重复
- **修复**：已完成且完成时间 > 窗口的不计入去重

**1.5 thalamus.js:320 — MODEL_PRICING 缺失模型 → 成本统计失实**
- 未知模型 `calculateCost()` 返回 0，成本监控完全失效
- **修复**：缺失模型时 log warning，不静默返回 0

**1.6 health-monitor.js:46 — uptime_h NULL 处理混乱**
- `MIN(created_at)` 为 NULL → `parseFloat(null)` = NaN，逻辑不明确
- **修复**：`COALESCE(EXTRACT(...), 0)` 统一处理

---

### L2 — 功能性缺陷

**2.1 planner.js:859 — Area Stream 无超时保护**
- 3 个 Area 累计延迟 > TICK_TIMEOUT_MS(60s)，部分 Area 永不被派发
- **修复**：`Promise.race(generateNextTask(...), timeout(5000))`

**2.2 executor.js:474 — 账户排序不稳定**
- `five_hour_pct` 相等时排序不确定，token 派发抖动
- **修复**：二级排序加 `account_id` 决胜字段

**2.3 thalamus.js:1268 — null event 注释有但无实现**
- 注释"P1 guard"，代码缺失，`event.type` 会 crash
- **修复**：入口加 null/undefined 检查返回 fallback decision

**2.4 task-router.js:104 — codex_qa 路由是死代码**
- 路由存在但无任何地方创建 `task_type='codex_qa'` 任务
- **修复**：实现创建逻辑或删除路由

**2.5 cortex.js:162 — CORTEX_ACTION_WHITELIST 与 ACTION_WHITELIST 分离**
- cortex 扩展 action（adjust_strategy 等）被 thalamus 级验证阻止
- **修复**：合并 whitelist 或修改验证层级

---

### L3 — 最佳实践

- db.js:25 — `getPoolHealth()` 导出无调用，未集成到 health-monitor
- executor.js:750 — `recordSessionEnd` fire-and-forget，会话记录不完整
- tick.js:52 — `AUTO_DISPATCH_MAX` 常量化，不跟随动态参数变化
- planner.js:68 — 大型 JSON.stringify 每 tick 打印，日志膨胀
- selfcheck.js:118 — 版本格式无验证，"148a" 会被 parseInt 截断
- cortex.js:186 — `_loadReflectionStateFromDB` 启动加载无超时

---

## 第二部分：Routes 安全审计

### L1 — 严重安全问题

**B-1.1 未鉴权的敏感操作（3 类共 6 个端点）**
- `POST /tick`、`/tick/enable`、`/tick/disable`、`/tick/drain` — 无认证，任意人可触发/关停调度
- `POST /quarantine/release-all` — 无认证，可批量释放所有隔离任务，触发级联故障
- `POST /action/trigger-n8n` — 无认证，可触发外部 n8n 工作流
- **修复**：全局 auth middleware，或各端点加 `requireAuth()`

**B-1.2 execSync 命令注入（routes.js:12195）**
```javascript
const escaped = changed_paths.join(' ').replace(/"/g, '\\"');
cmd = `bash "${scriptDir}" --changed="${escaped}" main`;
execSync(cmd, ...)
```
- `changed_paths` 来自请求体，简单转义可被绕过（`\$()`、反引号）
- **修复**：改用数组形式 `execFileSync(scriptDir, [args])` 避免 shell 解析

**B-1.3 错误处理信息泄露（60+ 处）**
- 所有 500 错误返回 `details: err.message`，可泄露 DB 连接串、SQL 错误、内部路径
- routes.js:316, 394, 406, 422, ... 共 60+ 处
- **修复**：生产环境返回通用消息，详细错误只写日志

---

### L2 — 功能性缺陷

**B-2.1 参数验证不完整**
- `GET /tasks?limit=` 无上界，`parseInt('999999999')` → 内存溢出或 DoS
- `POST /quarantine/:taskId` 的 `reason` 无白名单
- **修复**：`Math.min(parseInt(limit), 1000)`；白名单验证 reason

**B-2.2 POST /execution-callback 无 task_id 拥有权检查**
- 任意人可为任意 task_id 提交回调，伪造任务完成/失败状态
- **修复**：校验 `run_id` 对应 executor 身份；加时间窗口限制（1h 内）

**B-2.3 deploy token 时序攻击（routes.js:12172）**
- `token !== expectedToken` 非恒定时间比较
- **修复**：`crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))`

**B-2.4 Migration 序号不连续（缺 014, 019, 020）**
- 开发历史中有删除或合并，可审计性问题

**B-2.5 早期 Migration 幂等性差（migrations/000-050，30+ 个）**
- 008_publishing_system.sql 等早期文件无 `ON CONFLICT`，重跑失败
- 100+ 之后的 migration 基本都有 `ON CONFLICT`，质量好

**B-2.6 SELECT * 查询泄露敏感列**
- routes.js:450 动态构造 SQL 用 `SELECT *`，可能返回内部 token、debug 信息
- **修复**：明确指定返回列

---

### L3 — 最佳实践

- CORS `Access-Control-Allow-Origin: *` 过于开放（建议白名单）
- 错误 HTTP 状态码不一致（同类错误返回 400 / 500 / 404 随机）
- N+1 查询隐患（部分端点未使用 JOIN）
- verifyWebhookSignature 实现未审查是否有时序漏洞

---

## 第三部分：测试质量 & CI 体系

### L1 — 关键质量漏洞

**C-1.1 Routes 测试覆盖率仅 31%（🔴 CRITICAL）**
- 29 个路由文件，仅 9 个有测试
- 完全无测试：alerting / architecture / cluster / cognitive-map / curiosity / evolution / inner-life / intent-match / narrative / perception-signals / rumination / self-reports / stats 等 20 个
- **影响**：API 数据格式变化无感，SQL 注入风险未验证，权限逻辑无保障

**C-1.2 Baseline 机制实质失效（🔴 CRITICAL）**
- `brain-test-baseline.txt` 和 `brain-integration-baseline.txt` 值均为 0
- main 分支本身有 N 个遗留失败，但 baseline=0 导致无法区分"PR 新增失败"与"遗留失败"
- **修复**：baseline 应设为 main 当前失败数（非 0），每次 merge 后更新

**C-1.3 核心决策模块测试全 mock（decision-executor）**
- 83 个 expect 断言全针对返回值，0 个验证数据库状态
- 无法发现：并发 dispatch 冲突、SQL 事务失败、数据库约束违反
- **修复**：L4 环境加入真实 DB 集成测试

---

### L2 — CI 门禁漏洞

**C-2.1 假测试检测不完整**
- check-dod-mapping.cjs 未检测：`sh -c "echo ok"`、`node -e "console.log(ok)"`、`curl localhost:9999`
- **修复**：扩展假测试检测白名单

**C-2.2 Required Paths Check 仅前缀匹配**
- `grep -q "^${path_pattern}"` 可被 `executor-bak.js` 或 `executor.md` 绕过
- **修复**：改用 glob 或正则表达式

---

### 完全无测试的高风险模块

| 模块 | 行数 | 职责 | 风险 |
|------|------|------|------|
| routes/alerting.js | ~300 | 警报派发 | 🔴 P0 |
| routes/evolution.js | ~200 | 演化策略 | 🔴 P0 |
| routes/rumination.js | ~250 | 思考调度 | 🔴 P0 |
| embedding-service.js | ~500 | 向量生成 | 🟠 P1 |
| memory-utils.js | ~600 | 记忆检索去重 | 🟠 P1 |
| consolidation.js | ~400 | 每日总结压缩 | 🟠 P1 |

---

## 修复路线图

### 紧急（本周，P0）

| # | 问题 | 文件 | 预估 |
|---|------|------|------|
| 1 | 未鉴权敏感操作 | routes.js | 2h |
| 2 | execSync 命令注入 | routes.js:12195 | 1h |
| 3 | 错误信息泄露 | routes.js 60+ 处 | 2h |
| 4 | executor.js 进程存活检查 | executor.js:664 | 1h |
| 5 | tick.js setInterval 不清理 | tick.js:267 | 1h |
| 6 | thalamus.js null event 未实现的 guard | thalamus.js:1268 | 0.5h |

### 高优先级（两周内，P1）

| # | 问题 | 文件 | 预估 |
|---|------|------|------|
| 7 | 成本统计失实 | thalamus.js:320 | 1h |
| 8 | 去重窗口逻辑 | actions.js:50 | 1h |
| 9 | deploy token 时序攻击 | routes.js:12172 | 0.5h |
| 10 | execution-callback 权限 | routes.js:2718 | 1h |
| 11 | baseline 机制修复 | brain-ci/*.txt | 0.5h |
| 12 | cortex action whitelist 合并 | cortex.js:162 | 1h |
| 13 | 规划失败自动告警 | planner.js:345 | 2h |
| 14 | 账户排序稳定化 | executor.js:474 | 0.5h |

### 常规（月度，P2）

- L3 最佳实践逐项改进
- Routes 测试覆盖 31% → 60%（优先 alerting/evolution/rumination）
- 早期 migrations 幂等性补充（000-050）
- embedding-service / memory-utils / consolidation 补单元测试
- CORS 白名单限制
- 错误状态码统一

---

## 总评

**系统整体健康度：⚠️ 高风险**

最紧迫的两项：
1. **routes.js 未鉴权端点** — 任何人可关停 Brain 调度或伪造任务完成
2. **execSync 命令注入** — `/deploy` 端点可能被 RCE 利用

这两项建议下个 /dev 周期优先处理。
