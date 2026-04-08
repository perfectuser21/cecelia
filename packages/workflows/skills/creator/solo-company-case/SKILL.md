---
description: 成功案例内容生成流水线。输入：任意主题（一人公司人物、AI工具、方法论等）。输出：竖版封面+6张图（抖音/小红书）+ 公众号封面+3张配图 + 社媒文案 + 公众号长文 + 预览页。遇到"做一套 XX 的内容"、"帮我做个 XX 的案例"、"制作案例图文"立即触发。
---

# solo-company-case — 成功案例内容生成流水线

## 适用场景

- "做一套 Dan Koe 的内容"
- "帮我做个 Karpathy 的案例"
- "制作一人公司成功案例图文"
- "做个关于 XX 方法论 / XX 工具 / XX 公司 的内容"

---

## 输出规格

### A. 竖版图文（抖音 / 小红书 / 朋友圈）

| 文件 | 尺寸 | 内容 |
|------|------|------|
| `<slug>-cover.png` | 1080×1464 | 封面：核心视觉+大字标题 |
| `<slug>-01-<theme>.png` | 1080×1920 | 内容卡1 |
| `<slug>-02-<theme>.png` | 1080×1920 | 内容卡2 |
| `<slug>-03-<theme>.png` | 1080×1920 | 内容卡3 |
| `<slug>-04-<theme>.png` | 1080×1920 | 内容卡4 |
| `<slug>-05-<theme>.png` | 1080×1920 | 内容卡5 |
| `<slug>-06-<theme>.png` | 1080×1920 | 内容卡6 |
| 社媒文案 | 100-200字 | 抖音/小红书通用一版 |

### B. 公众号配图

| 文件 | 尺寸 | 内容 |
|------|------|------|
| `<slug>-lf-cover.png` | 900×383 | 封面（2.35:1） |
| `<slug>-lf-01-<theme>.png` | 1080×810 | 配图1 |
| `<slug>-lf-02-<theme>.png` | 1080×810 | 配图2 |
| `<slug>-lf-03-<theme>.png` | 1080×810 | 配图3 |
| 公众号文章 | ~800字 | 钩子→三段洞察→结语 |

---

## 流水线步骤

### Step 1 — 调研（NotebookLM）

```bash
# 检查 auth
notebooklm status

# 创建 notebook
notebooklm create "<主题名称>" --json
# → {"id": "<notebook_id>"}

# 深度调研
notebooklm source add-research "<主题关键词>" --mode deep
```

等待完成（轮询，不阻塞，每 30 秒检查一次，最多 10 分钟）：

```bash
# 检查调研状态（注意：-n 参数传 notebook_id）
notebooklm source list -n <notebook_id> --json
```

确认来源数 > 3 后提问：

```bash
notebooklm ask -n <notebook_id> "总结核心商业模式/方法论：关键数字、策略、阶段" --json
notebooklm ask -n <notebook_id> "列出发展历程的5个关键节点（时间+事件+一句话描述）" --json
notebooklm ask -n <notebook_id> "最常被引用的3-5句名言或核心观点" --json
notebooklm ask -n <notebook_id> "详细拆解收入/影响力结构（分项和比例）" --json
```

### Step 2 — 数据结构化

从调研结果提取，填充通用数据结构：

