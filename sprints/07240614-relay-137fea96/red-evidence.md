[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v1.6.1 /Users/administrator/worktrees/task-137fea96/session-6bc5d01b

stdout | packages/brain/src/db.js:10:9
PostgreSQL pool configured: {
  host: 'localhost',
  port: 5432,
  database: 'cecelia_test',
  user: 'cecelia',
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
}

 × sprints/07240614-relay-137fea96/tests/contract-task-delete.test.ts > DELETE /api/brain/tasks/:id [BEHAVIOR] > 存在的非终态任务 → HTTP 200，响应 status=cancelled
   → expected 404 to be 200 // Object.is equality
 × sprints/07240614-relay-137fea96/tests/contract-task-delete.test.ts > DELETE /api/brain/tasks/:id [BEHAVIOR] > DB 中该任务 status 真实变为 cancelled（真 Postgres 校验，不信任响应体自证）
   → expected 'pending_postdeploy' to be 'cancelled' // Object.is equality
 × sprints/07240614-relay-137fea96/tests/contract-task-delete.test.ts > DELETE /api/brain/tasks/:id [BEHAVIOR] > 不存在的 id → HTTP 404 + error 字段 (string)
   → Unexpected token '<', "<!DOCTYPE "... is not valid JSON
 × sprints/07240614-relay-137fea96/tests/contract-task-delete.test.ts > DELETE /api/brain/tasks/:id [BEHAVIOR] > 已 completed 的任务 → HTTP 409，状态未被改动（防误删历史记录）
   → expected 404 to be 409 // Object.is equality
 × sprints/07240614-relay-137fea96/tests/contract-task-delete.test.ts > DELETE /api/brain/tasks/:id [BEHAVIOR] > [AI_ADDED] 已 cancelled 的任务再次 DELETE → HTTP 409（幂等防重复误改，TERMINAL_STATUSES 含 cancelled）
   → expected 404 to be 409 // Object.is equality
stdout | sprints/07240614-relay-137fea96/tests/contract-postdeploy-smoke-filter.test.ts
[postdeploy-verifier] ✅ task=ba13533d-97d1-413d-8482-ba053db59dcf 验证通过 → completed

stdout | sprints/07240614-relay-137fea96/tests/contract-postdeploy-smoke-filter.test.ts
[postdeploy-verifier] ✅ task=92d15aaa-c146-4390-b255-82801ac66b07 验证通过 → completed

stdout | sprints/07240614-relay-137fea96/tests/contract-postdeploy-smoke-filter.test.ts
[postdeploy-verifier] ✅ task=fab17a58-8c00-40e1-ba26-40f569fb620e 验证通过 → completed
[postdeploy-verifier] 本轮完成: verified=2 failed=0 skipped=1 batch=3

 × sprints/07240614-relay-137fea96/tests/contract-postdeploy-smoke-filter.test.ts > postdeploy-verifier — fetchPendingBatch 排除 smoke: 前缀 [BEHAVIOR] > title 以 "smoke:" 开头的任务 → runPostdeployVerifier 扫描后 status 仍为 pending_postdeploy（未被消费）
   → expected 'completed' to be 'pending_postdeploy' // Object.is equality
 ✓ sprints/07240614-relay-137fea96/tests/contract-postdeploy-smoke-filter.test.ts > postdeploy-verifier — fetchPendingBatch 排除 smoke: 前缀 [BEHAVIOR] > 对照：不带 smoke: 前缀的同批次任务 → 正常被消费，status 变为 completed

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/07240614-relay-137fea96/tests/contract-postdeploy-smoke-filter.test.ts > postdeploy-verifier — fetchPendingBatch 排除 smoke: 前缀 [BEHAVIOR] > title 以 "smoke:" 开头的任务 → runPostdeployVerifier 扫描后 status 仍为 pending_postdeploy（未被消费）
AssertionError: expected 'completed' to be 'pending_postdeploy' // Object.is equality

- Expected
+ Received

- pending_postdeploy
+ completed

 ❯ sprints/07240614-relay-137fea96/tests/contract-postdeploy-smoke-filter.test.ts:70:30
     68|       [smokeTaskId]
     69|     );
     70|     expect(r.rows[0].status).toBe('pending_postdeploy');
       |                              ^
     71|     expect(r.rows[0].retry_count).toBeNull();
     72|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/6]⎯

 FAIL  sprints/07240614-relay-137fea96/tests/contract-task-delete.test.ts > DELETE /api/brain/tasks/:id [BEHAVIOR] > 存在的非终态任务 → HTTP 200，响应 status=cancelled
AssertionError: expected 404 to be 200 // Object.is equality

- Expected
+ Received

- 200
+ 404

 ❯ sprints/07240614-relay-137fea96/tests/contract-task-delete.test.ts:54:25
     52|   it('存在的非终态任务 → HTTP 200，响应 status=cancelled', async () =>…
     53|     const resp = await fetch(`${BRAIN_URL}/api/brain/tasks/${pendingTa…
     54|     expect(resp.status).toBe(200);
       |                         ^
     55|     const body = (await resp.json()) as Record<string, unknown>;
     56|     expect(body.status).toBe('cancelled');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/6]⎯

 FAIL  sprints/07240614-relay-137fea96/tests/contract-task-delete.test.ts > DELETE /api/brain/tasks/:id [BEHAVIOR] > DB 中该任务 status 真实变为 cancelled（真 Postgres 校验，不信任响应体自证）

--- tail (summary) ---
     89|     const body = (await resp.json()) as Record<string, unknown>;
     90|     expect(typeof body.error).toBe('string');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/6]⎯

 Test Files  2 failed (2)
      Tests  6 failed | 1 passed (7)
   Start at  19:45:37
   Duration  322ms (transform 36ms, setup 0ms, collect 70ms, tests 266ms, environment 0ms, prepare 66ms)

