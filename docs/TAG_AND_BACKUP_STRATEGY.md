---
version: 1.0.0
created: 2026-01-26
updated: 2026-01-26
changelog:
  - 1.0.0: 初始版本 - Tag 系统和备份策略
---

# Tag 系统 + 自动备份策略

## 🚨 核心问题：N8N 免费版 History 只保留 1 天

```
N8N Starter (免费版):  ❌ Workflow History 只保留 1 天
N8N Pro (付费版):      ✅ Unlimited History
```

**影响**：
- 周五改的 workflow，周一就看不到历史了
- 无法追溯上周的修改
- 无法可靠回滚

**解决方案**：**必须依赖 Git 自动备份**

---

## ✅ 解决方案 1：自动 Git 备份

### 自动备份配置

**每天凌晨 3 点自动备份并推送到 GitHub**：

```bash
# 1. 添加 cron job
crontab -e

# 2. 添加以下行
0 3 * * * bash /home/xx/dev/cecelia-workflows/scripts/backup-to-git.sh --auto >> /tmp/n8n-backup.log 2>&1
```

### 手动备份

```bash
# 交互式备份（会询问是否提交）
cd /home/xx/dev/cecelia-workflows
bash scripts/backup-to-git.sh

# 自动备份（直接提交并推送）
bash scripts/backup-to-git.sh --auto
```

### 查看备份日志

```bash
tail -f /tmp/n8n-backup.log
```

### 优势

| 功能 | N8N History (1天) | Git 备份 (永久) |
|------|------------------|----------------|
| 保留时间 | ❌ 1 天 | ✅ 永久 |
| 查看历史版本 | ✅ UI 方便 | ✅ Git log |
| 回滚 | ✅ 点击恢复 | ✅ Git checkout |
| 灾难恢复 | ❌ 服务器挂了就没了 | ✅ GitHub 有备份 |
| 团队协作 | ❌ 单机 | ✅ 多人可见 |

**最佳实践**：
- **日常查看**：用 N8N 内置 History（最近 1 天的修改）
- **长期追溯**：用 Git log（永久保留）
- **灾难恢复**：从 GitHub clone

---

## ✅ 解决方案 2：Tag + Folder 配合使用

### 架构设计

```
Folder（业务分类，4 个） + Tag（灵活标签，多个）

Folder:
  • Cecelia      - Cecelia 自动化相关
  • 自媒体        - 社交媒体运营
  • 基础工具      - VPS 维护和通用工具
  • Archive      - 旧版本归档

Tag（可多选，灵活组合）:
  • 状态: production, testing, deprecated
  • 平台: xiaohongshu, douyin, weibo, wechat, zhihu, kuaishou
  • 功能: scraping, publishing, scheduling, notification, health-check
  • 版本: v1, v2, v3
```

### Tag 使用规则

#### 1️⃣ 状态标签（必选）

| Tag | 含义 | N8N 状态 | 使用场景 |
|-----|------|----------|---------|
| `production` | 生产环境运行中 | 🟢 Active | 当前正式版本 |
| `testing` | 测试中 | ⚪ Inactive | 开发测试版本 |
| `deprecated` | 已废弃 | ⚪ Inactive | 不再使用，保留备查 |
| `archived` | 已归档 | ⚪ Inactive | 移到 Archive 文件夹 |

#### 2️⃣ 平台标签（可选，多选）

用于数据采集和发布类 workflow：

```
xiaohongshu   - 小红书
douyin        - 抖音
weibo         - 微博
wechat        - 微信公众号
zhihu         - 知乎
kuaishou      - 快手
toutiao       - 今日头条
```

#### 3️⃣ 功能标签（可选，多选）

```
scraping      - 数据爬取
publishing    - 内容发布
scheduling    - 任务调度
notification  - 通知提醒
health-check  - 健康检查
backup        - 备份
```

#### 4️⃣ 版本标签（可选）

```
v1, v2, v3    - 主版本号标识
```

### 实际示例

#### Workflow: `[Unit] 小红书数据爬取 v1.0 (20260126)`

**Folder**: `自媒体`

**Tags**:
- `production` （状态：生产环境）
- `xiaohongshu` （平台：小红书）
- `scraping` （功能：数据爬取）
- `v1` （版本：v1）

**使用场景**：
```
• 想找所有生产环境的 workflow → 过滤 tag: production
• 想找所有小红书相关的 workflow → 过滤 tag: xiaohongshu
• 想找所有数据爬取类的 workflow → 过滤 tag: scraping
• 想对比 v1 和 v2 版本 → 过滤 tag: v1 或 v2
```

#### Workflow: `[Flow] 数据采集调度器 v2.0 (20260126)`

**Folder**: `自媒体`

**Tags**:
- `production`
- `scheduling`
- `xiaohongshu` + `douyin` + `weibo` （支持多平台）
- `v2`

#### Workflow: `[Unit] 健康检查 v1.0 (20260126)`

**Folder**: `基础工具`

**Tags**:
- `production`
- `health-check`
- `v1`

---

## 📋 命名和组织总结

### 完整结构