```json
{
  "slug": "karpathy",
  "name": "Andrej Karpathy",
  "tagline": "AI 研究员 · 前 OpenAI / Tesla",
  "headline": "把 AI 教给所有人",
  "sub_headline": "一个人，开源，免费",
  "stats": { "s1": "400万", "l1": "订阅者", "s2": "零收费", "l2": "全部免费", "s3": "5年", "l3": "持续产出" },
  "timeline": [
    { "year": "2015", "title": "斯坦福博士毕业", "desc": "..." },
    { "year": "2015", "title": "加入 OpenAI", "desc": "..." },
    { "year": "2017", "title": "加入 Tesla", "desc": "..." },
    { "year": "2022", "title": "回归 OpenAI", "desc": "..." },
    { "year": "2023", "title": "独立，全力做教育", "desc": "..." }
  ],
  "flywheel": {
    "center": "核心方法",
    "nodes": ["节点1", "节点2", "节点3", "节点4"]
  },
  "qa": [
    { "q": "核心问题1？", "a": "回答1" },
    { "q": "核心问题2？", "a": "回答2" },
    { "q": "核心问题3？", "a": "回答3" },
    { "q": "核心问题4？", "a": "回答4" }
  ],
  "quote": "最重要的那句名言",
  "insights": [
    { "n": "01", "title": "洞察标题", "desc": "一句话描述", "sub": "补充说明" },
    { "n": "02", "title": "洞察标题", "desc": "一句话描述", "sub": "补充说明" },
    { "n": "03", "title": "洞察标题", "desc": "一句话描述", "sub": "补充说明" },
    { "n": "04", "title": "洞察标题", "desc": "一句话描述", "sub": "补充说明" },
    { "n": "05", "title": "洞察标题", "desc": "一句话描述", "sub": "补充说明" }
  ],
  "comparison": [
    { "label": "维度", "bad": "传统方式", "good": "该主题方式" },
    { "label": "维度", "bad": "...", "good": "..." }
  ],
  "income_breakdown": [
    { "label": "来源1", "pct": 50 },
    { "label": "来源2", "pct": 30 },
    { "label": "来源3", "pct": 20 }
  ]
}
```

若主题是工具或方法论（非人物），省略 `timeline` / `flywheel`，用 `insights` + `comparison` 代替。

### Step 3 — 版式选择 + 内容卡草稿确认

**先选版式，再出文案，等用户确认，再生成图片。**

#### Step 3a — 从版式库选版式（见下方版式库章节）

根据 Step 2 拿到的数据类型，按三步法选出 6 张卡各自的版式：
1. 盘点每张卡有什么数据（时间序列？对比？洞察列表？...）
2. 查匹配规则表，选最贴切的版式
3. 多样性检查：6张覆盖≥4种版式，同版式≤2次

**每个主题的版式组合都应该不同**——karpathy 有时间线，下一个主题可能没有，就不用时间线型；某个主题核心是阶段进化，就用阶段路径型替换。不要照抄任何参考实现的版式顺序。

#### Step 3b — 出文案草稿

每张卡格式：

```
**卡N（版式名称）：[主题]**
> 大标题：xxx
> 副标题：xxx
- 要点1：主文字 / 副说明
- 要点2：主文字 / 副说明
...
```

等用户说"可以"或提出修改 → 进入 Step 4。

---

## 版式库（11种，按内容匹配）

### 选版式三步法

**Step A — 盘点数据类型**

| 数据类型 | 例子 |
|---------|------|
| 时间序列 | 5年发展历程、里程碑节点 |
| 环形关系 | 飞轮、闭环、循环系统 |
| 时间块 | 24小时日程、周计划 |
| Q&A | 读者问题、FAQ |
| 对比 | 传统vs新方式、before/after |
| 纯数字 | 核心指标、成就数据 |
| 洞察列表 | 行动建议、方法论要点 |
| 名言/引用 | 核心观点、金句 |
| 步骤流程 | 操作路径、流水线 |
| 阶段进化 | Level 1→5、从初学到专家 |

**Step B — 数据→版式匹配规则**

| 如果数据是… | 优先选版式 |
|------------|-----------|
| 时间序列（4-6个节点） | 时间线型 |
| 环形/闭环关系 | 飞轮/节点图型 |
| 时间段分配 | 横向时间块型 |
| 问答对（3-5对） | Q&A对话格型 |
| 两列对比（3-6行） | 双列对比格型 |
| 3个大数字 + 说明 | 数字网格型 |
| 1个核心金句 + 5个洞察 | 引用大字框型 |
| 5-6个有序步骤 | 步骤行列型 |
| 5个洞察/要点（有大数字编号） | 大数字背景型 |
| 3-5个阶段/层级 | 阶段路径型 |
| 1个核心结论 + 对比数据 | 大字撞色型 |

**Step C — 多样性检查**

6张卡里：
- 同一版式不能超过 **2次**
- 必须覆盖至少 **4种不同版式**
- 不允许连续两张用同类视觉（同为"行列堆叠"算同类）

如果选出来不满足，重新调整，优先把最像的两张换成更独特的版式。

---

### 版式参考实现

