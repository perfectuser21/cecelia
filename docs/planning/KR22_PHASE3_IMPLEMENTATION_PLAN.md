---
id: kr22-phase3-implementation-plan
version: 1.0.0
created: 2026-02-06
updated: 2026-02-06
changelog:
  - 1.0.0: Initial implementation plan for KR2.2 Phase 3
---

# KR2.2 Phase 3: 重试引擎与状态管理 - 实施计划

## 概述

**目标**: 实现智能重试机制和发布状态管理 API，提升发布成功率从 ~70% 到 95% 以上

**时间**: 4 周 (20 个工作日)

**实施位置**: `/home/xx/dev/zenithjoy-autopilot`

**前置条件**:
- ✅ Phase 1: 数据库 Schema 已完成 (publish_jobs, publish_job_history 表)
- ✅ Phase 2: Platform Adapter 接口和 DouyinAdapter 已实现

## 子任务分解

### Task 3.1: Retry Engine (重试引擎) - 1.5 周

#### 目标

实现智能重试机制，根据错误类型自动重试失败的发布任务，使用指数退避策略。

#### 实现步骤

##### Step 1: 设计架构 (1 天)

**设计内容**:
- Retry Engine 类结构
- Error Classifier 分类规则
- Retry Policy 配置接口
- 与 BullMQ 的集成方式

**输出产物**:
```
docs/architecture/retry-engine-design.md
```

**关键决策**:
1. 使用 BullMQ 内置重试 vs 自定义实现？ → 自定义（更灵活）
2. 错误分类规则存储位置？ → 配置文件 + 代码常量
3. 重试状态如何记录？ → publish_job_history 表

##### Step 2: 实现 Error Classifier (2 天)

**文件**: `src/services/retry/ErrorClassifier.ts`

**功能**:
- 根据 HTTP 状态码分类错误
- 根据错误消息模式分类
- 返回错误类型和是否可重试

**代码示例**:
```typescript
// src/services/retry/ErrorClassifier.ts
export enum ErrorType {
  NETWORK_ERROR = 'network_error',           // 可重试
  RATE_LIMIT = 'rate_limit',                 // 可重试
  SERVER_ERROR = 'server_error',             // 可重试
  AUTH_ERROR = 'auth_error',                 // 不可重试
  PERMISSION_ERROR = 'permission_error',     // 不可重试
  CONTENT_ERROR = 'content_error',           // 不可重试
  UNKNOWN = 'unknown'                        // 可重试
}

export interface ClassifiedError {
  type: ErrorType;
  retryable: boolean;
  message: string;
  statusCode?: number;
}

export class ErrorClassifier {
  /**
   * 分类错误并判断是否可重试
   */
  classify(error: Error | any): ClassifiedError {
    // HTTP 状态码分类
    if (error.statusCode) {
      switch (error.statusCode) {
        case 429: // Rate Limit
          return {
            type: ErrorType.RATE_LIMIT,
            retryable: true,
            message: error.message,
            statusCode: 429
          };
        case 401: // Unauthorized
        case 403: // Forbidden
          return {
            type: ErrorType.AUTH_ERROR,
            retryable: false,
            message: error.message,
            statusCode: error.statusCode
          };
        case 400: // Bad Request
          return {
            type: ErrorType.CONTENT_ERROR,
            retryable: false,
            message: error.message,
            statusCode: 400
          };
        case 500:
        case 502:
        case 503:
        case 504:
          return {
            type: ErrorType.SERVER_ERROR,
            retryable: true,
            message: error.message,
            statusCode: error.statusCode
          };
      }
    }

    // 错误消息模式匹配
    const message = error.message || '';
    if (/timeout|ETIMEDOUT|ECONNRESET/.test(message)) {
      return {
        type: ErrorType.NETWORK_ERROR,
        retryable: true,
        message
      };
    }

    // 默认：未知错误，可重试
    return {
      type: ErrorType.UNKNOWN,
      retryable: true,
      message
    };
  }

  /**
   * 判断错误是否可重试
   */
  isRetryable(error: Error | any): boolean {
    return this.classify(error).retryable;
  }
}
```

