---
id: prd-brain-consolidation
version: 1.0.0
created: 2026-01-29
updated: 2026-01-29
changelog:
  - 1.0.0: 初始版本
---

# PRD: Brain 统一整合

## 📋 项目信息

| 项目 | 信息 |
|------|------|
| **名称** | Brain Consolidation |
| **目标仓库** | cecelia-semantic-brain |
| **源仓库** | cecelia-workspace/apps/core/src/brain |
| **端口** | 5220（统一） |
| **技术栈** | Python + FastAPI |

---

## 🎯 目标

**把分散的 Brain 逻辑统一到 `cecelia-semantic-brain`**

### 当前问题

```
cecelia-semantic-brain (Python :5220)     cecelia-workspace/core (Node.js :5212)
├── /parse      - 解析意图               ├── /api/brain/status  - 决策包
├── /schedule   - 智能调度               ├── /api/brain/focus   - OKR焦点
├── /detector   - 监控                   ├── /api/brain/tick    - 自动推进
├── /plan       - 执行计划               ├── /api/brain/action  - 动作执行
└── /fusion     - 语义搜索               └── /api/okr           - OKR CRUD

问题：Brain 分散在两个技术栈，两个端口
```

### 目标架构

```
cecelia-semantic-brain (Python :5220) - 统一 Brain
├── Intelligence Layer (已有)
│   ├── /parse      - 解析意图
│   ├── /schedule   - 智能调度
│   ├── /detector   - 监控检测
│   └── /plan       - 执行计划
│
├── State Layer (从 core 迁移)
│   ├── /status     - 决策包
│   ├── /focus      - OKR 焦点
│   ├── /tick       - 自动推进
│   ├── /action/*   - 动作执行
│   ├── /memory     - 工作记忆
│   └── /okr/*      - OKR CRUD
│
├── Queue Layer (新增)
│   ├── /queue/init     - 初始化 PRD 队列
│   ├── /queue/next     - 获取下一个 PRD
│   ├── /queue/complete - 完成当前 PRD
│   ├── /queue/fail     - 标记失败
│   └── /queue/status   - 队列状态
│
└── Semantic Layer (已有)
    └── /fusion     - 语义搜索


zenithjoy-engine - 纯执行层
├── /dev skill      - 开发工作流
├── cecelia-run     - 无头执行器
├── hooks           - 分支保护等
└── Ralph Loop      - 迭代机制
```

---

## 📦 迁移清单

### Phase 1: 数据库连接

从 Node.js 的 PostgreSQL 连接迁移到 Python：

| 源文件 | 目标 |
|--------|------|
| `core/src/task-system/db.js` | `semantic-brain/src/db/pool.py` |

需要连接的表：
- `tasks` - 任务
- `goals` - OKR
- `working_memory` - 工作记忆
- `decision_log` - 决策日志
- `projects` - 项目
- `system_snapshots` - 系统快照
- `policies` - 策略

### Phase 2: State Layer 迁移

| 源文件 | 目标文件 | 功能 |
|--------|----------|------|
| `brain/focus.js` | `src/state/focus.py` | OKR 焦点选择 |
| `brain/tick.js` | `src/state/tick.py` | 自动任务推进 |
| `brain/actions.js` | `src/state/actions.py` | 动作执行 |
| `brain/orchestrator.js` | `src/state/orchestrator.py` | 状态聚合 |
| `brain/perception.js` | `src/state/perception.py` | 系统感知快照 |
| `brain/routes.js` | `src/api/state_routes.py` | API 路由 |
| `okr/routes.js` | `src/api/okr_routes.py` | OKR CRUD |

### Phase 3: Queue Layer 新增

| 文件 | 功能 |
|------|------|
| `src/queue/prd_queue.py` | PRD 队列管理 |
| `src/queue/models.py` | 数据模型 |
| `src/api/queue_routes.py` | API 路由 |

### Phase 4: 统一 API

所有 API 统一到 `/api/brain/*` 前缀：

```
# Intelligence (已有，加前缀)
POST /api/brain/parse
POST /api/brain/schedule
GET  /api/brain/detector/status
POST /api/brain/plan

# State (迁移)
GET  /api/brain/status
GET  /api/brain/focus
POST /api/brain/focus/set
POST /api/brain/tick
POST /api/brain/action/{name}
GET  /api/brain/memory

# OKR (迁移)
GET  /api/brain/okr/trees
POST /api/brain/okr/trees
PUT  /api/brain/okr/trees/{id}

# Queue (新增)
POST /api/brain/queue/init
GET  /api/brain/queue/next
POST /api/brain/queue/complete
POST /api/brain/queue/fail
GET  /api/brain/queue/status

# Semantic (已有)
POST /api/brain/fusion
```

### Phase 5: Core 清理

迁移完成后，从 `cecelia-workspace/apps/core` 删除：
- `src/brain/` 目录
- `src/okr/` 目录
- 相关路由注册

保留 Core 作为前端服务，通过调用 Brain API 获取数据。

---

## 🔧 技术细节

### 数据库连接 (Python)

