---
version: 1.0.0
created: 2026-01-26
updated: 2026-01-26
changelog:
  - 1.0.0: 初始版本 - 快速参考指南
---

# N8N Workflows 快速参考

## 📁 Folder 结构

| Folder | 用途 | Workflow 数量 |
|--------|------|--------------|
| **Cecelia** | Cecelia 自动化系统 | 5 |
| **自媒体** | 社交媒体运营 | 11 |
| **基础工具** | VPS 维护和通用工具 | 8 |
| **Archive** | 旧版本归档 | 0 |

---

## 🏷️ Tag 快速参考

### 状态标签（必选一个）

| Tag | 含义 | Active |
|-----|------|--------|
| `production` | 生产环境运行中 | 🟢 ON |
| `testing` | 测试中 | ⚪ OFF |
| `deprecated` | 已废弃但保留 | ⚪ OFF |
| `archived` | 归档到 Archive 文件夹 | ⚪ OFF |

### 平台标签（可多选）

```
xiaohongshu   douyin      weibo       wechat
zhihu         kuaishou    toutiao
```

### 功能标签（可多选）

```
scraping      publishing   scheduling
notification  health-check backup
```

### 版本标签（可选）

```
v1   v2   v3
```

---

## 📝 命名格式

```
[Type] FunctionName vX.Y (YYYYMMDD)

Type:
  • [Flow]  - 编排型 workflow（调度多个 Unit）
  • [Unit]  - 原子型 workflow（单一功能）

示例:
  ✅ [Flow] 数据采集调度器 v1.2 (20260126)
  ✅ [Unit] 小红书数据爬取 v1.0 (20260126)
```

---

## 🔄 常用操作

### 1. 查看 Workflow 状态

```
N8N UI → Workflows
  • 🟢 绿色开关 = Active（运行中）
  • ⚪ 灰色开关 = Inactive（已停用）
```

### 2. 查看历史版本

```
打开 Workflow 编辑页面
  → 右上角 "⏱️ History" 按钮
  → 查看最近 1 天的自动保存版本
  → 可恢复任意版本
```

### 3. 添加 Tags

```
打开 Workflow → Settings → Tags 字段
  → 输入标签（逗号分隔）
  → 示例: production, xiaohongshu, scraping, v1
  → 保存
```

### 4. 手动备份到 Git

```bash
cd /home/xx/dev/cecelia-workflows
bash scripts/backup-to-git.sh
```

### 5. 查看备份历史

```bash
cd /home/xx/dev/cecelia-workflows
git log --oneline -10 n8n/workflows/
```

---

## 🚀 版本升级流程

### 场景：从 v1.0 升级到 v1.1

```
1️⃣ 复制当前版本
   [Unit] 小红书数据爬取 v1.0 (20260126)
   复制为 →
   [Unit] 小红书数据爬取 v1.1 (20260126)

2️⃣ 修改新版本
   v1.1: Active ⚪ OFF, Tags: testing

3️⃣ 测试
   手动触发 v1.1 测试

4️⃣ 上线
   v1.1: Active 🟢 ON, Tags: production
   v1.0: Active ⚪ OFF, Tags: deprecated

5️⃣ 归档旧版本（1 个月后）
   v1.0 移到 Archive 文件夹
   Tags 改为: archived
```

---

## 🔍 快速筛选

**在 N8N UI 中使用 Tag 筛选**：

| 需求 | 筛选方式 |
|------|---------|
| 所有生产环境 | Tag: `production` |
| 所有测试中的 | Tag: `testing` |
| 所有小红书相关 | Tag: `xiaohongshu` |
| 小红书 + 爬取 + 生产 | Tags: `production` `xiaohongshu` `scraping` |

---

## ⚠️ 重要提醒

### N8N History 限制

```
免费版: ❌ 只保留 1 天的历史版本
付费版: ✅ Unlimited

→ 必须依赖 Git 自动备份！
```

### 自动备份

```bash
# 查看 cron job
crontab -l | grep backup

# 应该看到（每天凌晨 3 点）:
0 3 * * * bash /home/xx/dev/cecelia-workflows/scripts/backup-to-git.sh --auto >> /tmp/n8n-backup.log 2>&1

# 查看备份日志
tail -f /tmp/n8n-backup.log
```

---

## 📊 当前 Workflows 统计

| Folder | Flow | Unit | Total | Active |
|--------|------|------|-------|--------|
| Cecelia | 2 | 3 | 5 | 5 🟢 |
| 自媒体 | 3 | 8 | 11 | 11 🟢 |
| 基础工具 | 1 | 7 | 8 | 8 🟢 |
| **Total** | **6** | **18** | **24** | **24** 🟢 |

---

## 🛠️ 常用命令

```bash
# 导出 workflows
bash scripts/export-from-n8n.sh

# 手动备份
bash scripts/backup-to-git.sh

# 自动备份（无交互）
bash scripts/backup-to-git.sh --auto

# 查看 Git 历史
git log --oneline n8n/workflows/

# 查看备份日志
tail -f /tmp/n8n-backup.log

# 查看 N8N 数据库
docker run --rm -v n8n-self-hosted_n8n_data:/data alpine:latest sh -c "
  apk add sqlite > /dev/null 2>&1
  sqlite3 /data/database.sqlite 'SELECT name, active FROM workflow_entity;'
"
```

---

## 📞 快速访问

| 服务 | URL |
|------|-----|
| N8N UI | http://localhost:5678 |
| GitHub Repo | https://github.com/yourusername/cecelia-workflows |
| 文档目录 | /home/xx/dev/cecelia-workflows/docs/ |

---

## 🎯 最佳实践

✅ **DO**:
- 每次重要修改后手动备份一次
- 新版本先设为 `testing` 测试通过再改 `production`
- 旧版本移到 Archive 前至少保留 1 个月
- 用 Tag 灵活标注，方便筛选

❌ **DON'T**:
- 不要直接修改生产版本（先复制）
- 不要删除 workflows（移到 Archive）
- 不要依赖 N8N History 做长期版本管理（只有 1 天）
- 不要忘记添加 Tags（否则无法筛选）