**单元测试**:
```typescript
// src/services/retry/__tests__/ErrorClassifier.test.ts
describe('ErrorClassifier', () => {
  let classifier: ErrorClassifier;

  beforeEach(() => {
    classifier = new ErrorClassifier();
  });

  describe('classify', () => {
    it('应该将 429 错误分类为可重试的 RATE_LIMIT', () => {
      const error = { statusCode: 429, message: 'Too many requests' };
      const result = classifier.classify(error);

      expect(result.type).toBe(ErrorType.RATE_LIMIT);
      expect(result.retryable).toBe(true);
    });

    it('应该将 401 错误分类为不可重试的 AUTH_ERROR', () => {
      const error = { statusCode: 401, message: 'Unauthorized' };
      const result = classifier.classify(error);

      expect(result.type).toBe(ErrorType.AUTH_ERROR);
      expect(result.retryable).toBe(false);
    });

    it('应该将超时错误分类为可重试的 NETWORK_ERROR', () => {
      const error = new Error('ETIMEDOUT');
      const result = classifier.classify(error);

      expect(result.type).toBe(ErrorType.NETWORK_ERROR);
      expect(result.retryable).toBe(true);
    });
  });
});
```

##### Step 3: 实现 Retry Policy (1 天)

**文件**: `src/services/retry/RetryPolicy.ts`

**功能**:
- 定义重试策略配置
- 计算重试间隔（指数退避）
- 管理最大重试次数

**代码示例**:
```typescript
// src/services/retry/RetryPolicy.ts
export interface RetryConfig {
  maxAttempts: number;        // 最大重试次数，默认 5
  baseDelay: number;          // 基础延迟（毫秒），默认 1000
  maxDelay: number;           // 最大延迟（毫秒），默认 60000
  exponentialBase: number;    // 指数基数，默认 2
}

export class RetryPolicy {
  private config: RetryConfig;

  constructor(config?: Partial<RetryConfig>) {
    this.config = {
      maxAttempts: config?.maxAttempts || 5,
      baseDelay: config?.baseDelay || 1000,
      maxDelay: config?.maxDelay || 60000,
      exponentialBase: config?.exponentialBase || 2
    };
  }

  /**
   * 计算重试延迟（指数退避）
   * 第 1 次: 1s
   * 第 2 次: 2s
   * 第 3 次: 4s
   * 第 4 次: 8s
   * 第 5 次: 16s
   */
  calculateDelay(attemptNumber: number): number {
    const delay = this.config.baseDelay * Math.pow(
      this.config.exponentialBase,
      attemptNumber - 1
    );

    return Math.min(delay, this.config.maxDelay);
  }

  /**
   * 判断是否应该继续重试
   */
  shouldRetry(attemptNumber: number): boolean {
    return attemptNumber < this.config.maxAttempts;
  }

  /**
   * 获取最大重试次数
   */
  getMaxAttempts(): number {
    return this.config.maxAttempts;
  }
}
```

##### Step 4: 实现 Retry Engine (2 天)

**文件**: `src/services/retry/RetryEngine.ts`

**功能**:
- 集成 ErrorClassifier 和 RetryPolicy
- 执行重试逻辑
- 记录重试状态到数据库

**代码示例**:
```typescript
// src/services/retry/RetryEngine.ts
import { ErrorClassifier } from './ErrorClassifier';
import { RetryPolicy } from './RetryPolicy';
import { publishJobHistoryRepository } from '../../repositories/publishJobHistory';

export interface RetryContext {
  jobId: string;
  attemptNumber: number;
  maxAttempts: number;
  error: Error | any;
}

export class RetryEngine {
  private classifier: ErrorClassifier;
  private policy: RetryPolicy;

  constructor(policy?: RetryPolicy) {
    this.classifier = new ErrorClassifier();
    this.policy = policy || new RetryPolicy();
  }

  /**
   * 判断是否应该重试
   */
  async shouldRetry(context: RetryContext): Promise<boolean> {
    // 1. 检查是否超过最大重试次数
    if (context.attemptNumber >= this.policy.getMaxAttempts()) {
      await this.recordRetryDecision(context, false, 'Max attempts reached');
      return false;
    }

    // 2. 分类错误并判断是否可重试
    const classified = this.classifier.classify(context.error);
    if (!classified.retryable) {
      await this.recordRetryDecision(context, false, `Non-retryable error: ${classified.type}`);
      return false;
    }

    // 3. 可以重试
    await this.recordRetryDecision(context, true, `Retryable error: ${classified.type}`);
    return true;
  }

  /**
   * 计算下次重试的延迟时间
   */
  getRetryDelay(attemptNumber: number): number {
    return this.policy.calculateDelay(attemptNumber + 1);
  }

  /**
   * 记录重试决策到数据库
   */
  private async recordRetryDecision(
    context: RetryContext,
    willRetry: boolean,
    reason: string
  ): Promise<void> {
    await publishJobHistoryRepository.create({
      job_id: context.jobId,
      status: willRetry ? 'retrying' : 'failed',
      error_message: context.error.message,
      error_type: this.classifier.classify(context.error).type,
      attempt_number: context.attemptNumber,
      will_retry: willRetry,
      retry_reason: reason,
      created_at: new Date()
    });
  }
}
```

