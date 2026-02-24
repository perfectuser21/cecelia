---
name: claude-work-summarizer
description: 总结 Claude Code 会话中的工作内容并保存到 Notion，帮助记录开发历史和决策过程
---

# 📝 Claude Code 工作总结器

## 🎯 功能说明

这个 Skill 用于总结 Claude Code 在当前会话中完成的工作，包括代码修改、功能开发、问题解决等，并将总结保存到 Notion 数据库中，方便后续查阅和回顾。

---

## 💡 使用场景

### 场景 1：会话结束时自动总结
当你完成一段工作后，可以让 Claude 总结本次会话做了什么：
```
总结一下今天的工作
```

### 场景 2：重要里程碑记录
完成重要功能或修复重要 bug 后记录：
```
把刚才实现的新功能总结到 Notion
```

### 场景 3：定期工作日志
每天结束时记录当天的工作内容：
```
把今天所有的改动记录到 Notion
```

---

## 📋 总结内容包含

### 1. 工作概述
- 会话开始时间
- 主要完成的任务
- 涉及的文件和模块

### 2. 详细变更记录
- 新增的功能
- 修改的代码
- 修复的问题
- 重构的部分

### 3. 技术决策
- 使用的技术栈
- 架构设计考虑
- 重要的实现细节

### 4. 待办事项
- 遗留问题
- 后续改进建议
- 需要关注的点

---

## 🏗️ 执行流程

### 步骤 1：分析会话历史

扫描当前会话中的所有操作：
- 读取了哪些文件
- 修改了哪些文件
- 执行了哪些命令
- 遇到了哪些问题和解决方案

### 步骤 2：智能总结

使用 AI 分析会话内容，生成结构化总结：

```
会话总结模板：

# [主要任务名称]

## 📅 时间
- 开始时间：YYYY-MM-DD HH:mm
- 结束时间：YYYY-MM-DD HH:mm
- 总耗时：X 小时 Y 分钟

## 🎯 任务目标
[简要描述本次会话要完成的目标]

## ✅ 完成内容

### 新增功能
- [功能1描述]
- [功能2描述]

### 代码修改
- 文件：[文件路径]
  - 修改：[具体修改内容]
  - 原因：[为什么要这样修改]

### 问题修复
- 问题：[问题描述]
  - 解决方案：[如何解决的]
  - 影响范围：[影响了哪些部分]

### 重构优化
- [重构内容]
  - 优化点：[具体优化了什么]

## 💡 技术决策

### 技术选型
- [技术/库名称]：[为什么选择它]

### 架构设计
- [设计决策]：[设计考虑]

### 实现细节
- [关键实现点]：[具体说明]

## 📝 文件变更清单
- ✅ 新建：[文件列表]
- 📝 修改：[文件列表]
- 🗑️ 删除：[文件列表]

## 🔧 执行的命令
- [命令1]
- [命令2]

## ⚠️ 遇到的问题
1. 问题：[问题描述]
   - 原因：[问题原因]
   - 解决：[解决方法]

## 📌 待办事项
- [ ] [待完成事项1]
- [ ] [待完成事项2]

## 💭 后续建议
- [改进建议1]
- [改进建议2]

## 🔗 相关资源
- 文档：[相关文档链接]
- 参考：[参考资料链接]
```

### 步骤 3：保存到 Notion

将总结保存到 Notion 数据库：

```javascript
// 创建新页面
const response = await notion.pages.create({
  parent: { database_id: WORK_LOG_DATABASE_ID },
  properties: {
    '标题': {
      title: [
        {
          text: {
            content: taskTitle
          }
        }
      ]
    },
    '日期': {
      date: {
        start: new Date().toISOString()
      }
    },
    '类型': {
      select: {
        name: taskType  // '功能开发' / 'Bug修复' / '重构' / '其他'
      }
    },
    '状态': {
      status: {
        name: '已完成'
      }
    }
  },
  children: [
    // 总结内容的 blocks
  ]
});
```

### 步骤 4：确认和反馈

