---
id: okr-exploratory-dev-hierarchy-analysis-v2
version: 2.0.0
created: 2026-02-12
updated: 2026-02-12
changelog:
  - 2.0.0: 修订版 - 补充权责边界、DoD一致性、执行颗粒度、Schema完整性
  - 1.0.0: 初始版本
---

# OKR → Exploratory → Dev 层级关系分析 (v2)

## 🚨 关键修订（基于真实运行经验）

本文档修订了 v1.0 中的 6 个"会在真实运行时爆炸"的问题：
1. ✅ 明确 PRD/DoD 修改权责边界（防止版本地狱）
2. ✅ 用结构校验替代纯长度校验（防止灌水绕过）
3. ✅ DoD 一致性校验（JSON vs Markdown）
4. ✅ /exploratory 生成 Exploration Spec 而非 PRD/DoD
5. ✅ /dev 执行颗粒度明确为 Task，而非整个 PR Plan
6. ✅ Schema 补充 revision/source/feedback_ids/locked 等字段

---

## 🏗️ 完整层级结构（不变）

```
OKR/KR（目标层）
  ↓
Initiative（战略层）- 由 /okr 生成，大 PRD
  ↓
PR Plans（工程规划层）- 由 /okr 生成，中 PRD + DoD
  ├── dod_items: [...]  ← Canonical 版本（结构化）
  ├── dod_markdown: "..."  ← 派生版本（渲染缓存）
  ├── prd_markdown: "..."  ← 完整 PRD
  ├── files: [...]
  ├── tasks: [...]
  └── sequence, depends_on, complexity, estimated_hours
  ↓
Tasks（执行层）- 由 /okr 生成，/dev 执行
  ├── prd_status: "detailed" / "draft"
  └── description: 任务描述
```

---

## 🔒 权责边界（3 条不可破规则）

### 规则 1: PRD/DoD 的 Owner 永远是 PR Plan

**唯一真相来源**: Brain 数据库的 `pr_plans` 表

```sql
-- PR Plans 是 PRD/DoD 的唯一 Owner
CREATE TABLE pr_plans (
  id UUID PRIMARY KEY,
  prd_markdown TEXT NOT NULL,       -- PRD 唯一真相
  dod_items JSONB NOT NULL,          -- DoD 唯一真相（结构化）
  dod_markdown TEXT,                 -- DoD 渲染缓存（派生）
  revision INT DEFAULT 1,            -- 版本号
  locked BOOLEAN DEFAULT FALSE,      -- 锁定标志（进入 dev 后锁定）
  owner_skill VARCHAR(50) DEFAULT 'okr',  -- 创建者
  source VARCHAR(20) DEFAULT 'okr',  -- 来源（okr/revised/manual）
  ...
);
```

**权限矩阵**:

| Skill | 可读 PRD/DoD | 可提议修改 | 可直接修改 | 可锁定/解锁 |
|-------|-------------|-----------|-----------|------------|
| **/okr** | ✅ | ✅ | ✅ (仅在创建/revise 时) | ✅ |
| **/exploratory** | ✅ | ✅ (通过 feedback) | ❌ | ❌ |
| **/dev** | ✅ | ✅ (通过 feedback) | ❌ | ❌ |
| **Brain** | ✅ | - | ✅ (通过 revise API) | ✅ |

---

### 规则 2: /exploratory 和 /dev 只能提交 Feedback，不能直接改 PRD/DoD

**Feedback 数据结构**:

```json
{
  "feedback_id": "feedback_uuid_001",
  "pr_plan_id": "pr_plan_123",
  "source": "exploratory",  // 或 "dev"
  "type": "patch_proposal",  // 或 "issue_report", "question"
  "status": "pending",  // 或 "approved", "rejected", "merged"
  "recommended_changes": [
    {
      "target": "prd",
      "op": "add",
      "path": "## 风险与回滚",
      "content": "### 数据库锁竞争\n如果优先级算法计算超过 100ms，可能导致..."
    },
    {
      "target": "dod",
      "op": "modify",
      "dod_item_id": "DOD-03",
      "old_text": "单元测试覆盖率 > 80%",
      "new_text": "单元测试覆盖率 > 90%，包含边界条件测试"
    },
    {
      "target": "dod",
      "op": "add",
      "after": "DOD-03",
      "content": {
        "id": "DOD-04",
        "text": "压力测试：1000 QPS 下响应时间 < 50ms",
        "type": "performance",
        "evidence_required": true
      }
    }
  ],
  "rationale": "实验发现算法在高并发下有锁竞争问题，建议增加性能测试",
  "evidence": {
    "files": [".exploration.md", "benchmark.log"],
    "screenshots": ["screenshot.png"],
    "metrics": {"p99_latency": 250}
  },
  "created_at": "2026-02-12T10:30:00Z"
}
```

**Feedback 生命周期**:

```
/exploratory 或 /dev 生成 feedback
  ↓
POST /api/brain/pr-plans/:id/feedback
  ↓
Brain 存储 feedback，status = "pending"
  ↓
(人工审核 或 自动合并规则)
  ↓
如果 approved:
  └─> 调用 /okr --revise-pr-plan <id> --with-feedback <feedback_id>
  └─> /okr 生成新版本 prd_markdown/dod_items（revision++）
  └─> Brain 更新 pr_plans 表，feedback.status = "merged"
```

---

### 规则 3: PRD/DoD 只能通过一个"合并动作"更新

**方式 1: /okr --revise-pr-plan (推荐)**

```bash
# 基于 feedback 修订 PR Plan
/okr --revise-pr-plan pr_123 --with-feedback feedback_001,feedback_002

# /okr 做的事情：
# 1. 读取 PR Plan 当前版本
# 2. 读取所有 feedback 的 recommended_changes
# 3. 用 LLM 合并修改（冲突时智能解决）
# 4. 生成新版本 prd_markdown 和 dod_items
# 5. 验证新版本（validate-okr.py）
# 6. revision++, source = 'revised'
# 7. 保存到 Brain
```

**方式 2: Brain API (自动化)**

```javascript
// Brain 内置的 revise endpoint
PATCH /api/brain/pr-plans/:id/revise
{
  "feedback_ids": ["feedback_001", "feedback_002"],
  "merge_strategy": "auto",  // 或 "manual"
  "reviewer": "brain_auto"   // 或 user_id
}

// Brain 自动：
// 1. 调用 /okr --revise-pr-plan
// 2. 验证新版本
// 3. 更新数据库
// 4. 标记 feedback 为 "merged"
```

---

## 🔍 PRD 质量校验（结构 + 最小信息集）

### 问题：纯长度校验不够稳定

**旧方案** (v1.0):
```python
if len(prd_markdown) > 500:
    score += 10
```
❌ 容易被模型用废话灌水绕过

---

### 新方案：结构校验 + 最小信息集 (MIK)

**PRD 必需结构**:

```markdown
# PRD - <标题>

## 1. 背景与动机 (必需)
- 现状痛点（至少 1 条，必须具体）
- 为什么现在做（时机/优先级）

## 2. 目标 (必需)
### 目标
- [ ] 目标 1（可量化）
- [ ] 目标 2

### 非目标（明确排除）
- [ ] 非目标 1
- [ ] 非目标 2

## 3. 功能需求 (必需)
### 需求列表（至少 5 条）
- [P0] 需求 1: 描述（包含"什么"+"为什么"）
- [P0] 需求 2: 描述
- [P1] 需求 3: 描述
- [P1] 需求 4: 描述
- [P2] 需求 5: 描述

## 4. 验收标准 (必需)
- 必须与 DoD 一致或可映射
- 每条验收标准对应至少 1 个 DoD item

## 5. 风险与回滚 (必需)
### 风险
- 风险 1: 描述 + 缓解措施
- 风险 2: 描述 + 缓解措施

### 回滚计划
- 如何回滚（步骤）
- 回滚成本（时间/影响面）

## 6. 影响面 (必需)
- 涉及文件（至少 3 个，与 files 字段一致）
- 涉及模块/组件
- 依赖的外部系统

## 7. 技术方案（可选，但推荐）
- 架构设计
- 数据结构
- API 设计
```

---

### validate-okr.py 的验证规则

```python
def validate_prd_structure(prd_markdown: str) -> Dict[str, Any]:
    """
    验证 PRD 结构完整性
    """
    required_sections = {
        "背景与动机": r"##\s*\d*\.?\s*背景[与和]动机",
        "目标": r"##\s*\d*\.?\s*目标",
        "非目标": r"###\s*非目标",
        "功能需求": r"##\s*\d*\.?\s*功能需求",
        "验收标准": r"##\s*\d*\.?\s*验收标准",
        "风险与回滚": r"##\s*\d*\.?\s*风险[与和]回滚",
        "影响面": r"##\s*\d*\.?\s*影响面"
    }

    issues = []
    score = 0

    for section, pattern in required_sections.items():
        if re.search(pattern, prd_markdown, re.IGNORECASE):
            score += 10
        else:
            issues.append(f"缺少必需章节: {section}")

    # 验证最小信息集
    # 1. 需求数量（至少 5 条）
    requirements = re.findall(r'-\s*\[P[0-2]\]', prd_markdown)
    if len(requirements) < 5:
        issues.append(f"功能需求不足 5 条（当前 {len(requirements)} 条）")
    else:
        score += 10

    # 2. 风险至少 2 条
    risks = re.findall(r'风险\s*\d+:', prd_markdown)
    if len(risks) < 2:
        issues.append(f"风险分析不足 2 条（当前 {len(risks)} 条）")
    else:
        score += 5

    # 3. 影响文件至少 3 个
    files_mentioned = re.findall(r'`[\w/\-\.]+\.(js|ts|py|sh|md)`', prd_markdown)
    if len(files_mentioned) < 3:
        issues.append(f"影响文件不足 3 个（当前 {len(files_mentioned)} 个）")
    else:
        score += 5

    # 4. 总长度（次要约束）
    if len(prd_markdown) < 300:
        issues.append(f"内容过短（{len(prd_markdown)} 字符，建议 > 300）")
    else:
        score += 5

    return {
        "score": score,  # 满分 100
        "issues": issues,
        "passed": score >= 80 and len(issues) == 0
    }
```

---

## 🔗 DoD 一致性校验（Canonical + 派生）

### 问题：JSON vs Markdown 不一致

**现状** (v1.0):
```json
{
  "dod": ["标准1", "标准2"],  // JSON 数组
  "dod_markdown": "- [ ] 标准1\n- [ ] 标准2"  // Markdown
}
```
❌ 一旦两者不一致，谁算准？

---

### 新方案：dod_items 为 Canonical，markdown 为派生

**dod_items 数据结构**:

```json
{
  "dod_items": [
    {
      "id": "DOD-01",
      "text": "优先级算法实现完成",
      "type": "functional",  // functional/performance/quality/security
      "owner": "dev",  // dev/qa/audit
      "status": "pending",  // pending/completed/failed
      "evidence_required": true,  // 是否需要证据
      "evidence": {
        "type": "code",  // code/test/benchmark/screenshot
        "path": "brain/src/priority-algo.js",
        "verified_at": "2026-02-12T14:30:00Z"
      },
      "sequence": 1
    },
    {
      "id": "DOD-02",
      "text": "单元测试覆盖率 > 80%",
      "type": "quality",
      "owner": "qa",
      "status": "pending",
      "evidence_required": true,
      "evidence": {
        "type": "coverage_report",
        "threshold": 0.8,
        "actual": null
      },
      "sequence": 2
    },
    {
      "id": "DOD-03",
      "text": "压力测试：1000 QPS 下响应时间 < 50ms",
      "type": "performance",
      "owner": "qa",
      "status": "pending",
      "evidence_required": true,
      "evidence": {
        "type": "benchmark",
        "threshold": 50,
        "actual": null
      },
      "sequence": 3
    }
  ]
}
```

**dod_markdown 生成规则** (派生缓存):

```python
def generate_dod_markdown(dod_items: List[Dict]) -> str:
    """
    从 dod_items (canonical) 生成 dod_markdown (派生)
    """
    lines = ["# DoD\n"]

    for item in sorted(dod_items, key=lambda x: x['sequence']):
        checkbox = "[x]" if item['status'] == 'completed' else "[ ]"
        tag = f"({item['id']})"
        type_emoji = {
            "functional": "⚙️",
            "performance": "⚡",
            "quality": "✅",
            "security": "🔒"
        }.get(item['type'], "📋")

        line = f"- {checkbox} {tag} {type_emoji} {item['text']}"

        if item.get('evidence_required'):
            line += " 🔍"

        lines.append(line)

    return "\n".join(lines)
```

**示例输出**:

```markdown
# DoD

- [ ] (DOD-01) ⚙️ 优先级算法实现完成 🔍
- [ ] (DOD-02) ✅ 单元测试覆盖率 > 80% 🔍
- [ ] (DOD-03) ⚡ 压力测试：1000 QPS 下响应时间 < 50ms 🔍
```

---

### 一致性校验（validate-okr.py）

```python
def validate_dod_consistency(pr_plan: Dict) -> Dict[str, Any]:
    """
    验证 dod_items (canonical) 和 dod_markdown (派生) 的一致性
    """
    dod_items = pr_plan['dod_items']
    dod_markdown = pr_plan['dod_markdown']

    issues = []

    # 1. 检查每个 dod_item 都在 markdown 中
    for item in dod_items:
        tag = f"({item['id']})"
        if tag not in dod_markdown:
            issues.append(f"dod_item {item['id']} 在 markdown 中缺失")

    # 2. 检查 markdown 中的 tag 都在 dod_items 中
    markdown_tags = re.findall(r'\(DOD-\d+\)', dod_markdown)
    item_ids = {item['id'] for item in dod_items}

    for tag in markdown_tags:
        item_id = tag.strip('()')
        if item_id not in item_ids:
            issues.append(f"markdown 中的 {tag} 在 dod_items 中不存在")

    # 3. 检查数量一致
    markdown_items = re.findall(r'-\s*\[[ x]\]', dod_markdown)
    if len(markdown_items) != len(dod_items):
        issues.append(f"数量不一致：dod_items={len(dod_items)}, markdown={len(markdown_items)}")

    # 4. 检查 status 和 checkbox 一致
    for item in dod_items:
        tag = f"({item['id']})"
        if tag in dod_markdown:
            # 查找对应行
            line_match = re.search(rf'-\s*\[(.)\].*{re.escape(tag)}', dod_markdown)
            if line_match:
                checkbox = line_match.group(1)
                expected = "x" if item['status'] == 'completed' else " "
                if checkbox != expected:
                    issues.append(f"{item['id']}: status={item['status']} 但 checkbox={'checked' if checkbox=='x' else 'unchecked'}")

    return {
        "passed": len(issues) == 0,
        "issues": issues
    }
```