#### 时间线型（timeline）

```js
// 5节点纵向时间线，节点间连线
// yearDot: circle r=28, 年份文字在圆心
// titleText: y=dot_cy-8, fontSize=40, fontWeight=700
// descText: y=dot_cy+28, fontSize=26, fill-opacity=0.5
// 连线: x=dot_cx, y1=dot1_cy+28, y2=dot2_cy-28, stroke=TC, stroke-dasharray="4 6"
const dotSpacing = Math.floor(CH / 5);
```

#### 飞轮/节点图型（flywheel）

```js
// 中心圆 r=110，4个卫星圆 r=70，虚线连接
// 卫星位置：上/右/下/左（或四角），offsetR=260
// center文字：两行，fontSize=36/28
// satellite文字：两行，fontSize=30/24，text-anchor=middle
```

#### 横向时间块型（day_blocks）

```js
// 横向色块：x=CX, width=CW, height按时长比例
// 左侧：时间标签 fontSize=28
// 中间：活动名称 fontSize=38 fontWeight=700
// 右侧：时长 fontSize=28
// 底部：图例行
const blockHeight = (block.hours / 24) * CH * 0.85;
```

#### Q&A对话格型（qa）

```js
// Q：背景色 TC fill-opacity=0.15，左边竖条 TC
// A：背景色深色 fill-opacity=0.08，左边竖条白色 opacity=0.2
// Q文字：fontSize=34 fontWeight=700 fill=TC
// A文字：fontSize=28 fill=white fill-opacity=0.75
const boxH = Math.floor((CH - 3*GAP) / 4);  // 4对Q&A
```

#### 双列对比格型（contrast）

```js
// 左列"传统"：红色 #ef4444，标题 fontSize=26，右列"新方式"：绿色 #34d399
// 顶部列标题行：height=64，填充背景色
// 每行 rowH=202，内有2行文字（预定义，禁止 .slice 截断）
// colW = (CW - 20) / 2
const rows = [
  { b: ['传统方式第一行', '第二行补充'], g: ['新方式第一行', '第二行补充'] },
  ...
]
```

#### 数字网格型（stats_grid）

```js
// 3个大数字格，横向排列或2+1排列
// 每格：大数字 fontSize=96 fontWeight=900，标签 fontSize=28
// 下方5条洞察，箱式布局 bxH=118，左竖条 ACCENTS 轮换
const ACCENTS = ['#f87171','#34d399','#60a5fa','#fbbf24','#a78bfa'];
```

#### 引用大字框型（quote）

```js
// 顶部：大号金句 fontSize=52 fontWeight=800，带引号装饰
// 下方5条洞察，箱式 bxH=118，ACCENTS 轮换颜色
// quoteBox：rect with TC fill-opacity=0.1，左竖条 TC
```

#### 步骤行列型（steps）

```js
// 5-6步，每步 bxH=138，左边数字圆 r=28
// 数字：fill=TC，fontSize=34 fontWeight=900
// 标题：fontSize=38 fontWeight=700
// 说明：fontSize=26 fill-opacity=0.5
const bxSlot = bxH + bxGap;
```

#### 大数字背景型（big_number_bg）

```js
// 5行全宽 box，动态高度填满安全区
const bxH = Math.floor((CB - (CT + 190) - 5 * bxGap) / 5);  // ≈227px
// 每行左侧：标题+副文字
// 每行右侧：大号透明数字作背景（fill-opacity=0.12，fontSize=bxH*0.82）
// ACCENTS 轮换 box 背景色
```

#### 阶段路径型（stages）

```js
// 3-5个阶段，竖向排列，阶段间有箭头连接
// 每阶段：左侧阶段标签（胶囊），右侧内容（标题+说明）
// 阶段颜色渐变：从暗到亮，体现进化感
```

#### 大字撞色型（hero_text）

```js
// 超大核心数字/结论，fontSize=180-240，占上半屏
// 下半：3-4条支撑数据，横向排列
// 背景：双色渐变，或大字与背景撞色
```

---

## 技术规范

### 尺寸常量

```js
const W = 1080, H = 1920;     // 9:16 内容卡
const WC = 1080, HC = 1464;   // 竖版封面
const WLC = 900, HLC = 383;   // 公众号封面
const WLB = 1080, HLB = 810;  // 公众号配图
```

