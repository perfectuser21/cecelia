# 设计:刀C全家——锚点回填四件套

> 2026-07-19 | 任务 28108503-9c9b-49ff-adcc-d346cf391735 | 信息逻辑重建刀C
> 前提:锚点回填提案(`docs/proposals/anchor-proposal-20260719.md`)已批阅,批准清单定稿(`anchor-approved-20260719.json`,30 条),裁决落库(`decisions` id `1e153663`)

## 目标

存量批准的 30 条锚点一次性写库;同时把"锚点回填"从一次性人工动作变成自动化闭环——新建 feature 出生即焊、sprint merge 后自动焊、nightly 巡检断锚不许升。

## 非目标

- 不重新批阅提案里已裁决的条目(见 `anchor-approved-20260719.json`,本刀直接消费结果)
- 不扫 zenithjoy-workspace 二仓的锚点覆盖率(刀A2 已声明留给下一刀)
- 不建新表:`journey_features.{unit_test_path,workflow_ref,guard_ref}` 三列已存在(282/295/343 号迁移),锚点哨兵复用 `graph-query.js` 现成的 `classifyFeatureAnchors()`,不重复发明判定逻辑
- 不做 Dashboard 可视化

## 关键现实(设计必须诚实容纳)

- `POST /journey_features`(`packages/brain/src/routes/journeys.js`)目前对锚点字段零校验,任何 status 都能裸奔创建——这是"出生即焊"要补的口子
- `add-feature.js` 只透传 `--unit-test-path`,没有 `--workflow-ref`/`--guard-ref` 参数
- `harness-report.mjs` S6 只翻 `status`,不碰锚点字段;`harness_initiative` 任务的 `payload.feature_id` 现成可用,不需要反查图
- 现有账龄哨兵/扫描器都不写 `issues`/`decisions` 表告警,统一走 `POST /api/brain/harness/notify`(`main-repo-sentinel.sh` 的 `notify()` 写法)或纯 stdout(`run-all-scans.sh`)——锚点哨兵跟随 `notify()` 这条路径，不新造告警通道
- `rescan-if-changed.sh` 的状态文件用 `/tmp` 默认路径(可被清空,重启后最坏情况是漏一次告警,不会误报)——锚点哨兵沿用同一容忍度，不为此单独加持久化表

## 设计

### 1. apply器 `scripts/anchor/apply-anchors.js`

零 IO 纯函数 + 一个执行入口，DI 方式测试:

```
parseApprovedFile(jsonContent) → entries[]           // 直接 JSON.parse + 校验每条含 feature_id
resolveFeatureId(pool, shortId) → uuid|null           // journey_features.id::text ILIKE '<shortId>%'，多命中报错退出（提案短id唯一性由批阅阶段保证，这里只做防御）
buildPatchPayload(entry) → { unit_test_path, workflow_ref, guard_ref }  // 只带非null字段，避免PATCH把已有字段误清空成undefined→null
```

执行流程：读 `docs/proposals/anchor-approved-20260719.json` → 逐条 `resolveFeatureId` → `PATCH /api/brain/journey_features/:id` → 打印执行结果 → 写 `$SPRINT_DIR/apply-anchors-result.json`（`{applied:[{feature_id,fields}], skipped:[{feature_id,reason}], failed:[...]}`）。

**确认的前置缺口**：`PATCH /journey_features/:id`（`packages/brain/src/routes/journeys.js:250`）现状字段白名单是 `thickness/status/unit_test_path/version/guard_ref/softness/group`——**没有 `workflow_ref`**。批准清单 30 条里有 6 条（`6b2ab9b5`/`9b56cbae`/`39130340`/`ca5fe5ec`/`7b5b403c`/`24a98312`）需要写 `workflow_ref`，本 PR 必须先给这个路由加一行 `if (workflow_ref !== undefined) { sets.push(...); vals.push(workflow_ref ?? null); }`，否则 apply器对这 6 条的 PATCH 会静默丢字段（现有路由对未知 body 字段直接忽略，不报错——这是本设计能提前发现的原因，不加会导致数据没写全却看不到报错）。

`--dry-run`：只做到 `resolveFeatureId` + 打印 diff（当前值 vs 将写入值，需要先 GET 现有行），不调 PATCH。

失败处理：单条 resolve 失败或 PATCH 失败不中断整批（记入 `failed[]`，继续下一条），跑完打印 `失败 N 条` 摘要，退出码按是否有 `failed` 决定（有失败 exit 1，供 CI/人工判断，但这是一次性脚本，不进 CI 常驻）。

### 2. 锚点哨兵 `scripts/patrol/anchor-sentinel.sh` + `packages/brain/scripts/anchor-sentinel-check.mjs`

复用 `classifyFeatureAnchors()`（`packages/brain/src/lib/graph-query.js`，已在刀A2 落地，无需改动）。

`anchor-sentinel-check.mjs`（纯 Node，无 shell 逻辑，方便单测）：
```
main() →
  edges = SELECT src_path,dst_path,edge_type FROM graph_edges WHERE repo='cecelia'
  features = SELECT id,name,unit_test_path,workflow_ref,guard_ref FROM journey_features
  classified = classifyFeatureAnchors(features, buildNodeSet(edges))
  broken = classified.filter(f => f.status !== 'covered').length   // unanchored + uncovered
  print JSON: { broken, total: classified.length, covered: classified.length - broken }
```

