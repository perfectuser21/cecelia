---
name: luxury-card-generator
description: 根据内容数据生成高级玻璃效果卡片图片（2K 9:16），支持 hook、paradox、insight、transformation、steps 等多种卡片类型
---

# 🎨 Luxury Card Generator

生成高级玻璃效果卡片图片（2K 9:16）

---

## 🎯 功能

根据内容数据生成指定类型的高级卡片图片。支持多种卡片类型，可灵活组合。

---

## 📦 输入格式

```javascript
{
  content: {
    paradox: "核心悖论文本",
    insight: "关键洞察文本",
    transformation: "转型弧线文本",
    steps: ["步骤1", "步骤2", "步骤3"]
  },
  options: {
    pageTitle: "页面标题",  // 用于命名文件夹
    cardTypes: ["hook", "steps"]  // 要生成的卡片类型
  }
}
```

---

## 🎴 卡片类型定义

### 1. `hook` - Hook 卡片

**用途**：展示核心悖论和关键洞察，吸引注意力

**内容要求**：
```javascript
content: {
  paradox: "核心悖论文本（必需）",
  insight: "关键洞察文本（必需）"
}
```

**视觉设计**：
- 尺寸：1080 x 1920 px (2K 9:16)
- 布局：上下分区
  - 上半部分：核心悖论（大标题 + 正文）
  - 光束分隔线
  - 下半部分：关键洞察（玻璃卡片效果）
- 配色：红金高级配色（#9C5740 + #B68C3A）
- 效果：玻璃拟态 + 渐变背景 + 发光文字

**文件名**：`01_hook.png`

---

### 2. `steps` - 步骤卡片

**用途**：展示转型弧线和可执行步骤

**内容要求**：
```javascript
content: {
  transformation: "转型弧线文本（必需）",
  steps: ["步骤1", "步骤2", "步骤3"]  // 必需，数组
}
```

**视觉设计**：
- 尺寸：1080 x 1920 px (2K 9:16)
- 布局：上下分区
  - 上部：转型弧线（箭头显示）
  - 光束分隔线
  - 下部：可执行步骤（圆形徽章 + 连接线）
- 配色：红金高级配色
- 效果：
  - 圆形渐变徽章（120px，发光效果）
  - 步骤连接线（渐变）
  - 玻璃质感背景

**文件名**：`02_steps.png`

---

### 3. `summary` - 总结卡片（将来可扩展）

**用途**：一句话核心总结 + 金句

**内容要求**：
```javascript
content: {
  summary: "核心总结（必需）",
  quote: "金句（可选）"
}
```

**视觉设计**：
- 尺寸：1080 x 1920 px
- 布局：居中大字
- 配色：红金高级配色
- 效果：简洁大气，适合分享

**文件名**：`03_summary.png`

---

### 4. `quote` - 引用卡片（将来可扩展）

**用途**：名人名言或权威引用

**内容要求**：
```javascript
content: {
  quote: "引用内容（必需）",
  author: "作者/出处（必需）"
}
```

**视觉设计**：
- 尺寸：1080 x 1920 px
- 布局：大引号 + 引用文字 + 作者
- 配色：红金高级配色
- 效果：引用符号突出，文字优雅

**文件名**：`04_quote.png`

---

## 🔧 使用方法

### 示例 1：生成默认的 2 张卡片（Hook + Steps）

```javascript
await generateLuxuryCards(content, {
  pageTitle: "三页表格起号流程",
  cardTypes: ["hook", "steps"]  // 默认值
});

// 输出：
// output/luxury-cards/三页表格起号流程/
//   ├── 01_hook.png
//   └── 02_steps.png
```

---

### 示例 2：只生成 Hook 卡片

```javascript
await generateLuxuryCards(content, {
  pageTitle: "核心洞察",
  cardTypes: ["hook"]
});

// 输出：
// output/luxury-cards/核心洞察/
//   └── 01_hook.png
```

---

### 示例 3：生成 4 张卡片（将来）

```javascript
await generateLuxuryCards(content, {
  pageTitle: "完整内容包",
  cardTypes: ["hook", "steps", "summary", "quote"]
});

// 输出：
// output/luxury-cards/完整内容包/
//   ├── 01_hook.png
//   ├── 02_steps.png
//   ├── 03_summary.png
//   └── 04_quote.png
```

---

## ⚡ 性能优化

### 并行生成

多张卡片会**并行生成**，提高效率：

```javascript
// 内部实现
const browser = await puppeteer.launch(...);

// 所有卡片同时生成
const results = await Promise.all([
  generateCard(browser, 'hook', content),
  generateCard(browser, 'steps', content),
  generateCard(browser, 'summary', content),
  generateCard(browser, 'quote', content)
]);

await browser.close();
```

**性能对比**：
- 串行生成 4 张：~32 秒
- 并行生成 4 张：~10 秒
- **节省 70% 时间**

---

## 📤 输出格式

```javascript
{
  images: [
    { type: 'hook', path: '/path/to/01_hook.png' },
    { type: 'steps', path: '/path/to/02_steps.png' }
  ],
  outputDir: '/path/to/output/luxury-cards/页面标题/'
}
```

---

## 🎨 视觉规范

### 统一设计元素

所有卡片类型共享：
- **尺寸**：1080 x 1920 px (2K 9:16)
- **配色方案**：
  - 背景渐变：#30384A → #1C2433
  - 主色调：#9C5740（红色）
  - 强调色：#B68C3A（金色）
  - 文字：#FFFFFF（白色）
- **字体**：Noto Sans SC
- **效果**：
  - 玻璃拟态（backdrop-filter: blur）
  - 渐变光效
  - 微妙网格背景
  - 过期时间提示（72小时）

### 文字层级

- 大标题：76px / 900 weight
- 小标题：70px / 900 weight
- 正文：44-52px / 700 weight
- 辅助文字：36-48px / 500-700 weight
- 过期提示：28px / 600 weight

---

## ⏰ 自动删除

所有生成的图片会在 **72 小时后自动删除**，节省服务器空间。

卡片底部会显示：
```
⏰ 图片将于 2025-01-16 18:38 自动删除
```

---

## 🔄 扩展新卡片类型

### 步骤

1. **定义模板函数**：在 `generate-luxury-cards.mjs` 中添加
```javascript
function generateSummaryHTML(content) {
  // 返回 HTML 模板
}
```

2. **注册卡片类型**：
```javascript
const CARD_TEMPLATES = {
  hook: generateHookHTML,
  steps: generateStepsHTML,
  summary: generateSummaryHTML,  // 新增
  quote: generateQuoteHTML       // 新增
};
```

3. **更新 skill 文档**：在本文件中添加新类型的定义

4. **测试**：
```javascript
await generateLuxuryCards(content, {
  cardTypes: ["summary"]
});
```

---

## 📋 注意事项

1. **内容完整性**：确保 content 包含所需字段，否则会生成失败
2. **文件夹命名**：pageTitle 会自动清理非法字符
3. **静态服务器**：确保 9527 端口的静态服务器在运行
4. **浏览器资源**：同时生成多张图片会占用较多内存

---

## 🎯 当前支持的类型

- ✅ `hook` - Hook 卡片
- ✅ `steps` - 步骤卡片
- 🔜 `summary` - 总结卡片（待实现）
- 🔜 `quote` - 引用卡片（待实现）

---

## 💡 使用建议

- **标准流程内容**：使用 `["hook", "steps"]`
- **单一洞察分享**：使用 `["hook"]`
- **完整内容包**（将来）：使用 `["hook", "steps", "summary", "quote"]`