---

### store-to-database.sh 存储逻辑

```bash
# 存储时只存 dod_items (canonical)
# dod_markdown 可以实时生成，也可以作为缓存存储

curl -X POST http://localhost:5221/api/brain/pr-plans \
  -H "Content-Type: application/json" \
  -d "{
    \"initiative_id\": \"$initiative_id\",
    \"title\": \"$title\",
    \"prd_markdown\": \"$prd_markdown\",
    \"dod_items\": $dod_items,
    \"dod_markdown\": \"$dod_markdown\",  // 缓存，可重新生成
    \"files\": $files,
    \"sequence\": $sequence,
    \"depends_on\": $depends_on
  }"
```

---

## 🔬 /exploratory 生成 Exploration Spec（不是 PRD/DoD）

### 问题：/exploratory 生成临时文件，与正式 PRD/DoD 冲突

**旧方案** (v1.0):
```
/exploratory 不再生成 PRD/DoD 文件
```
❌ 这样会让 exploratory 没法沉淀可复现证据

---

### 新方案：生成 `.exploration.md`，不是 `.prd.md`

**文件结构**:

```
worktree/
├── .exploration.md          ← Exploration Spec（探索规格）
├── .experiment.log          ← 实验日志
├── artifacts/               ← 证据文件夹
│   ├── screenshot-01.png
│   ├── benchmark.csv
│   └── minimal-repro.js
└── ...（代码）
```

---

### `.exploration.md` 格式

```markdown
---
pr_plan_id: pr_123
exploration_id: exp_456
started_at: 2026-02-12T10:00:00Z
completed_at: 2026-02-12T12:30:00Z
status: completed
---

# Exploration: 任务优先级算法技术验证

## 假设 (Hypotheses)

### H1: 使用加权评分法可以在 10ms 内完成计算
**优先级**: P0
**可证伪**: 可以通过 benchmark 测试

### H2: Redis 缓存可以减少 80% 的重复计算
**优先级**: P1
**可证伪**: 可以通过 cache hit rate 统计

## 实验 (Experiments)

### E1: 加权评分算法性能测试
**目的**: 验证 H1
**方法**:
1. 实现基础算法（见 `src/priority-algo.js`）
2. 生成 1000 个随机任务
3. Benchmark 计算时间

**结果**:
- 平均耗时: 3.2ms ✅
- P99: 8.7ms ✅
- P99.9: 12.3ms ⚠️（略超 10ms）

**证据**: `artifacts/benchmark.csv`

### E2: Redis 缓存效果测试
**目的**: 验证 H2
**方法**:
1. 添加 Redis 缓存层
2. 模拟 10000 次请求（20% 重复）
3. 统计 cache hit rate

**结果**:
- Cache hit rate: 85% ✅（超预期）
- 平均响应时间: 0.8ms（缓存命中）vs 3.2ms（未命中）

**证据**: `artifacts/cache-stats.json`

## 发现 (Findings)

### ✅ 成功验证
1. 加权评分法在大多数情况下可以满足 10ms 要求
2. Redis 缓存效果显著，cache hit rate 超过预期

### ⚠️ 需要注意
1. P99.9 略超 10ms（12.3ms），极端情况下可能影响用户体验
2. Redis 单点故障会导致性能回退（需要降级机制）

### 🔴 潜在风险
1. 算法在处理 1000+ 依赖关系时性能衰减明显（O(n²)）
2. Redis 内存占用随任务增长（需要设置 TTL）

## 推荐改动 (Recommended Changes)

### 对 PRD 的建议

**1. 添加章节：性能优化策略**
```markdown
## 性能优化策略

### 缓存机制
- 使用 Redis 缓存计算结果（TTL: 5min）
- Cache key: `priority:${task_id}:${version}`
- 降级：Redis 不可用时使用内存缓存（LRU, 1000 entries）

### 算法优化
- 对于 > 100 依赖的任务，使用采样算法（Sample 50%）
- 设置计算超时：10ms（超时返回默认优先级）
```

**2. 修改章节：风险与回滚**
```markdown
### 新增风险
- **风险 4**: 复杂任务（> 100 依赖）计算超时
  - **缓解**: 采样算法 + 超时机制
  - **回滚**: 如果超时率 > 5%，回退到简单算法
```

---

### 对 DoD 的建议

**1. 修改 DOD-03**
- **旧**: 单元测试覆盖率 > 80%
- **新**: 单元测试覆盖率 > 90%，包含边界条件测试（0 依赖、1000+ 依赖）

**2. 新增 DOD-04**
- **ID**: DOD-04
- **Text**: 压力测试：1000 QPS 下 P99 < 10ms，P99.9 < 15ms
- **Type**: performance
- **Evidence**: benchmark report

**3. 新增 DOD-05**
- **ID**: DOD-05
- **Text**: Redis 降级测试：Redis 不可用时系统仍可正常工作（性能回退）
- **Type**: reliability
- **Evidence**: chaos engineering test

## 可复现步骤

### 环境
- Node.js: v18.17.0
- Redis: 7.0.12
- 测试数据: `test-data/tasks-1000.json`

### 复现 E1
```bash
cd worktree
npm install
node benchmark/priority-algo-perf.js
# 输出：artifacts/benchmark.csv
```

### 复现 E2
```bash
redis-server &
node benchmark/cache-hit-rate.js
# 输出：artifacts/cache-stats.json
```

## 参考资料
- [Redis Caching Best Practices](https://redis.io/docs/manual/patterns/caching/)
- [Algorithm Complexity Analysis](./artifacts/complexity-analysis.pdf)
```

---

### 结构化反馈输出（JSON）

**保存位置**: `.exploration-feedback.json`