向用户显示总结结果：
```
✅ 工作总结已保存到 Notion！

📊 本次会话统计：
- 修改文件：5 个
- 新增代码：230 行
- 删除代码：45 行
- 执行命令：12 次
- 耗时：1 小时 23 分钟

🔗 Notion 链接：https://notion.so/...
```

---

## 🎨 总结类型分类

### 类型 1：功能开发
- 标签：`功能开发`
- 重点：新功能的设计和实现

### 类型 2：Bug 修复
- 标签：`Bug修复`
- 重点：问题分析和解决过程

### 类型 3：代码重构
- 标签：`重构`
- 重点：重构目的和优化效果

### 类型 4：探索研究
- 标签：`研究`
- 重点：调研内容和发现

### 类型 5：配置调整
- 标签：`配置`
- 重点：配置变更和影响

---

## ⚙️ 配置说明

### Notion 数据库配置

需要在 Notion 中创建一个"工作日志"数据库，包含以下字段：

```yaml
数据库名称：Claude Code 工作日志

必需字段：
  - 标题（Title）：任务名称
  - 日期（Date）：完成日期
  - 类型（Select）：功能开发/Bug修复/重构/研究/配置
  - 状态（Status）：已完成/进行中/暂停

可选字段：
  - 耗时（Number）：花费时间（分钟）
  - 文件数（Number）：修改的文件数量
  - 代码行数（Number）：变更的代码行数
  - 标签（Multi-select）：相关标签
  - 项目（Relation）：关联的项目
```

### 环境变量配置

在 `.env` 文件中添加：

```bash
# 工作日志数据库 ID（新建数据库后填写）
WORK_LOG_DATABASE_ID=your_database_id_here

# 或者使用现有的数据库（如果适用）
# WORK_LOG_DATABASE_ID=${NOTION_DATABASE_ID}
```

---

## 🚀 使用示例

### 示例 1：基本使用

**用户**：
```
总结今天的工作并保存到 Notion
```

**Claude 执行**：
1. 分析会话历史
2. 生成工作总结
3. 保存到 Notion
4. 返回 Notion 链接

### 示例 2：指定总结类型

**用户**：
```
把刚才修复的 bug 记录到 Notion
```

**Claude 识别**：类型为"Bug修复"，重点记录问题和解决方案

### 示例 3：详细总结

**用户**：
```
详细总结一下这次重构，包括所有的技术决策
```

**Claude 执行**：生成包含详细技术决策的总结

---

## 💪 核心优势

1. **自动化记录**：无需手动整理工作日志
2. **结构化输出**：统一的格式方便查阅
3. **智能分析**：AI 理解上下文，提取关键信息
4. **永久保存**：存储在 Notion 中便于检索
5. **团队协作**：可分享给团队成员了解进度

---

## 🔧 技术实现

### 会话分析算法

```javascript
function analyzeSession(sessionHistory) {
  const summary = {
    filesRead: [],
    filesModified: [],
    filesCreated: [],
    filesDeleted: [],
    commandsExecuted: [],
    problemsSolved: [],
    decisionsMode: [],
    timeSpent: calculateDuration()
  };

  // 分析会话历史中的每个操作
  for (const action of sessionHistory) {
    if (action.type === 'Read') {
      summary.filesRead.push(action.file_path);
    } else if (action.type === 'Edit') {
      summary.filesModified.push({
        path: action.file_path,
        changes: analyzeChanges(action)
      });
    } else if (action.type === 'Write') {
      summary.filesCreated.push(action.file_path);
    } else if (action.type === 'Bash') {
      summary.commandsExecuted.push(action.command);
    }
    // ... 其他类型分析
  }

  return summary;
}
```

### Notion 格式化

```javascript
function formatForNotion(summary) {
  const blocks = [];

  // 添加标题
  blocks.push({
    object: 'block',
    type: 'heading_1',
    heading_1: {
      rich_text: [{ text: { content: summary.title } }]
    }
  });

  // 添加时间信息
  blocks.push({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [
        { text: { content: `📅 时间：${summary.startTime} - ${summary.endTime}` } }
      ]
    }
  });

  // 添加文件变更
  if (summary.filesModified.length > 0) {
    blocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ text: { content: '📝 文件变更' } }]
      }
    });

    for (const file of summary.filesModified) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [
            { text: { content: file.path, code: true } },
            { text: { content: `: ${file.changes}` } }
          ]
        }
      });
    }
  }

  // ... 其他内容格式化

  return blocks;
}
```

