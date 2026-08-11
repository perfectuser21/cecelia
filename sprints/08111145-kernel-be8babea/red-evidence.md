[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v1.6.1 /workspace

 × sprints/08111145-kernel-be8babea/tests/dashboard-only-production-chain.test.ts > Dashboard-only 官方生产发布主链 > Dashboard-only 成功路径必须调用既有双节点 promote 主链 311ms
   → expected [ 'rebuild' ] to deeply equal [ 'rebuild', 'promote' ]
 × sprints/08111145-kernel-be8babea/tests/dashboard-only-production-chain.test.ts > Dashboard-only 官方生产发布主链 > HK 同步或终验失败必须让 Dashboard-only 发布非零退出
   → expected 'rebuild\n' to contain 'promote'
 × sprints/08111145-kernel-be8babea/tests/dashboard-only-production-chain.test.ts > Dashboard-only 官方生产发布主链 > HK 同步或终验失败必须让 Dashboard-only 发布非零退出
   → expected 'rebuild\n' to contain 'promote'

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/08111145-kernel-be8babea/tests/dashboard-only-production-chain.test.ts > Dashboard-only 官方生产发布主链 > Dashboard-only 成功路径必须调用既有双节点 promote 主链
AssertionError: expected [ 'rebuild' ] to deeply equal [ 'rebuild', 'promote' ]

- Expected
+ Received

  Array [
    "rebuild",
-   "promote",
  ]

 ❯ sprints/08111145-kernel-be8babea/tests/dashboard-only-production-chain.test.ts:39:38
     37|     const { result, calls } = await fixture(0);
     38|     expect(result.status).toBe(0);
     39|     expect(calls.trim().split('\n')).toEqual(['rebuild', 'promote']);
       |                                      ^
     40|   });
     41| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  sprints/08111145-kernel-be8babea/tests/dashboard-only-production-chain.test.ts > Dashboard-only 官方生产发布主链 > HK 同步或终验失败必须让 Dashboard-only 发布非零退出
AssertionError: expected 'rebuild\n' to contain 'promote'

- Expected
+ Received

- promote
+ rebuild
+

 ❯ sprints/08111145-kernel-be8babea/tests/dashboard-only-production-chain.test.ts:44:19
     42|   it('HK 同步或终验失败必须让 Dashboard-only 发布非零退出', async () =…
     43|     const { result, calls } = await fixture(23);
     44|     expect(calls).toContain('promote');
       |                   ^
     45|     expect(result.status).not.toBe(0);
     46|     expect(`${result.stdout}\n${result.stderr}`).toContain('fixture pr…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯

 Test Files  1 failed (1)
      Tests  2 failed (2)
   Start at  04:09:21
   Duration  953ms (transform 38ms, setup 0ms, collect 29ms, tests 548ms, environment 0ms, prepare 117ms)

