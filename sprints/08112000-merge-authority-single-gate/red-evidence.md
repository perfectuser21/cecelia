# Red 证据（合同测试，实现前全红片段）
```
total 13 passed 3 failed 10
FAIL - 端点已注册（GET /pr-ownership 有 handler）
FAIL - 命中 v2 initiative_run → owned=true（凭 initiative_runs 记录，非标题）
FAIL - 无匹配 run → owned=false（不回归 /dev 的端点侧信号）
FAIL - branch 与 pr_url 均缺失 → HTTP 400
FAIL - owned=true → 输出 SKIP（harness-owned，交裁判 gate）
PASS - owned=false + cp-* → 输出 MERGE（/dev 不回归，红线）
FAIL - Brain 5xx → SKIP（fail-closed，绝不 MERGE）
FAIL - 非法 JSON → SKIP（fail-closed，2xx 但 body 不可解析）
FAIL - Brain 不可达（连接被拒 exit7）→ SKIP（fail-closed 快速失败）
FAIL - Brain 超时（接受连接后挂起 → curl --max-time exit28）→ SKIP（fail-closed，R1-1）
FAIL - 回归 #4755 分支 cp-08101107-04e4690d → harness-owned/SKIP（当天绕过标题判据事故不重演）
PASS - 回归 #4759 分支 cp-08101246-643b5302 → harness-owned/SKIP（当天无视 judge FAIL 强合事故不重演）
PASS - 非cp-* 分支 → SKIP（保留原有行为，不归通用 auto-merge）
```
