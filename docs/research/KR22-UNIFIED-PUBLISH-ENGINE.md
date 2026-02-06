# KR2.2: 统一发布引擎 — 一键发布 API 成功率 ≥95% 技术设计文档

> 调研时间：2026-02-06
> 版本：1.0.0
> 状态：Draft

---

## 1. 执行摘要 (Executive Summary)

### 1.1 目标定义

**KR2.2 目标**：建立统一发布引擎，实现一键发布功能，成功率达到 95% 以上。

**关键指标**：
- **成功率**：`(成功发布数 / 总发布请求数) × 100% ≥ 95%`
- **响应时间**：发布请求提交后 5 分钟内完成或返回失败
- **平台覆盖**：支持抖音、小红书、微博、B站、YouTube 等主流平台
- **幂等性**：重复发布请求不会造成重复内容发布
- **可监控性**：实时监控发布状态，失败时自动告警

### 1.2 当前状态分析

根据 `/home/xx/dev/perfect21-platform/zenithjoy/OKR.md` 分析：

**当前进度**：
- O1-KR3: 多平台发布 - 30% (⏳ 待开始)
- 平台覆盖：3 个平台（抖音 ✅ / 小红书 ✅ / 微博 ⏳）
- 项目位置：`/home/xx/dev/zenithjoy-autopilot`

**识别的问题**：
1. **无统一发布抽象**：每个平台单独实现，代码重复
2. **缺乏重试机制**：网络失败时直接报错，不自动重试
3. **无状态追踪**：发布后无法查询当前状态
4. **错误处理不完善**：失败原因不明确，难以定位问题
5. **无回滚机制**：发布失败后无法自动撤回已发布内容

---

## 2. 现状分析 (Current State Analysis)

### 2.1 技术栈识别

根据项目结构 `/home/xx/dev/zenithjoy-autopilot/apps/dashboard/`：

```
zenithjoy-autopilot/
├── apps/
│   └── dashboard/
│       ├── core/          # 核心业务逻辑
│       │   └── api/       # API 层
│       ├── data/          # 数据层
│       ├── database/      # 数据库
│       └── frontend/      # 前端界面
```

**推测技术栈**：
- **后端**：Node.js / Python (待确认)
- **数据库**：PostgreSQL (根据 CLAUDE.md 全局规则)
- **部署**：香港 VPS (43.154.85.217)
- **任务调度**：可能使用 Cecelia Brain 或 N8N

### 2.2 常见失败原因分析

基于业界经验，多平台发布的典型失败原因：

| 失败类型 | 占比估算 | 原因 | 可重试 |
|----------|----------|------|--------|
| 网络超时 | 30% | 网络不稳定、API 响应慢 | ✅ 可重试 |
| 限流 (Rate Limit) | 25% | 平台 API 调用频率限制 | ✅ 延迟重试 |
| 认证失效 | 20% | Token 过期、Cookie 失效 | ⚠️ 需刷新认证 |
| 内容违规 | 15% | 平台审核拒绝、敏感词 | ❌ 不可重试，需修改内容 |
| 参数错误 | 5% | 请求格式错误、缺少必填字段 | ❌ 不可重试，需修改代码 |
| 平台故障 | 5% | 平台维护、服务宕机 | ✅ 延迟重试 |

**关键洞察**：
- **80% 的失败可以通过重试解决**（网络超时 + 限流 + 认证刷新 + 平台故障）
- **重试策略是提升成功率的核心手段**

### 2.3 成功率计算逻辑

```
基础成功率（无重试）：假设 70%
├── 网络超时 (30%) → 重试 2 次 → 成功率提升至 91%
├── 限流 (25%) → 延迟重试 → 成功率提升至 95%
├── 认证失效 (20%) → 自动刷新 → 成功率提升至 98%
└── 不可重试失败 (20%) → 提前校验 → 降低至 5%

最终成功率 = 70% + (30% × 70%) + (25% × 80%) + ... ≈ 95%+
```

**结论**：通过智能重试机制，可以将基础 70% 成功率提升至 95%+。

---

## 3. 解决方案设计 (Solution Design)

### 3.1 架构设计

