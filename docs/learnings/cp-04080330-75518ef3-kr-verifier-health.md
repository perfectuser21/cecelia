# Learning: KR Verifier 健康度 API

**任务**: KR 进度采集链路修复与可信度恢复
**分支**: cp-04080330-75518ef3-abef-4e88-a604-4e059b
**日期**: 2026-04-08

### 根本原因

KR3/KR4 进度曾为 0%，根本原因是 verifier 采集逻辑正确，但缺少可观测性工具：
- 没有 API 能快速查询所有 verifier 的健康状态
- 没有区分"静态 SQL"（如 `SELECT 72::numeric`）和"真实采集 SQL"
- tick.js 没有每日巡检日志，问题只能靠人工发现

### 下次预防

- [ ] 新增 verifier 时必须检查 SQL 是否为静态常量
- [ ] 部署后应调用 `/api/brain/okr/verifiers/health` 验证所有 verifier 健康
- [ ] tick.js 中的 daily 巡检会自动记录 `kr_health_check` action，可在 audit log 中检索
