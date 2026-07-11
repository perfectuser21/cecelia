# 设计：九要素T6 两轴衔接——KR↔Ability 轻边 + 对账端点

日期：2026-07-11
上游：docs/architecture/2026-07-10-nine-elements-integrity/architecture.md（T6，PR #3731 已拍板）
任务：Brain task f477cf9a-5b39-4f47-b07e-0aa00d239a2b（plan=nine-elements-integrity, seq=6）
决策：47dd265d（两轴衔接落地方式，small-change）

## 目标

OKR 轴（key_results）与能力轴（journey_features/advancement_items）之间建立轻边：
KR 通过 `metadata.target_abilities`（ability_id 数组，JSONB 约定 key，零 migration）指向它要推进的能力；
季度末通过对账端点把"这个 KR 推进了哪些能力、各自厚度与推进项完成度"算出来。

## 变更 1：PATCH /api/brain/goals/:id 支持 metadata（task-goals.js）

- 在现有 setClauses 里加可选字段 `metadata`，写法必须为：
  `metadata = COALESCE(metadata, '{}'::jsonb) || $n::jsonb`
- **为什么必须 COALESCE**：objectives/key_results 的 metadata 列均为可空无 DEFAULT（migration 177），
  `NULL || jsonb = NULL` 会静默吞掉写入。库内既有惯例：kr-verifier.js:74/194、okr-tick.js:298。
- 先 objectives 后 key_results 的两段式 UPDATE 保持不变，两表都有 metadata 列，通用。
- 互斥规则（写进 PR 描述）：okr-hierarchy.js mountCrud 的 `PATCH /okr/key-results/:id` 对 metadata
  是**整体覆盖**语义——改 target_abilities 一律走 goals PATCH（merge），禁走 mountCrud PATCH。

## 变更 2：GET /api/brain/okr/kr/:id/ability-progress（okr-hierarchy.js）

新端点加在文件尾部（export default 前），风格随现有 handler（try/catch + success 包裹）：

1. 查 key_results 行（id/title/metadata）；不存在 → 404。
2. 取 `metadata.target_abilities`；缺省/空数组 → 返回 `{ success:true, kr_id, kr_title, abilities:[], missing_ability_ids:[], hint:'该KR未登记target_abilities' }`。
3. 一条 SQL join：`journey_features`（WHERE id=ANY($ids) AND kind='ability'，取 id/name/thickness/status）
   LEFT JOIN LATERAL 聚合 `advancement_items` 的 `COUNT(*) FILTER (WHERE status=...)`（写法参考 abilities.js:358-366）。
4. 每个 ability 的 `advancement` 用 `computeProgress`（`import { computeProgress } from '../advancement-progress.js'`，
   与 abilities.js 同路径）算 `{done,doing,todo,total,pct}`。
5. `target_abilities` 里引用了但 journey_features 查不到（或 kind≠ability）的 id → 归入 `missing_ability_ids`
   （对账端点的本职就是暴露失联引用）。

响应形状：

```json
{
  "success": true,
  "kr_id": "…", "kr_title": "…",
  "abilities": [
    { "ability_id": "…", "name": "…", "thickness": "thin", "status": "…",
      "advancement": { "done": 2, "doing": 1, "todo": 3, "total": 6, "pct": 33 } }
  ],
  "missing_ability_ids": []
}
```

## 变更 3：decomp skill（zenithjoy-skills repo，另一 PR）

Phase 1 KR 拆解段加死步骤：拆完 KR 必须把 ability id 列表写进
`key_results.metadata.target_abilities`（`curl -X PATCH /api/brain/goals/:kr_id -d '{"metadata":{"target_abilities":[…]}}'`）；
ability id 来自 `GET /api/brain/journey_features` 语义匹配，禁凭空造。merge 后刷 dist。
本 repo PR 不含此项。

## 测试策略（integration 档）

- `packages/brain/src/__tests__/routes/task-goals.test.js`（既有文件追加）：
  PATCH 带 metadata → 断言 SQL 含 `COALESCE(metadata, '{}'::jsonb) ||` 且参数为 JSON 字符串；
  不带 metadata → SQL 不含 metadata（回归保护）。
- okr-hierarchy 新端点单测（advancements-api.test.js 的 getHandler + mockReqRes 模式）：
  ① 正常 join 三态聚合 ② target_abilities 缺省 → 空数组+hint ③ 含失联 id → missing_ability_ids ④ KR 不存在 → 404。
- manual 验收：真库上给某 KR 写 target_abilities → 端点数字与 journey_features/advancement_items 直查一致。

## 版本与门禁

- brain minor bump（新端点=feature）：package.json + package-lock.json + .brain-versions + DEFINITION.md 四处同步。
- 无新 migration，不动 EXPECTED_SCHEMA_VERSION。
- 提交前：`node scripts/facts-check.mjs` + `bash scripts/check-version-sync.sh`。

## 不做（YAGNI）

- 不建正式列/不加 migration（架构决策：轻边验证被使用后再转正）。
- 不做 Dashboard 视图、不做 Notion 同步扩展。
- 不动 mountCrud PATCH 的整体覆盖语义（既存行为，另案）。