```json
{
  "pr_plan_id": "pr_123",
  "exploration_id": "exp_456",
  "status": "completed",
  "summary": "验证了加权评分算法的可行性，发现性能在极端情况下略超预期，建议增加缓存和超时机制",

  "hypotheses": [
    {
      "id": "H1",
      "text": "使用加权评分法可以在 10ms 内完成计算",
      "result": "mostly_confirmed",
      "confidence": 0.85
    },
    {
      "id": "H2",
      "text": "Redis 缓存可以减少 80% 的重复计算",
      "result": "confirmed",
      "confidence": 0.95
    }
  ],

  "experiments": [
    {
      "id": "E1",
      "hypothesis_id": "H1",
      "result": "success",
      "metrics": {
        "avg_ms": 3.2,
        "p99_ms": 8.7,
        "p999_ms": 12.3
      },
      "evidence": ["artifacts/benchmark.csv"]
    },
    {
      "id": "E2",
      "hypothesis_id": "H2",
      "result": "success",
      "metrics": {
        "cache_hit_rate": 0.85,
        "avg_cached_ms": 0.8,
        "avg_uncached_ms": 3.2
      },
      "evidence": ["artifacts/cache-stats.json"]
    }
  ],

  "findings": {
    "successes": [
      "加权评分法满足性能要求",
      "Redis 缓存效果显著"
    ],
    "warnings": [
      "P99.9 略超 10ms（12.3ms）",
      "Redis 单点故障风险"
    ],
    "risks": [
      "复杂任务（> 100 依赖）性能衰减",
      "Redis 内存占用增长"
    ]
  },

  "recommended_changes": [
    {
      "target": "prd",
      "op": "add",
      "path": "## 性能优化策略",
      "content": "### 缓存机制\n- 使用 Redis 缓存...\n\n### 算法优化\n- 对于 > 100 依赖的任务..."
    },
    {
      "target": "prd",
      "op": "modify",
      "path": "## 风险与回滚",
      "content": "### 新增风险\n- **风险 4**: 复杂任务（> 100 依赖）计算超时..."
    },
    {
      "target": "dod",
      "op": "modify",
      "dod_item_id": "DOD-03",
      "old_text": "单元测试覆盖率 > 80%",
      "new_text": "单元测试覆盖率 > 90%，包含边界条件测试（0 依赖、1000+ 依赖）"
    },
    {
      "target": "dod",
      "op": "add",
      "after": "DOD-03",
      "content": {
        "id": "DOD-04",
        "text": "压力测试：1000 QPS 下 P99 < 10ms，P99.9 < 15ms",
        "type": "performance",
        "owner": "qa",
        "evidence_required": true
      }
    },
    {
      "target": "dod",
      "op": "add",
      "after": "DOD-04",
      "content": {
        "id": "DOD-05",
        "text": "Redis 降级测试：Redis 不可用时系统仍可正常工作",
        "type": "reliability",
        "owner": "qa",
        "evidence_required": true
      }
    }
  ],

  "artifacts": {
    "exploration_spec": ".exploration.md",
    "experiment_log": ".experiment.log",
    "evidence_files": [
      "artifacts/benchmark.csv",
      "artifacts/cache-stats.json",
      "artifacts/screenshot-01.png"
    ],
    "code_files": [
      "src/priority-algo.js",
      "benchmark/priority-algo-perf.js",
      "benchmark/cache-hit-rate.js"
    ]
  },

  "metadata": {
    "duration_seconds": 9000,
    "agent": "exploratory",
    "created_at": "2026-02-12T12:30:00Z"
  }
}
```

---

### /exploratory 工作流

```
1. /exploratory --pr-plan-id pr_123 (可选)
   ↓
2. Step 1: 创建 worktree + 分支
   ├─> 如果有 pr_plan_id，从 Brain 读取初始 PRD（作为参考）
   └─> 创建 .exploration.md（Exploration Spec）
   ↓
3. Step 2: 快速实现 + 实验
   ├─> 生成假设（Hypotheses）
   ├─> 设计实验（Experiments）
   ├─> 运行实验 → 收集证据（artifacts/）
   └─> 记录结果（.experiment.log）
   ↓
4. Step 3: 分析发现 + 生成建议
   ├─> 总结发现（Findings）
   ├─> 生成推荐改动（Recommended Changes）
   └─> 保存结构化反馈（.exploration-feedback.json）
   ↓
5. Step 4: 上传反馈到 Brain
   ├─> POST /api/brain/pr-plans/:id/exploration-feedback
   ├─> 上传 .exploration-feedback.json
   └─> Brain 存储 feedback（status = "pending"）
   ↓
6. (可选) 人工审核 feedback
   ↓
7. 调用 /okr --revise-pr-plan pr_123 --with-feedback exp_456
   ├─> /okr 合并建议，生成新版本 PRD/DoD
   └─> Brain 更新 pr_plans 表（revision++）
```

---

## ⚙️ /dev 执行颗粒度：Task，而非整个 PR Plan

### 问题：/dev --pr-plan-id 执行所有 Tasks 会卡死

**旧方案** (v1.0):
```bash
/dev --pr-plan-id pr_123
# → 执行 PR Plan 中的所有 Tasks（可能 10+ 个）
```
❌ 真实开发中经常需要分 PR 做，或者一个 Task 做到一半要拆 PR

---

### 新方案：/dev 的执行单位明确为 Task

**三种入口，都支持**:

#### 入口 1: /dev --task-id (最常用)

```bash
/dev --task-id task_123

# Step 1: 从 Brain 读取 Task
task=$(curl http://localhost:5221/api/brain/tasks/task_123)

# 获取关联的 PR Plan
pr_plan_id=$(echo "$task" | jq -r .pr_plan_id)
pr_plan=$(curl http://localhost:5221/api/brain/pr-plans/$pr_plan_id)

# 生成 PRD/DoD（从 PR Plan 注入）
echo "# PRD - $(echo "$task" | jq -r .title)" > .prd-task_123.md
echo "$pr_plan" | jq -r .prd_markdown >> .prd-task_123.md
echo "\n## 本 Task 具体工作" >> .prd-task_123.md
echo "$task" | jq -r .description >> .prd-task_123.md

# 生成 DoD（从 PR Plan 提取相关 items）
task_related_dod_ids=$(echo "$task" | jq -r '.dod_items[]')
echo "# DoD" > .dod-task_123.md
echo "$pr_plan" | jq -r ".dod_items[] | select(.id | IN($task_related_dod_ids))" \
  | jq -r '"- [ ] (\(.id)) \(.text)"' >> .dod-task_123.md

# 执行开发流程
# Branch → Code → Test → Quality → PR → CI → Cleanup
```

---

#### 入口 2: /dev --pr-plan-id (生成骨架，不执行)

```bash
/dev --pr-plan-id pr_123

# Step 1: 从 Brain 读取 PR Plan
pr_plan=$(curl http://localhost:5221/api/brain/pr-plans/pr_123)

# Step 2: 生成 PRD/DoD 文件（作为参考）
echo "$pr_plan" | jq -r .prd_markdown > .prd-pr_123.md
echo "$pr_plan" | jq -r .dod_markdown > .dod-pr_123.md

# Step 3: 创建分支骨架
branch_name="cp-$(date +%m%d%H%M)-$(echo "$pr_plan" | jq -r .title | sed 's/ /-/g' | cut -c1-30)"
git checkout -b "$branch_name" develop

# Step 4: 生成 TODO 列表（不执行）
echo "# PR Plan: $(echo "$pr_plan" | jq -r .title)" > .pr-plan-tasks.md
echo "" >> .pr-plan-tasks.md
echo "## Tasks to complete:" >> .pr-plan-tasks.md
echo "$pr_plan" | jq -r '.tasks[] | "- [ ] \(.title) (task_id: \(.id))"' >> .pr-plan-tasks.md
echo "" >> .pr-plan-tasks.md
echo "## Next step:" >> .pr-plan-tasks.md
echo "Run: /dev --task-id <task_id>" >> .pr-plan-tasks.md

echo "✅ PR Plan 骨架已生成"
echo "📋 查看任务列表: cat .pr-plan-tasks.md"
echo "🚀 开始第一个任务: /dev --task-id $(echo "$pr_plan" | jq -r '.tasks[0].id')"
```

