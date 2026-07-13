# 小改动 PrepPRD：warroom 前端动态化——四板块接真数据

## 改什么
新建 apps/dashboard/src/pages/warroom/WarRoomPanels.tsx（四个板块组件 + 可单测纯函数），并在 WarRoomPage.tsx 最小接线（保留现有 Line 卡/三栏结构不动）：
1. **战况横幅**：顶栏下方横向条，接 GET /api/brain/harness/stats?by=journey&days=30 —— 每线 chip：线名 + runs/成功率 + 最近一跑相对时间（有 last_failure 标红点）
2. **哨兵灯**：并入战况横幅右端，接 GET /api/brain/sentinel/health —— 每 job 一灯（ok 且 age<=1800 绿 / 否则黄），整体 healthy=false 时红字提示；纯 API 数据，不读 /tmp 日志
3. **接力史流**：跨线总览（"全部"视图）中栏 feed 上方左半，接 GET /api/brain/handoffs?limit=8 —— 卡片：verdict 徽章 + title + next_steps 第一条 + 相对时间
4. **决策流**：同排右半，接 GET /api/brain/decisions?made_by=user&limit=8 —— 行：topic + 上海日期
每板块独立 fetch + 60s 轮询 + 失败静默降级（板块隐藏/占位，不白屏不阻塞现有 feed）。

## 为什么改
relay-baton4 item2：主理人发令 war room 从「任务清单板」升级「活的作战室」，数据器官（聚合战况/交接单/决策/哨兵）全部接进前端。数据层 item1 已上线（brain 1.239.0）。

## 关联上下文
- Journey：Cecelia Harness Pipeline（bb8cc561）；上游 handoff：docs/handoffs/202607071005-9782aa11.md
- API 契约：stats={by,period_days,journeys[{journey_id,journey_name,runs,done,failed,success_rate,last_run_at,last_failure}]}；handoffs={handoffs[{task_id,title,verdict,journey_id,created_at,next_steps,pr_urls}],total}；decisions=行数组[{topic,created_at,...}]；sentinel={jobs[{name,ok,age_seconds,at}],expected,healthy}

## 影响范围
仅 apps/dashboard（Cecelia 前端）→ workspace-ci；不改 brain，不 bump brain 版本。WarRoomPage.tsx 已 1550 行，新板块放独立文件避免继续膨胀。
部署铁律：必须走 Brain webhook 部署（手动 build 会漏 HK 生产实例）；PWA 缓存注意强刷。

## 验收标准
- [ ] 四板块纯函数 vitest 单测（先红后绿，惯例照 WarRoomPage.test.ts 纯函数风格）
- [ ] CI 全绿（workspace-ci）
- [ ] Brain webhook 部署后 perfect21:5211/warroom 刷新四板块显示真数据，截图入 handoff
