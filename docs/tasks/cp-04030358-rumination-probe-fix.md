# Task Card: fix(brain): 修复 probeRumination 误报逻辑

## 元信息
- **分支**: cp-04030358-cedf9588-b511-4961-8b06-424ce9
- **任务 ID**: cedf9588-b511-4961-8b06-424ce9
- **优先级**: P0
- **领域**: quality（Brain 自监控）

---

## 根因分析

**故障现象**：2026-04-02 20:44 CDT，capability probe 报告 `rumination` 链路 FAIL：
```
48h_count=0 last_run=never undigested=8
```

**根因**：
1. 4月1日 CDT 早晨，`runRumination` 处理了所有可用 learnings，synthesis_archive 写入
2. 4月2日 CDT 全天，rumination 持续运行但无新 learnings（`skipped: no_undigested`）
3. 4月2日 CDT 傍晚，8 条新 learnings 到达，但此时 synthesis_archive 最后写入已超过 48h
4. `probeRumination` 判断：`48h_count=0 AND undigested=8` → 报 FAIL

**本质**：这是探针的**误报（false positive）**。rumination 功能本身正常运作，只是：
- "空闲日"（无新 learnings）不会更新 synthesis_archive
- 新 learnings 晚到时，旧 synthesis 恰好滑出 48h 窗口
- 探针误以为链路故障

---

## 修复方案

**修改文件**：`packages/brain/src/capability-probe.js`，`probeRumination` 函数

**修复逻辑**：在 `48h_count=0 AND undigested>0` 时，额外检查 `cecelia_events` 中最近 24h 内是否有 `rumination_output` 事件：
- 有 → 系统正在运行，返回 ok=true（附加 `running_but_no_archive_update` 标注）
- 无 → 确实故障，返回 ok=false

**阈值兜底**：若 synthesis_archive 超过 72h 未更新（而非 48h），无论是否有 rumination_output，均报 FAIL（防止 rumination_output 写成功但 synthesis 写失败的问题被掩盖）。

---

## DoD

- [x] **[ARTIFACT]** `packages/brain/src/capability-probe.js` 已修改，`probeRumination` 含新的 3 阶段检查逻辑
  - Test: `node -e "const fs=require('fs'); const c=fs.readFileSync('packages/brain/src/capability-probe.js','utf8'); if(!c.includes('rumination_output'))process.exit(1); console.log('ok')"`

- [x] **[BEHAVIOR]** probe 在 `48h无synthesis + undigested>0 + 有近期rumination_output` 场景下返回 ok=true
  - Test: `tests/brain/rumination-probe-false-positive.test.ts`

- [x] **[BEHAVIOR]** probe 在 `72h无synthesis + undigested>0 + 无rumination_output` 场景下仍返回 ok=false（真实故障不被掩盖）
  - Test: `tests/brain/rumination-probe-false-positive.test.ts`