---

#### 入口 3: /dev --workpack-id (Brain 生成可执行包)

```bash
/dev --workpack-id workpack_789

# Workpack 是 Brain 生成的"可执行包"，包含：
# - 一组相关 Tasks（可以在一个 PR 中完成）
# - 预生成的 PRD/DoD
# - 预生成的分支名
# - 预生成的文件列表

# Step 1: 从 Brain 读取 Workpack
workpack=$(curl http://localhost:5221/api/brain/workpacks/workpack_789)

# Workpack 数据结构：
{
  "id": "workpack_789",
  "pr_plan_id": "pr_123",
  "title": "实现优先级算法核心逻辑",
  "task_ids": ["task_123", "task_124"],  // 这一批任务
  "prd_markdown": "...",  // 预生成的 PRD（只包含这批任务的范围）
  "dod_items": [...],     // 预生成的 DoD（只包含这批任务的验收标准）
  "branch_name": "cp-02121530-priority-algo-core",
  "files_to_modify": [
    "brain/src/priority-algo.js",
    "brain/src/__tests__/priority-algo.test.js"
  ],
  "estimated_hours": 4,
  "dependencies": [],
  "created_by": "brain_planner",
  "created_at": "2026-02-12T15:00:00Z"
}

# Step 2: 生成 PRD/DoD
echo "$workpack" | jq -r .prd_markdown > .prd-workpack_789.md
generate_dod_markdown "$workpack" > .dod-workpack_789.md

# Step 3: 创建分支
git checkout -b "$(echo "$workpack" | jq -r .branch_name)" develop

# Step 4: 执行开发流程
# Branch → Code → Test → Quality → PR → CI → Cleanup

# Step 5: 完成后更新所有 Task 状态
for task_id in $(echo "$workpack" | jq -r '.task_ids[]'); do
    curl -X PATCH http://localhost:5221/api/brain/tasks/$task_id \
      -d '{"status": "completed"}'
done

# Step 6: 更新 Workpack 状态
curl -X PATCH http://localhost:5221/api/brain/workpacks/workpack_789 \
  -d '{"status": "completed"}'
```

---

### Phase 3 最小版本（推荐）

```bash
# Phase 3 先实现最简单的：/dev --task-id

/dev --task-id task_123

# 只做两件事：
# 1. 从 Brain 读取 Task + PR Plan
# 2. 生成 .prd-task_123.md 和 .dod-task_123.md
# 3. 执行正常的 /dev 流程（不变）

# Phase 3.5（可选）：/dev --pr-plan-id（生成骨架）
# Phase 4（未来）：/dev --workpack-id（Brain 智能打包）
```

---

## 🗄️ Brain Schema 完整版（补充缺失字段）

### pr_plans 表（完整版）