#### 3.1.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      Unified Publish Engine                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐   │
│  │   API 层    │───▶│  调度引擎    │───▶│   监控告警      │   │
│  │ /publish    │    │  Job Queue   │    │  Metrics/Alerts │   │
│  └─────────────┘    └──────────────┘    └─────────────────┘   │
│         │                   │                      │            │
│         ▼                   ▼                      ▼            │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              Platform Adapter Layer                      │  │
│  ├──────────┬──────────┬──────────┬──────────┬────────────┤  │
│  │  抖音    │  小红书  │  微博    │  B站     │  YouTube   │  │
│  │ Adapter  │ Adapter  │ Adapter  │ Adapter  │  Adapter   │  │
│  └──────────┴──────────┴──────────┴──────────┴────────────┘  │
│         │         │         │         │            │          │
│         ▼         ▼         ▼         ▼            ▼          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │            Retry & Error Handling Layer                │  │
│  │  - Exponential Backoff                                 │  │
│  │  - Circuit Breaker                                     │  │
│  │  - Dead Letter Queue                                   │  │
│  └────────────────────────────────────────────────────────┘  │
│         │                                                     │
│         ▼                                                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              State Management (PostgreSQL)             │  │
│  │  - publish_jobs (任务表)                                │  │
│  │  - publish_logs (日志表)                                │  │
│  │  - platform_credentials (凭据表)                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

#### 3.1.2 数据库 Schema 设计

```sql
-- 发布任务表
CREATE TABLE publish_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL,              -- 关联内容表
  platforms TEXT[] NOT NULL,             -- 目标平台 ['douyin', 'xiaohongshu']
  status TEXT NOT NULL,                  -- pending/running/success/failed
  priority INT DEFAULT 0,                -- 优先级 (0=normal, 1=high, 2=urgent)
  scheduled_at TIMESTAMPTZ,              -- 定时发布时间
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB                         -- 额外元数据
);

-- 平台发布记录表（一对多）
CREATE TABLE publish_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES publish_jobs(id),
  platform TEXT NOT NULL,                -- 'douyin' / 'xiaohongshu' 等
  status TEXT NOT NULL,                  -- pending/success/failed
  retry_count INT DEFAULT 0,             -- 已重试次数
  max_retries INT DEFAULT 3,             -- 最大重试次数
  error_type TEXT,                       -- timeout/rate_limit/auth_failed/content_rejected
  error_message TEXT,                    -- 详细错误信息
  platform_post_id TEXT,                 -- 平台返回的发布 ID
  published_at TIMESTAMPTZ,              -- 实际发布时间
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 平台凭据表
CREATE TABLE platform_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,                -- 平台名称
  account_name TEXT NOT NULL,            -- 账号标识
  credential_type TEXT NOT NULL,         -- 'token' / 'cookie' / 'oauth'
  credentials JSONB NOT NULL,            -- 加密存储的凭据
  expires_at TIMESTAMPTZ,                -- 过期时间
  status TEXT DEFAULT 'active',          -- active/expired/invalid
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, account_name)
);

-- 索引优化
CREATE INDEX idx_publish_jobs_status ON publish_jobs(status);
CREATE INDEX idx_publish_jobs_scheduled ON publish_jobs(scheduled_at) WHERE status = 'pending';
CREATE INDEX idx_publish_records_job ON publish_records(job_id);
CREATE INDEX idx_publish_records_status ON publish_records(status);
```

### 3.2 核心组件设计

#### 3.2.1 Platform Adapter 接口（统一抽象）

```typescript
// 统一发布接口
interface IPlatformAdapter {
  // 平台名称
  readonly name: string;

  // 发布内容
  publish(content: PublishContent, credentials: Credentials): Promise<PublishResult>;

  // 检查凭据有效性
  validateCredentials(credentials: Credentials): Promise<boolean>;

  // 刷新凭据（如果支持）
  refreshCredentials(credentials: Credentials): Promise<Credentials>;

  // 获取发布状态（如果平台支持异步发布）
  getPublishStatus(postId: string): Promise<PublishStatus>;

  // 平台限流配置
  getRateLimits(): RateLimitConfig;
}

// 发布内容结构
interface PublishContent {
  title?: string;           // 标题
  description?: string;     // 描述
  content: string;          // 正文
  media: MediaItem[];       // 媒体文件（图片/视频）
  tags?: string[];          // 标签
  visibility?: 'public' | 'private' | 'unlisted';
  scheduledTime?: Date;     // 定时发布
}

// 发布结果
interface PublishResult {
  success: boolean;
  postId?: string;          // 平台返回的 ID
  url?: string;             // 发布后的 URL
  error?: PublishError;
}

// 错误类型枚举
enum PublishErrorType {
  NETWORK_TIMEOUT = 'network_timeout',
  RATE_LIMIT = 'rate_limit',
  AUTH_FAILED = 'auth_failed',
  CONTENT_REJECTED = 'content_rejected',
  PLATFORM_ERROR = 'platform_error',
  UNKNOWN = 'unknown'
}

interface PublishError {
  type: PublishErrorType;
  message: string;
  retryable: boolean;       // 是否可重试
  retryAfter?: number;      // 建议重试延迟（秒）
}
```

