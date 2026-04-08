---
description: 全套内容生成流水线。输入：任意主题（人物/概念/方法论）。输出：竖版图(封面+6张) + 公众号横版图(封面+3张) + 社媒文案 + 公众号长文 → 存 NAS → 注册数据库。
---

# solo-company-case — 全套内容生成器

## 适用场景

任意主题均可：
- 人物案例："做一套 Dan Koe 的内容"、"做 Karpathy"
- 方法论/概念："AI学习方法论"、"Software 2.0"、"一人公司商业模式"
- 事件/趋势："大模型横评"、"315曝光GEO"

---

## 输出规格

### A. 竖版图（适合抖音/小红书/朋友圈）

| 文件 | 尺寸 | 说明 |
|------|------|------|
| `{slug}-cover.png` | 1080×1464 | 封面 |
| `{slug}-01-xxx.png` | 1080×1920 | Card1 |
| `{slug}-02-xxx.png` | 1080×1920 | Card2 |
| `{slug}-03-xxx.png` | 1080×1920 | Card3 |
| `{slug}-04-xxx.png` | 1080×1920 | Card4 |
| `{slug}-05-xxx.png` | 1080×1920 | Card5 |
| `{slug}-06-xxx.png` | 1080×1920 | Card6 |
| 社媒文案 | 100-200字 | 通用一版（抖音/小红书/朋友圈） |

### B. 公众号横版图（适合微信公众号）

| 文件 | 尺寸 | 说明 |
|------|------|------|
| `{slug}-lf-cover.png` | 900×383 | 公众号封面 (2.35:1) |
| `{slug}-lf-01-xxx.png` | 1080×810 | 正文配图1 (4:3) |
| `{slug}-lf-02-xxx.png` | 1080×810 | 正文配图2 (4:3) |
| `{slug}-lf-03-xxx.png` | 1080×810 | 正文配图3 (4:3) |
| 公众号长文 | 800字+ | content.html + text_v1.md |

---

## 卡片版式映射（无数据时换通用版式）

| 卡片 | 人物主题 | 通用主题 | 视觉形式 |
|------|---------|---------|---------|
| 封面 | 头像+核心数字+钩子 | 大字标题+核心主张 | 大字/渐变/视觉冲击 |
| Card1 | 人物档案（时间线+统计） | 背景+核心成就 | 时间线+数字格 |
| Card2 | 飞轮圆图（中心+4卫星） | 核心框架/系统图 | 圆形节点图 |
| Card3 | 真实一天（横向时间块） | 路径/阶段图 | 时间轴/步骤块 |
| Card4 | Q&A对话格 | 对比/反常识 | 两列对比格 |
| Card5 | 金句/语录 | 核心观点/金句 | 引用框+要点列表 |
| Card6 | 行动指南 | 落地方法/下一步 | 步骤箱式布局 |
| LF配图1 | 飞轮/内容策略 | 核心框架可视化 | 图表/节点 |
| LF配图2 | 收入结构 | 关键数据/对比 | 数字格/对比 |
| LF配图3 | 成长路线图 | 落地路径图 | 阶段线 |

**判断规则**：有头像/收入数字/时间线 → 人物模板；否则 → 通用模板。可混用。

---

## 流水线步骤

### Step 1 — 判断主题类型 + NotebookLM 调研

```bash
notebooklm create "<主题名>" --json
# → {"id": "<notebook_id>"}

notebooklm source add-research "<主题关键词>" --mode deep --no-wait
```

等待完成后提取核心数据：

```bash
# 人物主题
notebooklm ask "总结商业模式：收入构成、内容策略、日常工作流、关键数字" --json
notebooklm ask "列出职业发展时间线的5个关键节点（年份+事件+描述）" --json
notebooklm ask "最常被引用的3-5句名言" --json

# 通用主题
notebooklm ask "总结核心框架/方法论：3-5个关键要点" --json
notebooklm ask "列出关键数据/证据/案例" --json
notebooklm ask "对普通人最有价值的3个行动洞察" --json
```

---

### Step 2 — 数据结构化

