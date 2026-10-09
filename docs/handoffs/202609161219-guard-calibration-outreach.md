# Handoff：守卫校正 + 触达线活性告警 + 盘满事故复盘（PR #5350/#5352/#5354）

**verdict: PASS**（1.296.1 上产；守卫第五腿在生产真实抓到故障）

## 完成
- **守卫阈值校正（escort 误伤案）**：1400→2000（env 可调），容器硬顶 1.86G→2.29G 在线抬。旧阈值定在网关正常工作态（1.4-1.7G）之下，一天误摁 9 次打断在跑 escort；实证 1824MB 现判 ok
- **触达线活性告警（第五腿）**：xian-m4 outreach.log → parseOutreachHealth 判 healthy/idle/degraded/stalled，stalled→P1 告警（3h debounce）。**上产即真实抓到 6 轮空转**
- **memlog 观测线修复**：docker top 缺 pid 被 daemon 拒（错误被 catch 吞），泄漏甄别数据线此前一直空跑
- **push 噪音根治**：249 条 legacy notion_id 绑错库返 400（非 404）不命中解绑分支，每轮重试刷屏 269 次/2h；新增 isWrongDatabaseError 一并解绑重建
- **盘满事故处置**：/ 100% 导致网关容器 rootfs 损毁 6 小时；清理+按原参数重建容器（state 全在宿主挂载，零数据损失）。**关键发现：us-vps 挂有 100G 数据盘 /mnt/openclaw_data 且 docker data-root 早已在其上**——之前"盘满禁本地 build"的前提是误判，真凶是 /var/lib/*.old-0916 迁移备份占系统盘；memory 已更正（排障先看全挂载）

## 没完成（待主理人拍板 / 观察中）
- **⚠️ 触达线仍空转**：飞书话术表 A1/A2/B 三条「启用状态」全为**停用**（09-15 12:02 起），属业务决策未擅动。要恢复触达需主理人在飞书把话术改「启用」
- 泄漏甄别：观测线今日才真正生效，需 24h 数据才能判「真漏 vs 正常呼吸」
- stalled 回执文案 reason 有 "NO_SCRIPT(NO_SCRIPT)" 重复瑕疵（不影响功能）
- OPC 支线打标腿（12 条待办卡在「执行机器」空字段）未做

## 下一步
- 主理人拍板话术启用 → 触达线自动恢复（守卫会验证）
- 24h 后读 memlog 曲线定泄漏性质
- OPC 打标腿按同款流程做掉

## 数据源
- packages/brain/src/openclaw-guards.js（五腿）、notion-push-sync.js（解绑判定）
- 飞书话术表 tblZZWdv0YUNojqI @ GNuwbzY0da8GP0sv6MGcOTu9ntd；xian-m4 ~/outreach.log
- 决策 95477a66（零执行物理化）

## 产物
- PR #5350/#5352/#5354 + bumps；生产 1.296.1
