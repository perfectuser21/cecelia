---
name: batch-notion-analyzer
description: 批量处理 Notion 数据库中"未使用"页面 → 双层并行分析 → 自动清理过期文档。这是默认的日常工作流，分析完成后自动清理工作区。
---

# 批量 Notion 分析器（含自动清理）

## 工作流架构

```
Step 1: 查询未使用页面
  ├─ mcp__notion_query_database()
  ├─ filter: {状态: "未使用"}
  └─ 询问用户处理数量
         ↓
Step 2: 批量分析（分批并行）
  ├─ 每批 2 个页面并行处理
  ├─ 每个页面调用 two-layer-parallel-analyzer
  │   ├─ Layer 1: 4 agents 并行
  │   └─ Layer 2: 5 agents 并行
  ├─ 写入 Notion
  └─ 更新状态 → "AI 处理"
         ↓
Step 3: 自动清理工作区
  ├─ 运行 smart-cleanup-docs.mjs
  ├─ 扫描所有 .md 文件
  ├─ 检测重复/孤立/过期文档
  └─ 自动归档到 archive/
         ↓
Step 4: 生成最终报告
```

---

## 执行步骤（你需要按顺序执行）

### Step 1: 查询未使用页面

使用 MCP tool 查询 Notion 数据库：

```javascript
mcp__notion_query_database({
  database_id: NOTION_DATABASE_ID,
  filter: {
    property: '状态',
    status: { equals: '未使用' }
  }
})
```

然后询问用户要处理多少个页面（2个/5个/10个/全部）。

---

### Step 2: 批量分析页面

对每个页面：
- 使用 Skill tool 调用 `two-layer-parallel-analyzer`
- 获取完整的分析结果（Layer 1 + Layer 2）
- 使用 MCP tool 写入 Notion
- 更新页面状态为"AI 处理"

**并发控制**：每批 2 个页面并行，批次间串行

---

### Step 3: 自动清理工作区

批量处理完成后，**自动运行**清理脚本（不需要用户确认）：

```bash
node smart-cleanup-docs.mjs --verbose
```

清理脚本会：
- 扫描项目中所有 .md 文件（排除 node_modules）
- 基于内容分析进行分类（不依赖文件名）
- 检测重复文档（使用内容哈希）
- 识别孤立文档（检查是否被其他文件引用）
- 自动归档过期/重复/孤立文档到 `archive/`

**安全保障**：
- 只移动文件，不删除
- 核心文档自动保护（README.md, PRD.md, context.md）
- Skills 和 src 目录永不清理
- 所有操作记录到 `archive/smart-cleanup-log.txt`

---

### Step 4: 生成最终报告

读取批量处理统计信息，生成完整报告：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      批量 Notion 分析 + 自动清理完成
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Notion 分析结果：
  ✅ 成功处理: X 个页面
  ❌ 失败: Y 个页面
  ⏱️  总耗时: Z 分钟

🗑️  工作区清理结果：
  📁 扫描: A 个 .md 文件
  🗑️  已归档: B 个文档
  💾 保留: C 个文档

📁 归档位置: archive/
✅ 工作区已整理完毕
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 重要提示

1. **自动清理**：分析完成后自动清理，无需手动确认
2. **安全第一**：只移动文件到 archive/，不删除任何内容
3. **可恢复**：所有归档文件可随时从 archive/ 恢复
4. **核心保护**：README、PRD、Skills、src 目录永不清理

---

## 依赖项

- `batch-notion-analyzer` skill
- `two-layer-parallel-analyzer` skill
- `write-analysis-with-strict-format.mjs`
- `smart-cleanup-docs.mjs`
- `.docs-cleanup-rules-v2.json`

---

## 稳定性保障

- ✅ 批量处理隔离：单个页面失败不影响其他页面
- ✅ 格式一致性：所有页面使用统一格式化脚本
- ✅ 智能清理：基于内容分析，不依赖文件名模式
- ✅ 安全预览：默认 dry-run 模式，预览后再执行
- ✅ 已验证成功率：33/33 页面成功处理（100%）
