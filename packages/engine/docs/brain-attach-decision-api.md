---
id: brain-attach-decision-api
version: 1.0.0
created: 2026-02-12
status: IMPLEMENTATION_READY
priority: P0
---

# Brain 挂载决策 API（最小可用版本）

**目标**：给新任务找到最合适的挂载点，避免重复工作。

---

## 📡 API 端点

### 1. 查询相似内容（search_similar）

**端点**：`POST /api/brain/search-similar`

**请求**：
```json
{
  "query": "实现任务优先级算法",
  "top_k": 5
}
```

**响应**：
```json
{
  "matches": [
    {
      "level": "task",
      "id": "task_123",
      "title": "实现优先级计算算法",
      "status": "completed",
      "score": 0.88,
      "metadata": {
        "initiative_id": "initiative_456",
        "initiative_title": "实现智能调度系统",
        "pr_url": "https://github.com/.../pull/552"
      }
    },
    {
      "level": "initiative",
      "id": "initiative_456",
      "title": "实现智能调度系统",
      "status": "in_progress",
      "score": 0.71,
      "metadata": {
        "kr_id": "kr_789",
        "kr_title": "任务调度响应时间降低 50%"
      }
    },
    {
      "level": "kr",
      "id": "kr_789",
      "title": "任务调度响应时间降低 50%",
      "status": "active",
      "score": 0.65,
      "metadata": {
        "okr_id": "okr_001",
        "okr_objective": "提升系统性能"
      }
    }
  ]
}
```

---

### 2. 挂载决策（attach_decision）

**端点**：`POST /api/brain/attach-decision`

**请求**：
```json
{
  "input": "实现任务优先级的动态调整功能",
  "matches": [...],  // 来自 search_similar 的结果
  "context": {
    "user": "user_id",
    "mode": "interactive"  // 或 "autonomous"
  }
}
```

**响应**（统一格式）：
```json
{
  "input": "实现任务优先级的动态调整功能",

  "attach": {
    "action": "extend_initiative",  // 4 种之一
    "target": {
      "level": "initiative",
      "id": "initiative_456",
      "title": "实现智能调度系统"
    },
    "confidence": 0.75,
    "reason": "在现有 Initiative 下扩展新功能",
    "top_matches": [
      {"level": "initiative", "id": "initiative_456", "score": 0.71, "title": "实现智能调度系统"}
    ]
  },

  "route": {
    "path": "exploratory_then_dev",
    "why": [
      "涉及算法改动",
      "需要验证性能影响"
    ],
    "confidence": 0.8
  },

  "next_call": {
    "skill": "/exploratory",
    "args": {
      "initiative_id": "initiative_456",
      "task_description": "实现任务优先级的动态调整功能"
    }
  }
}
```

---

## 🔧 Phase 0 实现（最小可用）

### 相似度计算（简单版）

**文件**：`brain/services/similarity.js`

