---
description: 一人公司成功案例内容生成流水线。输入：人物名称。输出：图文帖子（9:16，5张图+文案）+ 长文配图（公众号封面+3张配图+800字文章）+ 预览 HTML。
---

# solo-company-case — 一人公司成功案例生成器

## 适用场景

用户想制作"一人公司 / solopreneur 成功案例"内容，例如：
- "做一套 Dan Koe 的内容"
- "帮我做个 Sahil Bloom 的案例"
- "制作一人公司成功案例图文"

---

## 输出规格

### A. 图文帖子（适合抖音/小红书/朋友圈）

| 文件 | 尺寸 | 内容 |
|------|------|------|
| `v6-cover.png` | 1080×1464 | 封面：头像+姓名+核心数字+钩子标题 |
| `v6-01-profile.png` | 1080×1920 | Card1：故事时间线（5个节点） |
| `v6-02-flywheel.png` | 1080×1920 | Card2：内容飞轮图（圆心+4卫星） |
| `v6-03-day.png` | 1080×1920 | Card3：24小时时间块 |
| `v6-04-qa.png` | 1080×1920 | Card4：Q&A 对话格 |
| 文案 | 100-200字 | 适合社媒配图发布 |

### B. 长文配图（适合微信公众号）

| 文件 | 尺寸 | 内容 |
|------|------|------|
| `v6-lf-cover.png` | 900×383 | 封面：头像在右+标题+副标题 |
| `v6-lf-01-flywheel.png` | 1080×810 | 配图1：内容飞轮 |
| `v6-lf-02-income.png` | 1080×810 | 配图2：收入结构 |
| `v6-lf-03-roadmap.png` | 1080×810 | 配图3：成长路线图 |
| 文章 | ~800字 | 结构：钩子→三点洞察→结语 |

---

## 流水线步骤

### Step 1 — NotebookLM 深度调研

```bash
# 检查 auth
notebooklm status

# 创建 notebook
notebooklm create "一人公司案例：<人物名>" --json
# → {"id": "<notebook_id>"}

# 深度调研（deep 模式，20+ 来源）
notebooklm source add-research "<人物名> solopreneur creator economy" --mode deep --no-wait

# 后台等待并导入（启动子任务）
# notebooklm research wait -n <notebook_id> --import-all --timeout 600
```

等待完成后：

```bash
# 确认来源就绪
notebooklm source list -n <notebook_id> --json

# 核心问题提取
notebooklm ask "总结该人物的商业模式：收入构成、内容策略、日常工作流、关键数字" --json
notebooklm ask "列出该人物职业发展时间线的5个关键节点（年份+事件+描述）" --json
notebooklm ask "该人物最常被引用的3-5句名言" --json
notebooklm ask "该人物的收入结构分解（按产品类型和比例）" --json
```

### Step 2 — 数据结构化

从调研结果提取并填充以下结构（JSON 格式，供 Step 3 使用）：

```json
{
  "name": "Dan Koe",
  "handle": "@thedankoe",
  "tagline": "作家 · 内容创业者 · 年入 $5M+",
  "headline": "一个人，年赚500万美元",
  "sub_headline": "他的极简商业哲学",
  "stats": {
    "revenue": "$5M",
    "followers": "470万",
    "margin": "70%"
  },
  "timeline": [
    { "year": "早年", "title": "平凡上班族", "desc": "..." },
    { "year": "2019", "title": "开始在网上写作", "desc": "..." },
    { "year": "2021", "title": "第一门课程上线", "desc": "..." },
    { "year": "2022", "title": "收入突破六位数", "desc": "..." },
    { "year": "2024", "title": "年入 $5M+ 一人公司", "desc": "..." }
  ],
  "flywheel": {
    "center": "内容飞轮",
    "nodes": ["每日写作 2-3小时", "沉淀产品 课程·书", "多平台 分发", "被动收入 自动流入"]
  },
  "day_blocks": [
    { "time": "05:00", "label": "睡眠", "hours": 7, "color": "#818cf8" },
    { "time": "07:00", "label": "晨间仪式", "hours": 1, "color": "#34d399" },
    { "time": "08:00", "label": "深度写作", "hours": 3, "color": "#c084fc" },
    { "time": "11:00", "label": "运动", "hours": 1, "color": "#f87171" },
    { "time": "13:00", "label": "休息·阅读", "hours": 2, "color": "#60a5fa" },
    { "time": "15:00", "label": "回复·社交", "hours": 2, "color": "#fbbf24" },
    { "time": "17:00", "label": "自由时间", "hours": 4, "color": "#a78bfa" }
  ],
  "qa": [
    { "q": "为什么不招员工？", "a": "系统比团队更可靠，人扩大复杂度，系统扩大收益。" },
    { "q": "每天写什么？", "a": "一篇通讯 → 拆成推文、脚本、课程模块，一内容多渠道。" },
    { "q": "普通人能复制吗？", "a": "不需要复制，需要找到你的「一件事」，然后建系统。" },
    { "q": "最重要的建议？", "a": "你不需要一支团队，你需要一套系统。" }
  ],
  "quote": "你不需要一支团队，你需要一套系统。",
  "income_breakdown": [
    { "label": "数字课程", "pct": 55 },
    { "label": "付费订阅", "pct": 25 },
    { "label": "联盟佣金", "pct": 12 },
    { "label": "其他", "pct": 8 }
  ]
}
```

