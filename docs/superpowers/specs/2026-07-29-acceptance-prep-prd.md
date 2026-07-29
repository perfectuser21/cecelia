# 小改动 PrepPRD：Brain 验收公网端点（Acceptance 刀 1）

Brain task: ab4efe7a-9e8a-4d29-8ebd-9ef24fd5b1a6
决策链: 19f2632c（员工验收前端走 Notion/Zenithjoy-July，收编员工表，Brain DB 为唯一 SSOT）

## 改什么

cecelia repo packages/brain，三件事：

1. 两张表（migration）：
   - acceptance_runs：run_key（唯一业务主键）、title、gp_id、line、surface、version、status（pending→in_review→passed/failed）、pass_rate、source（manual/harness）
   - acceptance_checks：check_key（唯一）、run_id FK、kind（FR/NFR/Invariant/SOP）、name、device、result（通过/不通过/无法验证/NULL）、note、decided_at

2. 三个端点（routes/acceptance.js）：
   - POST /api/brain/acceptance/runs（内网 5221，harness/手动建单，按 run_key 幂等 upsert，body 含 checks[]）
   - GET /acceptance/pending（公网 5223，给 Notion Worker sync 拉验收单+验收项 JSON）
   - POST /acceptance/results（公网 5223，收员工结果，批量 [{check_key, result, note}]，落库并自动重算 run 的 pass_rate/status）

3. 公网安全暴露：绝不暴露 5221 整体。Brain 起独立公网 listener（5223），只挂两个公网端点 + Bearer token 鉴权中间件；cloudflared tunnel 指 localhost:5223。token 双写 1Password + ~/.credentials/，后续推给 Worker env。

## 错误路径（对抗深挖结论）

- 无 token / 错 token → 401（常量时间比较 timingSafeEqual）
- results 带不存在的 check_key → 400 并列出坏 key，不部分静默落库（整批原子：有坏 key 整批拒绝）
- result 枚举非法 → 400
- 同 check 重复提交 → 幂等覆盖（last-write-wins）+ 更新 decided_at
- Brain 重启期间 → cloudflared 502，Worker 下轮 sync 自动重试，无数据丢失
- 公网扫描 → 5223 只挂两个路由，其余全 404

## 影响范围

纯新增（新表 + 新路由 + 新 listener），不动现有端点。cloudflared 域名开通（brain-acceptance.zenjoymedia.media）是 PR 外部署动作，PR 带配置说明。

## 验收标准

- [ ] migration + 路由单测（TDD：先红后绿）
- [ ] 本机全链 curl 实测：建单 → 5223 带 token 拉 pending → 回写 results → pass_rate/status 自动更新
- [ ] 无 token 请求 5223 → 401；5221 上不存在 acceptance 公网路由
- [ ] CI 全绿

## 不包含

- Worker 改造对接（刀 2）
- harness 自动建单 + 通知（刀 3）
- cloudflared 域名实际开通（部署动作）
