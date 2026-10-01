# us-mac-m4 在 Brain 眼里反复离线：fleet-worker /health 冷探测 6.6s 超过准入客户端 5s 超时，30s 缓存到期即抖一次（machine_offline → all_execution_targets_exhausted）

## Objective
实证 2026-09-25：us-vps curl http://100.71.151.105:5231/health 首发 6.65s，其后 0.11s（缓存 30s，DEFAULT_HEALTH_CACHE_TTL_MS）；Brain fleet-cache 日志在 1/3 与 2/3 在线之间抖；bug 任务 b85faf28 的 run d6acfb0d reviewer 一跳 capability preflight probe_detail machine_health.signature=machine_offline / machine_capacity.available=0 → all_execution_targets_exhausted → infrastructure backoff。fleet-worker.cjs 注释已自认：完整探测（git worktree + docker）单发 4-6s 超过 admission client 5s。修法二选一先做便宜的：①健康探测改后台定时刷新（永远回缓存，附 observed_at），准入读取零等待；②准入客户端超时 5s→15s 并对首发失败重试一次。验收：连续 30 分钟 fleet-cache 无 1/3 抖动；capability preflight 无 machine_offline 假阳性。先写复现测试。

## Frozen authority
- execution_profile: hotfix-v1
- routing_receipt_id: e31b36c2-397c-4d6f-a47b-ed33d7d915da
- impact_contract_id: b3232d6c-1c0e-490c-a924-5a0aca4743ab
- input_base_sha: ce587e5699b0d507d2fea4f815d69b5ecad81a0a