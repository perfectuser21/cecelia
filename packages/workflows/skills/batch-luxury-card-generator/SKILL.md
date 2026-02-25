---
name: batch-luxury-card-generator
description: 批量处理 Notion 数据库中的页面，为每个页面生成高级玻璃效果卡片（2K 9:16），自动上传到 Notion 页面底部和飞书
---

# 📦 批量高级卡片生成器

## 🎯 功能说明

批量处理 Notion 数据库中的页面，为每个页面生成高级玻璃效果卡片（2K 9:16），并自动上传到 Notion 页面底部和飞书。

---

## 🏗️ 架构设计

```
查询 Notion 数据库页面
    ↓
分批处理（每批 3-5 个页面并行）
    ↓
每个页面执行:
  ├─ 读取页面内容
  ├─ 并行生成多张卡片图片
  ├─ 上传到 Notion 页面底部
  ├─ 发送飞书通知（交互式卡片）
  └─ 更新页面状态（可选）
    ↓
等待该批次所有页面完成
    ↓
启动下一批次
```

**并发策略**：
- **批次大小**：10 个页面同时处理（受 Claude Code 10 个 subagents 限制）
- **每个页面**：使用 1 个 subagent 进行 AI 内容提取
- **图片生成**：每个页面的多张图片可并行生成
- **批次间同步**：等待一批全部完成才启动下一批

**为什么是 10 个页面/批次？**
- 每个页面需要 1 个 subagent 用于 AI 分析提取内容
- Claude Code 限制最多同时运行 10 个 subagents
- 因此每批最多处理 10 个页面

---

## 📋 执行流程

### 步骤 1：查询待处理页面

```javascript
// 查询 Notion 数据库
const response = await notion.databases.query({
  database_id: NOTION_DATABASE_ID,
  filter: {
    // 可选：按状态筛选
    property: '状态',
    status: { equals: '待处理' }
  }
});

const pages = response.results;
console.log(`找到 ${pages.length} 个待处理页面`);
```

---

### 步骤 2：用户选择处理数量

询问用户：
- 选项 A：处理 2 个页面（测试）
- 选项 B：处理 5 个页面
- 选项 C：处理 10 个页面
- 选项 D：处理全部页面

---

### 步骤 3：分批并行处理

```javascript
// 分批处理
const batchSize = 10; // 每批 10 个页面并行（受 subagent 限制）
const batches = chunk(selectedPages, batchSize);

for (let i = 0; i < batches.length; i++) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`批次 ${i+1}/${batches.length}: 处理 ${batches[i].length} 个页面`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // 并行处理该批次的所有页面（最多 10 个）
  await Promise.all(batches[i].map((page, idx) =>
    processPage(page, i * batchSize + idx + 1, totalPages)
  ));

  console.log(`✅ 批次 ${i+1} 完成！\n`);
}
```

---

### 步骤 4：单个页面处理流程

```javascript
async function processPage(page, pageIndex, totalPages) {
  const pageId = page.id;
  const title = extractTitle(page);

  console.log(`📄 页面 ${pageIndex}/${totalPages}: ${title}`);

  // 1. 读取原始内容
  console.log('  ⏳ 读取页面内容...');
  const rawContent = await readPageBlocks(pageId);
  const notionUrl = getPageUrl(page);
  console.log('  ✅ 内容读取完成');

  // 2. AI 提取结构化内容（使用 subagent）
  console.log('  ⏳ AI 分析提取关键信息...');
  const extractedContent = await Task({
    subagent_type: 'general-purpose',
    description: 'Extract card content',
    prompt: `分析以下 Notion 页面内容，提取关键信息用于生成卡片：

页面标题：${title}

页面内容：
${rawContent}

请提取以下信息（严格按照 JSON 格式输出）：
{
  "paradox": "核心悖论（用1-2句话说明矛盾点）",
  "insight": "关键洞察（用1-2句话说明反直觉的真理）",
  "transformation": "转型弧线（从认知A到认知B的转变）",
  "steps": ["步骤1", "步骤2", "步骤3"]
}

要求：
- 提取最核心、最有冲击力的内容
- 步骤要具体可执行
- 输出纯 JSON，不要其他文字`
  });

  const content = JSON.parse(extractedContent);
  console.log('  ✅ AI 分析完成');

  // 3. 生成卡片图片
  console.log('  ⏳ 生成高级卡片...');
  const { hookPath, stepsPath } = await generateLuxuryCards(content, {
    pageTitle: title,
    cardTypes: ['hook', 'steps']
  });
  console.log('  ✅ 卡片生成完成');

  // 4. 上传和通知（并行执行）
  console.log('  ⏳ 上传到 Notion 和飞书...');
  const [notionResult, larkResult] = await Promise.all([
    uploadToNotion(pageId, [hookPath, stepsPath], title),
    sendToLark([hookPath, stepsPath], title, notionUrl)
  ]);

  if (notionResult.success) {
    console.log('  ✅ Notion 上传成功');
  } else {
    console.log('  ⚠️  Notion 上传失败');
  }

  if (larkResult.success) {
    console.log('  ✅ 飞书通知成功');
  } else {
    console.log('  ⚠️  飞书通知失败');
  }

  console.log(`✅ 页面 ${pageIndex} 完成！\n`);
}
```