```sql
CREATE TABLE pr_plans (
  -- 基础字段
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id UUID REFERENCES initiatives(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,

  -- PRD/DoD（核心）
  prd_markdown TEXT NOT NULL,        -- PRD 唯一真相
  dod_items JSONB NOT NULL,          -- DoD 唯一真相（结构化）
  dod_markdown TEXT,                 -- DoD 渲染缓存（派生，可重新生成）

  -- 版本管理 ⭐ 新增
  revision INT DEFAULT 1,            -- 版本号（每次 revise 时 ++）
  source VARCHAR(20) DEFAULT 'okr',  -- 来源（okr/revised/manual）
  parent_revision INT,               -- 父版本号（用于版本树）

  -- 反馈管理 ⭐ 新增
  feedback_ids JSONB DEFAULT '[]'::jsonb,  -- 关联的 feedback IDs

  -- 锁定机制 ⭐ 新增
  locked BOOLEAN DEFAULT FALSE,      -- 是否锁定（进入 dev 后锁定，防止乱改）
  locked_at TIMESTAMP,               -- 锁定时间
  locked_by VARCHAR(50),             -- 锁定者（user_id 或 agent_name）

  -- 所有权 ⭐ 新增
  owner_skill VARCHAR(50) DEFAULT 'okr',  -- 创建/维护的 Skill
  owner_agent VARCHAR(50),           -- 创建/维护的 Agent（如 brain_planner）

  -- 工程信息（原有）
  files JSONB,                       -- 涉及的文件列表
  sequence INT NOT NULL,             -- 执行顺序
  depends_on JSONB DEFAULT '[]'::jsonb,  -- 依赖的 PR Plan IDs
  complexity VARCHAR(20),            -- low/medium/high
  estimated_hours INT,               -- 预估工时

  -- 状态
  status VARCHAR(20) DEFAULT 'pending',  -- pending/in_progress/completed/failed/archived

  -- 时间戳
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- 索引
CREATE INDEX idx_pr_plans_initiative ON pr_plans(initiative_id);
CREATE INDEX idx_pr_plans_status ON pr_plans(status);
CREATE INDEX idx_pr_plans_sequence ON pr_plans(sequence);
CREATE INDEX idx_pr_plans_locked ON pr_plans(locked);
CREATE INDEX idx_pr_plans_revision ON pr_plans(revision);
CREATE INDEX idx_pr_plans_feedback_ids ON pr_plans USING gin(feedback_ids);

-- 触发器：自动更新 updated_at
CREATE TRIGGER update_pr_plans_updated_at
  BEFORE UPDATE ON pr_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

---

### feedback 表（新增）

```sql
CREATE TABLE pr_plan_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_plan_id UUID REFERENCES pr_plans(id) ON DELETE CASCADE,

  -- 来源
  source VARCHAR(50) NOT NULL,       -- exploratory/dev/manual
  agent_id VARCHAR(50),              -- 生成 feedback 的 agent
  user_id VARCHAR(50),               -- 如果是人工 feedback

  -- 类型和状态
  type VARCHAR(50) NOT NULL,         -- patch_proposal/issue_report/question/enhancement
  status VARCHAR(20) DEFAULT 'pending',  -- pending/approved/rejected/merged

  -- 内容
  summary TEXT NOT NULL,             -- 摘要
  rationale TEXT,                    -- 理由
  recommended_changes JSONB NOT NULL,  -- 推荐的改动（结构化）

  -- 证据
  evidence JSONB,                    -- 证据文件、metrics、截图等

  -- 审核
  reviewed_by VARCHAR(50),           -- 审核者
  reviewed_at TIMESTAMP,             -- 审核时间
  review_comment TEXT,               -- 审核评论

  -- 合并
  merged_into_revision INT,          -- 合并到哪个版本
  merged_at TIMESTAMP,               -- 合并时间

  -- 时间戳
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_feedback_pr_plan ON pr_plan_feedback(pr_plan_id);
CREATE INDEX idx_feedback_status ON pr_plan_feedback(status);
CREATE INDEX idx_feedback_source ON pr_plan_feedback(source);
CREATE INDEX idx_feedback_type ON pr_plan_feedback(type);
```

---

### workpacks 表（未来，Phase 4）

```sql
CREATE TABLE workpacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_plan_id UUID REFERENCES pr_plans(id) ON DELETE CASCADE,

  -- 基本信息
  title TEXT NOT NULL,
  description TEXT,

  -- 任务批次
  task_ids JSONB NOT NULL,           -- 这一批要完成的 Task IDs

  -- 预生成的 PRD/DoD（只包含这批任务的范围）
  prd_markdown TEXT NOT NULL,
  dod_items JSONB NOT NULL,
  dod_markdown TEXT,

  -- 预生成的工程信息
  branch_name VARCHAR(100),
  files_to_modify JSONB,
  estimated_hours INT,
  dependencies JSONB DEFAULT '[]'::jsonb,

  -- 状态
  status VARCHAR(20) DEFAULT 'pending',

  -- 创建者
  created_by VARCHAR(50) DEFAULT 'brain_planner',

  -- 时间戳
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- 索引
CREATE INDEX idx_workpacks_pr_plan ON workpacks(pr_plan_id);
CREATE INDEX idx_workpacks_status ON workpacks(status);
CREATE INDEX idx_workpacks_task_ids ON workpacks USING gin(task_ids);
```

---

## ⚠️ Implementation Notes（实施前必读）

**这些细节不改也能跑，但会变成技术债。实施前必须明确。**

---

### 1. locked 语义必须明确（防止锁死）

**问题**：现在写"进入 dev 后锁定"，但没说锁什么，谁能改哪些字段。

**硬规则**：

**方案 A（推荐）：拆成两类锁**

```sql
ALTER TABLE pr_plans ADD COLUMN locked_for_prd_dod BOOLEAN DEFAULT FALSE;  -- 锁 text
ALTER TABLE pr_plans ADD COLUMN locked_for_status BOOLEAN DEFAULT FALSE;    -- 锁 status
```

**锁定规则**：

| 场景 | locked_for_prd_dod | locked_for_status | 可修改字段 |
|------|-------------------|------------------|-----------|
| **创建** | FALSE | FALSE | 全部 |
| **dev 执行中** | TRUE | FALSE | dod_items[].status, evidence, 不能改 text/prd |
| **revise** | 短暂 FALSE | FALSE | 生成新 revision |
| **completed** | TRUE | TRUE | 只读 |

**Brain API 检查逻辑**：

```javascript
// PATCH /api/brain/pr-plans/:id
function validateUpdate(current, updates) {
  // 检查 PRD/DoD text 锁
  if (current.locked_for_prd_dod) {
    if (updates.prd_markdown || updates.dod_items?.some(item => item.text !== current.dod_items.find(i => i.id === item.id)?.text)) {
      throw new Error("PR Plan 已锁定，禁止修改 PRD/DoD text");
    }
  }

  // 允许更新 status 和 evidence
  if (updates.dod_items) {
    updates.dod_items.forEach(item => {
      const current_item = current.dod_items.find(i => i.id === item.id);
      // 只允许改 status 和 evidence
      if (item.status !== current_item.status || JSON.stringify(item.evidence) !== JSON.stringify(current_item.evidence)) {
        // OK
      }
    });
  }
}
```

**方案 B（简单但不够精细）：只有一个 locked 字段**

```javascript
// locked = TRUE 时：
// - 禁止改 prd_markdown
// - 禁止改 dod_items[].text
// - 允许改 dod_items[].status/evidence
// - 允许改 status 字段

// revise 时：
// 不改原记录，而是写入新 revision（revision++, parent_revision_id = 当前 id）
```

**推荐**：方案 A（两类锁），更清晰

---

### 2. Task 必须包含 dod_item_ids（否则 /dev 无法生成 Task 级 DoD）

**问题**：现在 Task 不带 dod_items，/dev 不知道本 Task 要验收哪些 DoD。

**示例代码会失败**：
```bash
# ❌ 这行会失败，因为 Task 没有 .dod_items 字段
task_related_dod_ids=$(echo "$task" | jq -r '.dod_items[]')
```

**解决方案 A（推荐）：Task 包含 dod_item_ids**

```sql
-- tasks 表添加字段
ALTER TABLE tasks ADD COLUMN dod_item_ids JSONB DEFAULT '[]'::jsonb;
CREATE INDEX idx_tasks_dod_item_ids ON tasks USING gin(dod_item_ids);
```

**数据示例**：
```json
{
  "id": "task_123",
  "title": "写 priority-algo.js",
  "pr_plan_id": "pr_plan_456",
  "dod_item_ids": ["DOD-01", "DOD-03"],  // ← 明确本 Task 关联哪些 DoD
  "description": "实现优先级计算算法"
}
```

**/dev 生成 DoD**：
```bash
# ✅ 正确
task_related_dod_ids=$(echo "$task" | jq -r '.dod_item_ids[]')
echo "# DoD" > .dod-task_123.md
echo "$pr_plan" | jq -r ".dod_items[] | select(.id | IN($task_related_dod_ids))" \
  | jq -r '"- [ ] (\(.id)) \(.text)"' >> .dod-task_123.md
```

**解决方案 B（反向映射，不推荐）：dod_items[].task_ids**

```json
{
  "dod_items": [
    {
      "id": "DOD-01",
      "text": "...",
      "task_ids": ["task_123", "task_124"]  // 哪些 Task 负责完成
    }
  ]
}
```

缺点：/dev 拉 Task 时还要反查 PR Plan 的所有 dod_items，效率低

**推荐**：方案 A（Task 包含 dod_item_ids）

---

### 3. dod_markdown 不接受外部写入，只允许 Brain 从 dod_items 派生生成

**问题**：现在允许外部传入 dod_markdown，会导致与 dod_items 不一致。

**错误示例**：
```bash
# ❌ store-to-database.sh 接受外部 dod_markdown
curl -X POST http://localhost:5221/api/brain/pr-plans \
  -d "{
    \"dod_items\": [...],
    \"dod_markdown\": \"$EXTERNAL_MARKDOWN\"  # ← 可能与 dod_items 不一致
  }"
```

**硬规则**：

**规则 1：Brain API 写入时不接受 dod_markdown**

```javascript
// POST /api/brain/pr-plans
function createPRPlan(data) {
  // 忽略外部传入的 dod_markdown
  delete data.dod_markdown;

  // 从 dod_items 生成
  data.dod_markdown = generateDodMarkdown(data.dod_items);

  // 插入数据库
  await db.insert('pr_plans', data);
}

