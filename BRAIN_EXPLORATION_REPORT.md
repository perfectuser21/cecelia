# Cecelia Brain 包 探索报告

## 1. server.js 路由注册结构

### 文件位置
- `/home/xx/perfect21/cecelia/packages/brain/server.js` (共 ~250 行)

### 路由注册核心代码（第 1-130 行）

```javascript
import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import brainRoutes from './src/routes.js';
import ceceliaRoutes from './src/cecelia-routes.js';
import traceRoutes from './src/trace-routes.js';
import memoryRoutes from './src/routes/memory.js';
import profileFactsRoutes from './src/routes/profile-facts.js';
// ... 其他路由导入（共 25+ 条路由）

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || process.env.BRAIN_PORT || 5221;

// CORS 配置
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Body parser
app.use(express.json({ limit: '256kb' }));

// 路由挂载（按优先级顺序）
app.use('/api/brain/memory', memoryRoutes);
app.use('/api/brain/profile/facts', profileFactsRoutes);
app.use('/api/brain/cluster', clusterRoutes);
app.use('/api/brain/vps-monitor', vpsMonitorRoutes);
app.use('/api/brain/tasks/projects', taskProjectsRoutes);
app.use('/api/brain/projects', taskProjectsRoutes);
// ... 更多路由
app.use('/api/brain', brainRoutes);  // 主路由（必须最后，最通用）
app.use('/api/cecelia', ceceliaRoutes);
app.use('/api/brain/trace', traceRoutes);

// 自定义端点（在主路由前）
app.post('/api/brain/orchestrator/chat', async (req, res) => {
  const { message, messages = [], context = {} } = req.body;
  const result = await handleChat(message, context, messages);
  res.json(result);
});

// 健康检查
app.get('/', (_req, res) => {
  res.json({ service: 'cecelia-brain', status: 'running', port: PORT });
});

// 全局错误处理
app.use((err, _req, res, _next) => {
  console.error('Error:', err.message);
  res.status(500).json({ success: false, error: err.message });
});

// 启动前检查
await runMigrations(pool);
const selfCheckOk = await runSelfCheck(pool);
if (!selfCheckOk) process.exit(1);

// 启动服务器
server.listen(PORT, async () => {
  console.log(`Cecelia Brain running on http://localhost:${PORT}`);
  initWebSocketServer(server);
});
```

### 路由注册优先级
1. **特定路由**（先注册，避免被通用路由拦截）
   - `/api/brain/memory`
   - `/api/brain/profile/facts`
   - `/api/brain/cluster`
   - `/api/brain/tasks/*`
2. **业务路由**
   - `/api/brain` （通用主路由，必须最后）
   - `/api/cecelia`
   - `/api/brain/trace`
3. **自定义端点**（特殊处理）
   - `POST /api/brain/orchestrator/chat`
4. **根路由与错误处理**

---

## 2. 测试文件 (__tests__ 目录)

### 统计信息
- **总数**：260 个 `.test.js` 文件
- **位置**：`/home/xx/perfect21/cecelia/packages/brain/src/__tests__/`

### 测试文件按模块分类（示例）

#### 核心系统测试
- `tick.test.js` - Tick 循环主测试
- `executor.test.js` - 任务执行器
- `thalamus.test.js` - 丘脑（L1 决策）
- `cortex.test.js` - 皮层（深度分析）
- `memory-retriever.test.js` - 记忆检索

#### 路由/API 测试
- `routes.test.js` - 主路由集合
- `cecelia-routes.test.js` - Cecelia 执行路由
- `orchestrator-chat-route.test.js` - 聊天路由
- `work-streams-route.test.js` - 工作流路由
- `cognitive-map-api.test.js` - 认知图 API

#### 业务逻辑测试
- `dispatch-*.test.js` - 派发相关（15+ 文件）
- `quarantine-*.test.js` - 隔离系统（8+ 文件）
- `task-router-*.test.js` - 任务路由（8+ 文件）
- `tick-*.test.js` - Tick 循环细粒度（20+ 文件）
- `rumination-*.test.js` - 反思系统（5+ 文件）

#### 数据库/迁移测试
- `migration-*.test.js` - 迁移验证（5+ 文件）
- `db-config.test.js` - 数据库配置

#### 特性测试
- `suggestion-*.test.js` - 建议系统（5+ 文件）
- `desire-*.test.js` - 欲望系统（5+ 文件）
- `learning-*.test.js` - 学习系统（5+ 文件）
- `proposal-*.test.js` - 提案系统（8+ 文件）

---

## 3. src/ 下的源文件列表

### 总数：106 个文件
- `.js` 文件：104 个
- `.mjs` 文件：2 个

### 主要文件分类

#### 核心引擎（16 个）
```
tick.js                    2454 行 - 调度循环主入口
executor.js                2087 行 - 任务执行器
routes.js                  10776 行 - 主路由集合（重）
thalamus.js                1455 行 - L1 丘脑（事件路由）
cortex.js                  1022 行 - L2 皮层（深度分析）
decision-executor.js       1157 行 - 决策执行
memory-retriever.js        1110 行 - 记忆检索
planner.js                 1053 行 - 规划器
quarantine.js              1055 行 - 隔离系统
```

#### 决策与意图（5 个）
```
intent.js                  919 行 - 意图识别
decision.js                416 行 - 决策引擎
task-router.js             613 行 - 任务路由
cognitive-core.js          595 行 - 认知核心
goal-evaluator.js          ~400 行 - 目标评估
```

#### 系统与监控（8 个）
```
tick.js                    - 循环调度
monitor-loop.js            597 行 - 资源监控
health-monitor.js          ~300 行 - 健康检查
watchdog.js                ~500 行 - 看门狗保护
alerting.js                ~200 行 - 告警系统
circuit-breaker.js         ~150 行 - 熔断器
```

#### 学习与知识（6 个）
```
learning.js                678 行 - 学习系统
notion-full-sync.js        792 行 - Notion 同步
auto-learning.js           ~250 行 - 自动学习
fact-extractor.js          ~500 行 - 事实提取
embedding-service.js       ~150 行 - 嵌入服务
```

#### 通信与集成（5 个）
```
orchestrator-chat.js       776 行 - 聊天编排
llm-caller.js              ~500 行 - LLM 调用
openai-client.js           ~200 行 - OpenAI 客户端
websocket.js               ~250 行 - WebSocket 服务
```

#### 业务流程（8 个）
```
proposal.js                620 行 - 提案系统
rumination.js              ~500 行 - 反思系统
initiative-closer.js       ~400 行 - 闭环系统
task-cleanup.js            ~400 行 - 清理任务
learning.js                678 行 - 学习反馈
```

#### 数据库与配置（4 个）
```
db.js                      19 行 - 数据库连接
db-config.js               24 行 - 配置中心
migrate.js                 ~200 行 - 迁移执行
selfcheck.js               ~300 行 - 自检验证
```

#### 工具与辅助（6 个）
```
templates.js               848 行 - 提示模板
trace.js                   565 行 - 追踪系统
similarity.js              ~500 行 - 相似度计算
entity-linker.js           ~300 行 - 实体链接
memory-utils.js            ~100 行 - 内存工具
```

#### 脚本（MJS）
```
generate-capability-embeddings.mjs  - 生成能力嵌入
query-okr-status.mjs                - 查询 OKR 状态
```

---

## 4. package.json 依赖分析

### 生产依赖（9 个）
```json
{
  "@anthropic-ai/sdk": "^0.32.1",     // Claude API
  "bullmq": "^5.28.2",                 // Redis 队列
  "dotenv": "^16.4.0",                 // 环境变量
  "express": "^4.18.2",                // Web 框架
  "ioredis": "^5.4.1",                 // Redis 客户端
  "js-yaml": "^4.1.1",                 // YAML 解析
  "natural": "^7.0.7",                 // NLP 工具
  "openai": "^4.77.3",                 // OpenAI API
  "pg": "^8.12.0",                     // PostgreSQL 驱动
  "uuid": "^9.0.0",                    // UUID 生成
  "ws": "^8.19.0"                      // WebSocket
}
```

### 开发依赖（3 个）
```json
{
  "@vitest/coverage-v8": "^1.6.1",    // 覆盖率报告
  "supertest": "^7.2.2",               // HTTP 测试
  "vitest": "^1.6.1"                   // 单元测试框架
}
```

### 版本
```
"version": "1.193.2"  // 当前版本（semver）
```

---

## 5. ESLint 配置

### 当前状态
- **无专门 ESLint 配置文件** (`.eslintrc*` 或 `eslint.config.*`)
- Brain 包未配置代码样式检查
- 建议：可使用 Vitest 和 supertest 做集成测试，但没有 linting 

### 相关配置文件
```
vitest.config.js          - Vitest 单元测试配置
COVERAGE_BASELINE.md      - 覆盖率基线
quality-summary.json      - 质量指标汇总
```

---

## 6. 迁移系统 (Migrations)

### 位置
`/home/xx/perfect21/cecelia/packages/brain/migrations/`

### 统计
- **总数**：122 个迁移文件
- **时间跨度**：2026-02-25 至 2026-03-04

### 命名规律
```
{序号}_{功能描述}.sql

000_base_schema.sql                    # 基础 Schema
001_cecelia_architecture_upgrade.sql   # 升级架构
002_task_type_review_merge.sql         # 任务类型合并
...
122_dev_execution_logs.sql             # 最新迁移
```

### 最新迁移（最后 10 个）
```
113_notion_memory_sync.sql             (Mar 4 00:15)
114_notion_task_type.sql               (Mar 4 00:15)
115_system_reports.sql                 (Mar 4 08:02)
116_component_evolutions.sql            (Mar 4 10:57)
117_projects_execution_mode.sql         (Mar 4 11:14)
118_recurring_tasks_notion.sql          (Mar 4 16:29)
119_person_signal_preference_type.sql   (Mar 4 16:29)
120_notion_props.sql                    (Mar 4 17:22)
121_learned_keywords.sql                (Mar 4 17:22)
122_dev_execution_logs.sql              (Mar 5 09:54)
```

### 主要模块覆盖
- 基础架构：000-003
- 任务系统：004-068
- OKR 体系：029-040
- 记忆系统：028, 053, 069, 083-090
- Notion 同步：105, 111-120
- 提案系统：054, 071
- 欲望系统：073, 076, 095-096
- 学习系统：012, 053, 056, 063
- 自检：062, 093

---

## 7. 数据库连接配置

### 文件：`db-config.js`（单一事实来源）
```javascript
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 从项目根目录加载 .env（相对于 brain/src/ 的 ../../.env）
dotenv.config({ path: path.join(__dirname, '../../.env') });

export const DB_DEFAULTS = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'cecelia',
  user: process.env.DB_USER || 'cecelia',
  password: process.env.DB_PASSWORD || '',
};
```

### 数据库连接（db.js）
```javascript
import pg from 'pg';
import { DB_DEFAULTS } from './db-config.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

export default pool;  // 全局 connection pool
```

### 使用方式
- 所有模块通过 `import pool from './src/db.js'` 获取连接池
- 支持 Docker 环境变量覆盖（不会影响已设置的变量）
- 迁移、自检、业务逻辑都共用同一 Pool

---

## 8. 额外信息

### 路由子目录（routes/）
- **总数**：25 个路由文件
- **位置**：`/home/xx/perfect21/cecelia/packages/brain/src/routes/`

**路由文件列表**：
```
alerting.js              cluster.js               dev-logs.js
evolution.js             architecture.js          cognitive-map.js
brain-manifest.js        intent-match.js          memory.js
narratives.js            notebook-audit.js        notion-sync.js
perception-signals.js    profile-facts.js         recurring.js
self-reports.js          stats.js                 system-reports.js
task-areas.js            task-goals.js            task-projects.js
task-router-diagnose.js  task-tasks.js            vps-monitor.js
inner-life.js
```

### 特殊目录
```
/src/__tests__/           - 260 个测试文件
/src/routes/             - 25 个路由文件
/src/scripts/            - 脚本工具
/src/services/           - 服务模块
/src/prompts/            - LLM 提示模板
/src/data/               - 数据文件
/src/events/             - 事件系统
/src/desire/             - 欲望模块
/src/migrations/         - SQL 迁移脚本
/src/alertness/          - 警觉子系统
```

---

## 总结

| 项目 | 统计 |
|------|------|
| **源文件** | 106 (104 JS + 2 MJS) |
| **测试文件** | 260 个 |
| **路由文件** | 25 个 |
| **迁移文件** | 122 个 |
| **代码总行数** | ~50,400 行（仅 src/*.js） |
| **最大文件** | routes.js (10,776 行) |
| **最小路由文件** | 19 行 (db.js) |
| **版本** | 1.193.2 (semver) |
| **测试框架** | Vitest |
| **ESLint** | 未配置 |
| **API 根路由** | `/api/brain`, `/api/cecelia` |
| **服务端口** | 5221 |