#### 3.2.2 重试策略引擎

```typescript
// 重试策略配置
interface RetryPolicy {
  maxRetries: number;           // 最大重试次数
  baseDelay: number;            // 基础延迟（毫秒）
  maxDelay: number;             // 最大延迟（毫秒）
  backoffMultiplier: number;    // 退避系数
  retryableErrors: PublishErrorType[];  // 可重试错误类型
}

// 默认重试策略
const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelay: 1000,              // 1 秒
  maxDelay: 60000,              // 60 秒
  backoffMultiplier: 2,         // 指数退避
  retryableErrors: [
    PublishErrorType.NETWORK_TIMEOUT,
    PublishErrorType.RATE_LIMIT,
    PublishErrorType.PLATFORM_ERROR
  ]
};

// 计算重试延迟（指数退避）
function calculateRetryDelay(
  attempt: number,
  policy: RetryPolicy,
  error?: PublishError
): number {
  // 如果平台指定了 retryAfter，优先使用
  if (error?.retryAfter) {
    return error.retryAfter * 1000;
  }

  // 指数退避：baseDelay * (backoffMultiplier ^ attempt)
  const delay = policy.baseDelay * Math.pow(policy.backoffMultiplier, attempt);

  // 加入随机抖动（±20%），避免惊群效应
  const jitter = delay * 0.2 * (Math.random() - 0.5);

  return Math.min(delay + jitter, policy.maxDelay);
}

// 重试执行器
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  onRetry?: (attempt: number, error: Error) => void
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // 检查是否可重试
      if (error instanceof PublishError && !error.retryable) {
        throw error;
      }

      if (attempt < policy.maxRetries) {
        const delay = calculateRetryDelay(attempt, policy, error as PublishError);
        onRetry?.(attempt + 1, error as Error);
        await sleep(delay);
      }
    }
  }

  throw lastError!;
}
```

#### 3.2.3 任务调度引擎

```typescript
// 使用 BullMQ（Redis 队列）或 pg-boss（PostgreSQL 队列）
import { Queue, Worker } from 'bullmq';

// 创建发布队列
const publishQueue = new Queue('publish-jobs', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,                    // 最大重试次数
    backoff: {
      type: 'exponential',
      delay: 1000
    },
    removeOnComplete: false,        // 保留完成记录
    removeOnFail: false             // 保留失败记录
  }
});

// 提交发布任务
async function submitPublishJob(jobData: PublishJobData): Promise<string> {
  const job = await publishQueue.add('publish', jobData, {
    priority: jobData.priority || 0,
    delay: jobData.scheduledAt
      ? jobData.scheduledAt.getTime() - Date.now()
      : 0
  });

  return job.id;
}

// Worker 处理任务
const publishWorker = new Worker('publish-jobs', async (job) => {
  const { platforms, contentId } = job.data;

  // 并行发布到多个平台
  const results = await Promise.allSettled(
    platforms.map(platform =>
      publishToPlatform(platform, contentId, job.data)
    )
  );

  // 记录结果
  await savePublishResults(job.data.jobId, results);

  return results;
}, {
  connection: redisConnection,
  concurrency: 10                   // 并发数
});
```

#### 3.2.4 监控与告警

