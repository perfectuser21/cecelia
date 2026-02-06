# KR2.2 统一发布引擎技术设计文档

**版本**: v1.0
**日期**: 2026-02-06
**目标**: 一键发布 API 成功率 ≥95%

---

## 1. 执行摘要

本文档分析了 ZenithJoy 内容发布系统的现状，识别了导致发布失败的主要原因，并提出了统一发布引擎的技术设计方案，目标是将一键发布 API 成功率提升至 ≥95%。

**核心问题**: 当前系统缺乏统一的任务队列、重试机制和错误处理，导致发布成功率无法保障。

**解决方案**: 构建基于消息队列的统一发布引擎，实现可靠的任务调度、自动重试和完善的监控。

---

## 2. 现状分析

### 2.1 系统架构概览

当前发布系统采用**混合架构**（单体应用 + 外部脚本）：

```
Frontend (React/TypeScript)
    ↓ HTTP REST API
Creator API (Python FastAPI :8899)
    ↓
SQLite Database
    ↓
Publishing Scripts (Python CDP Automation)
    ↓ Tailscale
Node PC Browser (100.97.242.124:19226)
    ↓
Social Media Platforms
```

### 2.2 核心组件

| 组件 | 技术栈 | 职责 | 文件路径 |
|------|--------|------|----------|
| **Frontend** | React + TypeScript | 用户界面、任务创建 | `/home/xx/perfect21/zenithjoy/workspace/apps/dashboard/src/pages/ContentPublish.tsx` |
| **API Client** | TypeScript | 前端 API 调用 | `/home/xx/perfect21/zenithjoy/workspace/apps/dashboard/src/api/publish.api.ts` |
| **Backend API** | Python FastAPI | 任务管理、状态存储 | `/home/xx/perfect21/zenithjoy/creator/api/server.py` |
| **Database** | SQLite | 任务和发布记录 | `/home/xx/perfect21/zenithjoy/creator/api/` |
| **Publishing Script** | Python CDP | 浏览器自动化发布 | `/home/xx/perfect21/zenithjoy/creator/scripts/publish-to-toutiao.py` |
| **Content Engine** | Python Pillow | 图片卡片生成 | `/home/xx/perfect21/zenithjoy/creator/scripts/engine/main.py` |

### 2.3 发布流程

```
1. 用户创建任务 (标题、内容、平台、计划时间)
   ↓
2. Frontend → POST /v1/publish/tasks → SQLite (status: draft)
   ↓
3. 用户点击"提交" → POST /v1/publish/tasks/{id}/submit
   ↓
4. Backend 更新状态 → processing
   ↓
5. 执行 Publishing Script (同步调用)
   ↓
6. CDP 自动化操作浏览器 (填表、上传、发布)
   ↓
7. 返回结果 → 更新状态 (completed/failed/partial)
```

### 2.4 支持的平台

| 平台 | 状态 | 自动化方式 |
|------|------|------------|
| 今日头条 (Toutiao) | ✅ 已实现 | CDP 浏览器自动化 (100% 成功率) |
| 小红书 (Xiaohongshu) | ⏸️ 记录模式 | 未实现 |
| 抖音 (Douyin) | ⏸️ 记录模式 | 未实现 |
| 微博 (Weibo) | ⏸️ 记录模式 | 未实现 |
| 快手 (Kuaishou) | ⏸️ 记录模式 | 未实现 |
| 视频号 (Shipinhao) | ⏸️ 记录模式 | 未实现 |
| X (Twitter) | ⏸️ 记录模式 | 未实现 |
| 公众号 (WeChat) | ⏸️ 记录模式 | 未实现 |
| 知乎 (Zhihu) | ⏸️ 记录模式 | 未实现 |
| B站 (Bilibili) | ⏸️ 记录模式 | 未实现 |

**注**: 记录模式指仅保存发布记录到数据库，不执行实际发布。

### 2.5 任务状态机

```
draft → pending → processing → completed
                           ↓
                          failed
                           ↓
                         partial (部分平台成功)
```

---

## 3. 问题诊断

### 3.1 架构问题