```
命名格式：
  [Type] FunctionName vX.Y (YYYYMMDD)

Folder 分类：
  • Cecelia
  • 自媒体
  • 基础工具
  • Archive

Tag 灵活标注：
  • 状态: production / testing / deprecated / archived
  • 平台: xiaohongshu / douyin / weibo / ...
  • 功能: scraping / publishing / scheduling / ...
  • 版本: v1 / v2 / v3
```

### 示例对比

| 元素 | 用途 | 示例 |
|------|------|------|
| **名字** | 标识和版本 | `[Unit] 小红书数据爬取 v1.0 (20260126)` |
| **Folder** | 业务分类 | `自媒体` |
| **Tag** | 灵活筛选 | `production, xiaohongshu, scraping, v1` |
| **Active 开关** | 运行状态 | 🟢 绿色 = 运行中 |

---

## 🔄 版本迭代流程（带 Tag）

### 场景：升级小红书爬虫从 v1.0 到 v1.1

```bash
# 1. 复制当前版本
   在 N8N UI 中复制:
   [Unit] 小红书数据爬取 v1.0 (20260126)

   新名字:
   [Unit] 小红书数据爬取 v1.1 (20260126)

# 2. 修改新版本的 Tags
   v1.0 (旧版本):
     Tags: deprecated, xiaohongshu, scraping, v1
     Active: ⚪ OFF

   v1.1 (新版本):
     Tags: testing, xiaohongshu, scraping, v1
     Active: ⚪ OFF

# 3. 测试 v1.1
   手动触发测试...

# 4. 测试通过，上线
   v1.1:
     Tags: production, xiaohongshu, scraping, v1
     Active: 🟢 ON

# 5. 归档 v1.0
   移动到 Archive 文件夹
   Tags: archived, xiaohongshu, scraping, v1
```

---

## 🛠️ 实施步骤

### 1. 设置自动备份

```bash
# 添加 cron job（每天凌晨 3 点）
crontab -e

# 添加这一行
0 3 * * * bash /home/xx/dev/cecelia-workflows/scripts/backup-to-git.sh --auto >> /tmp/n8n-backup.log 2>&1

# 验证
crontab -l | grep backup
```

### 2. 为现有 Workflows 添加 Tags

**方式 1：手动在 N8N UI 添加**
```
1. 打开 Workflow
2. 点击 Settings
3. 在 Tags 字段添加标签（逗号分隔）
4. 保存
```

**方式 2：批量脚本添加**（如果需要可以开发）

### 3. 定期手动备份

重要修改后立即备份：

```bash
cd /home/xx/dev/cecelia-workflows
bash scripts/backup-to-git.sh
```

---

## 📊 对比总结

| 方案 | 优势 | 劣势 | 适用场景 |
|------|------|------|---------|
| **N8N History** | UI 方便，快速查看 | 只保留 1 天 | 日常小修改的快速回滚 |
| **Git 备份** | 永久保留，支持团队协作 | 需要命令行 | 长期版本追溯，灾难恢复 |
| **Folder** | 清晰的业务分类 | 只能单选，层级固定 | 主要业务线分类 |
| **Tag** | 灵活，可多选，可筛选 | 需要手动维护 | 多维度筛选和标注 |

---

## ✅ 最终推荐方案

### 日常使用

```
1. 修改 Workflow
   → 在 N8N UI 中编辑
   → 添加/更新 Tags（状态、平台、功能）
   → 保存

2. 查看最近修改
   → N8N History（最近 1 天）

3. 测试新版本
   → 复制 → 改名 v1.1 → 改 Tags 为 testing → 测试

4. 上线新版本
   → 激活 v1.1 → Tags 改为 production
   → 停用 v1.0 → Tags 改为 deprecated
   → 移 v1.0 到 Archive 文件夹 → Tags 改为 archived

5. 重要修改后
   → bash scripts/backup-to-git.sh （手动备份）
```

### 自动保险

```
• 每天凌晨 3 点：cron 自动备份到 Git + 推送 GitHub
• 灾难恢复：从 GitHub clone 恢复所有 workflows
```

---

## 🎯 快速筛选示例

**在 N8N UI 中使用 Tag 筛选**：

| 想找什么 | 筛选方式 |
|---------|---------|
| 所有生产环境的 | Tag: `production` |
| 所有测试中的 | Tag: `testing` |
| 所有小红书相关 | Tag: `xiaohongshu` |
| 所有数据爬取类 | Tag: `scraping` |
| 小红书的爬取类生产环境 | Tags: `production` + `xiaohongshu` + `scraping` |
| 所有 v2 版本 | Tag: `v2` |

**在 Git 中查看历史**：

```bash
# 查看最近 10 次备份
git log --oneline -10 n8n/workflows/

# 查看某个文件的修改历史
git log --follow n8n/workflows/media/unit-小红书数据爬取.json

# 对比两个版本的差异
git diff HEAD~5 HEAD -- n8n/workflows/

# 恢复到某个历史版本
git checkout <commit-hash> -- n8n/workflows/xxx.json
bash scripts/import-to-n8n.sh
```