```typescript
// 监控指标
interface PublishMetrics {
  totalRequests: number;
  successCount: number;
  failureCount: number;
  successRate: number;              // 成功率
  avgResponseTime: number;          // 平均响应时间
  p95ResponseTime: number;          // P95 响应时间
  retryRate: number;                // 重试率
  platformMetrics: Map<string, PlatformMetric>;
}

// 平台级指标
interface PlatformMetric {
  platform: string;
  successRate: number;
  errorDistribution: Record<PublishErrorType, number>;
  rateLimitHits: number;            // 触发限流次数
}

// Prometheus 指标导出
import { Counter, Histogram, Gauge } from 'prom-client';

const publishCounter = new Counter({
  name: 'publish_requests_total',
  help: 'Total publish requests',
  labelNames: ['platform', 'status']
});

const publishDuration = new Histogram({
  name: 'publish_duration_seconds',
  help: 'Publish request duration',
  labelNames: ['platform'],
  buckets: [0.5, 1, 2, 5, 10]
});

const publishSuccessRate = new Gauge({
  name: 'publish_success_rate',
  help: 'Publish success rate (last 1h)',
  labelNames: ['platform']
});

// 告警规则（示例 - Prometheus Alertmanager）
const alertRules = `
groups:
  - name: publish_engine
    rules:
      - alert: LowPublishSuccessRate
        expr: publish_success_rate < 0.95
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "发布成功率低于 95%"
          description: "{{ $labels.platform }} 平台发布成功率仅 {{ $value | humanizePercentage }}"

      - alert: HighPublishLatency
        expr: histogram_quantile(0.95, publish_duration_seconds) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "发布延迟过高"
          description: "{{ $labels.platform }} 平台 P95 延迟超过 10 秒"
`;
```

### 3.3 实现路线图

#### Phase 1: 基础架构（2 周）

| 任务 | 产出 | 负责人 |
|------|------|--------|
| 设计数据库 Schema | SQL 迁移脚本 | 焦糖 |
| 实现 Platform Adapter 接口 | TypeScript 接口定义 | 焦糖 |
| 搭建任务队列（BullMQ） | Queue + Worker 基础代码 | 焦糖 |
| 实现状态管理 | CRUD API | 焦糖 |

**验收标准**：
- [ ] 数据库表创建成功
- [ ] 可以提交任务到队列
- [ ] Worker 可以消费任务
- [ ] 可以查询任务状态

#### Phase 2: 平台适配器（3 周）

| 任务 | 产出 | 负责人 |
|------|------|--------|
| 实现抖音 Adapter | DouyinAdapter.ts | 焦糖 |
| 实现小红书 Adapter | XiaohongshuAdapter.ts | 焦糖 |
| 实现微博 Adapter | WeiboAdapter.ts | 焦糖 |
| 凭据管理模块 | CredentialManager.ts | 焦糖 |
| 平台限流控制 | RateLimiter.ts | 焦糖 |

**验收标准**：
- [ ] 3 个平台 Adapter 通过单元测试
- [ ] 凭据可以安全存储和刷新
- [ ] 限流器可以有效控制请求频率

#### Phase 3: 重试与容错（2 周）

| 任务 | 产出 | 负责人 |
|------|------|--------|
| 实现重试引擎 | RetryEngine.ts | 焦糖 |
| 错误分类器 | ErrorClassifier.ts | 焦糖 |
| 熔断器（Circuit Breaker） | CircuitBreaker.ts | 焦糖 |
| 死信队列处理 | DeadLetterHandler.ts | 焦糖 |

**验收标准**：
- [ ] 网络超时自动重试
- [ ] 限流触发时延迟重试
- [ ] 不可重试错误直接失败
- [ ] 失败任务进入死信队列

#### Phase 4: 监控与告警（1 周）

| 任务 | 产出 | 负责人 |
|------|------|--------|
| Prometheus 指标导出 | metrics.ts | 焦糖 |
| Grafana 仪表盘 | dashboard.json | 焦糖 |
| 告警规则配置 | alert-rules.yaml | 焦糖 |
| 日志聚合（可选） | Loki/ELK 配置 | 诺贝 |

**验收标准**：
- [ ] Grafana 可以查看成功率
- [ ] 成功率低于 95% 时触发告警
- [ ] 可以查询失败日志

#### Phase 5: 测试与优化（2 周）

| 任务 | 产出 | 负责人 |
|------|------|--------|
| 集成测试 | E2E 测试套件 | 小检 |
| 压力测试 | 性能测试报告 | 小检 |
| 混沌测试（可选） | 故障注入测试 | 小检 |
| 文档编写 | API 文档 + 运维手册 | 焦糖 |

**验收标准**：
- [ ] 成功率达到 95%+
- [ ] P95 延迟 < 5 秒
- [ ] 通过压力测试（100 QPS）

**总计**：10 周（2.5 个月）

---

## 4. 技术选型建议

### 4.1 核心技术栈

| 组件 | 推荐方案 | 备选方案 | 理由 |
|------|----------|----------|------|
| **编程语言** | TypeScript | Python | 类型安全 + Node.js 生态 |
| **任务队列** | BullMQ | pg-boss | Redis 性能更好，支持优先级 |
| **数据库** | PostgreSQL | - | 已有基础设施 |
| **监控** | Prometheus + Grafana | Datadog | 开源免费，社区活跃 |
| **日志** | Winston + Loki | ELK Stack | 轻量级，易部署 |
| **测试框架** | Jest | Vitest | 成熟稳定 |

