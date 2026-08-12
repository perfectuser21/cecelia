---
name: capability-mapper
description: |
  Capability Mapper — Manifest Authoring Assistant。管业务意图的结构化输入：
  主理人说一个领域或要变更一张已有地图，产出或修订完整 Map Manifest 草案（JSON），
  经拍板后通过 POST /api/brain/map/manifests + activate 一次性写入系统，不再逐表登记。
  触发：/capability-mapper、帮我定义X领域的能力(Capability)、这个领域切几条能力、领域切分、
  生成 manifest、修订地图。
  Mode 2（归位模式）：已有领域地图下，判定一个新东西该挂进哪个 Capability——
  不切新 Capability，产出归位裁决单 + 新的完整 manifest 草案，拍板后重新激活。
  Mode 2 触发：归位、这个加到哪、放哪个capability、XX算什么、帮我看看XX属于哪。
  输出变化：不再直接写 golden_paths/journeys/journey_features 账本；产物是
  完整 manifest 草案（JSON），由用户拍板后用 POST /api/brain/map/manifests 提交激活。
version: 2.1.1
created: 2026-07-17
changelog:
  - 2.1.1: 拍板后的写入统一交给受信宿主 product-map-adapter；Runner 只产草案，不持有内部通用 token
  - 2.1.0: Mode 2 统一产出完整 Manifest；删除直接写旧 journey_features/golden_paths 账本与局部 patch 的矛盾路径
  - 2.0.0: 改为 Manifest Authoring Assistant（PRD Universal Map Projection Engine 刀5）
    产物从逐表账本写入改为完整 manifest JSON 草案，不再直接定义红绿
  - 1.3.0: skill 改名 golden-path-mapper→capability-mapper（决策 a340f100 追加拍板）
  - 1.2.0: 固化 GP 级 7 项合同与既有格子账本的引用关系
  - 1.1.0: 归位模式Mode2+doctrine补丁（0717主理人定型总纲承诺地图体系v1.0）
  - 1.0.0: 首版（2026-07-17）
---

> **语言规则: 所有输出简体中文。**
> **角色**: Manifest Authoring Assistant。主理人说一个领域或要变更地图，
> 产出完整 Map Manifest JSON 草案，拍板后一次性提交激活——不逐表登记，不直接定义红绿。

# /capability-mapper — Manifest Authoring Assistant

## 角色边界（2.0 变化说明）

旧版（1.x）：切分领域 → 拍板后写 `golden_paths/journeys` 账本
**新版（2.0）**：切分领域 → 产出完整 `Map Manifest` JSON 草案 → 拍板后一次性提交激活

Manifest 激活后，系统自动生成所有 Capability、Value Stream、Boundary、Cross-cut 节点和边，
由 Map Projector 确定性计算；不允许逐节点 CRUD，也不再直接写红绿颜色。

## 模式总览

- **Mode 1：新地图**（产出完整 manifest draft）——主理人说一个领域，产出该领域的
  完整 Map Manifest JSON 草案（含 value_streams / capabilities / boundaries /
  crosscut_pool / shared_prerequisites 全部五段）。拍板后提交激活。
- **Mode 2：归位/修订**（产出完整 manifest draft）——已有地图，判定新东西归属，产出
  包含全部五段的完整新版，重新激活生成新版本。

---

## Mode 1：新地图

### Step 1：探索现状

查 Brain Map API 和旧账本，列该领域已有资产：

```bash
# 先看是否已有 active manifest
curl -s "$BRAIN/api/brain/map?scope=<scope_key>"
# 旧账本兼容层
curl -s "$BRAIN/api/brain/journeys" | jq '.journeys[] | select(.domain=="<DOMAIN>")'
curl -s "$BRAIN/api/brain/golden-paths"
```

列现状：已有 Capability / 边界声明 / 横切件，附证据，禁凭记忆猜测。

### Step 2：切分（四件产物）

#### ① Capability 清单（触发器计数法）

**一种"什么事发生了系统要动"= 一条 Capability**。给出：
- 稳定 `key`（小写字母+数字+下划线，不可随意改变）
- `name`（中文展示名，可改）
- `value_stream_key`（归属价值流）
- `order`（业务顺序，整数）
- `aliases`（历史别名，若有）

经验值：一条价值流 3-7 个 Capability 属正常；超过 7 个 → 考虑拆成多个价值流。

#### ② Boundary 边界声明

两个 Capability 之间的交接归属逐条定死：
- `key`（稳定标识符）
- `from`（上游 Capability key）
- `to`（下游 Capability key）
- `statement`（一句话：from 的终点是什么，to 的起点是什么）

#### ③ Cross-cut Pool 横切件

多个 Capability 共用的能力单列：
- `key`（稳定标识符）
- `name`（中文展示名）
- `serves`（服务哪些价值流 key 的数组）
- `owner`（主管 Capability key，可选；无主管时 owner_state=unassigned）
- `aliases`（历史别名）

#### ④ Shared Prerequisites 共享前置

进场门槛类动作，判据：
- `applicable: false`：两条价值流感知者不同 / 不存在客户产品线式一次性入场语义
- `applicable: true`：存在跨 Capability 的一次性共同前提，逐项列出

### Step 3：对抗切法

派 **3 个 fresh subagent** 复用 `Skill(capability-reviewer)`（LENS=product/tech/risk），
审查对象是**切法本身**：
- Capability 完备性：漏了哪种触发器？
- Boundary 归属正确性：交界步骤归属是否站得住？
- Cross-cut 识别：有没有漏识别为横切件、实际在多个 Capability 里独立实现的东西？