| 问题 | 影响 | 严重性 |
|------|------|--------|
| **缺乏异步任务队列** | 发布任务阻塞 HTTP 线程，超时导致失败 | 🔴 高 |
| **单线程执行** | 无法并发发布多平台，效率低 | 🟠 中 |
| **无持久化队列** | 服务重启丢失待处理任务 | 🔴 高 |
| **SQLite 并发限制** | 高并发写入冲突 | 🟠 中 |

### 3.2 可靠性问题

| 问题 | 影响 | 严重性 |
|------|------|--------|
| **无自动重试机制** | 网络波动导致永久失败 | 🔴 高 |
| **无指数退避** | 重试过快触发平台反爬 | 🟠 中 |
| **无死信队列** | 永久失败的任务无法追踪 | 🟡 低 |
| **无超时保护** | 任务卡死占用资源 | 🟠 中 |

### 3.3 监控与可观测性问题

| 问题 | 影响 | 严重性 |
|------|------|--------|
| **无结构化日志** | 无法追踪失败原因 | 🔴 高 |
| **无成功率指标** | 无法量化 KR2.2 目标 | 🔴 高 |
| **无告警机制** | 大量失败无人知晓 | 🟠 中 |
| **无链路追踪** | 跨服务调试困难 | 🟡 低 |

### 3.4 平台集成问题

| 问题 | 影响 | 严重性 |
|------|------|--------|
| **CDP 依赖不稳定** | Chrome 更新导致脚本失效 | 🟠 中 |
| **Tailscale 单点故障** | Node PC 断网全体失败 | 🔴 高 |
| **无 Session 管理** | 登录态失效需手动恢复 | 🟠 中 |
| **无验证码处理** | 遇验证码直接失败 | 🟠 中 |

### 3.5 当前成功率估算

**假设**（基于代码分析）：
- 今日头条自动化：100% 成功率（实测 3/3）
- 其他平台：0% 成功率（未实现自动化）
- 网络/服务问题：估计 5% 失败率
- Tailscale 连接问题：估计 3% 失败率

**当前整体成功率**: 约 **92%**（仅头条）
**多平台场景**: < **50%**（其他平台未实现）

---

## 4. 技术设计方案

### 4.1 设计原则

1. **可靠优先**: 宁可慢也要保证成功
2. **幂等性**: 同一任务多次执行结果一致
3. **可观测**: 每个环节可追踪、可监控
4. **解耦**: 发布引擎与平台适配器分离
5. **可扩展**: 新增平台无需修改核心逻辑

### 4.2 统一发布引擎架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React)                        │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTP REST API
                 ↓
┌─────────────────────────────────────────────────────────────┐
│              API Gateway (FastAPI)                          │
│  - 任务创建/查询                                              │
│  - 权限验证                                                  │
│  - 请求限流                                                  │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────────────┐
│            Unified Publishing Engine (Core)                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Task Manager (任务管理器)                            │  │
│  │  - 任务验证                                           │  │
│  │  - 状态机管理                                         │  │
│  │  - 任务分解 (1个任务 → N个平台子任务)                  │  │
│  └─────────────────┬────────────────────────────────────┘  │
│                    │                                         │
│                    ↓                                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Message Queue (消息队列 - Redis/RabbitMQ)           │  │
│  │  - publish.task.{platform} (按平台分队列)             │  │
│  │  - Priority Queue (优先级队列)                        │  │
│  │  - Dead Letter Queue (死信队列)                       │  │
│  └─────────────────┬────────────────────────────────────┘  │
│                    │                                         │
│                    ↓                                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Worker Pool (工作池)                                 │  │
│  │  - 并发执行                                           │  │
│  │  - 自动扩缩容                                         │  │
│  │  - 健康检查                                           │  │
│  └─────────────────┬────────────────────────────────────┘  │
└────────────────────┼─────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│         Platform Adapters (平台适配器层)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ Toutiao  │ │  XHS     │ │ Douyin   │ │ Weibo    │ ...  │
│  │ Adapter  │ │ Adapter  │ │ Adapter  │ │ Adapter  │      │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘      │
└───────┼────────────┼────────────┼────────────┼─────────────┘
        │            │            │            │
        ↓            ↓            ↓            ↓
