# 集成缺口分析和修复方案

**日期**: 2026-02-13
**问题**: 检查整个 OKR → Exploratory → Dev 闭环是否完整，是否有割裂

---

## 🔴 发现的问题

### 1. Similarity Service 查询已删除的 features 表

**Bug 位置**: `brain/src/similarity.js`

**问题**:
- Lines 102, 139 查询 `features` 表
- Migration 027 已删除 `features` 表
- Initiative 已迁移到 `projects` 表（作为 Sub-Project）

**影响**:
- 记忆搜索功能失败
- `/api/brain/search-similar` API 报错
- 无法搜索相似的 Initiatives

**修复**:
```javascript
// ❌ 旧代码（Lines 95-106）
FROM tasks t
LEFT JOIN pr_plans pp ON t.pr_plan_id = pp.id
LEFT JOIN features f ON pp.initiative_id = f.id  ← features 表不存在

// ✅ 新代码
FROM tasks t
LEFT JOIN pr_plans pp ON t.pr_plan_id = pp.id
LEFT JOIN projects p ON pp.project_id = p.id     ← 使用 projects 表
WHERE p.parent_id IS NULL OR p.parent_id IS NOT NULL  ← Sub-Projects = Initiatives
```

```javascript
// ❌ 旧代码（Lines 134-144）
FROM features f                                   ← features 表不存在
LEFT JOIN key_results kr ON f.kr_id = kr.id

// ✅ 新代码
FROM projects p                                   ← 使用 projects 表
LEFT JOIN project_kr_links pkl ON p.id = pkl.project_id
LEFT JOIN goals kr ON pkl.kr_id = kr.id AND kr.type = 'key_result'
WHERE p.parent_id IS NOT NULL                    ← 只选择 Sub-Projects (Initiatives)
```

---

### 2. Skills 未集成记忆搜索

**问题**:
- `/okr` skill: 拆解前未检查是否有类似的 Initiative
- `/exploratory` skill: 验证前未检查是否有类似的探索
- `/dev` skill: 开发前未检查是否有类似的实现

**影响**:
- 重复工作
- 浪费资源
- 无法借鉴过去经验

**修复方案**:

#### 2.1 修改 /okr skill

**添加步骤**: 在拆解前调用记忆搜索

```bash
# 在 ~/.claude/skills/okr/SKILL.md 添加 Step 0
## Step 0: 检查是否有类似的 Initiative

**调用 Brain API**:
```bash
curl -X POST http://localhost:5221/api/brain/search-similar \
  -H "Content-Type: application/json" \
  -d '{
    "query": "<KR 描述>",
    "top_k": 5,
    "filters": {
      "repo": "<repository>"
    }
  }'
```

**如果找到相似的**:
- 展示给用户：「发现类似的 Initiative: <title>」
- 询问：「是否参考这个 Initiative 的拆解？」
- 如果用户同意，读取相似 Initiative 的 PR Plans 作为参考

**如果没找到**:
- 继续正常拆解流程
```

#### 2.2 修改 /exploratory skill

**添加步骤**: 在验证前调用记忆搜索

```bash
# 在 ~/.claude/skills/exploratory/steps/01-init.md 添加
## 1.1 检查是否有类似的探索

**调用 Brain API**:
```bash
curl -X POST http://localhost:5221/api/brain/search-similar \
  -H "Content-Type: application/json" \
  -d '{
    "query": "<任务描述>",
    "top_k": 3,
    "filters": {
      "repo": "<repository>"
    }
  }'
```

**如果找到相似的**:
- 读取相似 Task 的 metadata (PRD/DoD 文件路径)
- 如果有 PRD/DoD，展示给用户
- 询问：「发现类似的探索，是否跳过验证，直接使用已有 PRD/DoD？」
- 如果用户同意，跳过 Step 2-3，直接返回已有 PRD/DoD

**如果没找到**:
- 继续正常探索流程
```

#### 2.3 修改 /dev skill

**添加步骤**: 在开发前调用记忆搜索

```bash
# 在 ~/.claude/skills/dev/steps/02-prd.md 添加
## 2.1 检查是否有类似的实现

**调用 Brain API**:
```bash
curl -X POST http://localhost:5221/api/brain/search-similar \
  -H "Content-Type: application/json" \
  -d '{
    "query": "<PRD 标题>",
    "top_k": 3,
    "filters": {
      "repo": "<repository>"
    }
  }'
```

**如果找到相似的**:
- 读取相似 Task 的 PR 链接 (metadata.pr_number)
- 展示给用户：「发现类似的实现: PR #<number>」
- 询问：「是否参考这个 PR 的代码？」
- 如果用户同意，checkout PR 分支，参考代码结构

**如果没找到**:
- 继续正常开发流程
```

---

### 3. Brain Tick Loop 未集成记忆搜索

**问题**:
- `planNextTask()` 在派发前未检查重复任务
- 可能派发重复的任务

**修复方案**:

**修改 `brain/src/planner.js`**:

