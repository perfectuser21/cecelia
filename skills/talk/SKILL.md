# Talk Skill

> 对话记录模式 - 把想法倒进大脑，AI 自动拆解归档

---

## 核心约束

**Talk Mode = Plan Mode（只思考，不动手）**

| 允许 | 禁止 |
|------|------|
| ✅ 讨论、思考 | ❌ 修改代码 |
| ✅ 搜索数据库 | ❌ 执行命令 |
| ✅ 记录内容 | ❌ 创建/删除文件 |
| ✅ 读取文件 | ❌ 运行脚本 |

**如果用户在 Talk Mode 中要求改代码，AI 应该说：**
> "现在是 Talk Mode，我先记下来。要执行的话，请先 /done 结束，然后 /dev 开始。"

---

## 触发方式

```
/talk                    # 进入 Talk Mode
/talk 今天做了很多事...   # 快速记录
```

---

## 结束方式

| 方式 | 说明 |
|------|------|
| `/done` | 明确结束，触发拆解 |
| `结束`、`好了`、`就这样` | 口语结束 |
| `/dev`、`/commit` 等 | 切换到其他模式，自动结束 Talk |
| 超过 5 分钟无输入 | 提醒是否结束 |

---

## 工作流程

```
1. 进入 Talk Mode
   └── AI: "Talk Mode 已开启，随便说，说完输入 /done"

2. 用户自由输入（可以是）：
   ├── 日记、复盘
   ├── 想法、灵感
   ├── 决策、规则
   ├── 任务、待办
   ├── 学到的东西
   └── 任何内容...

3. 用户说 /done 或 "结束"
   └── AI 分析对话内容

4. **矛盾检测（关键步骤）**
   AI 主动搜索数据库，检查新内容是否与已有内容矛盾：

   ```
   对每条识别到的内容：
   ├── Rules → 搜索 rules 表，找相似 topic
   ├── Tasks → 搜索 tasks 表，找重复任务
   ├── Resources → 搜索 resources 表，找相同资源
   └── Notes → 搜索 notes 表，找相似知识点

   如果发现矛盾：
   ┌─────────────────────────────────────┐
   │ ⚠️ 发现潜在矛盾：                    │
   │                                     │
   │ 你说：服务器全放香港                  │
   │ 已有：美国研发、香港生产（rules #3）  │
   │                                     │
   │ [覆盖旧的 / 保留旧的 / 都保留]        │
   └─────────────────────────────────────┘
   ```

5. AI 展示拆解结果（含矛盾处理）：
   ┌─────────────────────────────────────┐
   │ 本次对话识别到：                      │
   │                                     │
   │ 📋 Tasks (2):                       │
   │   - [ ] 部署香港 N8N [Area: Cecelia] │
   │   - [ ] 更新文档 [Area: Meta]        │
   │                                     │
   │ 📝 Logs (1):                        │
   │   - 今天搞了一天服务器 [daily]       │
   │     mood: 累, energy: 3            │
   │                                     │
   │ 📌 Rules (1):                       │
   │   - 改网络配置前要准备回滚           │
   │     [Area: AI Systems]              │
   │                                     │
   │ 确认保存？ [Y/n/修改]                │
   └─────────────────────────────────────┘

5. 用户确认后存入数据库
```

---

## 拆解规则

### 识别为 Tasks（要做）
- 关键词：要做、待办、计划、打算、需要、应该去、明天、下周
- 例："明天要把 N8N 部署一下" → tasks

### 识别为 Logs（发生了什么）
- 关键词：今天、昨天、刚才、发生、做了、完成了、遇到
- 子类型：
  - daily: 日常记录
  - event: 特定事件
  - incident: 问题/故障
  - learning: 学到的东西
  - reflection: 复盘/反思
- 例："今天搞了一天服务器，累死了" → logs (daily)

### 识别为 Notes（知识/想法）
- 关键词：想法、灵感、发现、原来、知识点、记一下
- 子类型：
  - idea: 想法/灵感
  - knowledge: 知识点
  - reading: 阅读笔记
- 例："我发现这个方法很好用" → notes (knowledge)

### 识别为 Rules（决策/原则）
- 关键词：以后、决定、规定、必须、不能、原则、架构
- 例："以后改网络配置前都要准备回滚" → rules

### 识别为 Resources（资产）
- 关键词：服务器、配置、工具、账号、密码、IP
- 例："香港服务器 IP 是 43.154.85.217" → resources

---

## Area 自动识别

根据内容关键词匹配 Area：

| 关键词 | Area |
|--------|------|
| AI、自动化、Claude、LLM | AI Systems & Automation |
| 学习、读书、课程 | Learning |
| 社媒、抖音、小红书、发布 | Social Media |
| 公司、业务、客户、ZenithJoy | ZenithJoy |
| 股票、投资、理财 | Stock Investment |
| 爱好、创作、音乐、画 | Hobbies & Creative |
| 生活、健康、运动、睡眠 | Life Management |
| 方法论、系统、流程、规则 | Meta |
| Cecelia、管家、Brain | Cecelia |

如果无法识别，询问用户。

---

## 矛盾检测机制

### 检测时机

在用户说 `/done` 后、展示结果前，AI **必须**主动搜索数据库。

### 检测逻辑

