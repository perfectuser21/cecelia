
 RUN  v4.1.10 /workspace/playground

 × tests/kernel-e.test.js > GET /kernel-e > GET /kernel-e → 200 + {result: "ok-e"} 9ms
   → expected 404 to be 200 // Object.is equality
 × tests/kernel-e.test.js > GET /kernel-e > GET /kernel-e 带任意多余 query 参数 → 忽略参数仍 200 + {result: "ok-e"} 2ms
   → expected 404 to be 200 // Object.is equality
 × tests/kernel-e.test.js > GET /kernel-e > response keys 完整性 == ["result"]（不允许多余字段） 1ms
   → expected 404 to be 200 // Object.is equality
 × tests/kernel-e.test.js > GET /kernel-e > 禁用 key 反向：ok/pong/msg/echo/status/message/data/output 均不存在 1ms
   → expected 404 to be 200 // Object.is equality
 ✓ tests/kernel-e.test.js > GET /kernel-e > POST /kernel-e → 404（不注册非 GET 方法，走 Express 默认 404） 1ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/kernel-e.test.js > GET /kernel-e > GET /kernel-e → 200 + {result: "ok-e"}
AssertionError: expected 404 to be 200 // Object.is equality

- Expected
+ Received

- 200
+ 404

 ❯ tests/kernel-e.test.js:11:24
      9|   test('GET /kernel-e → 200 + {result: "ok-e"}', async () => {
     10|     const res = await request(app).get('/kernel-e');
     11|     expect(res.status).toBe(200);
       |                        ^
     12|     expect(res.body).toEqual({ result: 'ok-e' });
     13|     expect(res.body.result).toBe('ok-e');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

 FAIL  tests/kernel-e.test.js > GET /kernel-e > GET /kernel-e 带任意多余 query 参数 → 忽略参数仍 200 + {result: "ok-e"}
AssertionError: expected 404 to be 200 // Object.is equality

- Expected
+ Received

- 200
+ 404

 ❯ tests/kernel-e.test.js:18:24
     16|   test('GET /kernel-e 带任意多余 query 参数 → 忽略参数仍 200 + {result: "ok-e"}', …
     17|     const res = await request(app).get('/kernel-e').query({ foo: 'bar'…
     18|     expect(res.status).toBe(200);
       |                        ^
     19|     expect(res.body).toEqual({ result: 'ok-e' });
     20|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  tests/kernel-e.test.js > GET /kernel-e > response keys 完整性 == ["result"]（不允许多余字段）
AssertionError: expected 404 to be 200 // Object.is equality

- Expected
+ Received

- 200
+ 404

 ❯ tests/kernel-e.test.js:24:24
     22|   test('response keys 完整性 == ["result"]（不允许多余字段）', async () => {
     23|     const res = await request(app).get('/kernel-e');
     24|     expect(res.status).toBe(200);
       |                        ^
     25|     expect(Object.keys(res.body)).toEqual(['result']);
     26|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

 FAIL  tests/kernel-e.test.js > GET /kernel-e > 禁用 key 反向：ok/pong/msg/echo/status/message/data/output 均不存在
AssertionError: expected 404 to be 200 // Object.is equality

- Expected
+ Received

- 200
+ 404