```javascript
// 在 planNextTask() 中添加重复检查
async function planNextTask(scopeKRIds = null) {
  const state = await getGlobalState();

  // V4: 检查 PR Plans 前，先检查是否有重复任务
  const initiativesResult = await pool.query(`...`);

  for (const initiative of initiativesResult.rows) {
    const nextPrPlan = await getNextPrPlan(initiative.id);
    if (nextPrPlan) {
      const existingTaskResult = await pool.query(`
        SELECT * FROM tasks WHERE pr_plan_id = $1 AND status IN ('queued', 'in_progress')
        LIMIT 1
      `, [nextPrPlan.id]);

      if (existingTaskResult.rows[0]) {
        const task = existingTaskResult.rows[0];

        // ✨ 新增：检查是否有相似的已完成任务
        const { default: SimilarityService } = await import('./similarity.js');
        const similarityService = new SimilarityService();
        const similarResult = await similarityService.searchSimilar(
          task.title + ' ' + task.description,
          3,
          { repo: initiative.repo_path }
        );

        // 如果找到相似度 > 0.8 的已完成任务，标记为可能重复
        const highSimilarity = similarResult.matches.find(m =>
          m.score > 0.8 && m.level === 'task' && m.status === 'completed'
        );

        if (highSimilarity) {
          // 在 working_memory 中记录警告
          await pool.query(`
            INSERT INTO working_memory (key, value, metadata)
            VALUES ('duplicate_task_warning', $1, $2)
          `, [
            JSON.stringify({ task_id: task.id, similar_task_id: highSimilarity.id }),
            { score: highSimilarity.score, checked_at: new Date().toISOString() }
          ]);

          console.warn(`⚠️  Task ${task.id} may be duplicate of ${highSimilarity.id} (score: ${highSimilarity.score})`);
        }

        return {
          planned: true,
          task: { id: task.id, ... },
          duplicate_warning: highSimilarity ? {
            similar_task: highSimilarity.id,
            score: highSimilarity.score
          } : null
        };
      }
    }
  }

  // ... rest of the function
}
```

---

### 4. QA/Audit 集成缺失

**问题**:
- `/dev` skill v3.1.0 删除了本地 QA/Audit 调用
- 所有检查交给 CI DevGate
- 但 CI 中没有看到 QA/Audit 的 GitHub Actions

**检查**:

```bash
# 查看 CI 配置
cat .github/workflows/*.yml | grep -i "qa\|audit\|quality"
```

**如果 CI 中没有 QA/Audit**:
- ❌ 这是割裂的！
- ✅ 需要添加 CI jobs 或恢复本地 QA/Audit 调用

---

### 5. Task Types 未完全支持

**当前支持的 Task Types** (根据 MEMORY.md):
```
dev, review, qa, audit, talk, data, research
```

**但是闭环文档中提到了 `exploratory` 类型**:
- ❌ `exploratory` 不在支持列表中
- ❌ `brain/src/executor.js` 可能不知道如何派发 `exploratory` 类型的 Task

**检查**:

```bash
# 查看 executor.js 是否支持 exploratory
grep -n "exploratory\|task.*type" brain/src/executor.js
```

**如果不支持**:
- 需要在 `executor.js` 中添加 `exploratory` 类型的处理
- 需要在 task-router.js 的 LOCATION_MAP 中添加 `exploratory` 路由

---

## ✅ 修复优先级

### P0 - 立即修复（阻塞功能）

1. **修复 similarity.js 的 features 表查询** ← 阻塞记忆搜索
2. **添加 exploratory task type 支持** ← 阻塞 OKR 闭环

### P1 - 高优先级（完整性）

3. **Skills 集成记忆搜索** ← 避免重复工作
4. **Brain Tick Loop 集成记忆搜索** ← 自动去重

### P2 - 中优先级（质量保证）

5. **检查 QA/Audit 集成** ← 质量门禁

---

## 📝 修复计划

### Phase 1: 修复阻塞性 Bug (30 分钟)

1. 修复 `similarity.js` 查询 features 表 → projects 表
2. 添加 `exploratory` task type 到 executor.js
3. 测试记忆搜索 API

### Phase 2: 集成记忆搜索 (60 分钟)

4. 修改 `/okr` skill 添加 Step 0
5. 修改 `/exploratory` skill 添加相似度检查
6. 修改 `/dev` skill 添加参考代码查找

### Phase 3: 完善闭环 (30 分钟)

7. Brain Tick Loop 添加重复任务检查
8. 检查 QA/Audit 集成状态
9. 更新文档

---

## 🎯 预期结果

修复完成后：

✅ 记忆搜索功能正常工作
✅ Skills 调用记忆搜索，避免重复工作
✅ Brain 自动检测重复任务
✅ exploratory task type 被正确派发
✅ QA/Audit 集成到 CI 或本地流程
✅ 整个闭环无割裂，自动化执行

---

**下一步**: 用户确认修复方案后，开始执行 Phase 1