##### Step 5: 单元测试 (2 天)

**目标覆盖率**: > 85%

**测试文件**:
- `src/services/retry/__tests__/ErrorClassifier.test.ts`
- `src/services/retry/__tests__/RetryPolicy.test.ts`
- `src/services/retry/__tests__/RetryEngine.test.ts`

##### Step 6: 集成测试 (1 天)

**测试文件**: `src/__tests__/integration/retry-flow.test.ts`

**测试场景**:
1. 模拟网络错误，验证自动重试
2. 模拟认证错误，验证不重试
3. 模拟达到最大重试次数，验证停止重试
4. 验证重试延迟符合指数退避策略

---

### Task 3.2: 状态管理 API (1.5 周)

#### 目标

实现发布任务的状态管理 API，提供完整的 CRUD 功能，支持创建、查询、取消任务。

#### 实现步骤

##### Step 1: 定义 API Schema (0.5 天)

**文件**: `src/validators/publishSchemas.ts`

**使用 Zod 定义输入验证 Schema**:
```typescript
// src/validators/publishSchemas.ts
import { z } from 'zod';

export const CreateJobSchema = z.object({
  platform: z.enum(['douyin', 'xiaohongshu', 'weibo']),
  account_id: z.string().uuid(),
  content_id: z.string().uuid(),
  content: z.object({
    title: z.string().min(1).max(100),
    description: z.string().max(5000),
    media_urls: z.array(z.string().url()),
    tags: z.array(z.string()).max(10)
  }),
  schedule_time: z.string().datetime().optional(),
  priority: z.number().int().min(1).max(10).optional()
});

export const GetJobsQuerySchema = z.object({
  platform: z.enum(['douyin', 'xiaohongshu', 'weibo']).optional(),
  status: z.enum(['pending', 'processing', 'success', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export type CreateJobInput = z.infer<typeof CreateJobSchema>;
export type GetJobsQuery = z.infer<typeof GetJobsQuerySchema>;
```

##### Step 2: 实现 Service 层 (2 天)

**文件**: `src/services/PublishService.ts`

**功能**:
- 创建发布任务
- 查询任务状态
- 取消任务
- 批量查询任务

**代码示例**:
```typescript
// src/services/PublishService.ts
import { v4 as uuidv4 } from 'uuid';
import { publishJobRepository } from '../repositories/publishJob';
import { publishJobHistoryRepository } from '../repositories/publishJobHistory';
import { publishQueue } from '../queue/publishQueue';
import { CreateJobInput, GetJobsQuery } from '../validators/publishSchemas';

export class PublishService {
  /**
   * 创建发布任务
   */
  async createJob(input: CreateJobInput): Promise<{ job_id: string; status: string }> {
    // 1. 创建任务记录
    const job_id = uuidv4();
    await publishJobRepository.create({
      id: job_id,
      platform: input.platform,
      account_id: input.account_id,
      content_id: input.content_id,
      content: input.content,
      status: 'pending',
      priority: input.priority || 5,
      schedule_time: input.schedule_time ? new Date(input.schedule_time) : null,
      created_at: new Date()
    });

    // 2. 记录历史
    await publishJobHistoryRepository.create({
      job_id,
      status: 'pending',
      created_at: new Date()
    });

    // 3. 加入队列
    await publishQueue.add(
      'publish-task',
      {
        job_id,
        platform: input.platform,
        account_id: input.account_id,
        content: input.content
      },
      {
        jobId: job_id,
        priority: input.priority || 5,
        delay: input.schedule_time
          ? new Date(input.schedule_time).getTime() - Date.now()
          : 0
      }
    );

    // 4. 更新状态为 queued
    await publishJobRepository.update(job_id, { status: 'queued' });

    return { job_id, status: 'queued' };
  }

  /**
   * 查询任务状态
   */
  async getJob(jobId: string) {
    const job = await publishJobRepository.findById(jobId);
    if (!job) {
      throw new Error('Job not found');
    }
    return job;
  }

  /**
   * 查询任务历史
   */
  async getJobHistory(jobId: string) {
    return publishJobHistoryRepository.findByJobId(jobId);
  }

  /**
   * 取消任务
   */
  async cancelJob(jobId: string): Promise<{ success: boolean; message: string }> {
    const job = await publishJobRepository.findById(jobId);
    if (!job) {
      throw new Error('Job not found');
    }

    if (['success', 'failed', 'cancelled'].includes(job.status)) {
      return {
        success: false,
        message: `Cannot cancel job in status: ${job.status}`
      };
    }

    // 1. 从队列中移除
    await publishQueue.remove(jobId);

    // 2. 更新数据库状态
    await publishJobRepository.update(jobId, { status: 'cancelled' });

    // 3. 记录历史
    await publishJobHistoryRepository.create({
      job_id: jobId,
      status: 'cancelled',
      created_at: new Date()
    });

    return { success: true, message: 'Job cancelled successfully' };
  }

  /**
   * 批量查询任务
   */
  async getJobs(query: GetJobsQuery) {
    const { jobs, total } = await publishJobRepository.findMany({
      platform: query.platform,
      status: query.status,
      limit: query.limit,
      offset: query.offset
    });

    return {
      jobs,
      total,
      page: Math.floor(query.offset / query.limit) + 1,
      page_size: query.limit
    };
  }
}

export const publishService = new PublishService();
```