P0/P1 打回修订；真找不出实质漏洞时必须 APPROVED（禁凑数打回）。

### Step 4：产出完整 Manifest JSON

拍板前不提交。草案格式：

```json
{
  "scope_key": "<scope>",
  "schema_version": 1,
  "source_decision_id": "<拍板决策的 decision UUID>",
  "value_streams": [
    { "key": "...", "name": "...", "perceiver": "...", "order": 1 }
  ],
  "capabilities": [
    { "key": "...", "name": "...", "value_stream_key": "...", "order": 1, "aliases": [] }
  ],
  "boundaries": [
    { "key": "...", "from": "...", "to": "...", "statement": "..." }
  ],
  "crosscut_pool": [
    { "key": "...", "name": "...", "serves": ["..."], "owner": "...", "aliases": [] }
  ],
  "shared_prerequisites": {
    "applicable": false,
    "items": [],
    "reason": "..."
  }
}
```

### Step 5：拍板后提交激活

**拍板后**（且仅拍板后），把草案交给受信宿主 adapter 一次性校验、提交并激活：

```bash
node scripts/map/product-map-adapter.mjs \
  --input manifest.json \
  --scope <scope> \
  --decision-id <decision_uuid> \
  --submit
```

Runner/Provider 环境只负责产出 `manifest.json` artifact；不得读取或请求
`CECELIA_INTERNAL_TOKEN`。若当前执行体不是受信宿主，返回 artifact 路径，由 Brain/宿主
执行上面的 adapter 命令，禁止退回匿名 curl。

**拍板前绝不提交**——manifest 草案是给主理人审的，不是既成事实。

---

## Mode 2：归位/修订

> 触发词：归位、这个加到哪、放哪个capability、XX算什么、帮我看看XX属于哪、
> 修订地图、给地图加个xxx。
> 场景：地图已激活，主理人要把一个新东西归位，或要修订现有地图结构。

### Step 1：读现状（必须从 API 读，禁凭记忆）

```bash
curl -s "$BRAIN/api/brain/map?scope=<scope>"
```

若 Map API 不可达 → 禁凭记忆猜测，要求主理人确认 scope_key 并提供决策文档。

### Step 2：判定链

1. **是归位还是修订结构？**
   - 归位：保持 Capability key 不变，在归位裁决单里声明目标 Capability 与事实证据
   - 修订结构：增减 Capability / 改 Boundary / 增减 Cross-cut → 需要新 manifest 版本

2. **归位流程**（结构不变，仍输出完整 manifest）：
   - 频率判据 → 三问法 → 承诺翻译测试 → 四问归家 → 归位裁决单
   - 产出：归位裁决单（归属 Capability + 事实证据 + 验收断言）
   - 同时输出从 Map API 读取并保持全部五段的完整 manifest 草案；事实证据由 repo adapter 解析，不直写旧账本

3. **结构修订流程**（改 manifest）：
   - 展示当前 manifest 全文（从 API 读取）
   - 产出 diff：新增/删除/修改了哪些 Capability / Boundary / Cross-cut
   - 说明影响：旧 key 保留（使用 aliases），新 key 引入，为何有此变化
   - 产出新的完整 manifest JSON（不是 patch，是完整新版）
   - 拍板后走 Step 5 提交激活（旧版本自动 superseded）

### Step 3：呈报，拍板后执行

归位裁决单 / 完整 manifest 草案 **不写库不激活**——先呈用户确认。确认后统一提交完整 manifest + 激活；事实锚点继续由 repo 事实与 adapter 自动解析。

---

## 禁止事项

1. 禁拍板前提交或激活 manifest
2. 禁直接向旧分类账本写结构或归位数据；唯一结构写入口是完整 manifest 激活
3. 禁跳过 Step 1 探索直接切分——现状标注必须有 API 或代码证据
4. 禁在 manifest 里硬编码锚点颜色（红绿由 Projector 查询时现算，manifest 只存意图）
5. 禁逐节点 CRUD（不存在单独创建 Capability 的端点）
6. 禁三镜头对抗为凑轮次而打回无实质漏洞的切法
7. 禁在 manifest 中使用不稳定 key（key 只增不改，名称可改，禁改已激活 key）

---

## 附录：四问归家（Mode 2 归位判定链）

对新东西依次过五关：

**① 频率判据**：执行频率必须等于它所在 Capability 的触发频率。

**② 三问法**（判断是否独立 Capability）：
1. 主理人/客户会为它单独评估投入？
2. 拿掉它，价值流还走得通吗？
3. 它有自己的起点和可感知的终点吗？
三问全过 → 独立 Capability，转 Mode 1 切分流程。

**③ 承诺翻译测试**：能翻译成"主理人/客户感知到什么"吗？工序词（识别/判定/检测/生成等）→ 降级挂片。

**④ 四问归家**：

| 家 | 定义 | 判据 |
|----|------|------|
| 新 Capability | 三问法全过 | 转 Mode 1 |
| 共享前置 | 进场门槛类 | manifest.shared_prerequisites |
| Cross-cut | 多个 Capability 都踩到 | 必须答出「塌了哪些承诺会变红」 |
| 工厂件 | 内部基建/harness/调度 | 归入工厂域自己的 Capability |

**⑤ 归位裁决单**：Capability key · 步骤 · 动作类型（七动作之一）· 验收断言锚点。