### Step 3 — 头像获取

```bash
# 获取 Twitter 头像（400×400 JPEG）
curl -L "https://unavatar.io/twitter/<handle>" -o /tmp/avatar.jpg
base64 -i /tmp/avatar.jpg > /tmp/avatar-b64.txt
```

### Step 4 — 图片生成（SVG/resvg）

**技术规范**（基于验证过的 v6 设计系统）：

#### 依赖

```js
import { Resvg } from '@resvg/resvg-js';
import fs from 'fs';
// Node 18+，无 canvas 依赖
```

#### 尺寸常量

```js
const W = 1080, H = 1920;     // 9:16 内容卡
const WC = 1080, HC = 1464;   // 封面（图文）
const WLC = 900, HLC = 383;   // 长文封面
const WLB = 1080, HLB = 810;  // 长文配图
```

#### 安全区（CRITICAL）

```js
const CX = 80, CR = 820, CW = 740;   // 左边界=80，右边界=820
const CT = 264, CB = 1660;            // 上边界=264，下边界=1660
const CH = CB - CT;                   // 1396px 可用高度
```

内容必须在安全区内填满，不能留大片空白。

#### 品牌角落

```js
function corners(T, topTag, pageNum, w=W, h=H) {
  // 左上：标签胶囊（topTag）
  // 右侧：大湖成长日记 竖排文字
  // 左下：ZenithJoy
  // pageNum：如 "2/5"
}
```

#### 渲染函数

```js
function render(svg, filename) {
  const resvg = new Resvg(svg, {
    font: { loadSystemFonts: true },
    fitTo: { mode: 'width', value: W * 2 }  // 2x 质量
  });
  const png = resvg.render().asPng();
  fs.writeFileSync(`${OUT}/${filename}`, png);
}
```

#### 重叠预防规则（CRITICAL）

所有 y 坐标必须从上往下显式计算，禁止猜测或依赖 SVG 自动排列：

```js
// 正确：显式链式计算
const SECTION_A_TOP = CT + 64;
const SECTION_A_BOT = SECTION_A_TOP + SECTION_A_H;
const SECTION_B_TOP = SECTION_A_BOT + GAP;  // 有间距

// 禁止：硬编码可能重叠的绝对值
```

在每个卡片函数开头加 `console.log` 验证所有区间不重叠：

```js
console.log(`card2: wheel[${SAT_TOP}-${SAT_BOT}] stat[${STAT_TOP}-${STAT_BOT}] ins[${INS_TOP}-${CB}]`);
```

#### 配色方案（B类暖创意）

```js
const T0 = { TC:'#c084fc', BG1:'#0d0520', BG2:'#170a35', G1:'#a855f7' };  // 紫
const T1 = { TC:'#f472b6', BG1:'#15050e', BG2:'#200618', G1:'#ec4899' };  // 粉
const T2 = { TC:'#818cf8', BG1:'#08091a', BG2:'#0e1030', G1:'#6366f1' };  // 蓝
const T3 = { TC:'#2dd4bf', BG1:'#021512', BG2:'#061e1a', G1:'#14b8a6' };  // 青
const AC = ['#f87171','#34d399','#60a5fa','#fbbf24','#a78bfa'];            // 高亮色
```

#### 头像嵌入

```js
const AV = `data:image/jpeg;base64,${fs.readFileSync('/tmp/avatar-b64.txt','utf8').trim()}`;

// 圆形裁剪
`<defs><clipPath id="av"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>
 <circle cx="${cx}" cy="${cy}" r="${r+6}" fill="none" stroke="#c084fc" stroke-width="4"/>
 <image href="${AV}" x="${cx-r}" y="${cy-r}" width="${r*2}" height="${r*2}" clip-path="url(#av)"/>`
```

