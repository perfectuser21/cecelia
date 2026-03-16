# longform-creator — 公众号长文创作器

## 触发词

- `/longform-creator`、`longform-creator`
- 用户说：做公众号文章、创作长文、写公众号、做图文内容、创作文章

## 职责

**创作** 公众号长文内容（文字 + 配图），保存到 NAS。
**不负责发布**——发布由 `wechat-publisher` skill 完成。

---

## 输出规格

| 类型 | 尺寸 | 文件名格式 |
|------|------|-----------|
| 封面图 | 900×383 (2.35:1) | `{topic}-cover.png` |
| 正文配图 | 1080×810 (4:3 横版) | `{topic}-01-xxx.png`, `{topic}-02-xxx.png`... |
| 正文 HTML | — | `content.html` |
| 文章标题 | — | `title.txt` |
| Markdown 版 | — | `text_v1.md` |

**图片风格**：深色科技感（背景 #0d0d1f → #12082a，紫色/蓝色渐变，ZenithJoy 品牌）

---

## NAS 存储规范

```
NAS IP: 100.110.241.76  |  用户: 徐啸
BASE: /volume1/workspace/vault/zenithjoy-creator/content/

{YYYY-MM-DD-XXXXXX}/
├── manifest.json          # 元数据（由 nas-content-manager.sh 创建）
├── text/
│   └── text_v1.md         # Markdown 原文（供其他平台使用）
├── images/
│   ├── {topic}-cover.png  # 封面图 900×383
│   ├── {topic}-01-xxx.png # 正文配图 1 (1080×810)
│   └── {topic}-02-xxx.png # 正文配图 2 (1080×810)
├── exports/
│   ├── title.txt          # 文章标题（纯文本）
│   └── content.html       # 公众号正文 HTML（图片用相对路径）
└── logs/
```

---

## 执行流程

### Step 1 — 了解内容需求

从用户输入提取（不够则询问）：
- **主题**：文章讲什么（一句话）
- **核心要点**：3~5 个（决定几张配图）
- **目标读者**：谁会看（影响语气和深度）

信息足够时直接进入 Step 2。

---

### Step 2 — 规划内容草稿（必须让用户确认）

输出以下格式，**等用户确认后才进入 Step 3**：

```
**文章标题**：xxx（30字以内，吸引眼球）

**封面**：
  主标题：xxx（10字以内，大字醒目）
  副标题：xxx（一句话补充说明）

**配图 1：[主题]**
  > 标题：xxx
  - 要点 1
  - 要点 2
  - 要点 3

**配图 2：[主题]**
  ...

**正文大纲**：
  1. 开头（痛点/场景引入）
  2. 主体（每个要点展开）
  3. 结尾（价值总结 + 行动号召）
```

---

### Step 3 — 生成图片脚本

在 `~/claude-output/scripts/` 创建 `gen-{topic}.mjs`。

**尺寸常量**：
```js
import { Resvg } from '@resvg/resvg-js';
import fs from 'fs';

const W = 1080, H = 810;    // 4:3 正文配图
const WC = 900, HC = 383;   // 2.35:1 封面
const OUT = '/Users/administrator/claude-output/images';
```

**必备辅助函数**（照抄，不要改）：
```js
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function render(svg, filename) {
  const resvg = new Resvg(svg, { font: { loadSystemFonts: true } });
  const png = resvg.render().asPng();
  fs.writeFileSync(`${OUT}/${filename}`, png);
  console.log(`  ${filename}  ${Math.round(png.length/1024)}KB`);
}

// 数字/字母圆圈图标（禁止用 emoji，resvg 不支持）
function iconDot(cx, cy, r, color, label) {
  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" fill-opacity="0.18"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-opacity="0.35" stroke-width="1.5"/>
    <text x="${cx}" y="${cy + Math.round(r*0.40)}" text-anchor="middle"
      font-size="${Math.round(r*1.1)}" font-weight="800" fill="${color}">${esc(label)}</text>
  `;
}

function bg(extra = '') {
  return `
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0d0d1f"/>
        <stop offset="100%" stop-color="#12082a"/>
      </linearGradient>
      ${extra}
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
  `;
}