### 安全区（CRITICAL）

```js
const CX = 80, CR = 820, CW = 740;   // 左=80，右=820
const CT = 264, CB = 1660;            // 上=264，下=1660
const CH = CB - CT;                   // 1396px 可用
```

### 渲染（必须 2x）

```js
function render(svg, filename, w=W) {
  const resvg = new Resvg(svg, {
    font: { loadSystemFonts: true },
    fitTo: { mode: 'width', value: w * 2 }
  });
  fs.writeFileSync(`${OUT}/${filename}`, resvg.render().asPng());
}
```

### 重叠预防（CRITICAL）

y 坐标必须显式链式计算，禁止猜测绝对值：

```js
const sectionA_top = CT + 64;
const sectionA_bot = sectionA_top + sectionA_h;
const sectionB_top = sectionA_bot + gap;  // 有间距
```

每个卡片函数开头打日志验证：

```js
console.log(`card01: tl[${tlTop}-${tlBot}] stat[${stTop}-${stBot}]`);
```

### 配色（B类暖创意）

```js
const THEMES = [
  { TC:'#c084fc', BG1:'#0d0520', BG2:'#170a35', G1:'#a855f7', G2:'#d946ef' }, // 紫
  { TC:'#f472b6', BG1:'#15050e', BG2:'#200618', G1:'#ec4899', G2:'#fb923c' }, // 粉
  { TC:'#818cf8', BG1:'#08091a', BG2:'#0e1030', G1:'#6366f1', G2:'#8b5cf6' }, // 蓝
  { TC:'#2dd4bf', BG1:'#021512', BG2:'#061e1a', G1:'#14b8a6', G2:'#06b6d4' }, // 青
];
const ACCENTS = ['#f87171','#34d399','#60a5fa','#fbbf24','#a78bfa'];
// cover=T0, card01=T0, 02=T1, 03=T2, 04=T3, 05=T0, 06=T1
```

### 头像嵌入（人物主题）

```bash
curl -L "https://unavatar.io/twitter/<handle>" -o /tmp/avatar.jpg
base64 -i /tmp/avatar.jpg > /tmp/avatar-b64.txt
```

```js
const AV = `data:image/jpeg;base64,${fs.readFileSync('/tmp/avatar-b64.txt','utf8').trim()}`;
// 圆形裁剪：<defs><clipPath id="av"><circle cx cy r/></clipPath></defs>
```

### 文字截断规则（CRITICAL）

**禁止 `.slice(n)` 截断**——必须预定义行数组：

```js
// ❌ 禁止
text.slice(0, 8)

// ✅ 正确
const lines = ['第一行文字', '第二行文字']
lines.map((l, i) => `<text y="${y0 + i*lh}">${l}</text>`)
```

---

## 内容生成规则

### 社媒文案（抖音/小红书通用一版，100-200字）

```
[钩子：一句话点出最震撼的数字或反常识]
[方法：他/它是怎么做到的]
[名言或核心观点]
[结语：读者能学到什么]
#相关标签 #一人公司 #个人品牌
```

### 公众号文章（~800字）

```
标题：《<名称>：<核心结论>》

[钩子段：1-2句，最反常识的事实]

一、<洞察1>（~200字）
[问题→洞察→具体数据→引用]

二、<洞察2>（~200字）
[问题→洞察→案例→启发]

三、<洞察3>（~200字）
[问题→洞察→可复制方法论]

[结语：普通人如何开始]
```

---

## Step 4 — 生成图片

```bash
cd ~/claude-output/scripts && node gen-<slug>.mjs
```

---

## Gate 检查（生成后必须全部通过）

### Gate 1：机械检查

```bash
node ~/claude-output/scripts/validate-cards.mjs <slug>
```

检查项：封面1080×1464、内容卡1080×1920、公众号封面900×383、配图1080×810、所有文件>50KB。

exit 1 → 修脚本重新生成，回到 Gate 1。

### Gate 2：视觉审查（Read 工具逐张目检）

用 `Read` 工具读取每一张 PNG，核对：