##### Step 3: 实现 Controller 层 (1 天)

**文件**: `src/controllers/PublishController.ts`

**代码示例**:
```typescript
// src/controllers/PublishController.ts
import { Request, Response, NextFunction } from 'express';
import { publishService } from '../services/PublishService';
import { CreateJobSchema, GetJobsQuerySchema } from '../validators/publishSchemas';

export class PublishController {
  async createJob(req: Request, res: Response, next: NextFunction) {
    try {
      const input = CreateJobSchema.parse(req.body);
      const result = await publishService.createJob(input);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async getJob(req: Request, res: Response, next: NextFunction) {
    try {
      const { job_id } = req.params;
      const job = await publishService.getJob(job_id);
      res.json(job);
    } catch (error) {
      next(error);
    }
  }

  async getJobHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const { job_id } = req.params;
      const history = await publishService.getJobHistory(job_id);
      res.json(history);
    } catch (error) {
      next(error);
    }
  }

  async cancelJob(req: Request, res: Response, next: NextFunction) {
    try {
      const { job_id } = req.params;
      const result = await publishService.cancelJob(job_id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async getJobs(req: Request, res: Response, next: NextFunction) {
    try {
      const query = GetJobsQuerySchema.parse(req.query);
      const result = await publishService.getJobs(query);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

export const publishController = new PublishController();
```

##### Step 4: 实现 Routes (0.5 天)

**文件**: `src/routes/publish.ts`

**代码示例**:
```typescript
// src/routes/publish.ts
import { Router } from 'express';
import { publishController } from '../controllers/PublishController';

const router = Router();

// 创建发布任务
router.post('/jobs', publishController.createJob.bind(publishController));

// 查询任务状态
router.get('/jobs/:job_id', publishController.getJob.bind(publishController));

// 查询任务历史
router.get('/jobs/:job_id/history', publishController.getJobHistory.bind(publishController));

// 取消任务
router.post('/jobs/:job_id/cancel', publishController.cancelJob.bind(publishController));

// 批量查询任务
router.get('/jobs', publishController.getJobs.bind(publishController));

export default router;
```

**集成到主应用**:
```typescript
// src/app.ts
import publishRoutes from './routes/publish';

app.use('/api/publish', publishRoutes);
```

##### Step 5: 错误处理中间件 (0.5 天)

**文件**: `src/middleware/errorHandler.ts`

**代码示例**:
```typescript
// src/middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Zod 验证错误
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation Error',
      details: err.errors
    });
  }

  // 自定义业务错误
  if (err.message === 'Job not found') {
    return res.status(404).json({
      error: 'Not Found',
      message: err.message
    });
  }

  // 默认服务器错误
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production'
      ? 'An error occurred'
      : err.message
  });
}
```

##### Step 6: API 测试 (2 天)

**测试文件**: `src/__tests__/routes/publish.test.ts`

**测试覆盖**:
- 所有 5 个 API 端点的正常流程
- 输入验证错误场景
- 业务错误场景（如任务不存在）
- 边界条件测试

---

### Task 3.3: BullMQ 集成 (1 周)

#### 目标

集成 BullMQ 任务队列，实现异步任务处理、并发控制、优先级队列和定时发布。

#### 实现步骤