---

## 📊 数据统计

总结保存后，可以在 Notion 中进行数据分析：

### 可分析的维度
- 每周/每月完成的任务数量
- 不同类型任务的分布
- 平均耗时统计
- 最常修改的文件/模块
- 技术栈使用频率

### Notion 视图建议
- **时间线视图**：按日期查看工作历史
- **看板视图**：按类型分类查看
- **表格视图**：详细数据分析
- **日历视图**：月度工作概览

---

## 🎯 最佳实践

### 1. 定期总结
- 每完成一个功能就总结一次
- 每天结束前做一次总结
- 重要变更立即记录

### 2. 详细描述
- 说明"为什么"而不仅是"做了什么"
- 记录重要的技术决策
- 标注遗留问题

### 3. 分类管理
- 使用合适的类型标签
- 添加项目关联
- 使用标签分类

### 4. 团队协作
- 分享重要总结给团队
- 使用统一的格式
- 添加必要的上下文

---

## 🔗 相关 Skills

- `batch-notion-analyzer`：批量分析 Notion 页面
- `docs-organizer`：智能文档整理

---

## 🛠️ 故障排除

### 问题 1：无法保存到 Notion
**原因**：数据库 ID 未配置或无权限
**解决**：检查 `.env` 中的 `WORK_LOG_DATABASE_ID` 配置

### 问题 2：总结内容不完整
**原因**：会话历史太长或太复杂
**解决**：分阶段总结，或手动补充关键信息

### 问题 3：格式显示异常
**原因**：Notion blocks 格式错误
**解决**：检查 blocks 结构是否符合 Notion API 规范

---

## 📝 示例输出

```markdown
# 实现 Claude Work Summarizer Skill

## 📅 时间
- 开始时间：2025-01-15 14:30
- 结束时间：2025-01-15 16:15
- 总耗时：1 小时 45 分钟

## 🎯 任务目标
创建一个新的 skill，用于总结 Claude Code 会话中的工作内容并保存到 Notion

## ✅ 完成内容

### 新增功能
- 创建 claude-work-summarizer skill
- 实现会话历史分析功能
- 实现 Notion 自动保存功能

### 文件变更
- 新建：`.claude/skills/claude-work-summarizer/SKILL.md`
  - 内容：完整的 skill 说明文档
  - 包含：使用方法、配置说明、技术实现

## 💡 技术决策

### 架构设计
- 采用模块化设计，分离会话分析和 Notion 保存逻辑
- 使用模板化输出，保证总结格式一致性

### 实现细节
- 通过分析工具调用历史来追踪文件变更
- 使用时间戳记录会话持续时间
- 支持多种总结类型分类

## 📝 文件变更清单
- ✅ 新建：`.claude/skills/claude-work-summarizer/SKILL.md`

## 📌 待办事项
- [ ] 创建 Notion "工作日志" 数据库
- [ ] 配置 WORK_LOG_DATABASE_ID 环境变量
- [ ] 实现具体的总结脚本
- [ ] 测试保存功能

## 💭 后续建议
- 可以添加更多统计维度（如代码行数、测试覆盖率等）
- 考虑添加 git commit 信息关联
- 支持导出为 markdown 文件
```

---

## 🚀 快速开始

### 第一步：创建 Notion 数据库

1. 在 Notion 中创建新数据库
2. 命名为"Claude Code 工作日志"
3. 添加必需字段（标题、日期、类型、状态）
4. 复制数据库 ID

### 第二步：配置环境变量

```bash
# 编辑 .env 文件
echo "WORK_LOG_DATABASE_ID=your_database_id" >> .env
```

### 第三步：使用 Skill

在 Claude Code 中直接说：
```
总结今天的工作
```

完成！✅
