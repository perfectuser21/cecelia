# Learning: Brain API output 端点扩展 — 文件扫描代替 URL 猜测

## 背景
ZenithJoy 内容产出详情页需要展示文章全文、卡片文案和实际图片。原 output 端点只返回猜测的图片 URL（基于 slug），图片无法显示。

### 根本原因
原实现用字符串拼接构造图片 URL（`{slug}-cover.png`），但实际文件名可能因关键词特殊字符处理不同而不匹配。

### 解决方案
- 使用 `existsSync` 扫描 `~/claude-output/images/` 目录，只返回实际存在的文件 URL
- 用 `readdirSync` 扫描 `~/perfect21/zenithjoy/content-output/` 找匹配的输出目录，读取真实的 article.md 和 copy.md

### 下次预防
- [ ] 凡是依赖文件系统路径的 API，必须用 existsSync 验证后再返回 URL
- [ ] 不要基于关键词"猜测"文件名，实际扫描比猜测可靠