---

## 📊 进度显示示例

### 处理 5 个页面的完整输出

```
🔍 查询 Notion 数据库...
✅ 找到 12 个页面

📋 页面列表：
  1. 三页表格起号流程
  2. 如何打造个人IP
  3. 短视频创作底层逻辑
  4. 内容创作的三大误区
  5. 建立长期主义内容体系
  ...

请选择处理数量：
  A. 处理 2 个（测试）
  B. 处理 5 个
  C. 处理 10 个
  D. 处理全部 12 个

用户选择：B

开始处理 5 个页面，预计耗时约 3 分钟...

━━━━━━━━━━━━━━━━━━━━━━━━━━━
批次 1/2: 处理 3 个页面
━━━━━━━━━━━━━━━━━━━━━━━━━━━

📄 页面 1/5: 三页表格起号流程
  ⏳ 读取页面内容...
  ✅ 内容读取完成
  ⏳ 生成高级卡片...
  ✅ 卡片生成完成
  ⏳ 上传到 Notion 和飞书...
  ✅ Notion 上传成功
  ✅ 飞书通知成功
  ✅ 页面 1 完成！

📄 页面 2/5: 如何打造个人IP
  ⏳ 读取页面内容...
  ✅ 内容读取完成
  ⏳ 生成高级卡片...
  ✅ 卡片生成完成
  ⏳ 上传到 Notion 和飞书...
  ✅ Notion 上传成功
  ✅ 飞书通知成功
  ✅ 页面 2 完成！

📄 页面 3/5: 短视频创作底层逻辑
  ⏳ 读取页面内容...
  ✅ 内容读取完成
  ⏳ 生成高级卡片...
  ✅ 卡片生成完成
  ⏳ 上传到 Notion 和飞书...
  ✅ Notion 上传成功
  ✅ 飞书通知成功
  ✅ 页面 3 完成！

✅ 批次 1 完成！（用时 1 分 30 秒）

━━━━━━━━━━━━━━━━━━━━━━━━━━━
批次 2/2: 处理 2 个页面
━━━━━━━━━━━━━━━━━━━━━━━━━━━

📄 页面 4/5: 内容创作的三大误区
  ⏳ 读取页面内容...
  ✅ 内容读取完成
  ⏳ 生成高级卡片...
  ✅ 卡片生成完成
  ⏳ 上传到 Notion 和飞书...
  ✅ Notion 上传成功
  ✅ 飞书通知成功
  ✅ 页面 4 完成！

📄 页面 5/5: 建立长期主义内容体系
  ⏳ 读取页面内容...
  ✅ 内容读取完成
  ⏳ 生成高级卡片...
  ✅ 卡片生成完成
  ⏳ 上传到 Notion 和飞书...
  ✅ Notion 上传成功
  ✅ 飞书通知成功
  ✅ 页面 5 完成！

✅ 批次 2 完成！（用时 1 分 15 秒）

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 全部完成！
━━━━━━━━━━━━━━━━━━━━━━━━━━━

处理统计：
  ✅ 成功：5 个页面
  ❌ 失败：0 个
  ⏱️  总耗时：2 分 45 秒
  📊 平均速度：33 秒/页面

🖼️  生成的卡片：
  - 总计 10 张图片（每页 2 张）
  - 存储位置：output/luxury-cards/
  - 72 小时后自动删除

✅ 所有卡片已上传到 Notion 并发送飞书通知！
```

---

## 🚀 性能优化

### 1. 并行生成优化

```javascript
// 单个页面的多张图片可并行生成
async function generateLuxuryCards(content, options) {
  const browser = await puppeteer.launch(...);

  // 并行生成 Hook 和 Steps 卡片
  const [hookPath, stepsPath] = await Promise.all([
    generateHookCard(browser, content, outputDir),
    generateStepsCard(browser, content, outputDir)
  ]);

  await browser.close();
  return { hookPath, stepsPath, outputDir };
}
```

### 2. 浏览器复用（批次级别）

