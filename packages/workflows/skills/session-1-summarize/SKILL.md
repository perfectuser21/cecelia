---
name: session-1-summarize
description: 总结 Claude Code 会话（1 个功能）。自动提取执行摘要（阶段、做了什么、踩的坑、下一步）并保存到 Project Notes
---

# 会话执行摘要

总结当前 Claude Code 会话的工作内容，保存到 Notion XX_ProjectNotes。

---

## 触发方式

用户说：
- "总结一下"
- "记录一下"
- "保存这次的工作"

**Claude 需要做的**：
1. 回顾当前会话的所有对话
2. 按下面的格式整理内容
3. 调用脚本保存到 Notion
4. 返回链接给用户

---

## 自动获取

脚本会自动获取：
- **项目名**：从 git remote URL 提取 repository 名
- **今日 Commits**：自动附加到摘要末尾

---

## 保存位置

**数据库**：XX_ProjectNotes
**ID**：`1fb0ec1c-c75b-482b-be0c-ffd4fdb5fd4d`

---

## 输出格式

```markdown
## 当前阶段
[项目整体进度]

## 做了什么

### 1. [第一件事]
- 具体做了什么
- 为什么这样做
- 结果是什么

### 2. [第二件事]
- ...

## 踩的坑

### 1. [坑的名称]
- 问题：发生了什么
- 原因：为什么会这样
- 解法：怎么解决的
- 教训：下次怎么避免

## 启发

### 1. [启发标题]
- 这次经历说明：...
- 以后遇到类似情况：...

## 下一步
- 待办 1
- 待办 2

## 本次 Commits（自动生成）
- abc1234 feat: xxx
- def5678 fix: xxx
```

---

## 内容要求

### 1. 结构要细
- 每个大块拆成小节
- 每个小节有清晰标题
- 每个小节下有具体的点

### 2. 内容要够
- 不要一句话带过
- 每个点有足够细节
- 但不要啰嗦

### 3. 语言要简单
- 不用技术术语
- 用户能看懂

---

## 如何调用

```bash
node /home/xx/dev/notion-mcp-complete/save-session.mjs '{
  "phase": "当前阶段（xx%完成）",
  "sections": [
    {"type": "h2", "text": "做了什么"},
    {"type": "h3", "text": "1. 第一件事"},
    {"type": "bullet", "text": "具体内容"},

    {"type": "h2", "text": "踩的坑"},
    {"type": "h3", "text": "1. 坑名"},
    {"type": "bullet", "text": "问题：xxx"},
    {"type": "bullet", "text": "原因：xxx"},
    {"type": "bullet", "text": "解法：xxx"},
    {"type": "bullet", "text": "教训：xxx"},

    {"type": "h2", "text": "启发"},
    {"type": "h3", "text": "1. 启发标题"},
    {"type": "bullet", "text": "这次经历说明：xxx"},
    {"type": "bullet", "text": "以后遇到类似情况：xxx"},

    {"type": "h2", "text": "下一步"},
    {"type": "bullet", "text": "待办1"}
  ]
}'
```

项目名和 Commits 会自动获取，不需要手动传。