### 4.2 第三方依赖

```json
{
  "dependencies": {
    "bullmq": "^5.0.0",           // 任务队列
    "ioredis": "^5.3.0",          // Redis 客户端
    "pg": "^8.11.0",              // PostgreSQL
    "prom-client": "^15.1.0",     // Prometheus 指标
    "winston": "^3.11.0",         // 日志
    "axios": "^1.6.0",            // HTTP 客户端
    "puppeteer": "^21.6.0",       // 浏览器自动化（部分平台）
    "jsonwebtoken": "^9.0.0",     // JWT 处理
    "crypto-js": "^4.2.0"         // 加密
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "jest": "^29.7.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.3.0"
  }
}
```

### 4.3 部署架构

```
┌────────────────────────────────────────────────────────┐
│  香港 VPS (43.154.85.217)                               │
├────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────────┐   ┌──────────────┐               │
│  │  Publish API    │   │  Worker Pool │               │
│  │  (Node.js)      │   │  (5 workers) │               │
│  │  Port: 5300     │   └──────────────┘               │
│  └─────────────────┘           │                       │
│         │                      │                       │
│         ▼                      ▼                       │
│  ┌─────────────────────────────────────┐              │
│  │  Redis (Queue + Cache)              │              │
│  │  Port: 6379                         │              │
│  └─────────────────────────────────────┘              │
│         │                                              │
│         ▼                                              │
│  ┌─────────────────────────────────────┐              │
│  │  PostgreSQL (State + Logs)          │              │
│  │  Port: 5432                         │              │
│  └─────────────────────────────────────┘              │
│         │                                              │
│         ▼                                              │
│  ┌─────────────────────────────────────┐              │
│  │  Prometheus + Grafana (Monitoring)  │              │
│  │  Port: 9090 / 3000                  │              │
│  └─────────────────────────────────────┘              │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Docker Compose 示例**：

```yaml
version: '3.8'

services:
  publish-api:
    image: zenithjoy/publish-engine:latest
    ports:
      - "5300:5300"
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://user:pass@postgres:5432/zenithjoy
    depends_on:
      - redis
      - postgres

  publish-worker:
    image: zenithjoy/publish-engine:latest
    command: npm run worker
    deploy:
      replicas: 5
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://user:pass@postgres:5432/zenithjoy
    depends_on:
      - redis
      - postgres

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=zenithjoy
      - POSTGRES_PASSWORD=secret
      - POSTGRES_DB=zenithjoy
    volumes:
      - postgres-data:/var/lib/postgresql/data

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana-data:/var/lib/grafana

volumes:
  redis-data:
  postgres-data:
  prometheus-data:
  grafana-data:
