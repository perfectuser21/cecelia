# Alex Thinking

Alex 的思考空间。反思、探讨、决策记录。

## 结构

```
alex/thinking/
├── inbox/          # 随时捕获的想法、灵感、未成型的思考
├── exploring/      # 正在探讨中的话题（对话式，可能跨多次会话）
├── decisions/      # 已做出的决策和理由
└── to-knowledge/   # 准备写入 Knowledge DB 的成熟内容
```

## 工作流

```
想法 → inbox/（随手记）
  → exploring/（深入探讨）
    → decisions/（形成决策）
    → to-knowledge/（精炼后写入 Alex Operational Knowledge DB）
      → knowledge 表 + Notion 同步
```

## 命名规范

- `YYYY-MM-DD-主题.md` — 日期 + 简短主题
- 例：`2026-03-05-cecelia-thinking-system.md`

## 写入 Knowledge DB

当一篇思考成熟后，告诉 Claude "把这个存到 Knowledge DB"，会：
1. 提取核心内容，结构化
2. 写入 PostgreSQL `knowledge` 表（type = 'insight'）
3. 自动同步到 Notion Knowledge_Operational 数据库
