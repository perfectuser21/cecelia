# Learning：harness → okr_initiatives 活态镜像（PR 2b-2b）

## 背景
2b-2b 行为切换。Explore 测绘揭示：**完整的"harness 不再建 task、改认领 okr_initiatives"是多 PR 工程**——
整套执行机器以 `tasks.id` 为轴（thread_id=`harness-initiative:task.id:N`、driver_heartbeat、watchdog
`JOIN initiative_runs ON initiative_id=t.id`、patrol、dispatcher 并发 cap 全部 task-keyed）。
一把梭重写 = PRD 警告的"pipeline 崩"。

故本 PR 取**安全的第一步（dual-run，不碰执行/线程/看门狗机器）= 活态镜像**：harness 仍以 task 为执行轴，
但每次生命周期推进同步对应 okr_initiatives.status（running→done/failed），让规划侧 Initiative 成为实时真相。
全部同步点 **non-fatal（try/catch）**，镜像 best-effort，绝不阻断 harness 主流程。

## 根本原因 / 关键决策
1. **范围现实**：PRD 的"2b-2b 行为切换"被框定为一次完成，但代码实际是深度 task-keyed 的，
   彻底切换需多 PR。识别后改为最小安全增量（镜像），把彻底合一推后。这是"先摸清再动手"的价值。
2. **同步点非致命化**：harness 是活的调度核心，镜像逻辑任何报错都不能搞崩它 → 每个 sync 调用单独
   try/catch + console.warn 降级，照搬现有 writeDriverHeartbeat / initiative_runs INSERT 的 non-fatal 模式。
3. **`tasks.okr_initiative_id` 有 FK→okr_initiatives**：helper 把它设为新建的有效 okr_initiative id 没问题；
   但测试 cleanup 若先删 okr_initiatives 再删 task 会 FK 违例 → cleanup 必须先解引用（task 先删/置 NULL）。

## 下次预防
- [ ] 改"活"的调度/执行核心前，先用 Explore 测绘完整生命周期 + 所有 keyed-by 维度，别信 PRD 的风险标注
- [ ] 给活流程加旁路逻辑（镜像/埋点/同步）一律 non-fatal try/catch，宁可镜像缺失也不阻断主流程
- [ ] 写测试 cleanup 时按 FK 依赖逆序删（先删/解引用子表，再删父表）
- [ ] 给有 CHECK 的列做同步时，helper 入口先白名单校验生命周期值并抛错（防写坏约束）

## 验证
- 单元测试 `okr-initiative-sync.test.js` 7 例（解析三分支 + 状态同步 + 非法值抛错）先 RED 后 GREEN
- 真 DB（cecelia_test）端到端：建临时 harness task → sync running（新建 okr+映射+回写 tasks.okr_id）→
  sync done（复用同 okr + completed_at）→ resolve 幂等同 id，全部 ✓
- 受影响的 graph/executor 测试 8 文件 32 例全过（non-fatal 接线未破坏现有断言）
- smoke `okr-initiative-mirror-smoke.sh` 3/3（helper 导出+防护 / 四接线点 / DB 不变量）

## 遗留（后续 PR）
本 PR 不动 thread_id / watchdog / heartbeat / dispatcher / `initiative_runs.initiative_id`，
不退役 harness_initiative task_type。彻底合一（harness 直接以 okr_initiative 为执行轴、退役 task、
切 watchdog/patrol/dispatcher 到 okr_initiatives）留作后续多个 PR，每步合并后跑 walking-skeleton 验证。
