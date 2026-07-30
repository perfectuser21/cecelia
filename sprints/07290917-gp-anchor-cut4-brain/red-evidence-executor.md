
Number of calls: 1

 ❯ src/__tests__/harness-orchestrator-lockdown.test.js:363:44
    361|     const result = await runHarnessInitiativeRouter(task, { pool: { qu…
    362| 
    363|     expect(mockSpawnSkillRelaySession).not.toHaveBeenCalled();
       |                                            ^
    364|     expect(result.ok).toBe(false);
    365|     expect(result.terminal).toBe(true);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  src/__tests__/harness-orchestrator-lockdown.test.js > _driveHarnessInitiative — gp_anchor 硬校验（base_repo 限定范围） > SC-207: base_repo 含 zenithjoy-workspace 且 gp_anchor 格式不合法 → 拒绝
AssertionError: expected "spy" to not be called at all, but actually been called 1 times

Received: 

  1st spy call:

    Array [
      Object {
        "execution_attempts": 0,
        "id": "task-gp-anchor-lockdown-1",
        "payload": Object {
          "base_repo": "https://github.com/perfectuser21/zenithjoy-workspace.git",
          "gp_anchor": "这不是合法格式",
          "initiative_id": "init-gp-anchor-lockdown-001",
          "orchestrator": "skill-relay",
        },
        "retry_count": 0,
        "status": "in_progress",
        "task_type": "harness_initiative",
        "title": "harness init gp_anchor lockdown test",
      },
      Object {
        "pool": Object {
          "query": [Function spy],
        },
      },
    ]


Number of calls: 1

 ❯ src/__tests__/harness-orchestrator-lockdown.test.js:386:44
    384|     const result = await runHarnessInitiativeRouter(task, { pool: { qu…
    385| 
    386|     expect(mockSpawnSkillRelaySession).not.toHaveBeenCalled();
       |                                            ^
    387|     expect(result.ok).toBe(false);
    388|     expect(result.terminal).toBe(true);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯

 Test Files  1 failed (1)
      Tests  2 failed | 7 passed (9)
   Start at  09:28:09
   Duration  329ms (transform 59ms, setup 0ms, collect 21ms, tests 138ms, environment 0ms, prepare 26ms)

