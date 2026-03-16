# Learning - longform-creator Skill 架构设计

**Branch**: cp-03161820-add-longform-creator-skill
**PR**: #992

### 根本原因

公众号内容创作与发布之前耦合在一起，无法复用内容。需要建立清晰的分层：创作层（内容生成+存储）和发布层（读取+API发布）。

### 核心决策

公众号内容创作与发布分离架构：
- `longform-creator` skill：内容创作（文字 + 图片） → 保存到 NAS
- `wechat-publisher` skill：从 NAS 读取内容 → 微信 API 发布

### 图片规格（微信公众号官方要求）

- **封面图**：900×383（2.35:1 横版）
- **正文配图**：1080×810（4:3 横版）
- **图片风格**：深色科技感（#0d0d1f 背景，紫/蓝渐变）
- **禁止 emoji**：resvg-js 不支持彩色 emoji，改用 iconDot() SVG 圆圈图标

### NAS 存储规范

```
/volume1/workspace/vault/zenithjoy-creator/content/{YYYY-MM-DD-XXXXXX}/
├── manifest.json   # 由 nas-content-manager.sh 自动创建
├── text/text_v1.md
├── images/*.png
├── exports/{title.txt,content.html}
└── logs/
```

### 下次预防

- [ ] 新平台 skill 设计时优先考虑创作/发布分离，降低耦合
- [ ] 微信公众号图片比例：封面 2.35:1（非 16:9、非 9:16），正文 4:3 横版
- [ ] resvg 图片生成禁止 emoji，所有图标用 SVG iconDot() 替代
