---
name: quote-card-generator
description: 用 ChatGPT 生成金句卡片图片
trigger: 当需要生成金句卡片、Short Post图片、Broad Post图片时
version: 1.0.0
created: 2026-01-30
---

# Quote Card Generator

用 ChatGPT 生成金句卡片图片，配合 NotebookLM 生成的内容使用。

## 图片规范

### 基础设置
- **比例**: 1:1 (正方形)
- **数量**: 每次 1 张
- **操作**: 每次新窗口/新对话

### 视觉设计
- **背景**: 纯黑色
- **主字**: 米白色（金句主体文字）
- **强调**: 橘红色 `#A95738`（关键词高亮）
- **图标**: 2 个抽象图标（不含文字），扁平风格
- **版式**: 轻微随机变化，但整体风格统一

### 适用内容
| 类型 | 文字长度 | 图片用途 |
|------|----------|----------|
| Short Post | 10-20字金句 | 社交媒体配图 |
| Broad Post | 20-40字金句 | 深度内容配图 |
| Deep Post | 提取核心金句 | 长文配图 |

## ChatGPT Prompt 模板

```
参考这4张图片的风格，生成一张新的金句卡片：

内容：「{金句}」

要求：
1. 1:1 正方形比例
2. 纯黑色背景
3. 米白色主字体
4. 橘红色(#A95738)强调关键词
5. 2个抽象扁平图标（不含文字）
6. 版式可轻微变化
```

## 参考图位置

Mac Mini: `/Users/jinnuoshengyuan/Desktop/参考图-金句卡片/*.jpeg`

## 生成流程

1. **准备金句**: 从 NotebookLM 生成或手动提供
2. **打开 ChatGPT**: 新窗口/新对话
3. **上传参考图**: 4张风格参考
4. **输入 Prompt**: 使用上述模板
5. **下载原图**: 点击图片 → 下载（不是截图）
6. **保存**: 存到 `/home/xx/dev/zenithjoy-creator/output/generated-cards/{日期}/`

## 自动化脚本

位置: `/tmp/gen_chatgpt_cards.py`

```bash
# 运行
ssh jinnuoshengyuan@100.86.57.69 'python3 /tmp/gen_chatgpt_cards.py'
```

## 输出结构

```
作品 = {
  title: "标题",
  quote: "金句（用于图片）",
  image: "图片路径",
  content: "完整内容（2-3句或5-8句）"
}
```
