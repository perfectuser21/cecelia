# Cecelia Core 深度检测报告

**检测日期**: 2026-02-15
**检测团队**: 8 个专家 agents
**总问题数**: CRITICAL: 4, HIGH: 5, MEDIUM: 14, LOW: 13, API: 7, Coverage: 6 modules 0%

---

## Executive Summary

深度检测发现 **4 个 CRITICAL 问题** 必须在上线前修复：
1. **数据库密码泄露到 Git 仓库**（已在 7 个 commits 中暴露）
2. **硬编码密码 fallback**（代码中明文密码）
3. **运行时错误**（tick.js 未定义变量导致 WebSocket 广播失败）
4. **MEMORY.md 版本严重过期**（1.35.0 → 1.40.4）

另有 5 个 HIGH 问题和 14 个 MEDIUM 问题需要尽快修复。

---

## Phase 1: 安全紧急修复 (P0 - 上线前必须完成)

### 1.1 修复密码泄露

**问题**: `.env.docker` 包含明文密码 `CeceliaUS2026` 且被 Git 追踪（已泄露到 GitHub 仓库历史）

**修复步骤**:
```bash
# 1. 从 Git 追踪移除
git rm --cached .env.docker
git commit -m "security: remove .env.docker from git tracking"

# 2. 确保 .gitignore 生效
echo ".env.docker" >> .gitignore
git add .gitignore
git commit -m "security: ensure .env.docker is ignored"

# 3. 创建模板文件
cp .env.docker .env.docker.example
sed -i 's/CeceliaUS2026/YOUR_PASSWORD_HERE/' .env.docker.example
git add .env.docker.example
git commit -m "security: add .env.docker.example template"

# 4. 轮换数据库密码（在 PostgreSQL 中执行）
# ALTER USER cecelia WITH PASSWORD 'NewSecurePassword2026';

# 5. 更新本地 .env.docker（不提交）
# DB_PASSWORD=NewSecurePassword2026
```

**文件**: `.env.docker`, `brain/src/db-config.js`
**优先级**: P0
**工作量**: 30 分钟

---

### 1.2 修复硬编码密码 fallback

**问题**: `brain/src/db-config.js:13` 有 `password: process.env.DB_PASSWORD || 'CeceliaUS2026'`

**修复**:
```javascript
// brain/src/db-config.js
export const DB_DEFAULTS = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'cecelia',
  user: process.env.DB_USER || 'cecelia',
  password: process.env.DB_PASSWORD || '', // ← 改为空字符串
};

// 在 server.js 或 selfcheck.js 中添加启动检查
if (!process.env.DB_PASSWORD) {
  console.error('ERROR: DB_PASSWORD environment variable is required');
  process.exit(1);
}
```

**优先级**: P0
**工作量**: 10 分钟

---

### 1.3 修复 tick.js 运行时错误

**问题**: `brain/src/tick.js:643` 引用不存在的 `activeCount` 和 `effectiveLimit`

**修复** (方案 1 - 推荐，删除该调用):
```javascript
// brain/src/tick.js:643
// 删除这一行（slot budget 已在 /api/brain/slots 暴露）
// publishExecutorStatus(activeCount + 1, effectiveLimit - activeCount - 1, MAX_CONCURRENT_TASKS);
```

**修复** (方案 2 - 用 slot budget 替换):
```javascript
// brain/src/tick.js:643
const { used, total } = slotBudget;
publishExecutorStatus(used, total - used, total);
```

**优先级**: P0
**工作量**: 5 分钟

---

### 1.4 更新 MEMORY.md 版本信息

**问题**: 多处版本过期（1.35.0 → 1.40.4, schema 029 → 035, 测试数 1158 → 1244）

**修复**:
```bash
# 在 MEMORY.md 中替换：
# - Version: 1.35.0 → 1.40.4
# - Schema: '029' → '035'
# - Tests: 1158 pass (76 files) → 1244 pass (79 files)
# - Image: cecelia-brain:1.35.0 → cecelia-brain:1.40.4
```