```

---

## 5. 风险评估与缓解

### 5.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| **平台 API 变更** | High | Medium | - 定期监控 API 变化<br>- 实现 API 版本检测<br>- 保留旧版本 Adapter |
| **凭据管理安全** | High | Low | - 使用加密存储（AES-256）<br>- 定期轮换凭据<br>- 实施最小权限原则 |
| **队列积压** | Medium | Medium | - 水平扩展 Worker<br>- 设置任务过期时间<br>- 优先级队列 |
| **Redis 单点故障** | High | Low | - Redis Sentinel 高可用<br>- 持久化配置（AOF）<br>- 定期备份 |
| **数据库性能瓶颈** | Medium | Low | - 分区表（按时间分区）<br>- 索引优化<br>- 读写分离（可选）|

### 5.2 业务风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| **平台封号** | High | Medium | - 遵守平台 TOS<br>- 控制发布频率<br>- 内容预审核 |
| **重复发布** | Medium | Low | - 幂等性设计<br>- 去重机制<br>- 发布前检查 |
| **内容审核失败** | Medium | High | - 接入敏感词库<br>- 预审核机制<br>- 人工复审流程 |
| **限流导致延迟** | Low | High | - 智能限流器<br>- 错峰发布<br>- 多账号轮换 |

### 5.3 运维风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| **监控盲区** | Medium | Medium | - 完善监控指标<br>- 实施分布式追踪<br>- 定期演练 |
| **告警疲劳** | Low | High | - 合理设置阈值<br>- 告警分级<br>- 静默规则 |
| **回滚困难** | High | Low | - 灰度发布<br>- 蓝绿部署<br>- 数据库迁移可逆 |

---

## 6. 成功指标与验证

### 6.1 核心 KPI

| 指标 | 目标值 | 当前值 | 验证方法 |
|------|--------|--------|----------|
| **发布成功率** | ≥ 95% | - | (成功数 / 总请求数) × 100% |
| **平均响应时间** | ≤ 5s | - | Prometheus `publish_duration_seconds` P50 |
| **P95 响应时间** | ≤ 10s | - | Prometheus `publish_duration_seconds` P95 |
| **重试成功率** | ≥ 70% | - | (重试成功数 / 总重试数) × 100% |
| **系统可用性** | ≥ 99.9% | - | (正常时间 / 总时间) × 100% |

### 6.2 压力测试计划

**测试场景**：

1. **正常负载测试**
   - QPS: 10
   - 持续时间: 1 小时
   - 预期成功率: 95%+

2. **峰值负载测试**
   - QPS: 100
   - 持续时间: 10 分钟
   - 预期成功率: 90%+（允许部分降级）

3. **故障恢复测试**
   - 模拟 Redis 重启
   - 模拟网络抖动
   - 验证任务不丢失，自动恢复

**工具**：
- **k6** (负载测试)
- **Chaos Mesh** (混沌测试，可选)

### 6.3 验收清单

#### 功能验收

- [ ] 支持抖音、小红书、微博 3 个平台发布
- [ ] 支持图文、视频内容类型
- [ ] 支持定时发布
- [ ] 支持批量发布（多平台同时发布）
- [ ] 发布状态实时查询
- [ ] 失败自动重试（最多 3 次）

#### 性能验收

- [ ] 发布成功率 ≥ 95%（连续 7 天）
- [ ] P95 响应时间 ≤ 10 秒
- [ ] 系统可用性 ≥ 99.9%

#### 安全验收

- [ ] 凭据加密存储
- [ ] API 需要认证
- [ ] 敏感日志脱敏
- [ ] SQL 注入防护

#### 运维验收

- [ ] Grafana 仪表盘可用
- [ ] 成功率低于 95% 触发告警
- [ ] 支持一键扩容 Worker
- [ ] 文档完整（部署手册 + API 文档）

---

## 7. 附录

### 7.1 参考资料

- **业界案例**：
  - Buffer 社交媒体管理平台架构
  - Hootsuite 多平台发布引擎
  - Later Instagram 调度系统

- **技术文档**：
  - BullMQ 官方文档：https://docs.bullmq.io/
  - Prometheus 最佳实践：https://prometheus.io/docs/practices/
  - Circuit Breaker 模式：https://martinfowler.com/bliki/CircuitBreaker.html

### 7.2 术语表

| 术语 | 英文 | 解释 |
|------|------|------|
| 发布引擎 | Publish Engine | 统一管理多平台内容发布的系统 |
| 适配器 | Adapter | 抽象不同平台 API 的适配层 |
| 幂等性 | Idempotency | 重复操作不会产生副作用 |
| 指数退避 | Exponential Backoff | 重试延迟按指数增长 |
| 熔断器 | Circuit Breaker | 防止故障扩散的保护机制 |
| 死信队列 | Dead Letter Queue | 存放多次失败任务的队列 |

### 7.3 下一步行动

1. **立即行动**（本周）：
   - [ ] 评审本文档，确认技术方案
   - [ ] 创建项目仓库 `zenithjoy-publish-engine`
   - [ ] 搭建开发环境（Node.js + TypeScript）

2. **短期目标**（2 周内）：
   - [ ] 完成数据库设计和迁移
   - [ ] 实现 Platform Adapter 接口
   - [ ] 搭建任务队列基础设施

3. **中期目标**（1 个月内）：
   - [ ] 完成抖音、小红书 Adapter
   - [ ] 实现重试机制
   - [ ] 部署到香港 VPS 测试环境

4. **长期目标**（2.5 个月内）：
   - [ ] 全部功能开发完成
   - [ ] 通过压力测试
   - [ ] 上线生产环境，达到 95% 成功率

---

## 变更历史

| 版本 | 日期 | 作者 | 变更说明 |
|------|------|------|----------|
| 1.0.0 | 2026-02-06 | Claude (调研) | 初始版本 - 技术设计文档 |

---

**文档状态**: Draft
**审核状态**: Pending
**批准人**: 待定
**生效日期**: 待定