// PATCH /api/brain/pr-plans/:id
function updatePRPlan(id, updates) {
  // 如果更新了 dod_items，重新生成 dod_markdown
  if (updates.dod_items) {
    updates.dod_markdown = generateDodMarkdown(updates.dod_items);
  }

  // 忽略直接传入的 dod_markdown
  delete updates.dod_markdown;

  await db.update('pr_plans', id, updates);
}
```

**规则 2：validate-okr.py 在 /okr 生成时不检查外部 markdown**

```python
# validate-okr.py
def validate_okr(output_json):
    # 从 dod_items 生成 canonical markdown
    canonical_markdown = generate_dod_markdown(output_json['pr_plans'][0]['dod_items'])

    # 如果外部提供了 dod_markdown，忽略它，用 canonical 替换
    output_json['pr_plans'][0]['dod_markdown'] = canonical_markdown

    # 保存回文件（覆盖外部传入的）
    with open('output.json', 'w') as f:
        json.dump(output_json, f, indent=2)
```

**规则 3：store-to-database.sh 只传 dod_items**

```bash
# store-to-database.sh
# ✅ 只传 dod_items，让 Brain 生成 dod_markdown
curl -X POST http://localhost:5221/api/brain/pr-plans \
  -d "{
    \"dod_items\": $dod_items
  }"
# Brain 会自动生成 dod_markdown
```

**好处**：
- ✅ 永远以 dod_items 为准
- ✅ dod_markdown 只是渲染缓存
- ✅ 一致性校验 100% 可靠

---

### 4. Feedback 的 path 改为机器友好的锚点（anchor + insert_mode）

**问题**：现在 path 是自由文本 `"## 性能优化策略"`，PRD 章节名变化时会失效。

**错误示例**：
```json
{
  "target": "prd",
  "op": "add",
  "path": "## 性能优化策略",  // ← 如果 PRD 改成 "## 6. 性能优化策略"，就匹配不到
  "content": "..."
}
```

**新方案：anchor + insert_mode**

```json
{
  "target": "prd",
  "op": "add",
  "anchor": "## 5. 风险与回滚",  // 精确匹配的标题
  "insert_mode": "after_section",  // after_section | before_section | replace_section | append_to_section
  "content": "### 新增风险\n- **风险 4**: 复杂任务计算超时..."
}
```

**insert_mode 语义**：

| insert_mode | 说明 | 示例 |
|------------|------|------|
| `after_section` | 在整个章节后插入（在下一个同级标题前）| 在 "## 5. 风险与回滚" 整个章节后插入 |
| `before_section` | 在章节标题前插入 | 在 "## 5. 风险与回滚" 标题前插入 |
| `replace_section` | 替换整个章节（包括标题）| 替换 "## 5. 风险与回滚" 及其内容 |
| `append_to_section` | 追加到章节末尾（下一个同级标题前）| 在 "## 5. 风险与回滚" 内容末尾追加 |

**自动合并逻辑**：

```python
# /okr --revise-pr-plan
def apply_feedback_to_prd(prd_markdown, feedback):
    for change in feedback['recommended_changes']:
        if change['target'] != 'prd':
            continue

        anchor = change['anchor']
        insert_mode = change['insert_mode']
        content = change['content']

        # 查找锚点位置
        match = re.search(rf'^(#{1,6})\s+{re.escape(anchor)}$', prd_markdown, re.MULTILINE)
        if not match:
            print(f"⚠️  警告：找不到锚点 '{anchor}'，跳过此改动")
            continue

        anchor_level = len(match.group(1))  # 标题级别
        anchor_pos = match.end()

        # 查找章节结束位置（下一个同级或更高级标题）
        section_end = find_next_heading(prd_markdown, anchor_pos, anchor_level)

        # 应用改动
        if insert_mode == 'after_section':
            prd_markdown = prd_markdown[:section_end] + "\n\n" + content + prd_markdown[section_end:]
        elif insert_mode == 'append_to_section':
            prd_markdown = prd_markdown[:section_end] + "\n\n" + content + "\n" + prd_markdown[section_end:]
        elif insert_mode == 'replace_section':
            prd_markdown = prd_markdown[:match.start()] + content + prd_markdown[section_end:]
        # ...

    return prd_markdown
```

**好处**：
- ✅ PRD 章节编号变化时仍能匹配（用 exact text）
- ✅ 自动合并可实现（确定性算法）
- ✅ 冲突可检测（两个 feedback 修改同一 anchor）

---

### 5. revision 改为 UUID + parent_revision_id（防止并发冲突）

**问题**：INT revision 在并发 revise 时会撞号。

**错误场景**：
```
时刻 T1：Agent A 读取 PR Plan (revision=3)
时刻 T2：Agent B 读取 PR Plan (revision=3)
时刻 T3：Agent A revise → 写入 revision=4
时刻 T4：Agent B revise → 写入 revision=4（覆盖 A 的修改！）
```

**新方案：revision_id UUID + parent_revision_id**

```sql
ALTER TABLE pr_plans DROP COLUMN revision;
ALTER TABLE pr_plans DROP COLUMN parent_revision;

ALTER TABLE pr_plans ADD COLUMN revision_id UUID DEFAULT gen_random_uuid();
ALTER TABLE pr_plans ADD COLUMN parent_revision_id UUID;
ALTER TABLE pr_plans ADD COLUMN content_hash VARCHAR(64);  -- SHA256(prd_markdown + dod_items)
ALTER TABLE pr_plans ADD COLUMN revision_number INT DEFAULT 1;  -- 仅用于展示

CREATE INDEX idx_pr_plans_revision_id ON pr_plans(revision_id);
CREATE INDEX idx_pr_plans_parent_revision_id ON pr_plans(parent_revision_id);
```

**数据示例**：

```json
// 初始版本
{
  "id": "pr_plan_123",
  "revision_id": "rev_aaa",
  "parent_revision_id": null,
  "revision_number": 1,
  "content_hash": "sha256:abcd1234...",
  "prd_markdown": "...",
  "dod_items": [...]
}

// 第一次 revise
{
  "id": "pr_plan_123",  // 同一个 PR Plan
  "revision_id": "rev_bbb",  // 新 UUID
  "parent_revision_id": "rev_aaa",  // 指向父版本
  "revision_number": 2,
  "content_hash": "sha256:efgh5678...",
  "prd_markdown": "...",  // 新内容
  "dod_items": [...]
}