**优先级**: P0
**工作量**: 10 分钟

---

## Phase 2: 高优先级修复 (P1 - 一周内完成)

### 2.1 修复 WebSocket 方法名错误

**文件**: `brain/src/routes.js:276`

**修复**:
```javascript
// 改为正确的方法名
connected_clients: websocketService.getConnectedClientsCount()
```

**优先级**: P1
**工作量**: 2 分钟

---

### 2.2 修复 SQL 注入风险

**文件**: `brain/src/monitor-loop.js:57`

**修复**:
```javascript
// 使用参数化查询
const stuck = await pool.query(`
  SELECT r.id, r.task_id, r.heartbeat_ts
  FROM run_events r
  WHERE r.status = 'running'
    AND r.heartbeat_ts < NOW() - INTERVAL '$1 minutes'
`, [STUCK_THRESHOLD_MINUTES]);
```

**优先级**: P1
**工作量**: 5 分钟

---

### 2.3 修复内存泄漏风险

**文件**: `brain/src/routes.js:95-121`

**修复**:
```javascript
// 添加 Map 大小上限检查
const MAX_PROCESSED_KEYS = 10000;

if (processedKeys.size > MAX_PROCESSED_KEYS) {
  // 清理超过 TTL 的 keys
  const now = Date.now();
  for (const [key, timestamp] of processedKeys.entries()) {
    if (now - timestamp > TTL) {
      processedKeys.delete(key);
    }
  }

  // 如果还是太大，强制清空最旧的一半
  if (processedKeys.size > MAX_PROCESSED_KEYS) {
    const sortedKeys = Array.from(processedKeys.entries())
      .sort((a, b) => a[1] - b[1])
      .slice(0, Math.floor(processedKeys.size / 2));
    sortedKeys.forEach(([key]) => processedKeys.delete(key));
  }
}
```

**优先级**: P1
**工作量**: 15 分钟

---

### 2.4 修复 healing.js 查询不存在的表

**文件**: `brain/src/alertness/healing.js`

**修复**:
```javascript
// Line 458, 549: task_runs → run_events
// Line 618: 删除 error_logs 查询或创建该表

// 临时方案：禁用相关功能
// 长期方案：创建 Migration 036 添加缺失的表/列
```

**优先级**: P1
**工作量**: 30 分钟

---

## Phase 3: 中优先级修复 (P2 - 两周内完成)

### 3.1 修复 API 端点 500 错误（7 个）

**创建 Migration 036**: 添加缺失的列和表

```sql
-- Migration 036: Fix Missing Columns and Tables

-- 1. Add missing columns to policies table
ALTER TABLE policies ADD COLUMN IF NOT EXISTS success_count INTEGER DEFAULT 0;

-- 2. Add missing columns to policy_evaluations table
ALTER TABLE policy_evaluations ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ;

-- 3. Add missing columns to failure_signatures table (if exists)
ALTER TABLE failure_signatures ADD COLUMN IF NOT EXISTS first_seen TIMESTAMPTZ;

-- 4. Add missing columns to tasks table
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS quarantine_reason TEXT;

-- 5. Create system_snapshot table (or remove /status endpoint)
-- Option A: Create table
CREATE TABLE IF NOT EXISTS system_snapshot (
  id SERIAL PRIMARY KEY,
  snapshot_ts TIMESTAMPTZ DEFAULT NOW(),
  n8n_ok BOOLEAN DEFAULT FALSE,
  task_system_ok BOOLEAN DEFAULT FALSE,
  data JSONB
);

-- Option B: Remove /status endpoint and use /hardening/status instead
-- (Already documented in MEMORY.md as a known issue)
```

**优先级**: P2
**工作量**: 1 小时

---

### 3.2 修复数据库 KR 层级问题

**修复 SQL**:
```sql
-- 删除 orphan KR
DELETE FROM goals WHERE id = '21cb58dd-4035-4c2d-a791-ebfa472e19ca';

-- 对于 6 个跳过 area_okr 的 KR，两种方案：
-- 方案 1: 创建中间 area_okr 节点
-- 方案 2: 修改 planNextTask 逻辑允许这种结构（暂时）
```

