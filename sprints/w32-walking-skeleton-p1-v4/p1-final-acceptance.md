# W32 Walking Skeleton P1 — Final Acceptance

- initiative_id: N/A
- brain_url: http://host.docker.internal:5221
- generated_at: 2026-05-12T00:28:33Z
- terminal_status: N/A

## Verdict: FAIL

## Oracle a-g 实测

| oracle | verdict | detail |
|---|---|---|
| a | SKIP | 无 init id - 上游 POST 失败 |
| b | SKIP | psql 不可用或 DATABASE_URL 未设置 |
| c | SKIP | 无 init id |
| d | SKIP | psql 不可用或 DATABASE_URL 未设置 |
| e | FAIL | total_slots= in_use= in_progress_task_count= forbidden=none |
| f | FAIL | HOL_OK=false — primary 与 secondary 均未观察到 skipped → dispatched 紧邻对 |
| g | SKIP | psql 不可用或 DATABASE_URL 未设置 |

## Anomaly

- POST /api/brain/tasks 未拿到 id；Brain 不可达 (http://host.docker.internal:5221) 或 schema 不符
- POST 201 body 不符合 {task_type:harness_initiative,status:pending} 字面 schema (实际 task_type= status=)
- Oracle e: fleet/slots 字段或不变量异常 total_slots= in_use= in_progress_task_count= forbidden=none
- Oracle f: HOL_OK=false — primary 与 secondary 均未观察到 skipped → dispatched 紧邻对
- Oracle 被 SKIP (非 PASS 也非 FAIL，环境缺失): a,b,c,d,g — Verdict 未把 SKIP 等同 FAIL，请补齐基础设施 (DATABASE_URL / Brain 可达性) 重跑
