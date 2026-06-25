# 小改动 PrepPRD：Cecelia dashboard 部署加「私密 staging 网址 + 人工放行闸」并实跑验证

> 来源：本目录 handoff.md（最终版 2026-06-25）。执行：Agent Teams 直驱（不走 harness）。PR 留绿给用户合。
> base：最新 origin/main（含 PR #3412 staging slot 自检 gate 基础）。

## 改什么
1. **`scripts/deploy-local.sh` dashboard 路径**：build→`.dist-staging`→selfcheck（临时 slot 自检，沿用 #3412）→绿则
   - 起**常驻** staging 服务在非生产端口 `5223`（detached + PID 文件 `apps/dashboard/.staging-slot.pid`），供 `perfect21:5223` 走 SSH 隧道私密打开；
   - 写 `apps/dashboard/.staging-pending` 放行标记（记录待 promote 的 commit/时间）；
   - **停住**，打印人工验证 instruction（开 `perfect21:5223` 看 X/Y/Z）。**不再自检绿就自动 promote。**
   - selfcheck 红：不起 staging、不写标记、**不碰 live dist/、不 ssh HK** → exit 1 报红。
2. **新增 `scripts/promote-dashboard.sh`（人工放行才跑）**：读 `.staging-pending` → 原子换入 live `dist/`（本机 5211 即生效）→ tar+ssh 同步 HK 生产 → 停 staging 服务 + 清标记。无标记则拒绝（防误 promote）。
3. **新增 `scripts/smoke/dashboard-staging-gate-smoke.sh`**：E2E-first 守卫（见下）。
4. 给 deploy-local.sh 加测试钩子 `STAGING_FIXTURE_DIST`（指向预制假 dist，跳过慢 vite build），让 smoke 真链路快速跑。

## 为什么改
Cecelia = 内部工具、唯一用户=主理人。部署机制已隔离（#3412 build→`.dist-staging`→原子 swap），但缺
①可打开的私密 staging 网址 ②自检绿后停住等人放行。补齐后对齐「main→staging→人工放行→prod」。

## 关联上下文
- 相关 Journey：Cecelia Harness Pipeline / dev_pipeline（部署路径）
- 历史决策：decisions/match 无命中（新机制）
- 基础：PR #3412（origin/main）staging slot 自检 gate

## 影响范围
- 改变 /dev Step 11 自动部署 hook 的 dashboard 行为：**每次 dashboard 改动不再自动上生产**，停在 staging 等人工 promote（handoff §4.1 明示要的）。Brain 改动 / workflow skills 路径不受影响。

## Golden Path（用户操作流程）
1. dashboard 改动合 main → `deploy-local.sh` 自动跑：build→自检 → 系统起 staging 在 5223 + 打印「开 perfect21:5223 看」+ 停住 → 状态：等放行。
2. 主理人走 SSH 隧道开 `perfect21:5223` 看新版 dashboard → 满意。
3. 主理人手跑 `bash scripts/promote-dashboard.sh` → 系统原子换入 5211 + 同步 HK → 5211 与 HK 公网首页都 200 → 状态：已上线。
3-失败（proven-to-fire）：构建产物坏（自检红）→ 系统不起 staging、不写标记、live dist/ 不动、HK 不动 → 报红 exit 1 → 主理人看到红、两生产实例仍是旧版本。

## 验收标准（Final）
- [ ] commit-1：`dashboard-staging-gate-smoke.sh` 先红（gate 行为未实现）
- [ ] commit-2：实现让 smoke 绿
- [ ] smoke happy：gate 停在 staging、live dist/ 未变、`.staging-pending` 写入、5223 可达；promote 后 live dist/ 才更新
- [ ] smoke proven-to-fire：强制 selfcheck 红 → 无标记、live dist/ 不变、exit≠0
- [ ] 真实部署 happy：自检绿 → 开 5223 → 放行 → 5211 + HK 都 200
- [ ] 真实部署 proven-to-fire：自检失败 → 5211 与 HK 纹丝不动 + 报红
- [ ] 确认 promote 同时更新 5211 与 HK
- [ ] CI 全绿，PR 留绿给用户合（不 admin merge / 不 push main）
