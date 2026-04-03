# Learning: probeRumination 探针误报根因与修复

**分支**: cp-04030358-cedf9588-b511-4961-8b06-424ce9
**日期**: 2026-04-03

---

### 根本原因

`probeRumination` 仅通过 `synthesis_archive` 的时间窗口（48h）来判断 rumination 是否正常运行。当出现"空白日"（rumination 将所有 learnings 处理完毕后无新内容到达），旧 synthesis 逐渐滑出 48h 窗口，而新 learnings 恰在此时到达，探针就会误报 FAIL，尽管 rumination 功能本身从未停止。

具体事故：2026-04-01 凌晨（UTC）处理了所有 learnings，4月2日无新 learnings，4月3日凌晨新 learnings 到达。此时旧 synthesis 已超过 48h，探针首次检查到 `48h_count=0 AND undigested=8`，触发 FAIL 并自动创建此修复任务。

---

### 下次预防

- [ ] 任何探针的"链路健康"判断都需区分"产出存在"与"系统运行"两个维度
- [ ] `synthesis_archive` 是 rumination 的产出记录，不是心跳信号；不能仅凭它判断系统是否活跃
- [ ] 添加阶段 3 检查（`cecelia_events.rumination_output` 24h 内是否有记录）作为"系统实际在运行"的证据
- [ ] 探针窗口放宽时（24h→48h）仍可能触发，说明根本症结在判断维度，而非窗口长短