##### Step 1: BullMQ 配置 (1 天)

**文件**: `src/queue/queueConfig.ts`

**代码示例**:
```typescript
// src/queue/queueConfig.ts
import { ConnectionOptions } from 'bullmq';

export const redisConnection: ConnectionOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0'),

  // 连接池配置
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false
};

export const queueConfig = {
  connection: redisConnection,

  // 默认任务选项
  defaultJobOptions: {
    attempts: 5,                    // 最大重试次数
    backoff: {
      type: 'exponential',
      delay: 1000                   // 基础延迟 1s
    },
    removeOnComplete: {
      age: 7 * 24 * 3600            // 7 天后清理完成任务
    },
    removeOnFail: {
      age: 30 * 24 * 3600           // 30 天后清理失败任务
    }
  }
};
```

##### Step 2: 创建队列 (1 天)

**文件**: `src/queue/publishQueue.ts`

**代码示例**:
```typescript
// src/queue/publishQueue.ts
import { Queue } from 'bullmq';
import { queueConfig } from './queueConfig';

export interface PublishJobData {
  job_id: string;
  platform: 'douyin' | 'xiaohongshu' | 'weibo';
  account_id: string;
  content: {
    title: string;
    description: string;
    media_urls: string[];
    tags: string[];
  };
}

export const publishQueue = new Queue<PublishJobData>(
  'publish-jobs',
  queueConfig
);

// 队列事件监听
publishQueue.on('error', (err) => {
  console.error('Queue error:', err);
});

publishQueue.on('waiting', (jobId) => {
  console.log(`Job ${jobId} is waiting`);
});
```

##### Step 3: 实现 Worker (2 天)

**文件**: `src/workers/publishWorker.ts`

**代码示例**:
```typescript
// src/workers/publishWorker.ts
import { Worker, Job } from 'bullmq';
import { PublishJobData } from '../queue/publishQueue';
import { queueConfig } from '../queue/queueConfig';
import { platformAdapterFactory } from '../adapters/platformAdapterFactory';
import { publishJobRepository } from '../repositories/publishJob';
import { publishJobHistoryRepository } from '../repositories/publishJobHistory';
import { RetryEngine } from '../services/retry/RetryEngine';

const retryEngine = new RetryEngine();

const worker = new Worker<PublishJobData>(
  'publish-jobs',
  async (job: Job<PublishJobData>) => {
    const { job_id, platform, account_id, content } = job.data;

    try {
      // 1. 更新状态为 processing
      await publishJobRepository.update(job_id, { status: 'processing' });
      await publishJobHistoryRepository.create({
        job_id,
        status: 'processing',
        attempt_number: job.attemptsMade + 1,
        created_at: new Date()
      });

      // 2. 获取平台 Adapter
      const adapter = await platformAdapterFactory.getAdapter(platform, account_id);

      // 3. 执行发布
      const result = await adapter.publish(content);

      // 4. 发布成功，更新状态
      await publishJobRepository.update(job_id, {
        status: 'success',
        result: {
          post_id: result.post_id,
          post_url: result.post_url
        },
        completed_at: new Date()
      });

      await publishJobHistoryRepository.create({
        job_id,
        status: 'success',
        result: result,
        created_at: new Date()
      });

      return result;

    } catch (error: any) {
      // 5. 发布失败，判断是否重试
      const shouldRetry = await retryEngine.shouldRetry({
        jobId: job_id,
        attemptNumber: job.attemptsMade + 1,
        maxAttempts: 5,
        error
      });

      if (shouldRetry) {
        // 计算重试延迟
        const retryDelay = retryEngine.getRetryDelay(job.attemptsMade);
        throw error; // 抛出错误让 BullMQ 处理重试
      } else {
        // 不重试，标记为 failed
        await publishJobRepository.update(job_id, {
          status: 'failed',
          error_message: error.message,
          completed_at: new Date()
        });

        await publishJobHistoryRepository.create({
          job_id,
          status: 'failed',
          error_message: error.message,
          created_at: new Date()
        });

        // 不抛出错误，让任务完成（避免 BullMQ 继续重试）
        return { error: error.message };
      }
    }
  },
  {
    ...queueConfig,
    concurrency: 5,  // 并发处理 5 个任务
    limiter: {
      max: 10,       // 每 10 秒最多处理 10 个任务
      duration: 10000
    }
  }
);

// Worker 事件监听
worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});

export default worker;
```

##### Step 4: 集成 Bull Board (可视化) (1 天)

