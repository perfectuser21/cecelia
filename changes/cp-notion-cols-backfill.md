## {VERSION}

### Notion 库缺列补全 + Skills 库纳管（驾驶舱真正可用）

**事故**：上一刀（#5238）加了 `Liveness`/`SilentFor` 两列，但 Notion 库里没有这两个属性，推送全部 400 `is not a property that exists`，被 `upsertOpsRows` 的逐行 catch 吞掉——看板静默停更。这是 09-06 已记过一次的坑（「建库脚本只在新建时加属性，复用已有库须单独 PATCH 补列」）第二次复发。

- **列定义集中到 `ops-notion-schema.js`**：四库列写一处，`diffMissingProps` 幂等算差集，`ensureProps` 缺啥补啥、已有的不动（免得 PATCH 覆盖人手调过的列配置）
- **Skills 库纳管**：此前它只存在于 Notion、19 条 `notion_id` 是一次性手动灌的，仓库里没有任何代码维护——与 Notion 停更同一类病。现在建库脚本纳管并写进 kv，回读能找到它（你要的 DisCo 档位人工覆盖就在这个库）
- **真跑补列**：图谱库 +8（Type/Schedule/Repeat 三个旧坑 + 人工列）、Workflows +7（活性两列 + 人工列 + Enabled）、Skills +14。二次运行全部「列齐全，跳过」，幂等确认
- **新增一致性闸** `ops-notion-schema-smoke.sh`：推送要发的列必须在库定义里、回读认的人工列必须在库定义里、人工列绝不能被推送发出去。两种事故形态均已 proven-to-fire

生产验证：推送恢复，Notion 上现显示「🔴 失联 / 停了 3.6 天」。
