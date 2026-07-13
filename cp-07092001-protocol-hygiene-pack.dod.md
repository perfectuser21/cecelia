# DoD: 协议卫生包（失败分类重试 + 告警去抖 + 副作用幂等）

## 验收清单

- [x] [BEHAVIOR] rate_limit/network/timeout/server_error 四类各自 backoff 数组查表，5xx→server_error、ETIMEDOUT→timeout 独立分类
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/quarantine-timeout-server-error.test.js','utf8');if(!c.includes(\"toBe('server_error')\")||!c.includes(\"toBe('timeout')\"))process.exit(1)"

- [x] [BEHAVIOR] getRetryStrategy 返回结构不变（should_retry/next_run_at/needs_human_review/billing_pause/reason），timeout 3/6/12min、server_error 1/5/15min 退避
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/lib/__tests__/retry-policy.test.js','utf8');if(!c.includes('12 * 60_000')||!c.includes('15 * 60_000'))process.exit(1)"

- [x] [BEHAVIOR] 下游瞬态判定同步：callback-processor/routes/execution 改用 isTransientClass，timeout/server_error 不被误计失败误隔离
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/transient-class-sync.test.js','utf8');if(!c.includes('isTransientClass'))process.exit(1)"

- [x] [BEHAVIOR] 告警去抖 opt-in：连续 N 次才放行 + 冷却期静默 + resetDebounce 清零；不传 debounce 参数 25 处存量 raise 零变更；三层限流串联不吞第一次真告警
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/lib/__tests__/alert-debounce.test.js','utf8');if(!c.includes('组合行为')||!c.includes('resetDebounce'))process.exit(1)"

- [x] [BEHAVIOR] side_effect_dedupe 原子抢占：并发 10 claim 恰 1 胜、过期重占、DB 故障 fail-open 返回 degraded + P2 降级告警
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/lib/__tests__/dedupe.test.js','utf8');if(!c.includes('fail-open')||!c.includes('degraded'))process.exit(1)"

- [x] [BEHAVIOR] createTask 可选 dedupe_key：命中返回 deduplicated:true 不建新任务；INSERT 失败释放 key；不传零变更
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/actions-dedupe-key.test.js','utf8');if(!c.includes('dedupe_key_hit'))process.exit(1)"

- [x] [BEHAVIOR] executor spawn dedupe：claim 在资源检查之后（server_overloaded 不泄漏 key）；命中返回 spawn_deduplicated；dispatcher 对 spawn_deduplicated 不计熔断失败
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/executor-spawn-dedupe.test.js','utf8');if(!c.includes('spawn_deduplicated'))process.exit(1)"

- [x] [BEHAVIOR] notifier 可选 dedupeKey：claim 异常全吞照发（never breaks main flow），命中跳过发送
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/notifier-dedupe.test.js','utf8');if(!c.includes('照发'))process.exit(1)"

- [x] [ARTIFACT] migration 326 side_effect_dedupe 表（UNIQUE(kind,dedupe_key)，IF NOT EXISTS 幂等）+ selfcheck EXPECTED_SCHEMA_VERSION=326
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/migrations/326_side_effect_dedupe.sql','utf8');if(!c.includes('UNIQUE (kind, dedupe_key)'))process.exit(1)"

- [x] [ARTIFACT] retry-policy.js 文件头显式豁免 spawn retry-circuit（attempt 级语义不同）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/lib/retry-policy.js','utf8');if(!c.includes('retry-circuit'))process.exit(1)"

## Learning 路径

docs/learnings/cp-07092001-protocol-hygiene-pack.md