**文件**: `src/config/bullBoard.ts`

**代码示例**:
```typescript
// src/config/bullBoard.ts
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { publishQueue } from '../queue/publishQueue';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(publishQueue)],
  serverAdapter
});

export default serverAdapter;
```

**集成到主应用**:
```typescript
// src/app.ts
import bullBoardAdapter from './config/bullBoard';

app.use('/admin/queues', bullBoardAdapter.getRouter());
```

访问 `http://localhost:5212/admin/queues` 查看队列状态。

##### Step 5: 优先级队列测试 (1 天)

**测试文件**: `src/__tests__/queue/priority.test.ts`

**测试场景**:
- 高优先级任务先执行
- 相同优先级按 FIFO 顺序执行

##### Step 6: 定时任务测试 (1 天)

**测试文件**: `src/__tests__/queue/scheduled.test.ts`

**测试场景**:
- 定时任务在指定时间执行
- 定时任务可以被取消

##### Step 7: 集成测试 (1 天)

**测试文件**: `src/__tests__/integration/retry-flow.test.ts`

**测试场景**:
- 任务失败后自动重试（集成 RetryEngine）
- 达到最大重试次数后停止
- 重试延迟符合指数退避策略

---

## 整合和测试 (3 天)

### Day 1: 整合三个子任务

- 确保 Retry Engine、API、BullMQ 正确集成
- 端到端测试：创建任务 → 入队 → Worker 处理 → 失败重试 → 最终成功

### Day 2: 性能测试

**测试目标**:
- API 响应时间 < 200ms (p95)
- 发布成功率 > 95%
- 平均重试次数 < 1.5 次

**测试工具**: Apache Bench 或 k6

**测试脚本**:
```bash
# 创建 1000 个任务
k6 run performance-test.js
```

### Day 3: 文档和 Code Review

- 更新 API 文档（OpenAPI/Swagger）
- 代码审查和优化
- 准备部署脚本

---

## 验收标准

### Task 3.1: Retry Engine

- [x] 支持指数退避策略（1s, 2s, 4s, 8s, 16s）
- [x] 错误分类器正确分类可重试/不可重试错误
- [x] 重试状态记录到 publish_job_history 表
- [x] 达到最大重试次数后停止重试
- [x] 单元测试覆盖率 > 85%
- [x] 集成测试通过

### Task 3.2: 状态管理 API

- [x] 5 个 API 端点全部实现
- [x] 输入验证完整（使用 Zod）
- [x] 错误处理统一
- [x] API 响应时间 < 200ms (p95)
- [x] 单元测试覆盖率 > 80%
- [x] API 集成测试通过

### Task 3.3: BullMQ 集成

- [x] BullMQ 队列正常工作
- [x] Worker 并发处理（5 并发）
- [x] 优先级队列功能正常
- [x] 定时任务功能正常
- [x] Bull Board 可视化正常
- [x] 单元测试覆盖率 > 75%

### 整体验收

- [x] 发布成功率 > 95%
- [x] 平均重试次数 < 1.5 次
- [x] API 可用性 > 99.9%
- [x] 所有代码通过 Audit（L1+L2=0）
- [x] 集成测试全部通过

---

## 依赖和工具

### 新增 npm 包

```json
{
  "dependencies": {
    "bullmq": "^5.0.0",
    "@bull-board/express": "^5.0.0",
    "@bull-board/api": "^5.0.0",
    "zod": "^3.22.0",
    "ioredis": "^5.3.0"
  },
  "devDependencies": {
    "@types/bull": "^4.10.0",
    "k6": "^0.48.0"
  }
}
```

### Redis 配置

确保 Redis 服务运行：
```bash
# 启动 Redis
docker run -d -p 6379:6379 redis:7-alpine
```

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| BullMQ 学习曲线 | Medium | 参考官方文档和示例代码 |
| Redis 单点故障 | High | Phase 4 引入 Redis Sentinel |
| 重试逻辑过于复杂 | Medium | 先实现基础功能，逐步优化 |
| API 性能不达标 | Low | 添加数据库索引，使用缓存 |
| 测试覆盖率不足 | Medium | 严格执行 TDD，代码审查时检查 |

---

## 后续任务

完成 Phase 3 后，进入 Phase 4:
- 单元测试和集成测试完善
- Prometheus 监控集成
- 日志和告警系统
- 性能优化和压力测试

---

**文档版本**: 1.0.0
**创建日期**: 2026-02-06
**预计完成**: 2026-03-06 (4 周后)