```
对每条准备保存的内容：

1. Rules（决策）检测：
   SELECT * FROM rules
   WHERE status = 'active'
     AND (topic ILIKE '%关键词%' OR decision ILIKE '%关键词%')

   匹配条件：topic 相似 或 语义相反

2. Tasks（任务）检测：
   SELECT * FROM tasks
   WHERE status NOT IN ('completed', 'cancelled')
     AND title ILIKE '%关键词%'

   匹配条件：相同任务已存在（避免重复）

3. Resources（资源）检测：
   SELECT * FROM resources
   WHERE name ILIKE '%关键词%'

   匹配条件：相同资源，配置不同（可能是更新）

4. Notes（笔记）检测：
   SELECT * FROM notes
   WHERE title ILIKE '%关键词%'
      OR content ILIKE '%关键词%'

   匹配条件：相似知识点（避免重复，或可合并）
```

### 矛盾类型

| 类型 | 示例 | 处理方式 |
|------|------|----------|
| **直接冲突** | 旧：用A方案；新：用B方案 | 必须选择一个 |
| **重复** | 旧：部署N8N；新：部署N8N | 提示已存在 |
| **更新** | 旧：IP是x；新：IP是y | 询问是否更新 |
| **补充** | 旧：用A方案；新：A方案要注意xx | 可以都保留 |

### 处理选项

```
发现矛盾时，提供选项：

1. 覆盖旧的 → 旧记录标记 superseded，新记录生效
2. 保留旧的 → 不保存新记录
3. 都保留   → 两条并存（适合补充类）
4. 合并     → 把新内容合并到旧记录
```

### 无矛盾时

直接展示拆解结果，不需要额外提示。

---

## 数据库操作

### 数据库位置

```
数据库: cecelia
连接方式: docker exec -i cecelia-postgres psql -U cecelia -d cecelia

Schema 文档: /home/xx/dev/perfect21-platform/docs/database/SCHEMA.md
```

### 5 个 Types 表（已创建 ✅）

| 表 | 用途 | 关键字段 |
|----|------|----------|
| `tasks` | 要做的事 | area_id, title, status, priority |
| `logs` | 发生的事 | area_id, type, title, content, date, metadata |
| `notes` | 知识/想法 | area_id, type, title, content, tags |
| `rules` | 决策/原则 | area_id, category, topic, decision, reason, status |
| `resources` | 资产/配置 | area_id, category, name, config, tags |

### Areas 表（9 个领域）

```sql
SELECT id, name FROM areas ORDER BY sort_order;

-- AI Systems & Automation | Learning | Social Media | ZenithJoy
-- Stock Investment | Hobbies & Creative | Life Management | Meta | Cecelia
```

### 插入示例

```sql
-- 插入一条 rule
INSERT INTO rules (area_id, category, topic, decision, reason, tags)
VALUES (
    (SELECT id FROM areas WHERE name = 'Meta'),
    'workflow',
    '主题',
    '决策内容',
    '原因',
    ARRAY['tag1', 'tag2']
);

-- 插入一条 log
INSERT INTO logs (area_id, type, title, content, date, metadata)
VALUES (
    (SELECT id FROM areas WHERE name = 'Cecelia'),
    'daily',
    '今日总结',
    '内容...',
    CURRENT_DATE,
    '{"mood": "好", "energy": 8}'::jsonb
);
```

### API 端点（可选，用于 Dashboard 集成）
```
POST /api/brain/talk/parse    - 解析对话内容
POST /api/brain/talk/save     - 保存拆解结果
```

---

## 使用示例

### 示例 1：日常复盘

```
用户: /talk
AI: Talk Mode 已开启，随便说，说完输入 /done

用户: 今天挺累的，搞了一天数据库 schema。
      学到一个教训：改表结构前一定要备份。
      明天要把香港 N8N 部署一下。
      对了，决定以后所有决策都存到 rules 表里。

用户: /done

AI: 识别到以下内容：

📝 Logs (1):
  - "今天挺累的，搞了一天数据库 schema"
    type: daily, area: Cecelia
    metadata: { mood: "累" }

💡 Notes (1):
  - "改表结构前一定要备份"
    type: learning, area: Meta

📋 Tasks (1):
  - "部署香港 N8N"
    area: Cecelia, priority: P1

📌 Rules (1):
  - "所有决策都存到 rules 表里"
    area: Meta, category: workflow

确认保存？ [Y/n/修改]

用户: y
AI: ✅ 已保存 4 条记录
```

### 示例 2：快速记录

```
用户: /talk 刚想到一个点子：可以用 NocoDB 做数据可视化

AI: 识别到：
💡 Notes (1):
  - "用 NocoDB 做数据可视化"
    type: idea, area: AI Systems & Automation

确认保存？ [Y/n]

用户: y
AI: ✅ 已保存
```

---

## 命令

| 命令 | 作用 |
|------|------|
| `/talk` | 进入 Talk Mode |
| `/talk <内容>` | 快速记录单条 |
| `/done` | 结束并拆解 |
| `结束` | 同 /done |
| `/cancel` | 取消本次对话 |

---

## 配置

```yaml
# ~/.claude/skills/talk/config.yaml (可选)
default_area: null          # 默认 Area，null 则自动识别
auto_save: false            # 是否跳过确认直接保存
mood_tracking: true         # 是否追踪情绪
energy_tracking: true       # 是否追踪精力
```