```json
{
  "slug": "karpathy",
  "topic_type": "person | concept",
  "name": "Andrej Karpathy",
  "tagline": "OpenAI联合创始人 · 深度学习布道者",
  "headline": "AI时代最值得学的人",
  "sub_headline": "他的学习地图，普通人能直接用",
  "stats": [
    { "value": "2017", "label": "Software 2.0 预言" },
    { "value": "千万+", "label": "YouTube 播放" },
    { "value": "5步", "label": "Zero to Hero" }
  ],
  "timeline": [
    { "year": "2015", "title": "联合创立 OpenAI", "desc": "..." }
  ],
  "framework": {
    "center": "核心概念",
    "nodes": ["要点1", "要点2", "要点3", "要点4"]
  },
  "steps": [
    { "label": "步骤1", "desc": "说明" }
  ],
  "contrasts": [
    { "bad": "常见方式", "good": "推荐方式" }
  ],
  "quotes": ["金句1", "金句2"],
  "actions": ["行动1", "行动2", "行动3"],
  "income_breakdown": null
}
```

---

### Step 3 — 头像获取（仅人物主题）

```bash
curl -L "https://unavatar.io/twitter/<handle>" -o /tmp/avatar.jpg
base64 -i /tmp/avatar.jpg > /tmp/avatar-b64.txt
```

通用主题跳过。

---

### Step 4 — 图片生成（SVG/resvg）

在 `~/claude-output/scripts/` 创建 `gen-{slug}.mjs`。

#### 尺寸常量

```js
const W=1080, H=1920;        // 9:16 内容卡
const WC=1080, HC=1464;      // 竖版封面
const WLC=900,  HLC=383;     // 公众号封面
const WLB=1080, HLB=810;     // 公众号配图

const CX=80, CR=820, CW=740;
const CT=264, CB=1660, CH=CB-CT;
```

#### 渲染（2x 质量）

```js
function render(svg, filename) {
  const resvg = new Resvg(svg, {
    font: { loadSystemFonts: true },
    fitTo: { mode: 'width', value: W * 2 }
  });
  const png = resvg.render().asPng();
  fs.writeFileSync(`${OUT}/${filename}`, png);
  console.log(`  ✅ ${filename}  ${Math.round(png.length/1024)}KB`);
}
```

#### 配色方案

```js
const T0 = { TC:'#c084fc', BG1:'#0d0520', BG2:'#170a35', G1:'#a855f7', G2:'#d946ef' }; // 紫
const T1 = { TC:'#f472b6', BG1:'#15050e', BG2:'#200618', G1:'#ec4899', G2:'#fb923c' }; // 粉
const T2 = { TC:'#818cf8', BG1:'#08091a', BG2:'#0e1030', G1:'#6366f1', G2:'#8b5cf6' }; // 蓝
const T3 = { TC:'#2dd4bf', BG1:'#021512', BG2:'#061e1a', G1:'#14b8a6', G2:'#06b6d4' }; // 青
const AC = ['#f87171','#34d399','#60a5fa','#fbbf24','#a78bfa'];
// 分配：cover=T0, 01=T0, 02=T1, 03=T2, 04=T3, 05=T0, 06=T1
```

#### 卡片版式规则（CRITICAL — 禁止全用列表）

```
封面   → 头像(人物) / 大字渐变(通用) + 核心数字
Card1  → 时间线（5节点）+ 统计格（3个数字）+ 底部金句
Card2  → 圆形节点图（中心+4卫星，虚线连接）+ 底部数据
Card3  → 横向色块时间轴 / 阶段步骤块（带时间标签）
Card4  → 两列对比格（Q&A 或 Bad/Good）
Card5  → 引用大字框 + 要点箱式列表（ACCENTS 轮换）
Card6  → 步骤箱式布局（numbered iconDot + 描述）
```

#### y 坐标链式计算（CRITICAL）

```js
const SECTION_A_TOP = CT + 64;
const SECTION_A_BOT = SECTION_A_TOP + SECTION_A_H;
const SECTION_B_TOP = SECTION_A_BOT + GAP;
// 禁止硬编码绝对值
```

#### 头像嵌入（人物主题）

```js
const AV = `data:image/jpeg;base64,${fs.readFileSync('/tmp/avatar-b64.txt','utf8').trim()}`;
`<defs><clipPath id="av"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>
 <circle cx="${cx}" cy="${cy}" r="${r+6}" fill="none" stroke="#c084fc" stroke-width="4"/>
 <image href="${AV}" x="${cx-r}" y="${cy-r}" width="${r*2}" height="${r*2}" clip-path="url(#av)"/>`
```

运行：
```bash
cd ~/claude-output/scripts && node gen-{slug}.mjs
```

#### Gate 1：机械验证

