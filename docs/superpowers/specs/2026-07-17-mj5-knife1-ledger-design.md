# 设计：MJ5 刀1 — 承诺地图账本落库（schema + blast-radius API + 两域打样）

> 上游：PRD `docs/prd/2026-07-17-mj5-promise-map-first-cut.prd.md` §三、§十(刀1)｜Brain 任务 c93b3def｜判定点决策 c6d6d0bc/1d1cc811/705cd806/979951a5
> 数据 SSOT（三张图）：V4 骨干 artifact c9754f42 / 全景四个家 4e744c89 / GP-B 总表 93a47469
> 对抗审查：Research 子代理 a8f087bd 已过一轮（3 blocker 全部吸收，见「集成修复」节）

## 1. 范围

刀1 只做 S1（切路入账）：schema migration + 落账/查询 API + 两个打样域数据落库。
不做：锚点闸（刀2）、evaluator 联动（刀3）、nightly 对账（刀4）、指挥舱前端、db-update/mapper skill 文案（zenithjoy-skills 仓库，另 PR）。

## 2. 数据模型定案

**一条 GP = 一条 journeys 行**（home='biz'，domain 分组域）。证据：
- PRD 把 trigger/endpoint 放 journeys；
- 首次成功路径被 PRD 称"公司级 GP，journey 已存在"（GP≡journey 先例）；
- mapper skill Mode1 已按 `.journeys[] | select(.domain==…)` 查询。

`golden_paths`（复数）保持军师提案生命周期表，不动。`golden_path`（单数，sprint FR 表）不动。
格子 = 扩展 `journey_step_links`（判定点③，禁平行表）。

## 3. Migration 347（schema）

```sql
-- journeys
ALTER TABLE journeys ADD COLUMN home varchar(10) CHECK (home IN ('biz','pre','xcut','factory'));
ALTER TABLE journeys ADD COLUMN domain varchar(100);
ALTER TABLE journeys ADD COLUMN trigger text;          -- 已验证非保留字（decisions.trigger 先例）
ALTER TABLE journeys ADD COLUMN endpoint text;
-- journey_steps
ALTER TABLE journey_steps ADD COLUMN promise text;
ALTER TABLE journey_steps ADD COLUMN backbone_version integer NOT NULL DEFAULT 1;
-- journey_features
ALTER TABLE journey_features ADD COLUMN softness varchar(10) NOT NULL DEFAULT 'hard'
  CHECK (softness IN ('hard','soft'));
-- journey_step_links → 格子化
ALTER TABLE journey_step_links ALTER COLUMN step_order DROP NOT NULL;  -- cell 行无自然序号
ALTER TABLE journey_step_links
  ADD COLUMN feature_id uuid REFERENCES journey_features(id) ON DELETE SET NULL,
  ADD COLUMN cell_kind varchar(20) CHECK (cell_kind IN ('capability','element','scenario','base_ref')),
  ADD COLUMN cell_key varchar(200),
  ADD COLUMN cell_status varchar(10) CHECK (cell_status IN ('gray','red','pending','green')),
  ADD COLUMN assertion_ref text,
  ADD COLUMN na_reason text,
  ADD CONSTRAINT jsl_cell_key_required CHECK (cell_kind IS NULL OR cell_key IS NOT NULL);
ALTER TABLE journey_step_links DROP CONSTRAINT IF EXISTS journey_step_links_journey_id_step_id_key;
CREATE UNIQUE INDEX uq_jsl_membership ON journey_step_links(journey_id, step_id) WHERE cell_kind IS NULL;
CREATE UNIQUE INDEX uq_jsl_cell ON journey_step_links(step_id, cell_kind, cell_key) WHERE cell_kind IS NOT NULL;
CREATE INDEX idx_jsl_feature ON journey_step_links(feature_id) WHERE feature_id IS NOT NULL;
```

语义：
- 旧行（cell_kind IS NULL）= journey↔step 连接（原语义原样保留）。
- 新行（cell_kind 非空）= 格子：capability（能力芯片）/ element（11 要素之一）/ scenario（场景牌）/ base_ref（底座引用，feature_id 必挂）。
- cell_key = 芯片名/要素名/场景名/底座件名（幂等键之一）。
- 软格标注（模糊承诺）：thin 档用 `assertion_ref = 'eval:…'` 前缀表达（journey_features.softness 供件级标注，本次 seed 无软件）。

## 4. Migration 348（两域 seed，幂等 + 空库自足）

规则（CI blocker 吸收）：
- 所有新 journey/feature 用**固定 UUID 字面量** + `ON CONFLICT (id) DO NOTHING`（journeys/journey_features 无 name UNIQUE）；
- steps 用 `ON CONFLICT (journey_id, step_number) DO UPDATE SET promise=EXCLUDED.promise`（不覆盖已有 name/status，首次成功 S2 存量行零丢失）；
- cells 用 `ON CONFLICT (step_id, cell_kind, cell_key) …`（借 347 的 partial unique）幂等，且 **`notion_synced_at = NOW()`**（不推 Notion）；
- 对存量行（bfeed805 客户私域 AI 接管、6e63f204 首次成功）：UPDATE 补 domain/home/trigger/endpoint；空库时由本 migration 以同 UUID 创建（自足）；
- journeys/steps/features 非 cell 行保持 notion_synced_at=NULL，照常推 Notion（PRD：自动副作用照旧）。

