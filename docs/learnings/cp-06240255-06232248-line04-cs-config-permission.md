# Learning — Line04 客服配置写权限安全闸 + 管理员前台补全

## 运行指标

- Evaluator：PASS
- PR：https://github.com/perfectuser21/zenithjoy-workspace/pull/838 (MERGED @ 2026-06-23 18:50Z)
- Sprint Dir：sprints/06232248-line04-cs-config-permission

## 发现的问题

### [DESIGN] 设计缺陷

- 客服配置三写接口（/cs/config /cs/setup /cs/auto-agent）原先缺管理员角色闸 + 租户隔离，member 可越权写库（Issue 96db53be）。本 Sprint 统一前置 tenantContext + NOT_ADMIN 闸 + deny by default（目标解析不出租户 → 404 TARGET_NOT_FOUND，绝不放行）。
- 教训：所有"按租户/客服维度写库"的接口默认必须 deny by default，目标实体解析不出归属租户时返回 404 而非放行，避免隐性越权。

### [BUG] 代码缺陷

- 前台 PerCsConfigPage/CsOneClickSetupPage 缺营业时间 start/end + daily_limit 输入框，且无非管理员只读态 → 本 Sprint 补 cs-business-hours-start / cs-daily-limit / cs-readonly-notice testid + 消费 GET /cs/my-role 渲染只读。

### [INFRA] 基础设施问题

- ZenithJoy UI E2E 必须走 windows_cloud（GitHub Actions windows-latest runner），不走本地机器；本 Sprint 2-job workflow（ubuntu 后端 vitest + windows Playwright）符合 E2E 环境路由死规则。

### [PROMPT] Prompt 类问题

- （无）

## 下次预防清单

- [ ] 新增任何「按租户/客服写库」接口，默认套 tenantContext + 角色闸 + deny by default 三件套
- [ ] 修 bug 的 regression test 必须 commit 进 apps/api/tests/regression/ 永久留 CI（已落实）
- [ ] ZenithJoy UI 改动的 E2E 一律 windows_cloud runner，禁止本地路径判断