┌─────────────────────────────────────────────────────────────┐
│         Publishing Executors (执行层)                        │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │  CDP Automation  │  │  Official API    │                │
│  │  (Browser)       │  │  (HTTP)          │                │
│  └──────────────────┘  └──────────────────┘                │
└─────────────────────────────────────────────────────────────┘
        │                          │
        ↓                          ↓
    Social Media Platforms
```

### 4.3 核心组件设计

#### 4.3.1 Task Manager (任务管理器)

**职责**:
- 接收发布任务请求
- 验证任务合法性 (内容、平台、媒体文件)
- 任务分解：1 个任务 → N 个平台子任务
- 状态机管理

**接口设计**:
```python
class TaskManager:
    def create_task(self, content: PublishContent) -> Task:
        """创建任务并分解为子任务"""
        pass

    def submit_task(self, task_id: str) -> bool:
        """提交任务到队列"""
        pass

    def update_status(self, task_id: str, status: TaskStatus):
        """更新任务状态"""
        pass

    def get_task(self, task_id: str) -> Task:
        """查询任务详情"""
        pass
```

**任务分解逻辑**:
```python
# 1 个任务 → N 个平台子任务
task = Task(
    id="task-001",
    title="2024年度总结",
    platforms=["toutiao", "weibo", "xiaohongshu"]
)

# 分解为 3 个子任务
subtasks = [
    SubTask(id="task-001-toutiao", platform="toutiao", parent_id="task-001"),
    SubTask(id="task-001-weibo", platform="weibo", parent_id="task-001"),
    SubTask(id="task-001-xiaohongshu", platform="xiaohongshu", parent_id="task-001")
]
```

#### 4.3.2 Message Queue (消息队列)

**技术选型**: **Redis + Celery** (推荐) 或 **RabbitMQ**

**原因**:
- Redis: 已有基础设施，轻量级，适合中小规模
- Celery: 成熟的 Python 异步任务框架
- RabbitMQ: 更强的可靠性保障，适合大规模场景

**队列设计**:
```python
# 按平台分队列（隔离故障）
QUEUE_PUBLISH_TOUTIAO = "publish.task.toutiao"
QUEUE_PUBLISH_WEIBO = "publish.task.weibo"
QUEUE_PUBLISH_XHS = "publish.task.xiaohongshu"
QUEUE_PUBLISH_DOUYIN = "publish.task.douyin"
# ...

# 优先级队列
PRIORITY_HIGH = 9    # 紧急任务
PRIORITY_NORMAL = 5  # 正常任务
PRIORITY_LOW = 1     # 批量任务

# 死信队列
QUEUE_DLQ = "publish.task.dead_letter"
```

**任务入队**:
```python
from celery import Celery

app = Celery('publishing', broker='redis://localhost:6379/0')

@app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,  # 60秒后重试
    autoretry_for=(NetworkError, TimeoutError)
)
def publish_to_platform(self, subtask_id: str):
    try:
        subtask = get_subtask(subtask_id)
        adapter = get_adapter(subtask.platform)
        result = adapter.publish(subtask.content)
        update_status(subtask_id, "completed", result)
    except RetryableError as e:
        self.retry(exc=e)
    except FatalError as e:
        send_to_dlq(subtask_id, e)
```

#### 4.3.3 Worker Pool (工作池)

**设计**:
```python
# Celery Worker 配置
CELERY_WORKER_CONCURRENCY = 4  # 并发数
CELERY_WORKER_PREFETCH_MULTIPLIER = 1  # 预取任务数
CELERY_TASK_ACKS_LATE = True  # 任务完成后再确认
CELERY_TASK_REJECT_ON_WORKER_LOST = True  # Worker 崩溃时拒绝任务
```

**启动 Worker**:
```bash
# 按平台启动专用 Worker
celery -A publishing.celery worker -Q publish.task.toutiao -n toutiao@%h
celery -A publishing.celery worker -Q publish.task.weibo -n weibo@%h
celery -A publishing.celery worker -Q publish.task.xiaohongshu -n xhs@%h
```

**自动扩缩容** (Kubernetes HPA):
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: publish-worker-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: publish-worker
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

#### 4.3.4 Platform Adapter (平台适配器)

**接口定义**:
```python
from abc import ABC, abstractmethod
from typing import Optional