```javascript
/**
 * Phase 0: 简单相似度（关键词 + BM25）
 *
 * 足够跑通，后续可以升级到 embedding
 */

const natural = require('natural');
const TfIdf = natural.TfIdf;

class SimilarityService {
  constructor(db) {
    this.db = db;
  }

  /**
   * 查询相似内容
   */
  async searchSimilar(query, topK = 5) {
    // 1. 查询所有活跃的实体
    const entities = await this.getAllActiveEntities();

    // 2. 计算相似度
    const scored = entities.map(entity => ({
      ...entity,
      score: this.calculateScore(query, entity)
    }));

    // 3. 排序取 topK
    const topMatches = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter(m => m.score > 0.3);  // 过滤掉太低的

    return { matches: topMatches };
  }

  /**
   * 获取所有活跃的实体
   */
  async getAllActiveEntities() {
    const entities = [];

    // 查 Tasks
    const tasks = await this.db.query(`
      SELECT
        t.id, t.title, t.description, t.status,
        pp.initiative_id, i.title as initiative_title,
        pp.id as pr_plan_id
      FROM tasks t
      LEFT JOIN pr_plans pp ON t.pr_plan_id = pp.id
      LEFT JOIN features i ON pp.initiative_id = i.id
      WHERE t.status IN ('pending', 'in_progress', 'completed')
      ORDER BY t.updated_at DESC
      LIMIT 100
    `);

    tasks.rows.forEach(task => {
      entities.push({
        level: 'task',
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        text: `${task.title} ${task.description}`,
        metadata: {
          initiative_id: task.initiative_id,
          initiative_title: task.initiative_title,
          pr_plan_id: task.pr_plan_id
        }
      });
    });

    // 查 Initiatives
    const initiatives = await this.db.query(`
      SELECT
        i.id, i.title, i.description, i.status,
        kr.id as kr_id, kr.title as kr_title
      FROM features i
      LEFT JOIN key_results kr ON i.kr_id = kr.id
      WHERE i.status IN ('active', 'in_progress')
      ORDER BY i.updated_at DESC
      LIMIT 50
    `);

    initiatives.rows.forEach(initiative => {
      entities.push({
        level: 'initiative',
        id: initiative.id,
        title: initiative.title,
        description: initiative.description,
        status: initiative.status,
        text: `${initiative.title} ${initiative.description}`,
        metadata: {
          kr_id: initiative.kr_id,
          kr_title: initiative.kr_title
        }
      });
    });

    // 查 KRs
    const krs = await this.db.query(`
      SELECT
        kr.id, kr.title, kr.description, kr.status,
        o.id as okr_id, o.objective
      FROM key_results kr
      LEFT JOIN okrs o ON kr.okr_id = o.id
      WHERE kr.status IN ('active', 'in_progress')
      ORDER BY kr.updated_at DESC
      LIMIT 30
    `);

    krs.rows.forEach(kr => {
      entities.push({
        level: 'kr',
        id: kr.id,
        title: kr.title,
        description: kr.description,
        status: kr.status,
        text: `${kr.title} ${kr.description}`,
        metadata: {
          okr_id: kr.okr_id,
          okr_objective: kr.objective
        }
      });
    });

    return entities;
  }

  /**
   * 计算相似度（简单版）
   */
  calculateScore(query, entity) {
    const queryTokens = this.tokenize(query);
    const entityTokens = this.tokenize(entity.text);

    // 1. Jaccard 相似度
    const intersection = queryTokens.filter(t => entityTokens.includes(t));
    const union = new Set([...queryTokens, ...entityTokens]);
    const jaccard = intersection.length / union.size;

    // 2. 关键词加权
    let keyword_boost = 0;
    const important_words = this.extractKeywords(query);
    important_words.forEach(kw => {
      if (entity.text.includes(kw)) {
        keyword_boost += 0.1;
      }
    });

    // 3. 状态惩罚（已完成的 Task 降权）
    let status_penalty = 0;
    if (entity.level === 'task' && entity.status === 'completed') {
      status_penalty = -0.1;
    }

    // 综合得分
    return Math.min(1.0, jaccard + keyword_boost + status_penalty);
  }

  /**
   * 分词
   */
  tokenize(text) {
    return text.toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')  // 保留中文
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  /**
   * 提取关键词
   */
  extractKeywords(text) {
    const tokens = this.tokenize(text);
    const stopwords = ['的', '是', '在', '和', '了', '有'];
    return tokens.filter(t => !stopwords.includes(t));
  }
}

module.exports = SimilarityService;
```

---

## 🧠 LLM 决策提示词

**文件**：`brain/prompts/attach-decision.md`

