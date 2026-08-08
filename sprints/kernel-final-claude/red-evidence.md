 × tests/kernel-pong.test.js > GET /kernel-pong > GET /kernel-pong → 200 + {pong: true} 9ms
 × tests/kernel-pong.test.js > GET /kernel-pong > GET /kernel-pong 带任意 query 参数 → 忽略参数仍 200 + {pong: true} 2ms
 × tests/kernel-pong.test.js > GET /kernel-pong > response keys 完整性 == ["pong"]（不允许多余字段） 1ms
 × tests/kernel-pong.test.js > GET /kernel-pong > 禁用 key 反向：kernel/ok/result/message/status 均不存在 1ms
 ✓ tests/kernel-pong.test.js > GET /kernel-pong > POST /kernel-pong → 404（不注册非 GET 方法，走 Express 默认 404） 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/kernel-pong.test.js > GET /kernel-pong > GET /kernel-pong → 200 + {pong: true}
 ❯ tests/kernel-pong.test.js:11:24
      9|   test('GET /kernel-pong → 200 + {pong: true}', async () => {
     10|     const res = await request(app).get('/kernel-pong');
 FAIL  tests/kernel-pong.test.js > GET /kernel-pong > GET /kernel-pong 带任意 query 参数 → 忽略参数仍 200 + {pong: true}
 ❯ tests/kernel-pong.test.js:18:24
     16|   test('GET /kernel-pong 带任意 query 参数 → 忽略参数仍 200 + {pong: true}', asy…
     17|     const res = await request(app).get('/kernel-pong').query({ x: '1',…
 FAIL  tests/kernel-pong.test.js > GET /kernel-pong > response keys 完整性 == ["pong"]（不允许多余字段）
 ❯ tests/kernel-pong.test.js:24:24
     23|     const res = await request(app).get('/kernel-pong');
 FAIL  tests/kernel-pong.test.js > GET /kernel-pong > 禁用 key 反向：kernel/ok/result/message/status 均不存在
 ❯ tests/kernel-pong.test.js:30:24
     29|     const res = await request(app).get('/kernel-pong');
 Test Files  1 failed (1)
      Tests  4 failed | 1 passed (5)