class PlatformAdapter(ABC):
    """平台适配器基类"""

    @abstractmethod
    def publish(self, content: PublishContent) -> PublishResult:
        """发布内容"""
        pass

    @abstractmethod
    def validate(self, content: PublishContent) -> ValidationResult:
        """验证内容是否符合平台规范"""
        pass

    @abstractmethod
    def get_specs(self) -> PlatformSpec:
        """获取平台规范（字数限制、图片尺寸等）"""
        pass

    @abstractmethod
    def check_session(self) -> bool:
        """检查登录态是否有效"""
        pass
```

**实现示例**:
```python
class ToutiaoAdapter(PlatformAdapter):
    def __init__(self, cdp_client: CDPClient):
        self.cdp = cdp_client
        self.platform = "toutiao"

    def publish(self, content: PublishContent) -> PublishResult:
        try:
            # 1. 检查登录态
            if not self.check_session():
                self.login()

            # 2. 导航到发布页
            self.cdp.navigate("https://mp.toutiao.com/profile_v4/graphic/publish")

            # 3. 填写标题
            self.cdp.fill("#title-input", content.title)

            # 4. 填写正文
            self.cdp.fill(".editor-content", content.body)

            # 5. 上传图片
            for img in content.images:
                self.cdp.upload(".image-uploader", img.path)

            # 6. 点击发布
            self.cdp.click("button.publish-btn")

            # 7. 等待成功提示
            success_msg = self.cdp.wait_for_text("发布成功", timeout=30)

            # 8. 提取发布 URL
            url = self.extract_publish_url()

            return PublishResult(
                status="success",
                url=url,
                message="发布成功"
            )
        except CDPTimeoutError as e:
            raise RetryableError(f"超时: {e}")
        except CDPElementNotFoundError as e:
            raise FatalError(f"页面元素未找到: {e}")

    def validate(self, content: PublishContent) -> ValidationResult:
        errors = []
        if len(content.title) > 30:
            errors.append("标题不能超过30字")
        if len(content.body) > 5000:
            errors.append("正文不能超过5000字")
        if len(content.images) > 9:
            errors.append("图片不能超过9张")

        return ValidationResult(
            valid=len(errors) == 0,
            errors=errors
        )

    def get_specs(self) -> PlatformSpec:
        return PlatformSpec(
            platform="toutiao",
            title_max_length=30,
            body_max_length=5000,
            max_images=9,
            supported_formats=["jpg", "png", "gif"]
        )

    def check_session(self) -> bool:
        try:
            self.cdp.navigate("https://mp.toutiao.com")
            return self.cdp.exists(".user-avatar")
        except:
            return False
```

#### 4.3.5 Retry & Error Handling (重试与错误处理)

**重试策略**:
```python
from celery import Celery
from celery.exceptions import Retry

app = Celery('publishing')

@app.task(
    bind=True,
    max_retries=5,
    autoretry_for=(NetworkError, TimeoutError),
    retry_backoff=True,  # 指数退避
    retry_backoff_max=600,  # 最大退避10分钟
    retry_jitter=True  # 随机抖动防止雪崩
)
def publish_task(self, subtask_id: str):
    try:
        # 执行发布
        result = execute_publish(subtask_id)
        return result
    except RetryableError as e:
        # 可重试错误
        logger.warning(f"Retrying task {subtask_id}: {e}")
        raise self.retry(exc=e)
    except FatalError as e:
        # 不可重试错误，直接失败
        logger.error(f"Fatal error in task {subtask_id}: {e}")
        send_to_dlq(subtask_id, str(e))
        raise
```

**错误分类**:
```python
# 可重试错误 (Retryable)
class NetworkError(RetryableError): pass
class TimeoutError(RetryableError): pass
class ServiceUnavailableError(RetryableError): pass
class RateLimitError(RetryableError): pass