### 4.1 落库清单（与三张图逐项对应）

**域=智能客服（Line04），home='biz' 的 5 条 GP journey**（trigger/endpoint/promise 全部取 V4 原文）：
| GP | trigger | endpoint | steps(promise 略，见 V4) |
|----|---------|----------|--------------------------|
| GP-B 被动接待 | 客户发来消息 | 客户收到得体回复（或真人接手），这笔互动老板可查 | S1 消息被感知 / S2 决定谁来答 / S3 回复送达 / S4 留痕与善后 |
| GP-C 朋友圈发布 | 到了该发内容的时候（内容日历/老板指令） | 一条像人发的朋友圈，出现在客户能看到的地方 | S1 内容成稿 / S2 发布上圈 / S3 发布确认与留痕 |
| GP-D 经营汇报 | 到汇报时间（日/周/月） | 老板按时收到一份真实反映经营情况的报告 | S1 数据齐备 / S2 报告生成 / S3 送达老板 |
| GP-E 朋友圈互动 | 客户发了朋友圈 | 客户感到被关注，关系升温且不越界 | S1 客户动态被感知 / S2 互动决策 / S3 互动执行与留痕 |
| GP-F 社群运营 | 群里出现需要响应的动静 | 群保持健康有序，客户问题被接住 | S1 群动静被感知 / S2 响应与治理 / S3 留痕 |

step.status 映射：任一亮/半格 → in_progress；全灰/全红 → planned；家② 全亮 → done。

**家②**：journey「智能客服 · 绑定/安装（共享前置）」home='pre'，3 步全 done（注册自动登录 / 装客户端+Agent 连中台 / 扫码绑抖音主号，V4 原文）＋ feature「绑定/安装（共享前置）」（kind=feature，group='家②共享前置'，working）。

**家③ 7 底座件**（journey_id=bfeed805，kind=feature，group='家③横切件池'）：
消息/动态采集通道(working)、Agent 运行时底座—启动状态恢复·开机自检·保活重连(planned)、后台静默发送通道(working)、接管开关(working)、客户画像卡(planned)、CRM 表底座(building)、记忆库租户隔离—不变量(working)。
（存量 43 个 V3 件不动、不删、不改挂——后续 mapper Mode2 归位，存量豁免原则=判定点④同源。）

**GP-B 逐格**（总表 SSOT；只落图上画了的格子，不虚构）：
- capability：S1 文字green/图片·语音·表情·链接·红包·转账·文件gray；S2 怒诉退转人工green/CRM分级依据pending/客户画像卡gray；S3 文字发送green/图片·链接·文件视频gray；S4 CRM回填pending/拉黑检测gray/对话摘要入档gray。
- element（cell_key ∈ FR/NFR/判定点/两轴衔接/不变量/失败语义/死亡告警/效果确认/对抗面/保质期/账本保鲜）：
  S1 FRpending·NFRgreen·判定点pending·两轴red·不变量green·失败语义/死亡告警/效果确认/对抗面/保质期red；
  S2 FRgreen·NFRred·判定点pending(软→assertion_ref='eval:模糊承诺-该不该转LLM判,评测集待建')·两轴na(本步不跨lane)·不变量green·5托管red；
  S3 FRgreen·NFRgreen·判定点red(软→assertion_ref='eval:模糊承诺-得体判定,评测集待建')·两轴na·不变量green·失败语义/死亡告警/效果确认/保质期red；
  S4 FRpending·NFRred·判定点red·两轴pending·7 托管全red（死亡告警安家在此）。
- scenario（只落图示格）：S1 日常green·首次green·重启/断网/洪峰/平台改版red·凭据过期na(本步不涉凭据)；S2 日常green·人不在线red·对抗输入red·重启na(无状态可恢复)；S3 日常green·断网排队重发/微信升级后/高峰频控red；S4 全场景未验red。
- base_ref（feature_id 必挂）：S1→消息采集通道green+Agent底座gray+绑定/安装green；S2→接管开关green+CRM表底座pending+记忆库隔离green；S3→静默发送通道green；S4→CRM表底座pending。

**GP-C/D/E/F 格子**（V4 芯片 + 家③引用列，规则同上）：
C·S1 文案生成green/配图生成gray、判定点pending(AI画图vs素材库,未拍板)；C·S2 纯文案发布green/图文发布gray；C·S3 发布结果确认red/发布台账red；C·S1 base_ref 绑定/安装green。
D·S1 CRM表为唯一数据源pending + base_ref CRM表底座pending；D·S2 日报pending/周报gray/月报gray；D·S3 推送通道与送达确认red。
E·S1 动态采集gray + base_ref 消息采集通道gray + 绑定/安装green；E·S2 判定点green(已拍板:语义判定点赞;评论AI出稿不自动发)；E·S3 点赞执行gray/评论发布-人审后gray/回填CRM关系记录red + base_ref 静默发送通道gray+CRM表底座gray。
F·S1 群消息采集gray + 判定点green(已拍板:默认全静默只拉白关键群) + base_ref 消息采集通道gray + 绑定/安装green；F·S2 群内AI答/群公告/踢广告号gray + base_ref 静默发送通道gray；F·S3 群运营台账red。

