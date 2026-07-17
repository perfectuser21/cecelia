# 设计：作战日报 harness admission 吞吐段（de6d3582，beeba317 观察哨）

状态：已批准（Alex 07-17"你加吧"；decision 见 strategic-decisions 21:35 条）

## 目的

beeba317 产能闸换轨后验真实吞吐：日报回答"是否稳定跑到 cap、拒发原因分布是否健康"。

## 改动（两处，均在 packages/brain/src）

### 1. machine-vitals.js：采样时滚动记录容器数当日峰值

`sampleMachineVitals(pool)` 采样成功且有 pool 时，upsert `working_memory` 键 `machine_vitals_daily_peak`：
`{ date: 'YYYY-MM-DD'(Asia/Shanghai), peak: max(relay_count, 同日已存 peak) }`；跨日自动重置为当日值。DB 写失败 catch 不影响采样（与既有哨兵键同风格）。

### 2. battle-report.js：新增「⑦ harness admission 吞吐」段

buildBattleReportData 增查：
- 24h `dispatch_events`：`event_type='dispatched'` 总数；`event_type='failed_dispatch'` 且 reason IN (admission 原因清单：cap_reached / vitals_stale / vitals_error / disk_pressure / memory_pressure / no_memory_headroom / quota_critical / quota_low_priority / inflight_query_error / task_cap_backstop) 按 reason 计数
- `working_memory.machine_vitals_daily_peak`（无则 null）
- 当前 `getMachineVitals()` 快照（relay_count / vm 余量 / 盘 / stale）

renderBattleReportMarkdown 增渲染：一行汇总（派发 N 次｜admission 拒发 M 次｜容器峰值 P）+ 拒发原因分布列表；全空渲染"暂无"（与既有段一致）。

## 不做

- 不改判定逻辑/不加新表；不做历史趋势（日报只看 24h）；allow 逐次记录不加（slot_check 放行不落 DB，派发成功数用 dispatched 近似）

## 测试策略（unit 档，mock 只打 pool.query / vitals 缓存注入）

1. peak 滚动：同日两次采样 5→3 → peak 保持 5；跨日 → 重置 3
2. buildBattleReportData 返回 admission 段数据（mock dispatch_events 行）
3. render：有数据出段落与数字；全空出"暂无"
4. battle-report / machine-vitals 既有测试全过