**优先级**: P2
**工作量**: 30 分钟

---

### 3.3 更新 DEFINITION.md

**修复所有版本号和schema引用**:
```markdown
Line 584: cecelia-brain:1.40.3 → cecelia-brain:1.40.4
Line 760: 1.40.3 → 1.40.4
Line 611: pr_plans → cortex_analyses
Line 613: '034' → '035'
Line 789: (000-034) → (000-035)
Line 794: Add 035_final_cleanup_orphans_and_types.sql
Line 691: Remove stale features statement
```

**优先级**: P2
**工作量**: 15 分钟

---

### 3.4 清理配置文件

1. 删除 `.env` 中的废弃变量 (CECELIA_MAX_CONCURRENT, CECELIA_RESERVED_SLOTS)
2. 统一 `.env` 和 `.env.docker` 配置
3. 更新 docker-compose.yml 注释
4. 修复 `.brain-versions` 保留多行历史

**优先级**: P2
**工作量**: 30 分钟

---

## Phase 4: 测试覆盖率改进 (P3 - 长期)

**目标**: 提升核心模块覆盖率到 80%+

**优先级排序**:
1. **P3-1**: tick.js 核心函数测试（executeTick, dispatchNextTask）
2. **P3-2**: Alertness 模块测试（diagnosis, escalation, healing）
3. **P3-3**: decision.js 决策引擎测试
4. **P3-4**: executor.js 扩展测试
5. **P3-5**: auto-fix.js 和 monitor-loop.js 测试

**工作量**: 每个模块 2-4 小时，总计 20-40 小时

---

## Phase 5: 依赖更新 (P3 - 长期)

```bash
# 立即修复（无风险）
npm audit fix

# 安全更新（测试后）
npm update bullmq ioredis

# 主要版本升级（需要谨慎测试）
# - vitest 1.x → 4.x（修复 4 个 moderate vulns）
# - express 4 → 5（大版本升级）
# - @anthropic-ai/sdk 0.32 → 0.74（API 变更）
# - openai 4 → 6（API 变更）
```

**优先级**: P3
**工作量**: 2-8 小时（取决于破坏性变更）

---

## 总结

| 阶段 | 优先级 | 问题数 | 预计工作量 | 截止时间 |
|------|--------|--------|-----------|---------|
| **Phase 1** | P0 | 4 CRITICAL | 2-3 小时 | 上线前（立即） |
| **Phase 2** | P1 | 5 HIGH | 4-6 小时 | 1 周内 |
| **Phase 3** | P2 | 14 MEDIUM | 8-12 小时 | 2 周内 |
| **Phase 4** | P3 | Coverage | 20-40 小时 | 1-2 月 |
| **Phase 5** | P3 | Dependencies | 2-8 小时 | 按需 |

**立即行动**: 先执行 Phase 1（安全紧急修复），创建 PR，通过 CI 后立即上线。

---

## 附录：完整问题清单

详见各 agent 报告：
- config-checker: 配置文件验证（2 CRITICAL, 3 MEDIUM, 4 LOW）
- code-auditor: 代码质量审计（1 CRITICAL, 4 HIGH, 5 MEDIUM, 3 LOW, 23 TODO）
- deploy-checker: 部署配置检查（1 CRITICAL, 2 MEDIUM, 2 LOW）
- security-auditor: 依赖安全（5 vulnerabilities）
- database-inspector: 数据库完整性（1 MEDIUM, 3 LOW）
- api-tester: API 健康检查（7 broken endpoints）
- doc-validator: 文档一致性（1 HIGH, 3 MEDIUM, 3 LOW）
- coverage-analyst: 测试覆盖率（58.79% 总体，6 模块 0%）

---

**生成时间**: 2026-02-15 05:44 UTC
**检测工具**: Cecelia Deep Inspection Team (8 agents)
