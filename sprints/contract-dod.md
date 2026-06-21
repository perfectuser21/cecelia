---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 实测 planner/GAN 容器真实内存峰值（量到即停）

**范围**: 在一次真实 run 中测出 planner 容器与 GAN/proposer 容器各自的内存峰值（RSS），≥3 采样点、≤1s 间隔、分别独立落盘，量到即停。**不**做调优/改 limit/改镜像/多轮统计/其他指标。
**大小**: S

> 落盘文件路径变量：`MEASURE_OUT="${SPRINT_DIR:-sprints}/container-mem-peak.json"`。
> 采样器：`scripts/measure/container-mem-peak.mjs`（落在测量脚本目录，**不**改 `packages/brain/src/`）。
> 所有 [BEHAVIOR] 由 evaluator 先重跑采样器再断言（见 contract-draft.md `## E2E 验收`）。

## ARTIFACT 条目

- [ ] [ARTIFACT] 采样器脚本存在且含 cgroup/RSS 真实采样逻辑（非硬编码）
  Test: node -e "const c=require('fs').readFileSync('scripts/measure/container-mem-peak.mjs','utf8');if(!/(memory\.(peak|current)|\/proc\/.+\/status|Rss|docker stats|ps .*rss)/i.test(c))process.exit(1)"

- [ ] [ARTIFACT] 采样器导出可单测的纯函数 summarizePeak（供 tests/ws1 TDD）
  Test: node -e "const c=require('fs').readFileSync('scripts/measure/container-mem-peak.mjs','utf8');if(!/export\s+(function\s+summarizePeak|const\s+summarizePeak)/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令；evaluator 先重跑采样器再断言）

- [ ] [BEHAVIOR] 两被测目标 target 均被记录且非空（Golden Path Step 1）
  Test: manual:bash -c 'M="${SPRINT_DIR:-sprints}/container-mem-peak.json"; jq -e "(.planner.target|type==\"string\" and length>0) and (.gan.target|type==\"string\" and length>0)" "$M" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 每容器 ≥3 采样点且采样间隔 ≤1000ms（Golden Path Step 2）
  Test: manual:bash -c 'M="${SPRINT_DIR:-sprints}/container-mem-peak.json"; jq -e "(.planner.samples_mb|type==\"array\" and length>=3) and (.gan.samples_mb|type==\"array\" and length>=3) and (.planner.interval_ms<=1000) and (.gan.interval_ms<=1000)" "$M" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] planner 容器峰值数值合法：number 且 0 < x ≤ 2048（Golden Path Step 3）
  Test: manual:bash -c 'M="${SPRINT_DIR:-sprints}/container-mem-peak.json"; jq -e "(.planner.peak_rss_mb|type==\"number\") and (.planner.peak_rss_mb>0) and (.planner.peak_rss_mb<=2048)" "$M" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] GAN 容器峰值数值合法：number 且 0 < x ≤ 2048（Golden Path Step 3）
  Test: manual:bash -c 'M="${SPRINT_DIR:-sprints}/container-mem-peak.json"; jq -e "(.gan.peak_rss_mb|type==\"number\") and (.gan.peak_rss_mb>0) and (.gan.peak_rss_mb<=2048)" "$M" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 峰值 == 采样最大值，两容器各一条（防硬编码假峰值，Golden Path Step 4）
  Test: manual:bash -c 'M="${SPRINT_DIR:-sprints}/container-mem-peak.json"; jq -e "(.planner.peak_rss_mb == (.planner.samples_mb|max)) and (.gan.peak_rss_mb == (.gan.samples_mb|max))" "$M" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 落盘新鲜度 measured_at 在最近 5 分钟内（防历史数据冒充，Golden Path Step 5）
  Test: manual:bash -c 'M="${SPRINT_DIR:-sprints}/container-mem-peak.json"; TS=$(date -u -d "$(jq -r .measured_at "$M")" +%s 2>/dev/null || gdate -u -d "$(jq -r .measured_at "$M")" +%s); D=$(( $(date -u +%s) - TS )); [ "$D" -ge 0 ] && [ "$D" -le 300 ] && echo OK || { echo "FAIL measured_at 过期 ${D}s"; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] 两容器分别独立记录，顶层无合并峰值字段（Golden Path Step 6 — 不混算）
  Test: manual:bash -c 'M="${SPRINT_DIR:-sprints}/container-mem-peak.json"; jq -e "has(\"planner\") and has(\"gan\") and (has(\"peak_rss_mb\")|not) and (has(\"peak\")|not)" "$M" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] status 枚举合法 ∈ {complete, incomplete}（Golden Path Step 6 — 异常退出标注）
  Test: manual:bash -c 'M="${SPRINT_DIR:-sprints}/container-mem-peak.json"; jq -e "[.planner.status,.gan.status]|all(.==\"complete\" or .==\"incomplete\")" "$M" && echo OK'
  期望: OK

## 接缝清单（done 判定门槛）

- 逻辑断言（接缝 #1）：上述 ARTIFACT + BEHAVIOR 全绿 = 采样逻辑真 done。
- 接缝断言（接缝 #2）：planner/gan 峰值须来自**真实 `cecelia-task-*` 容器**的真运行（`HARNESS_DOCKER_ENABLED=true`，cgroup `memory.peak` 校准）。未在真容器上校准前，本 sprint 标 `logic-done-pending`，**不得标 done**。