```markdown
# 挂载决策提示词

你是 Cecelia Brain 的任务规划模块，负责判断新任务应该挂载在哪里。

## 输入

**用户输入**：
{input}

**相似内容（已排序）**：
{matches}

## 你的任务

根据相似内容，判断这个新任务应该挂载在哪里。

## 4 种挂载决策

### 1. duplicate_task（避免重复）

**条件**：
- 找到相似度 >= 0.85 的现有 Task
- 该 Task 已完成或正在进行中

**输出**：
```json
{
  "action": "duplicate_task",
  "target": {
    "level": "task",
    "id": "<task_id>",
    "title": "<task_title>"
  },
  "confidence": 0.0-1.0,
  "reason": "已存在高度相似的任务"
}
```

---

### 2. extend_initiative（在现有 Initiative 下扩展）

**条件**：
- 找到相似度 >= 0.65 的现有 Initiative
- 新任务是该 Initiative 的合理扩展

**输出**：
```json
{
  "action": "extend_initiative",
  "target": {
    "level": "initiative",
    "id": "<initiative_id>",
    "title": "<initiative_title>"
  },
  "confidence": 0.0-1.0,
  "reason": "在现有 Initiative 下创建新 PR Plan"
}
```

---

### 3. create_initiative_under_kr（在现有 KR 下创建新 Initiative）

**条件**：
- 找到相似度 >= 0.60 的现有 KR
- 新任务支持该 KR，但没有合适的现有 Initiative

**输出**：
```json
{
  "action": "create_initiative_under_kr",
  "target": {
    "level": "kr",
    "id": "<kr_id>",
    "title": "<kr_title>"
  },
  "confidence": 0.0-1.0,
  "reason": "在现有 KR 下创建新 Initiative"
}
```

---

### 4. create_new_okr_kr（创建全新的 OKR/KR）

**条件**：
- 没有找到相关的 OKR/KR/Initiative
- 或相似度都很低（< 0.60）

**输出**：
```json
{
  "action": "create_new_okr_kr",
  "target": {
    "level": "okr",
    "id": null,
    "title": null
  },
  "confidence": 0.0-1.0,
  "reason": "没有找到相关的 OKR，需要创建新的"
}
```

---

## 路由决策（exploratory vs direct_dev）

判断新任务是否需要先探索验证。

### 需要 exploratory 的信号（任意命中）

- 涉及性能/并发/稳定性/架构改动
- 需要引入新组件（Redis、队列、DB schema）
- 描述中出现"不确定/可能/评估/调研"等词
- 找不到明确的现有实现可参考
- 复杂度高（estimated_hours > 10 或 complexity = 'large'）

### 路由路径

```json
{
  "route": {
    "path": "exploratory_then_dev | direct_dev | okr_then_exploratory_then_dev",
    "why": ["原因1", "原因2"],
    "confidence": 0.0-1.0
  }
}
```

---

## 输出格式（完整）

```json
{
  "input": "{input}",

  "attach": {
    "action": "duplicate_task | extend_initiative | create_initiative_under_kr | create_new_okr_kr",
    "target": {
      "level": "task|initiative|kr|okr",
      "id": "...",
      "title": "..."
    },
    "confidence": 0.0-1.0,
    "reason": "...",
    "top_matches": [...]
  },

  "route": {
    "path": "exploratory_then_dev | direct_dev | okr_then_exploratory_then_dev",
    "why": ["原因1", "原因2"],
    "confidence": 0.0-1.0
  },

  "next_call": {
    "skill": "/dev | /exploratory | /okr",
    "args": {...}
  }
}
```

---

## 短路规则（CRITICAL）

### 短路 A：优先查 Task（避免重复最致命）

- task_score >= 0.85 → 立刻返回 duplicate_task
- 不需要再看 Initiative/KR

### 短路 B：再查 Initiative（决定扩展还是新建）

- initiative_score >= 0.65 → 返回 extend_initiative
- < 0.65 → 继续看 KR/OKR

---

## 示例

### 示例 1：重复 Task

**输入**：
```
"写一个任务优先级计算函数"
```

**Matches**：
```json
[
  {
    "level": "task",
    "id": "task_123",
    "title": "实现优先级计算算法",
    "score": 0.88,
    "status": "completed"
  }
]
```

**输出**：
```json
{
  "attach": {
    "action": "duplicate_task",
    "target": {
      "level": "task",
      "id": "task_123",
      "title": "实现优先级计算算法"
    },
    "confidence": 0.88,
    "reason": "已存在高度相似的任务（相似度 88%），且已完成"
  },
  "route": {
    "path": "direct_dev",
    "why": ["任务已完成，可以直接复用代码"],
    "confidence": 0.9
  },
  "next_call": {
    "skill": "/dev",
    "args": {
      "mode": "reuse",
      "reference_task_id": "task_123"
    }
  }
}
```

---

### 示例 2：扩展 Initiative

**输入**：
```
"添加任务优先级的动态调整功能"
```

**Matches**：
```json
[
  {
    "level": "initiative",
    "id": "initiative_456",
    "title": "实现智能调度系统",
    "score": 0.71,
    "status": "in_progress"
  }
]
```

**输出**：
```json
{
  "attach": {
    "action": "extend_initiative",
    "target": {
      "level": "initiative",
      "id": "initiative_456",
      "title": "实现智能调度系统"
    },
    "confidence": 0.75,
    "reason": "属于现有 Initiative 的合理扩展"
  },
  "route": {
    "path": "exploratory_then_dev",
    "why": [
      "涉及算法改动",
      "需要验证对现有系统的影响"
    ],
    "confidence": 0.8
  },
  "next_call": {
    "skill": "/exploratory",
    "args": {
      "initiative_id": "initiative_456",
      "task_description": "添加任务优先级的动态调整功能"
    }
  }
}
```

---

## 注意事项

1. **短路优先**：先查 Task（避免重复），再查 Initiative（决定扩展）
2. **阈值柔性**：相似度阈值是建议值，根据实际情况灵活调整
3. **保守原则**：不确定时倾向于 exploratory（安全）
4. **用户友好**：reason 字段要清晰解释为什么做这个决策
