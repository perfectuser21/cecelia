---
task_id: 4ac5fa39-521e-48b8-8b1a-ae1b79bcba2d
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3"]
---
# 独立验收证据

取证方式：① 在本机真实 PG 测试库 cecelia_test 上挂载真实 `routes/task-tasks.js` 路由与真实 `db.js` 连接池，发 HTTP 请求（E-1/E-2/E-3）；② 跑回归测试与既有路由测试（E-4）。

### E-1
对应: I-1
verdict: PASS

```command
sed -i '' "s#^import express from 'express';#import { createRequire } from 'module'; const express = createRequire('/Users/administrator/worktrees/cecelia-cw/cw-4ac5fa39/packages/brain/package.json')('express');#" /tmp/verify-4ac5fa39.mjs && cd /Users/administrator/worktrees/cecelia-cw/cw-4ac5fa39/packages/brain && DB_NAME=cecelia_test node /tmp/verify-4ac5fa39.mjs 2>&1 | grep -E '^GET|Error' | head
```

```output
GET not-a-uuid -> 400 {"error":"Invalid task id: must be a UUID"}
```

### E-2
对应: I-2
verdict: PASS

```command
sed -i '' "s#^import express from 'express';#import { createRequire } from 'module'; const express = createRequire('/Users/administrator/worktrees/cecelia-cw/cw-4ac5fa39/packages/brain/package.json')('express');#" /tmp/verify-4ac5fa39.mjs && cd /Users/administrator/worktrees/cecelia-cw/cw-4ac5fa39/packages/brain && DB_NAME=cecelia_test node /tmp/verify-4ac5fa39.mjs 2>&1 | grep -E '^GET|Error' | head
```

```output
GET %20 -> 400 {"error":"Invalid task id: must be a UUID"}
```

### E-3
对应: I-3
verdict: PASS

```command
sed -i '' "s#^import express from 'express';#import { createRequire } from 'module'; const express = createRequire('/Users/administrator/worktrees/cecelia-cw/cw-4ac5fa39/packages/brain/package.json')('express');#" /tmp/verify-4ac5fa39.mjs && cd /Users/administrator/worktrees/cecelia-cw/cw-4ac5fa39/packages/brain && DB_NAME=cecelia_test node /tmp/verify-4ac5fa39.mjs 2>&1 | grep -E '^GET|Error' | head
```

```output
GET 00000000-0000-4000-8000-000000000000 -> 404 {"error":"Task not found","id":"00000000-0000-4000-8000-000000000000"}
```

### E-4
对应: I-1
verdict: PASS

```command
cd packages/brain && npx vitest run src/__tests__/task-get-invalid-id.test.js src/__tests__/routes/task-tasks.test.js 2>&1 | tail -25
```

```output
 ✓ src/__tests__/routes/task-tasks.test.js  (27 tests) 255ms
 ✓ src/__tests__/task-get-invalid-id.test.js  (6 tests) 180ms

 Test Files  2 passed (2)
      Tests  33 passed (33)
```

### E-5
对应: I-2
verdict: PASS

```command
cd packages/brain && npx vitest run src/__tests__/task-get-invalid-id.test.js src/__tests__/routes/task-tasks.test.js 2>&1 | tail -25
```

```output
 ✓ src/__tests__/task-get-invalid-id.test.js  (6 tests) 180ms
```

### E-6
对应: I-3
verdict: PASS

```command
cd packages/brain && npx vitest run src/__tests__/task-get-invalid-id.test.js src/__tests__/routes/task-tasks.test.js 2>&1 | tail -25
```

```output
 Test Files  2 passed (2)
      Tests  33 passed (33)
```
