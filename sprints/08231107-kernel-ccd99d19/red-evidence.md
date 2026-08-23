The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v1.6.1 /workspace/sprints/08231107-kernel-ccd99d19

 ❯ tests/projection-two-phase.test.js  (5 tests | 1 failed) 13ms
   ❯ tests/projection-two-phase.test.js > 投影物化两阶段原子化 [BEHAVIOR] > runProjection writes the new run with materializing status
     → expected 'INSERT INTO map_projection_runs (scop…' to match /'materializing'/

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/projection-two-phase.test.js > 投影物化两阶段原子化 [BEHAVIOR] > runProjection writes the new run with materializing status
AssertionError: expected 'INSERT INTO map_projection_runs (scop…' to match /'materializing'/

- Expected: 
/'materializing'/

+ Received: 
"INSERT INTO map_projection_runs (scope_key, manifest_version_id, manifest_digest, fact_revisions, projector_version, projection_digest, status) VALUES ($1, $2, $3, $4, $5, $6, 'building') RETURNING id"

 ❯ tests/projection-two-phase.test.js:100:27
     98|     const insertRun = calls.find((c) => /INSERT INTO map_projection_ru…
     99|     expect(insertRun, 'projector 必须 INSERT 一条 run 行').toBeTruthy(…
    100|     expect(insertRun.sql).toMatch(/'materializing'/);
       |                           ^
    101|     expect(insertRun.sql).not.toMatch(/'building'/);
    102|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  1 failed | 4 passed (5)
   Start at  04:16:50
   Duration  216ms (transform 41ms, setup 0ms, collect 34ms, tests 13ms, environment 0ms, prepare 62ms)