#### 卡片内容类型（禁止全用列表）

| 卡片 | 形式 | 关键元素 |
|------|------|----------|
| 封面 | 头像+大字标题 | 头像（圆形）、核心数字、钩子文案 |
| Card1 人物档案 | 故事时间线 | 5节点时间线、3格统计、金句 |
| Card2 核心方法 | 飞轮圆图 | 中心圆+4卫星圆、虚线连接 |
| Card3 真实一天 | 时间块 | 横向色块、时间标签、图例 |
| Card4 问答 | 对话格 | Q(紫色背景)+A(深色背景) |
| 长文封面 | 头像在右 | 900×383，头像在右侧 |
| 长文配图 | 纯内容 | 无头像，信息密度高 |

### Step 5 — 文案生成

#### 图文帖子文案（100-200字，Dan Koe Newsletter 框架）

```
结构：
朋友分享了 <人物名> 这个案例，看完有点震撼。
[钩子：一句话点出最震撼的数字]
[方法：他是怎么做到的，用"他的逻辑很简单"引出]
[名言：一句他说过的话]
[结语：普通人能学到什么]
#一人公司 #内容创业 #个人品牌
```

#### 长文文章（~800字，公众号格式）

```
结构：
标题：《<人物名>：一个人，<核心数字>，靠的是什么》

[钩子段：1-2句，点出最反常识的事实]

一、<洞察1>（~200字）
[问题→洞察→具体数据→引用名言]

二、<洞察2>（~200字）
[问题→洞察→具体案例→行动启发]

三、<洞察3>（~200字）
[问题→洞察→可复制的方法论]

[结语：普通人如何开始，1-2句]
```

### Step 6 — 预览页生成

创建 `~/claude-output/<人物拼音>-preview.html`，包含：
- 图文帖子横向滚动行（高度 440px 缩略图）
- 点击灯箱放大
- 文案展示区
- 长文配图展示

关键 CSS：
```css
.cards-row { display:flex; gap:16px; overflow-x:auto; align-items:flex-start; }
.lightbox { position:fixed; inset:0; background:rgba(0,0,0,0.92); display:none; }
.lightbox.active { display:flex; align-items:center; justify-content:center; }
```

### Step 7 — 输出

图片保存到 `~/claude-output/images/`，公网访问：
`http://38.23.47.81:9998/images/<文件名>.png`

预览页公网访问：
`http://38.23.47.81:9998/<人物拼音>-preview.html`

---

## 注意事项

- **禁止 emoji**：SVG 中不用 emoji，用 `·`、圆点、中文符号替代
- **禁止浮动内容**：所有内容必须填满安全区，不允许居中浮在中间
- **头像放封面**：图文帖子头像在封面，不在内容卡；长文头像在封面（900×383），不在配图
- **y 坐标链式计算**：每段从上一段的 bottom + gap 开始，不硬编码
- **生成后验证**：打开预览页检查是否有重叠，用 console.log 输出各区间

---

## 完整生成脚本模板

```js
// gen-<slug>.mjs
import { Resvg } from '@resvg/resvg-js';
import fs from 'fs';

const SLUG = 'dankoe';
const OUT = '/Users/administrator/claude-output/images';
const AVATAR_B64 = fs.readFileSync('/tmp/avatar-b64.txt','utf8').trim();
const AV = `data:image/jpeg;base64,${AVATAR_B64}`;

// 常量（直接复用，不改）
const W=1080,H=1920,WC=1080,HC=1464,WLC=900,HLC=383,WLB=1080,HLB=810;
const CX=80,CR=820,CW=740,CT=264,CB=1660,CH=CB-CT;

// 替换为调研得到的数据
const DATA = { /* Step 2 结构化输出 */ };

// 生成函数
function cover() { /* ... */ }
function card1() { /* ... */ }
function card2() { /* ... */ }
function card3() { /* ... */ }
function card4() { /* ... */ }
function lfCover() { /* ... */ }
function lfCard1() { /* ... */ }
function lfCard2() { /* ... */ }
function lfCard3() { /* ... */ }

cover(); card1(); card2(); card3(); card4();
lfCover(); lfCard1(); lfCard2(); lfCard3();
console.log('Done');
```

参考实现：`/Users/administrator/claude-output/scripts/gen-dankoe-v6.mjs`（已验证无重叠）
