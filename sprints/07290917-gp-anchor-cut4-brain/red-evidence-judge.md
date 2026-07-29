
- Expected
+ Received

- false
+ true

 ❯ src/__tests__/harness-judge-mechanical-gate.test.js:182:20
    180|     const deps = makeAnchorDeps({ contractDraft: '## Golden Path\n无关…
    181|     const r = await runMechanicalGate(goodCtx(), deps);
    182|     expect(r.pass).toBe(false);
       |                    ^
    183|     expect(r.reasons.join()).toMatch(/gp_anchor_missing/);
    184|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL  src/__tests__/harness-judge-mechanical-gate.test.js > runMechanicalGate — GP-Anchor 一致性核查（刀4，file-existence gated） > contract 声明推进 GP-Anchor 但 id 在 product-map.json 里查无 → FAIL
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ src/__tests__/harness-judge-mechanical-gate.test.js:201:20
    199|     const deps = makeAnchorDeps({ contractDraft: '## GP-Anchor\n\nGP-A…
    200|     const r = await runMechanicalGate(goodCtx(), deps);
    201|     expect(r.pass).toBe(false);
       |                    ^
    202|     expect(r.reasons.join()).toMatch(/gp_anchor_id_notfound/);
    203|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  src/__tests__/harness-judge-mechanical-gate.test.js > runMechanicalGate — GP-Anchor 一致性核查（刀4，file-existence gated） > contract 声明格式不合法（既非三形态之一）→ FAIL
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ src/__tests__/harness-judge-mechanical-gate.test.js:220:20
    218|     const deps = makeAnchorDeps({ contractDraft: '## GP-Anchor\n\nGP-A…
    219|     const r = await runMechanicalGate(goodCtx(), deps);
    220|     expect(r.pass).toBe(false);
       |                    ^
    221|     expect(r.reasons.join()).toMatch(/gp_anchor_format_invalid/);
    222|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯

 Test Files  1 failed (1)
      Tests  3 failed | 20 passed (23)
   Start at  09:27:31
   Duration  199ms (transform 19ms, setup 0ms, collect 22ms, tests 10ms, environment 0ms, prepare 26ms)