`anchor-sentinel.sh`（沿用 `main-repo-sentinel.sh` 的 `notify()` 写法 + `rescan-if-changed.sh` 的状态文件写法）：
```bash
STATE_FILE="${ANCHOR_SENTINEL_STATE_FILE:-/tmp/anchor-sentinel-last-broken-count}"
result=$(node packages/brain/scripts/anchor-sentinel-check.mjs)
broken=$(echo "$result" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0)).broken))")
last=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
if [[ "$broken" -gt "$last" ]]; then
  notify "锚点断锚数上升" "上次 $last → 本次 $broken，见 /api/brain/graph/locate 排查"
fi
echo "$broken" > "$STATE_FILE"
```

`notify()` 函数直接从 `main-repo-sentinel.sh` 抽出复用（两个脚本都 `source` 一个共享的 `scripts/patrol/lib/notify.sh`，本 PR 顺手把 `main-repo-sentinel.sh` 内联的 `notify()` 提取出来，两脚本一起用——这是"改功能A同步清理周边矛盾"，不是范围蔓延，两脚本本来就该共享同一份告警实现）。

crontab：`0 5 * * * ... run-all-scans.sh && anchor-sentinel.sh >> /tmp/anchor-sentinel.log`（紧跟扫描之后跑，保证锚点哨兵吃到当天最新的 graph_edges）。

Proven-to-fire 验证（DoD 要求）：本地手动把一条已焊 feature 的 `guard_ref`/`unit_test_path` 置空模拟断锚，跑一次脚本，亲眼看 `notify` 被调用；随后写回原值。

### 3. 出生即焊

`packages/brain/src/routes/journeys.js` `POST /journey_features`：

```js
if (status && status !== 'planned') {
  const hasAnchor = unit_test_path || workflow_ref || guard_ref;
  if (!hasAnchor) {
    return res.status(400).json({ error: 'status 非 planned 时必须至少提供一个锚点字段(unit_test_path/workflow_ref/guard_ref)' });
  }
}
```

放在现有 `if (!name)` 校验之后、INSERT 之前。`status` 未传（沿用列默认值，通常是 `'planned'`）或显式 `'planned'` 不受限——骨架阶段没有代码，强制要求锚点会挡住合法的"先建骨架后写代码"流程。

`add-feature.js` 加 `--workflow-ref`/`--guard-ref` 两个可选参数，透传进 POST body，向后兼容（不传即 null，行为不变）。

### 4. merge自动焊

`packages/brain/scripts/harness-report.mjs` S6（`PATCH /journey_features/:id {status:'done'}`）之后追加：

```js
try {
  const featureId = task.payload?.feature_id;
  if (featureId) {
    const feature = await getJourneyFeature(featureId);   // 已有 GET 端点
    if (feature && !feature.unit_test_path && !feature.workflow_ref && !feature.guard_ref) {
      const changedFiles = await getPrChangedFiles(prNumber);  // gh api 或已有的 PR 元数据
      const testFile = changedFiles.find(f => /\.(test|spec)\.[jt]sx?$|_test\.py$|test_.*\.py$/.test(f));
      if (testFile) {
        await patchJourneyFeature(featureId, { unit_test_path: testFile });
      }
    }
  }
} catch (e) {
  console.warn(`[harness-report] 锚点自动回填失败(非致命): ${e.message}`);
}
```

只在三锚字段皆为 `null` 时才写，且只写 `unit_test_path`（不猜测 workflow_ref/guard_ref，避免把普通单测文件误标成 e2e/guard）——已有锚点（无论是 apply器焊的还是人工焊的）永远不被这段逻辑覆盖。失败不阻断 harness-report 收尾（try/catch 包裹，锚点回填是加分项不是关卡）。

## 测试策略

- **unit**：`buildPatchPayload`/`resolveFeatureId`（apply器，mock pool）；`classifyFeatureAnchors` 已有测试覆盖不重复写；`anchor-sentinel-check.mjs` 的 `broken` 计数逻辑（mock DB 返回固定 features+edges，断言 broken 数）；merge自动焊的两个分支（皆 null → 回填 / 已有锚点 → 不覆盖）
- **integration**：`POST /journey_features` 两个分支（status=working 无锚点 → 400；status=planned 无锚点 → 201）
- **manual/e2e**（DoD `[BEHAVIOR]`）：apply器 `--dry-run` 真跑一次 + 去 dry-run 真跑一次，psql 验证 30 条落库；锚点哨兵 proven-to-fire（人为制造断锚上升，亲眼看 notify 被调）

## 风险与边界

- `anchor-approved-20260719.json` 里的 `feature_id` 是短 id（提案文档里展示的 8 位前缀），apply器靠 `ILIKE '<prefix>%'` 解析成真实 UUID——若批阅之后、apply器执行之前这批 feature 被删除或 id 前缀冲突，resolve 会失败并记入 `failed[]`，不会误写别的 feature（防御性设计，非本次要解决的问题，只是诚实标注）
- merge自动焊只处理 `unit_test_path`，`workflow_ref`/`guard_ref` 的自动化留空——这两个字段语义更依赖人工判断（e2e/guard vs 普通单测），机械猜测误判代价更高，宁可留给下一批人工/apply器批次