# 不可重试错误 (Fatal)
class ContentValidationError(FatalError): pass
class AccountSuspendedError(FatalError): pass
class PlatformPolicyViolationError(FatalError): pass
```

**死信队列处理**:
```python
@app.task
def handle_dead_letter(subtask_id: str, error: str):
    """处理死信队列中的任务"""
    # 1. 记录失败日志
    log_failed_task(subtask_id, error)

    # 2. 发送告警
    send_alert(f"任务永久失败: {subtask_id}, 原因: {error}")

    # 3. 更新任务状态
    update_task_status(subtask_id, "failed", error)

    # 4. 通知用户
    notify_user(subtask_id, "发布失败，请检查内容或联系客服")
```

### 4.4 数据库设计

**从 SQLite 迁移到 PostgreSQL**（支持高并发）：

```sql
-- 发布任务表
CREATE TABLE publish_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    title VARCHAR(200) NOT NULL,
    content TEXT,
    platforms TEXT[] NOT NULL,  -- 数组类型
    status VARCHAR(20) NOT NULL,  -- draft, pending, processing, completed, partial, failed
    scheduled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    INDEX idx_status (status),
    INDEX idx_user_id (user_id),
    INDEX idx_created_at (created_at)
);

-- 平台子任务表
CREATE TABLE publish_subtasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES publish_tasks(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,  -- queued, processing, completed, failed
    result JSONB,  -- 发布结果（URL、错误信息等）
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    INDEX idx_task_id (task_id),
    INDEX idx_status (status),
    INDEX idx_platform (platform)
);

-- 发布日志表（审计追踪）
CREATE TABLE publish_logs (
    id BIGSERIAL PRIMARY KEY,
    subtask_id UUID NOT NULL REFERENCES publish_subtasks(id),
    level VARCHAR(10) NOT NULL,  -- info, warning, error
    message TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    INDEX idx_subtask_id (subtask_id),
    INDEX idx_created_at (created_at)
);

-- 平台配置表
CREATE TABLE platform_configs (
    platform VARCHAR(50) PRIMARY KEY,
    enabled BOOLEAN DEFAULT TRUE,
    specs JSONB NOT NULL,  -- 平台规范
    session_status JSONB,  -- 登录态信息
    last_check_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### 4.5 监控与可观测性

#### 4.5.1 指标收集 (Prometheus)

```python
from prometheus_client import Counter, Histogram, Gauge

# 任务计数器
publish_tasks_total = Counter(
    'publish_tasks_total',
    'Total number of publish tasks',
    ['platform', 'status']
)

# 任务耗时
publish_task_duration_seconds = Histogram(
    'publish_task_duration_seconds',
    'Duration of publish tasks',
    ['platform']
)

# 队列长度
publish_queue_length = Gauge(
    'publish_queue_length',
    'Number of tasks in queue',
    ['platform']
)

# 成功率（通过 PromQL 计算）
# success_rate = sum(rate(publish_tasks_total{status="completed"}[5m]))
#              / sum(rate(publish_tasks_total[5m]))
```

#### 4.5.2 日志规范 (结构化日志)

```python
import structlog

logger = structlog.get_logger()

logger.info(
    "task_submitted",
    task_id="task-001",
    user_id="user-123",
    platforms=["toutiao", "weibo"],
    scheduled_at="2024-03-15T10:00:00Z"
)

logger.error(
    "task_failed",
    task_id="task-001",
    subtask_id="task-001-toutiao",
    platform="toutiao",
    error_type="NetworkError",
    error_message="Connection timeout after 30s",
    retry_count=2,
    max_retries=3
)
```

#### 4.5.3 告警规则 (AlertManager)

```yaml
groups:
- name: publishing
  rules:
  - alert: PublishSuccessRateLow
    expr: |
      sum(rate(publish_tasks_total{status="completed"}[5m]))
      / sum(rate(publish_tasks_total[5m])) < 0.95
    for: 10m
    annotations:
      summary: "发布成功率低于95%"
      description: "过去10分钟发布成功率: {{ $value | humanizePercentage }}"

  - alert: PublishQueueTooLong
    expr: publish_queue_length > 1000
    for: 5m
    annotations:
      summary: "发布队列积压超过1000个任务"
      description: "队列 {{ $labels.platform }} 长度: {{ $value }}"

  - alert: WorkerDown
    expr: up{job="publish-worker"} == 0
    for: 1m
    annotations:
      summary: "Worker节点下线"
      description: "Worker {{ $labels.instance }} 不可用"
```

#### 4.5.4 Dashboard (Grafana)

**关键指标面板**:
1. **成功率**: 实时成功率、24小时成功率趋势
2. **吞吐量**: 每分钟处理任务数
3. **延迟**: P50/P95/P99 任务耗时
4. **队列深度**: 各平台队列长度
5. **错误率**: 按错误类型分组
6. **Worker状态**: 在线/离线、CPU/内存使用率

### 4.6 部署架构

#### 4.6.1 服务拓扑

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React)                                           │
│  - Nginx (静态托管)                                          │
│  - Cloudflare Tunnel (对外访问)                              │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────────────┐
│  API Gateway (FastAPI)                                      │
│  - Gunicorn (WSGI Server)                                   │
│  - 2 Replicas (HA)                                          │
│  - Port: 8899                                               │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────────────┐
│  Redis (Message Broker + Cache)                            │
│  - Port: 6379                                               │
│  - Persistence: RDB + AOF                                   │
└─────────────────────────────────────────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────────────┐
│  Celery Workers (Publishing Engine)                        │
│  - 4 Workers per Platform                                   │
│  - Auto Scaling (2-10 replicas)                             │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────────────┐
│  CDP Executors (Browser Automation)                        │
│  - Node PC (Tailscale: 100.97.242.124:19226)               │
│  - Chromium Headless                                        │
│  - 4 Browser Contexts (并发隔离)                             │
└─────────────────────────────────────────────────────────────┘
                 │
                 ↓
            Social Media Platforms