| # | 检查项 |
|---|--------|
| 1 | 底部重叠：ZenithJoy / 页码 / 底部正文是否叠在一起 |
| 2 | 右侧越界：内容是否压到右侧竖排文字区（x > CX+CW=820） |
| 3 | 内容溢出：最后内容块是否超出 CB=1660 |
| 4 | XML实体：`&`、`<`、`>` 是否未经 `esc()` 处理 |
| 5 | 底部空白：内容最后一行 y < CB-400（空白超过400px）→ 补充内容 |
| 6 | 视觉单调：相邻两张是否版式几乎相同 |
| 7 | 无框浮字：列表项是否直接浮在背景上（必须有 rect box） |
| 8 | 颜色重复：同张卡内是否所有 box 同一颜色（必须 ACCENTS 轮换） |
| 9 | 版式多样性：6张内容卡是否覆盖≥4种不同版式（同版式≤2张） |

发现问题 → 修脚本重新生成 → 回到 Gate 1。

**两个 Gate 全过才能给链接。**

---

## Step 5 — NAS 上传与数据库注册

```bash
# 生成内容 ID（格式：YYYY-MM-DD-<6位随机hex>）
CONTENT_ID=$(date +%Y-%m-%d)-$(openssl rand -hex 3)
echo "CONTENT_ID: ${CONTENT_ID}"

# 创建 NAS 目录
ssh 徐啸@100.110.241.76 "mkdir -p /volume1/ZenithJoy/content/${CONTENT_ID}/images"

# 上传图片
scp ~/claude-output/images/<slug>-*.png 徐啸@100.110.241.76:/volume1/ZenithJoy/content/${CONTENT_ID}/images/

# 上传文案
scp ~/claude-output/<slug>-content.html 徐啸@100.110.241.76:/volume1/ZenithJoy/content/${CONTENT_ID}/

# 数据库注册（Brain API）
curl -X POST localhost:5221/api/brain/content \
  -H "Content-Type: application/json" \
  -d "{
    \"content_id\": \"${CONTENT_ID}\",
    \"slug\": \"<slug>\",
    \"title\": \"<标题>\",
    \"type\": \"solo-company-case\",
    \"platforms\": [\"douyin\", \"xiaohongshu\", \"wechat\"],
    \"image_count\": 10,
    \"status\": \"ready\"
  }"
```

NAS 离线时（ssh timeout）→ 跳过上传，记录 CONTENT_ID，图片已在本地 `~/claude-output/images/`，用户上线后手动上传。

---

## Step 6 — 预览页

生成 `~/claude-output/<slug>-preview.html`，包含：
- 竖版图文横向滚动行（缩略图高440px）
- 公众号配图展示行
- 点击灯箱放大
- 社媒文案 + 公众号文章展示区

关键 CSS：
```css
.cards-row { display:flex; gap:16px; overflow-x:auto; align-items:flex-start; }
.lightbox { position:fixed; inset:0; background:rgba(0,0,0,0.92); display:none; }
.lightbox.active { display:flex; align-items:center; justify-content:center; }
```

---

## Step 7 — 输出链接

```
封面：http://38.23.47.81:9998/images/<slug>-cover.png
卡1：http://38.23.47.81:9998/images/<slug>-01-<theme>.png
...
预览：http://38.23.47.81:9998/<slug>-preview.html
```

---

## 禁止事项

- 禁止 emoji（SVG 中用 `·`、圆点、中文符号替代，用 `iconDot()` SVG 图标）
- 禁止 `.slice(n)` 截断文字（预定义行数组）
- 禁止硬编码 y 坐标（链式计算）
- 禁止 6 张卡用同一版式（覆盖≥4种）
- 禁止连续两张用视觉相似版式
- 禁止跳过 Gate 检查直接给链接

---

## 参考实现

- 脚本参考（技术写法）：`/Users/administrator/claude-output/scripts/gen-karpathy-v2.mjs`
  - 已验证：无重叠、2x渲染、ACCENTS轮换、预定义行数组
  - **注意**：karpathy 的版式组合（时间线/飞轮/时间块/Q&A/双列对比/大数字背景）是针对那批数据选出来的，**不是模板**。下一个主题应该重新走 Step 3a 选版式，不要照抄这个组合。
