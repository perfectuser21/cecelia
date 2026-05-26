# iOS → N8N → Notion 内容收藏工作流 设计文档

**日期**：2026-05-18  
**状态**：已批准

---

## 1. 目标

从 iOS 上浏览小红书、抖音、得到等平台时，一键把好内容（含 AI 摘要）存入 Notion `Knowledge_Reference` 数据库，无需手动填字段。

---

## 2. 整体架构

```
用户在 App 内复制文字
  → 触发 iOS 快捷指令（Share Sheet 或桌面图标）
    → POST {url, text, note} 到 N8N Webhook
      → 平台/内容类型自动识别
      → Claude AI 生成标题 + 摘要
        → 写入 Notion Knowledge_Reference 页面
          → 返回成功通知给 iOS
```

---

## 3. 组件详情

### 3.1 iOS 快捷指令

**触发方式**：Share Sheet（从任意 App 分享）或桌面图标（独立触发）

**步骤**：
1. 获取 Share Sheet 传入的 URL（若从桌面触发则手动输入）
2. 读取剪贴板内容（用户提前复制的正文/文案）
3. 弹可选输入框：「一句话备注（直接回车跳过）」
4. POST 到 N8N Webhook：
   ```json
   {
     "url": "https://...",
     "text": "用户复制的原文（可为空）",
     "note": "用户备注（可为空）"
   }
   ```
5. 显示返回结果：「✅ 已保存到 Notion」或错误信息

### 3.2 N8N Workflow

**节点顺序**：

| # | 节点 | 说明 |
|---|------|------|
| 1 | Webhook Trigger | 接收 iOS POST，路径 `/clip-to-notion` |
| 2 | Code (平台检测) | 从 URL 解析平台名 + 内容类型 |
| 3 | AI (Claude Summarize) | 生成标题 + 摘要（text 为空时跳过） |
| 4 | Notion Create Page | 写入 Knowledge_Reference 数据库 |
| 5 | Respond to Webhook | 返回 `{"success": true, "title": "..."}` |

**平台识别规则**：

| URL 特征 | 平台 | 内容类型 |
|---------|------|---------|
| `dedao.cn` | 得到 | 软文 |
| `xiaohongshu.com` / `xhslink.com` | 小红书 | 图文 |
| `douyin.com` / `v.douyin.com` | 抖音 | 短视频 |
| `mp.weixin.qq.com` | 公众号 | 软文 |
| `zhihu.com` | 知乎 | 软文 |
| `toutiao.com` | 今日头条 | 图文 |
| `weibo.com` / `weibo.cn` | 微博 | 图文 |
| 其他 | （空） | 图文 |

**AI Prompt 策略**（按平台分支）：
- **得到**：「提取核心论点，列出 3 条关键 takeaway，生成一句话标题」
- **小红书**：「提炼帖子标题和 3 个关键点」
- **抖音**：「根据文案摘要主题和核心信息，生成标题」
- **通用**：「总结主要观点，生成标题」
- **text 为空**：跳过 AI，标题从 URL 域名生成占位符

**AI 使用 Claude API（Anthropic）**，N8N 内 HTTP Request 节点调用。

### 3.3 Notion 页面字段映射

| Notion 字段 | 来源 | 示例值 |
|------------|------|-------|
| 标题 (title) | AI 生成 | 「得到：认知升级的三个关键时刻」 |
| 链接 (url) | iOS 传入 | `https://dedao.cn/...` |
| 平台 (select) | 自动识别 | 得到 |
| 内容类型 (select) | 自动识别 | 软文 |
| 日期 (date) | 当前时间 | 2026-05-18 |
| 状态 (status) | 固定 | 未使用 |

**页面正文结构**：
```
## 原文
{用户复制的 text}

## AI 摘要
{Claude 生成的摘要}

## 备注
{用户的 note，若有}
```

---

## 4. 数据流与错误处理

- **text 为空**：跳过 AI，标题填「[平台] 待整理 YYYY-MM-DD」，仍保存链接
- **URL 识别失败**：平台留空，继续保存
- **Notion 写入失败**：N8N 返回 `{"success": false, "error": "..."}`，iOS 显示红色提示
- **Webhook 超时**（iOS 等待 > 30s）：N8N 先存 Notion，再返回；iOS 端超时后提示「已提交，请稍等」

---

## 5. Notion 数据库

- **数据库 ID**：`770c40c2-ba63-83ea-86d0-01eba832c218`
- **数据库名**：Knowledge_Reference
- **现有平台选项**：抖音、今日头条、Dan Koe、公众号、知乎、微博、小红书、得到

---

## 6. 实现步骤

1. 在 N8N Cloud 创建 workflow（Webhook → Code → AI → Notion → Respond）
2. 配置 N8N 中的 Notion credential 和 Claude API credential
3. 在 iOS 快捷指令 App 创建 Shortcut，配置 webhook URL
4. 端到端测试：得到 / 小红书 / 抖音 各一条