```python
# src/db/pool.py
import asyncpg
from contextlib import asynccontextmanager

class Database:
    def __init__(self, dsn: str):
        self.dsn = dsn
        self.pool = None

    async def connect(self):
        self.pool = await asyncpg.create_pool(self.dsn)

    async def disconnect(self):
        await self.pool.close()

    @asynccontextmanager
    async def connection(self):
        async with self.pool.acquire() as conn:
            yield conn
```

### Focus 迁移示例

```python
# src/state/focus.py
from typing import Optional
from ..db.pool import Database

FOCUS_OVERRIDE_KEY = 'daily_focus_override'

async def select_daily_focus(db: Database) -> Optional[dict]:
    """选择今日焦点 OKR"""
    async with db.connection() as conn:
        # 检查手动覆盖
        override = await conn.fetchrow(
            'SELECT value_json FROM working_memory WHERE key = $1',
            FOCUS_OVERRIDE_KEY
        )

        if override and override['value_json'].get('objective_id'):
            obj = await conn.fetchrow(
                'SELECT * FROM goals WHERE id = $1 AND type = $2',
                override['value_json']['objective_id'], 'objective'
            )
            if obj:
                return {'objective': dict(obj), 'reason': '手动设置', 'is_manual': True}

        # 自动选择
        obj = await conn.fetchrow('''
            SELECT * FROM goals
            WHERE type = 'objective' AND status NOT IN ('completed', 'cancelled')
            ORDER BY
                CASE WHEN (metadata->>'is_pinned')::boolean = true THEN 0 ELSE 1 END,
                CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END,
                CASE WHEN progress >= 80 THEN 0 ELSE 1 END,
                updated_at DESC NULLS LAST
            LIMIT 1
        ''')

        if not obj:
            return None

        return {'objective': dict(obj), 'reason': generate_reason(obj), 'is_manual': False}
```

### PRD 队列模型

```python
# src/queue/models.py
from pydantic import BaseModel
from typing import List, Optional
from enum import Enum

class PrdStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    FAILED = "failed"

class PrdItem(BaseModel):
    id: int
    path: str
    status: PrdStatus = PrdStatus.PENDING
    branch: Optional[str] = None
    pr_url: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    error: Optional[str] = None

class PrdQueue(BaseModel):
    items: List[PrdItem]
    status: str = "idle"  # idle, ready, running, completed, paused
    project_path: Optional[str] = None
    started_at: Optional[str] = None
    updated_at: Optional[str] = None
```

---

## ✅ 验收标准

### 功能验收

1. **数据库连接**
   - [ ] Python 能连接 PostgreSQL
   - [ ] 所有表可读写

2. **State Layer**
   - [ ] `/api/brain/status` 返回完整决策包
   - [ ] `/api/brain/focus` 返回 OKR 焦点
   - [ ] `/api/brain/tick` 触发任务推进
   - [ ] `/api/brain/action/*` 执行所有动作

3. **OKR Layer**
   - [ ] CRUD 操作正常
   - [ ] 进度自动计算

4. **Queue Layer**
   - [ ] 初始化队列
   - [ ] 获取下一个 PRD
   - [ ] 标记完成/失败
   - [ ] 状态持久化

5. **Core 清理**
   - [ ] 删除旧 brain 代码
   - [ ] 前端改用 Brain API

### 集成验收

```bash
# Brain 状态
curl http://localhost:5220/api/brain/status | jq

# OKR 焦点
curl http://localhost:5220/api/brain/focus | jq

# 初始化 PRD 队列
curl -X POST http://localhost:5220/api/brain/queue/init \
  -H "Content-Type: application/json" \
  -d '{"prd_paths": ["prds/01.prd.md", "prds/02.prd.md"]}'

# 获取下一个 PRD
curl http://localhost:5220/api/brain/queue/next | jq
```

---

## 📅 里程碑

| 阶段 | 内容 | 输出 |
|------|------|------|
| M1 | 数据库连接 + Focus 迁移 | Python 能读写 PostgreSQL |
| M2 | Tick + Actions 迁移 | 动作执行正常 |
| M3 | OKR CRUD 迁移 | OKR 管理正常 |
| M4 | Queue Layer 实现 | PRD 队列可用 |
| M5 | Core 清理 + 集成测试 | 统一完成 |

---

## 🔗 依赖

- `asyncpg` - PostgreSQL async driver
- `pydantic` - 数据模型
- 现有 `cecelia-semantic-brain` 代码库
- 现有 PostgreSQL 数据库（5432 端口）

---

## ⚠️ 风险

1. **数据库连接字符串**：需要从环境变量读取
2. **前端适配**：Core 前端需要改调 Brain API
3. **端口冲突**：确保 5220 端口可用
4. **事务处理**：Python 的事务写法和 Node.js 不同

---

## 📝 备注

- Brain = 思考层（状态 + 智能 + 队列）
- Engine = 执行层（/dev + hooks + cecelia-run）
- Brain 通过 API 被 Engine 调用
- 无头执行时：Engine 查 Brain 状态 → 执行 PRD → 回报 Brain