```javascript
// 可选：整个批次共享一个浏览器实例
async function processBatch(pages, browser) {
  await Promise.all(pages.map(page =>
    processPageWithBrowser(page, browser)
  ));
}
```

### 3. 批次大小动态调整

```javascript
// 根据页面复杂度动态调整批次大小
const batchSize = pages.length > 20 ? 5 : 3;
```

---

## ⚙️ 配置参数

```yaml
Notion 配置:
  API_KEY: 从 .env 读取 NOTION_TOKEN
  DATABASE_ID: 从用户输入或 .env 读取

处理配置:
  批次大小: 3-5 个页面/批次
  图片格式: PNG
  图片尺寸: 1080 x 1920 px (2K 9:16)
  过期时间: 72 小时

服务器配置:
  静态服务器: http://146.190.52.84:9527
  输出目录: output/luxury-cards/
  命名方式: 按页面标题命名文件夹

飞书配置:
  WEBHOOK_URL: 从 .env 读取 LARK_WEBHOOK_URL
  卡片类型: 交互式卡片
```

---

## 🛡️ 错误处理

### 单个页面失败

```javascript
try {
  await processPage(page);
  successCount++;
} catch (error) {
  console.log(`  ❌ 失败: ${error.message}`);
  failedPages.push({ page, error });
  failCount++;
}
```

### 最终统计显示

```
处理统计：
  ✅ 成功：8 个页面
  ❌ 失败：2 个

失败页面列表：
  - 页面 3: "某个页面标题"
    原因：Puppeteer timeout
  - 页面 7: "另一个页面"
    原因：Notion API error
```

---

## 📈 时间估算

单个页面处理时间：
- 读取内容：~3 秒
- AI 提取分析：~10 秒（使用 subagent）
- 生成卡片：~11 秒（内部并行）
- 上传和通知：~5 秒（并行执行）
- **总计**：~29 秒/页面

批量处理时间：
- 10 个页面/批次（并行）：~29 秒/批次
- 10 个页面 = 1 批次：~29 秒
- 50 个页面 = 5 批次：~2.5 分钟
- 100 个页面 = 10 批次：~5 分钟

---

## 🎮 使用方式

### 方式 1：直接调用（推荐）

用户说：
```
批量生成卡片
```

或者：
```
处理 Notion 页面生成卡片
```

Claude Code 会：
1. 询问 Database ID（或从 .env 读取）
2. 查询页面列表
3. 询问处理数量
4. 分批并行处理
5. 实时显示进度

---

### 方式 2：指定数量

用户说：
```
生成 5 个页面的卡片
```

Claude Code 会直接处理前 5 个，跳过询问步骤。

---

### 方式 3：指定 Database ID

用户说：
```
从 abc123def456 数据库生成卡片
```

---

## 🎯 核心优势

1. **批量处理**：一次性处理多个页面
2. **并行加速**：3-5 个页面同时处理
3. **自动上传**：结果自动上传到 Notion 和飞书
4. **按名称命名**：文件夹按页面标题命名，方便查找
5. **进度可视**：实时显示处理进度
6. **错误容错**：单页失败不影响整体
7. **自动清理**：72 小时后自动删除图片

---

## 💡 使用建议

### 日常使用流程

**每天处理新增页面**：
```
用户: "批量生成卡片"
Claude:
  - 查询 → 找到 8 个页面
  - 询问 → 用户选择"处理全部"
  - 分 3 批处理（每批 3 个）
  - 约 2 分钟完成
  - 显示处理报告
```

**测试新功能**：
```
用户: "先生成 2 个页面的卡片看看"
Claude:
  - 直接处理前 2 个
  - 约 30 秒完成
  - 用户检查 Notion 和飞书结果
  - 满意后继续处理剩余页面
```

---

## 📦 依赖

### 环境变量（.env）
```bash
NOTION_TOKEN=your_notion_integration_token
NOTION_DATABASE_ID=your_database_id  # 可选，也可以运行时输入
LARK_WEBHOOK_URL=your_feishu_webhook_url  # 可选
```

### Node.js 模块
```javascript
import { generateLuxuryCards } from './generate-luxury-cards.mjs';
import { uploadCardsToPlatforms } from './upload-cards-to-platforms.mjs';
import { Client } from '@notionhq/client';
```

### 服务依赖
- **静态文件服务器**：必须在 9527 端口运行
- **PM2 自动清理**：可选，用于 72 小时后删除图片

---

## 🔄 执行原则

1. **严格显示进度**：每个步骤都要实时输出状态
2. **批次同步**：等待一批全部完成才启动下一批
3. **错误继续**：单页失败继续处理其他页面
4. **最终统计**：显示成功/失败数量、总耗时、平均速度
5. **详细日志**：记录失败页面和原因，便于排查