```

#### 4.6.2 容器化 (Docker Compose)

```yaml
version: '3.8'

services:
  api:
    build: ./api
    ports:
      - "8899:8899"
    environment:
      - DATABASE_URL=postgresql://user:pass@postgres:5432/publishing
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - postgres
      - redis
    deploy:
      replicas: 2

  worker-toutiao:
    build: ./worker
    command: celery -A publishing.celery worker -Q publish.task.toutiao -n toutiao@%h
    environment:
      - REDIS_URL=redis://redis:6379/0
      - DATABASE_URL=postgresql://user:pass@postgres:5432/publishing
    depends_on:
      - redis
      - postgres
    deploy:
      replicas: 4

  worker-weibo:
    build: ./worker
    command: celery -A publishing.celery worker -Q publish.task.weibo -n weibo@%h
    environment:
      - REDIS_URL=redis://redis:6379/0
      - DATABASE_URL=postgresql://user:pass@postgres:5432/publishing
    depends_on:
      - redis
      - postgres
    deploy:
      replicas: 4

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=publishing
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data

  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin

volumes:
  redis-data:
  postgres-data:
```

---

## 5. 实现路线图

### 5.1 里程碑划分

| 阶段 | 目标 | 工期 | 关键产出 |
|------|------|------|----------|
| **P0** | 基础引擎 + 头条平台 | 2周 | 消息队列、Worker Pool、头条适配器 |
| **P1** | 监控告警 + 重试机制 | 1周 | Prometheus、Grafana、成功率监控 |
| **P2** | 多平台适配 | 3周 | 小红书、抖音、微博适配器 |
| **P3** | 优化提升 | 1周 | 性能优化、成本优化 |

### 5.2 P0: 基础引擎 (2周)

#### Week 1: 核心框架

**Day 1-2**: 数据库设计与迁移
- [ ] 设计 PostgreSQL Schema
- [ ] 编写迁移脚本 (SQLite → PostgreSQL)
- [ ] 数据验证

**Day 3-5**: 消息队列集成
- [ ] 安装配置 Redis + Celery
- [ ] 实现 Task Manager (任务分解逻辑)
- [ ] 实现任务入队/出队逻辑
- [ ] 单元测试

#### Week 2: 平台适配器

**Day 6-8**: 头条适配器重构
- [ ] 抽象 PlatformAdapter 基类
- [ ] 重构现有头条脚本为 ToutiaoAdapter
- [ ] 集成到 Worker Pool
- [ ] 端到端测试

**Day 9-10**: Worker Pool
- [ ] 实现 Celery Worker 配置
- [ ] 实现重试逻辑（3次，指数退避）
- [ ] 实现死信队列处理
- [ ] 压力测试（100并发任务）

### 5.3 P1: 监控告警 (1周)

**Day 11-12**: 指标收集
- [ ] 集成 Prometheus
- [ ] 实现自定义指标（成功率、耗时、队列长度）
- [ ] 实现结构化日志 (structlog)

**Day 13-14**: 可视化与告警
- [ ] 配置 Grafana Dashboard
- [ ] 配置 AlertManager 告警规则
- [ ] 接入告警渠道（邮件/Slack/企业微信）

### 5.4 P2: 多平台适配 (3周)

**Week 3**: 小红书适配器
- [ ] 研究小红书发布流程
- [ ] 实现 XiaohongshuAdapter (CDP)
- [ ] 测试验证（10篇内容）

**Week 4**: 抖音适配器
- [ ] 研究抖音发布流程
- [ ] 实现 DouyinAdapter (CDP)
- [ ] 测试验证（10条视频）

**Week 5**: 微博适配器
- [ ] 研究微博 API / CDP 方案
- [ ] 实现 WeiboAdapter
- [ ] 测试验证（10条微博）

### 5.5 P3: 优化提升 (1周)

**Day 15-16**: 性能优化
- [ ] 并发性能测试（1000任务/小时）
- [ ] 数据库查询优化（索引、缓存）
- [ ] Worker 自动扩缩容测试

**Day 17**: 成本优化
- [ ] 评估 CDP vs API 成本
- [ ] 优化浏览器资源使用
- [ ] 配置任务优先级策略

### 5.6 验收标准

#### 功能验收
- [ ] 支持3个以上平台同时发布
- [ ] 任务入队后无需用户等待（异步）
- [ ] 失败任务自动重试3次
- [ ] 死信队列可查询

#### 性能验收
- [ ] 单平台发布耗时 < 60秒
- [ ] 100并发任务无阻塞
- [ ] 队列吞吐量 ≥ 1000任务/小时

#### 可靠性验收
- [ ] **发布成功率 ≥ 95%**（核心KPI）
- [ ] Worker 崩溃时任务不丢失
- [ ] 数据库故障时任务自动重试
- [ ] Tailscale 断线后自动恢复

#### 可观测性验收
- [ ] Grafana 显示实时成功率
- [ ] 成功率低于95%时自动告警
- [ ] 所有失败任务可追踪原因

---

## 6. 风险评估与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| **平台反爬** | 高 | 高 | 1. CDP 模拟真人行为（随机延迟、鼠标轨迹）<br>2. 准备多个账号轮换<br>3. 降级到官方 API（如果有） |
| **Tailscale 不稳定** | 中 | 高 | 1. 监控 Tailscale 连接状态<br>2. 自动重连机制<br>3. 考虑备用执行节点 |
| **Chrome 更新破坏脚本** | 中 | 中 | 1. 锁定 Chrome 版本<br>2. 使用 Chrome for Testing<br>3. Playwright 作为备选方案 |
| **成功率无法达标** | 低 | 高 | 1. 逐步提升目标（先90%，再95%）<br>2. 重点攻坚失败率最高的环节<br>3. 引入人工介入机制 |
| **队列积压** | 低 | 中 | 1. 自动扩容 Worker<br>2. 限流保护<br>3. 优先级队列 |
| **数据库性能瓶颈** | 低 | 中 | 1. PostgreSQL 读写分离<br>2. Redis 缓存热点数据<br>3. 分库分表（长期） |

---

## 7. 成本估算

### 7.1 基础设施成本

| 资源 | 规格 | 月成本 (USD) |
|------|------|-------------|
| PostgreSQL | 2 vCPU, 4GB RAM | $25 |
| Redis | 1 vCPU, 2GB RAM | $15 |
| Worker Nodes (平均) | 4 vCPU, 8GB RAM | $40 |
| 监控 (Prometheus + Grafana) | 1 vCPU, 2GB RAM | $10 |
| **总计** | | **$90/月** |

### 7.2 人力成本

| 角色 | 工时 | 成本估算 |
|------|------|----------|
| 后端开发 | 4周 * 5天 * 8h = 160h | 高 |
| 前端开发 | 1周 * 5天 * 8h = 40h | 中 |
| 测试 | 1周 * 5天 * 8h = 40h | 中 |
| DevOps | 0.5周 * 5天 * 8h = 20h | 中 |

### 7.3 ROI 分析

**假设**:
- 当前人工发布：10分钟/平台，每天发布50篇内容到5个平台
- 人工成本：$20/小时

**节省**:
- 人工时间：10分钟 * 5平台 * 50篇 = 4166分钟/天 ≈ **70小时/天**
- 人工成本：70小时 * $20 = **$1400/天** = **$42,000/月**

**ROI**:
- 初始投入：约 $20,000（人力成本）
- 月度运营成本：$90
- **回本周期**: 约 **0.5个月**

---

## 8. 后续优化方向

### 8.1 短期优化 (3个月内)

1. **智能调度**
   - 基于历史数据预测最佳发布时间
   - 自动避开平台高峰期

2. **内容优化建议**
   - AI 分析各平台爆款内容特征
   - 自动生成优化建议（标题、标签等）

3. **A/B 测试**
   - 同一内容生成多个版本
   - 发布到不同平台并对比效果

### 8.2 中期优化 (6个月内)

1. **官方 API 集成**
   - 替换 CDP 为官方 API（如果有）
   - 降低反爬风险和资源消耗

2. **多账号管理**
   - 自动轮换发布账号
   - 防止单账号触发限流

3. **内容合规检测**
   - 集成敏感词过滤
   - 平台规则预检查

### 8.3 长期优化 (1年内)

1. **跨平台数据分析**
   - 统一各平台数据指标
   - 生成综合效果报告

2. **智能内容分发**
   - 根据平台特性自动调整内容格式
   - 自动生成平台专属内容

3. **全球化扩展**
   - 支持海外平台（YouTube, Instagram, TikTok Global）
   - 多语言内容适配

---

## 9. 总结

### 9.1 核心改进

| 改进点 | 现状 | 目标 | 提升 |
|--------|------|------|------|
| **成功率** | ~92% | ≥95% | +3% |
| **并发能力** | 单线程 | 100并发 | 100x |
| **可观测性** | 无监控 | 完整监控 | ∞ |
| **可靠性** | 无重试 | 自动重试 | ∞ |
| **可扩展性** | 硬编码 | 插件化 | ∞ |

### 9.2 成功关键

1. **消息队列**: 解耦任务提交和执行，实现异步、并发、可靠
2. **重试机制**: 自动应对网络波动和临时故障
3. **监控告警**: 及时发现和解决问题
4. **平台适配器**: 标准化接口，快速扩展新平台

### 9.3 最终目标

**实现 KR2.2：一键发布 API 成功率 ≥95%**

**衡量方式**:
```promql
# Prometheus 查询
sum(rate(publish_tasks_total{status="completed"}[5m]))
/ sum(rate(publish_tasks_total[5m])) >= 0.95
```

---

## 附录

### A. 术语表

| 术语 | 定义 |
|------|------|
| **CDP** | Chrome DevTools Protocol，浏览器自动化协议 |
| **Worker Pool** | 并发执行任务的工作进程池 |
| **Dead Letter Queue** | 存放永久失败任务的队列 |
| **Platform Adapter** | 平台适配器，封装各平台发布逻辑 |
| **Retry Backoff** | 重试退避策略，每次重试间隔递增 |

### B. 参考资料

1. [Celery 官方文档](https://docs.celeryproject.org/)
2. [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
3. [Prometheus 最佳实践](https://prometheus.io/docs/practices/)
4. [微服务可靠性模式](https://docs.microsoft.com/en-us/azure/architecture/patterns/)

### C. 联系方式

**技术负责人**: [待定]
**产品负责人**: [待定]
**项目仓库**: `/home/xx/perfect21/zenithjoy/`

---

**文档结束**