```bash
node ~/claude-output/scripts/validate-cards.mjs {slug}
```

#### Gate 2：视觉审查（8项）

底部重叠 / 右侧越界 / iconDot遮字 / 内容溢出 / XML乱码 / 底部大片空白(>600px) / 视觉单调 / 无框浮字。任何一项 FAIL → 修脚本重新生成。

---

### Step 5 — 文案生成（两种）

**平台硬限制**：图片最多9张，标题最多20字，社媒正文100-200字，公众号正文800字以上。
**不要分别写抖音和小红书**——社交媒体通用一版。

#### 社媒文案（100-200字）

```
公式：P支柱 × A角度 × I意图 × S结构（8模块选4-7个）
结构：钩子 → 对象与问题 → 核心观点 → 方法/证据 → CTA
自检：前2句有镜头？说清代价？读者对号入座？结论+边界？1个最小动作？
```

#### 公众号长文（800字+）

```
标题：《<主题>：<核心主张>》（20字以内）
结构：
  [钩子：1-2句，点出最反常识的事实]
  一、<洞察1>（~200字）[问题→洞察→数据→名言]
  二、<洞察2>（~200字）[问题→洞察→案例→启发]
  三、<洞察3>（~200字）[问题→洞察→可复制方法论]
  [结语：普通人如何开始，1-2句]
```

---

### Step 6 — 上传 NAS + 注册数据库

```bash
CONTENT_ID=$(date +%Y-%m-%d)-$(openssl rand -hex 3)
NAS_USER="徐啸"
NAS_IP="100.110.241.76"
NAS_BASE="/volume1/workspace/vault/zenithjoy-creator/content"
TITLE="文章标题"

bash /Users/administrator/perfect21/infrastructure/scripts/nas-content-manager.sh \
  create "${CONTENT_ID}" "${TITLE}" "full_suite"

scp ~/claude-output/images/{slug}-*.png \
  "${NAS_USER}@${NAS_IP}:${NAS_BASE}/${CONTENT_ID}/images/"

echo "${TITLE}" > /tmp/title.txt
scp /tmp/title.txt    "${NAS_USER}@${NAS_IP}:${NAS_BASE}/${CONTENT_ID}/exports/"
scp /tmp/content.html "${NAS_USER}@${NAS_IP}:${NAS_BASE}/${CONTENT_ID}/exports/"
scp /tmp/text_v1.md   "${NAS_USER}@${NAS_IP}:${NAS_BASE}/${CONTENT_ID}/text/"

bash /Users/administrator/perfect21/infrastructure/scripts/nas-content-manager.sh \
  update-status "${CONTENT_ID}" ready
```

```bash
PGPASSWORD="${POSTGRES_PASSWORD}" psql -h localhost -p 5432 -U postgres -d cecelia -c "
  INSERT INTO zenithjoy.works (
    content_id, title, content_type, nas_path, status
  ) VALUES (
    '${CONTENT_ID}', '${TITLE}', 'full_suite',
    '${NAS_BASE}/${CONTENT_ID}', 'ready'
  )
  ON CONFLICT (content_id) DO UPDATE SET
    title = EXCLUDED.title, status = EXCLUDED.status, updated_at = NOW();
" || echo "⚠️ works 表注册失败，继续"
```

---

### Step 7 — 输出摘要

```
✅ 全套内容生成完成

Content ID : {content_id}
主题       : {主题}
NAS 路径   : /volume1/workspace/vault/zenithjoy-creator/content/{content_id}/

竖版图（9:16）：
  {slug}-cover.png       封面 1080×1464
  {slug}-01~06-xxx.png   内容卡 1080×1920 ×6

公众号横版：
  {slug}-lf-cover.png    封面 900×383
  {slug}-lf-01~03.png    配图 1080×810 ×3

下一步发布：
  社媒（抖音/小红书）→ 从 NAS 取竖版图 + 社媒文案
  公众号              → 从 NAS 取横版图 + 长文 HTML
```

---

## 注意事项

- **禁止 emoji**：SVG 中不用 emoji，用 `iconDot()` 或中文符号替代
- **禁止全用列表**：每张卡片版式必须不同，参考卡片版式映射表
- **y 坐标必须链式计算**：禁止硬编码绝对值
- **通用主题无头像**：封面改用渐变大字
- **NAS SSH**：已配置免密，直接 scp
- **参考实现**：`~/claude-output/scripts/gen-dankoe-v6.mjs`（已验证无重叠）