function topBar(tag, tagColor, tagBg, pageNum) {
  return `
    <rect x="48" y="28" width="170" height="40" rx="20"
      fill="${tagBg}" fill-opacity="0.25"/>
    <text x="133" y="53" text-anchor="middle"
      font-size="22" font-weight="700" fill="${tagColor}">${esc(tag)}</text>
    ${pageNum ? `<text x="${W-52}" y="53" text-anchor="end"
      font-size="22" fill="#ffffff" fill-opacity="0.40">${esc(pageNum)}</text>` : ''}
  `;
}

function bottomBar() {
  return `
    <text x="52" y="${H-22}" font-size="24" font-weight="700"
      fill="#a78bfa" fill-opacity="0.75">ZenithJoy</text>
    <text x="178" y="${H-22}" font-size="20"
      fill="#ffffff" fill-opacity="0.22"> · AI自动发布系列</text>
  `;
}
```

**封面模板（900×383）**：
- 主标题：字号 ≤72px，控制在 10 字以内（避免超出宽度）
- 主标题 y ≈ 148，副标题 y ≈ 196
- 底部品牌 y ≤ 355

**内容区安全范围（4:3 配图 1080×810）**：
- 顶部：y ≥ 80（topBar 占 68px）
- 底部：y ≤ 760（bottomBar 在 y=788）
- 左边距：x ≥ 52，右边距：x ≤ 1028

**颜色方案**：

| 主题类型 | tagColor | tagBg |
|---------|---------|-------|
| 技术/工具（紫） | #a78bfa | #6c63ff |
| 网络/安全（蓝） | #60a5fa | #3b82f6 |
| 成就/完成（绿） | #34d399 | #10b981 |
| 数据/分析（黄） | #fbbf24 | #f59e0b |

运行生成：
```bash
cd ~/claude-output/scripts && node gen-{topic}.mjs
```

验证：所有 PNG 文件大小 > 50KB（太小说明生成失败）。

---

### Step 4 — 生成正文 HTML

创建 `content.html`：
- 标题用 `<h2>`（公众号不建议 h1）
- 图片用相对路径：`<img src="{topic}-01-xxx.png" alt="...">`
- 段落用 `<p>`
- 结尾固定加：`<p style="color: #888;">ZenithJoy · AI自动发布系列</p>`

---

### Step 5 — 上传到 NAS

```bash
CONTENT_ID=$(date +%Y-%m-%d)-$(openssl rand -hex 3)
NAS_USER="徐啸"
NAS_IP="100.110.241.76"
NAS_PATH="/volume1/workspace/vault/zenithjoy-creator/content/${CONTENT_ID}"
TITLE="文章标题"

bash /Users/administrator/perfect21/infrastructure/scripts/nas-content-manager.sh \
  create "${CONTENT_ID}" "${TITLE}" "article"

scp ~/claude-output/images/{topic}-*.png "${NAS_USER}@${NAS_IP}:${NAS_PATH}/images/"

echo "${TITLE}" > /tmp/title.txt
scp /tmp/title.txt "${NAS_USER}@${NAS_IP}:${NAS_PATH}/exports/"
scp /tmp/content.html "${NAS_USER}@${NAS_IP}:${NAS_PATH}/exports/"
scp /tmp/text_v1.md "${NAS_USER}@${NAS_IP}:${NAS_PATH}/text/"

bash /Users/administrator/perfect21/infrastructure/scripts/nas-content-manager.sh \
  update-status "${CONTENT_ID}" ready
```

**注意**：NAS SSH key 已配置，无需密码。用户名是中文 `徐啸`，需要加引号。

---

### Step 6 — 输出摘要

```
✅ 长文创作完成

Content ID : {content_id}
标题       : {标题}
NAS 路径   : /volume1/workspace/vault/zenithjoy-creator/content/{content_id}/

配图列表：
  {topic}-cover.png     (900×383，封面)
  {topic}-01-xxx.png    (1080×810，正文配图 1)
  {topic}-02-xxx.png    (1080×810，正文配图 2)

发布到微信公众号：
  /wechat-publisher --content-id {content_id}
```

---

## 注意事项

- **禁止 emoji**：resvg 不支持彩色 emoji，全渲染成方块。改用 `iconDot()` SVG 图标。
- **封面主标题**：≤10 字，避免超出 900px 宽度。
- **每张配图**：最多 5~6 个信息项，不要塞太多。
- **文件命名**：小写 + 连字符，无空格。如 `autopublish-01-pain.png`。
- **NAS SSH**：已配置免密，直接 scp 即可。