// 并发 revise（被拒绝）
{
  "id": "pr_plan_123",
  "revision_id": "rev_ccc",
  "parent_revision_id": "rev_aaa",  // ⚠️ 仍然基于 rev_aaa
  // Brain 检测到 parent_revision_id 不是当前最新的 rev_bbb
  // 拒绝写入，提示 rebase
}
```

**Brain API 乐观锁**：

```javascript
// PATCH /api/brain/pr-plans/:id/revise
async function revisePRPlan(id, feedback_ids, expected_revision_id) {
  // 1. 读取当前版本
  const current = await db.query('SELECT * FROM pr_plans WHERE id = $1', [id]);

  // 2. 检查乐观锁
  if (current.revision_id !== expected_revision_id) {
    throw new Error(`Revision conflict: expected ${expected_revision_id}, but current is ${current.revision_id}. Please rebase.`);
  }

  // 3. 生成新版本
  const new_revision_id = uuidv4();
  const new_prd_markdown = applyFeedback(current.prd_markdown, feedback_ids);
  const new_content_hash = sha256(new_prd_markdown + JSON.stringify(current.dod_items));

  // 4. 插入新版本（不改原记录）
  await db.insert('pr_plans', {
    ...current,
    revision_id: new_revision_id,
    parent_revision_id: current.revision_id,
    revision_number: current.revision_number + 1,
    prd_markdown: new_prd_markdown,
    content_hash: new_content_hash,
    updated_at: new Date()
  });

  // 5. 标记 feedback 为 merged
  await db.update('pr_plan_feedback', { status: 'merged', merged_into_revision_id: new_revision_id }, { id: feedback_ids });

  return { revision_id: new_revision_id };
}
```

**调用方式**：

```bash
# 客户端必须传入 expected_revision_id
curl -X PATCH http://localhost:5221/api/brain/pr-plans/pr_123/revise \
  -d '{
    "feedback_ids": ["feedback_001"],
    "expected_revision_id": "rev_aaa"
  }'

# 如果并发冲突，返回 409 Conflict
{
  "error": "Revision conflict",
  "current_revision_id": "rev_bbb",
  "expected_revision_id": "rev_aaa",
  "message": "Please rebase your changes"
}
```

**好处**：
- ✅ 防止并发覆盖
- ✅ 可追溯版本树（parent_revision_id）
- ✅ 可回滚（所有历史版本保留）

---

## 📋 行动计划（更新）

### Phase 1: /okr 生成完整 PRD/DoD (立即开始)

**变更**:
1. ✅ `skills/okr/SKILL.md` - 添加 `prd_markdown` 和 `dod_items` 字段
   - PRD 必需结构（7 个章节）
   - DoD items 结构（id, text, type, owner, evidence_required）

2. ✅ `skills/okr/scripts/validate-okr.py` - 结构校验
   - `validate_prd_structure()` - 验证 PRD 章节完整性
   - `validate_dod_consistency()` - 验证 dod_items vs dod_markdown 一致性
   - 最小信息集（MIK）校验

3. ✅ 测试 - 生成一个完整的 3-layer output，验证质量

---

### Phase 2: Brain 增加 PR Plans 表 (1-2 天)

**变更**:
1. ✅ 数据库迁移
   - `pr_plans` 表（完整版，含 revision/source/feedback_ids/locked/owner_skill）
   - `pr_plan_feedback` 表（新增）
   - 索引和触发器

2. ✅ Brain API
   - `GET /api/brain/pr-plans/:id` - 读取 PR Plan
   - `PATCH /api/brain/pr-plans/:id` - 更新状态
   - `POST /api/brain/pr-plans/:id/feedback` - 提交 feedback（exploratory/dev）
   - `PATCH /api/brain/pr-plans/:id/revise` - 合并 feedback，生成新版本
   - `POST /api/brain/pr-plans/:id/lock` - 锁定 PR Plan（进入 dev 时）
   - `POST /api/brain/pr-plans/:id/unlock` - 解锁 PR Plan

3. ✅ `skills/okr/scripts/store-to-database.sh`
   - 存储 PR Plans（含 prd_markdown + dod_items + dod_markdown）
   - 存储时自动生成 dod_markdown（如果缺失）

---

### Phase 3: /dev 支持 --task-id (1-2 天)

**变更**:
1. ✅ `skills/dev/SKILL.md` - 明确执行颗粒度
   - 入口 1: `--task-id` (Phase 3 实现)
   - 入口 2: `--pr-plan-id` (Phase 3.5 实现)
   - 入口 3: `--workpack-id` (Phase 4 实现)

2. ✅ `skills/dev/scripts/fetch-task.sh`
   - 从 Brain 读取 Task
   - 从 Brain 读取关联的 PR Plan
   - 生成 `.prd-task_<id>.md`（注入 PR Plan 的 prd_markdown + Task description）
   - 生成 `.dod-task_<id>.md`（提取 Task 相关的 dod_items）

3. ✅ `skills/dev/steps/01-prd.md`
   - 检测 `--task-id` 参数
   - 调用 `fetch-task.sh`
   - 如果 PR Plan 已锁定，提示警告（但仍允许执行）

---

### Phase 4: /exploratory 集成 (1-2 天)

**变更**:
1. ✅ `skills/exploratory/SKILL.md` - 明确定位
   - 生成 `.exploration.md`（Exploration Spec）
   - 生成 `.exploration-feedback.json`（结构化反馈）
   - 不生成 `.prd.md` 或 `.dod.md`

2. ✅ `skills/exploratory/steps/01-init.md`
   - 支持 `--pr-plan-id`（可选）
   - 如果有 pr_plan_id，从 Brain 读取 PRD 作为参考

3. ✅ `skills/exploratory/steps/04-feedback.md`
   - 生成 `.exploration-feedback.json`
   - 上传: `POST /api/brain/pr-plans/:id/exploration-feedback`
   - Brain 存储 feedback（status = "pending"）

4. ✅ `/okr --revise-pr-plan`（新增命令）
   - 读取 PR Plan 当前版本 + feedback
   - 用 LLM 合并修改
   - 验证新版本
   - revision++, source = 'revised'
   - 保存到 Brain

---

### Phase 5: 前端可视化 (未来)

- PR Plans 详情页（含版本历史）
- Feedback 审核界面
- DoD 进度追踪（实时更新 checkbox 状态）
- Exploration 证据查看器（artifacts/）

---

## ✅ 总结：v2 vs v1 的关键改进

| 问题 | v1.0 | v2.0 ✅ |
|------|------|--------|
| **PRD/DoD 修改权** | 未定义，隐含允许 exploratory/dev 直接改 | 明确：只能通过 feedback 提议，/okr revise 合并 |
| **PRD 质量校验** | 纯长度（> 500 字） | 结构校验（7 个必需章节）+ MIK |
| **DoD 一致性** | JSON vs Markdown 可能不一致 | dod_items 为 canonical，markdown 为派生，有校验 |
| **/exploratory 定位** | "不再生成 PRD/DoD"（模糊） | 生成 `.exploration.md` + `.exploration-feedback.json` |
| **/dev 执行颗粒度** | --pr-plan-id 执行所有 Tasks | --task-id（Phase 3），--pr-plan-id 只生成骨架 |
| **Schema 字段** | 缺 revision/source/feedback_ids/locked | 完整版（含版本、反馈、锁定、所有权） |

---

## 🚀 下一步

**立即开始**: Phase 1 - 修改 `/okr SKILL.md`，添加：
1. PRD 必需结构（7 个章节）
2. DoD items 结构（id, text, type, owner, evidence_required）
3. 结构校验规则

要不要现在就开始用 `/dev` 修复？