**首次成功（6e63f204，domain='公司级'，home='biz'）**：trigger='客户签约开通'，endpoint='客户自己会看 Dashboard 了解经营情况'。五步：S1 开通(done)/S2 装好连上(存量行,补promise)/S3 绑资产(done)/S4 第一次价值·按线参数化(in_progress)/S5 会看 dashboard(in_progress)，每步一句承诺；S2 base_ref→绑定/安装（家②引用关系）。

## 5. 集成修复（对抗审查 3 blocker + must_change）

1. `routes/journeys.js:352`：`ON CONFLICT (journey_id, step_id)` → `ON CONFLICT (journey_id, step_id) WHERE cell_kind IS NULL`（partial index 推断），否则删约束后 POST /journey_step_links 生产必 500。
2. `notion-push-sync.js:~285`：pushJourneyStepLinks 查询 WHERE 加 `AND l.cell_kind IS NULL`（+ seed 侧 cell 行 notion_synced_at=NOW() 双保险）。
3. blast-radius 端点挂 `GET /api/brain/journey_features/:id/blast-radius`（`/api/brain/features` 前缀已被 feature-ledger 表占用），实现在 routes/journeys.js，注册在 `:id` 类路由之前（unguarded-count 先例）。
4. 落账端点扩白名单（mapper 接线的最小集）：
   - 新增 `PATCH /journeys/:id`：home/domain/trigger/endpoint/description/maturity（显式白名单）；
   - `POST /journey_steps` upsert 扩 promise/backbone_version（insert+update 都带）；
   - `PATCH /journey_features/:id` 白名单加 softness/group；
   - `POST /journey_step_links` 扩 cell_kind/cell_key/cell_status/feature_id/assertion_ref/na_reason，按 cell/非 cell 分流两个 ON CONFLICT 目标。
5. `selfcheck.js:28` EXPECTED_SCHEMA_VERSION → '348'；DEFINITION.md「Schema 版本」+「Brain 版本」行同步；版本 bump 四件套（brain package.json / package-lock / .brain-versions / DEFINITION.md）。

## 6. blast-radius API 契约

`GET /api/brain/journey_features/:id/blast-radius` →
```json
{ "feature": {"id","name","status","group"},
  "blast_radius": [ {"journey_id","journey_name","domain","step_id","step_name","step_number","promise","cell_status"} ],
  "count": N }
```
查询：journey_step_links WHERE feature_id=$1 AND cell_kind='base_ref' JOIN journey_steps/journeys，按 journey_name,step_number 排序。404=feature 不存在；正常空引用返回 count=0（S4 对账断言 3 的数据源）。

## 7. 测试策略（四档定级：integration 为主）

- **integration（真 postgres，brain-integration job 每 PR 跑）**：
  - `migration-347.integration.test.js`：information_schema 断言新列/CHECK/两个 partial unique/idx_jsl_feature 存在；旧约束不存在；
  - `migration-348.integration.test.js`：seed 后断言——journeys(domain='智能客服') = 7 条（5 GP + 家② + 存量 bfeed805）；GP-B 4 步 promise 与 V4 原文一致（逐字对比 S1 promise）；家③ 7 件在账；**blast-radius(CRM 表底座) = 恰好 4 步（B·S2/B·S4/D·S1/E·S3，对齐全景图"四处红"）**；二次重跑 migrate 不新增行（幂等）；
  - `blast-radius.integration.test.js`：路由真查（200 形状 / 404 / count=0 空引用）。
- **unit（mock pool，PR 快路 4 shards）**：routes/journeys.test.js 补 blast-radius 参数校验 + POST /journey_step_links cell 分流 upsert SQL 断言 + notion-push WHERE 含 cell_kind IS NULL。
- **manual（DoD [BEHAVIOR]，CI 兼容）**：`curl localhost:5221/api/brain/journeys` 断言 domain/home/trigger 字段；`curl …/journey_features/<CRM底座uuid>/blast-radius` 断言 count=4。
- E2E 档：无 UI 面，本刀不设 Playwright E2E（PRD 验收即 API 断言）。

## 8. 验收（对 PRD 刀1）

- [ ] 两打样域账本 API 可查且与三张图一致（integration 测试逐字断言 + manual curl）
- [ ] blast-radius 端点上线且 CRM 表底座返回 4 步（全景图口径）
- [ ] 现存 POST /journey_step_links、Notion push 零回归（blocker 1/2 修复 + 单测）
- [ ] CI 全绿（brain-unit + brain-integration + DevGate 三件）
- [ ] 账本写入全部为 migration 自动副作用，零手工步骤
