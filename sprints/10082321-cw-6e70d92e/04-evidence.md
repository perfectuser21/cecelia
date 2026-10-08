---
task_id: 6e70d92e-4cf1-4769-93af-28a345b9dc55
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---
# 验收证据

### E-1
对应: I-1
verdict: PASS

```command
cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/new-task.test.mjs --reporter=verbose 2>&1 | tail -50
```

```output
 ✓ scripts/coding-workflow/__tests__/new-task.test.mjs > new-task.mjs > 校验：有依赖但没挂 project → { tasks: [ { key: 'a', title: 't', acceptance: [ 'x' ] }, { key: 'b', title: 't', acceptance: [ 'x' ], depends_on: [ 'a' ] } ] }，不调 Brain
 ✓ scripts/coding-workflow/__tests__/new-task.test.mjs > new-task.mjs > 校验：返回 projectId / project

 Test Files  1 passed (1)
      Tests  19 passed (19)
```

### E-2
对应: I-1
verdict: PASS

```command
sed -n 15,45p scripts/coding-workflow/__tests__/new-task.test.mjs; echo ----; sed -n 110,160p scripts/coding-workflow/__tests__/new-task.test.mjs; echo ----; sed -n 185,212p scripts/coding-workflow/__tests__/new-task.test.mjs
```

```output
    ['有依赖但没挂 project', { tasks: [{ key: 'a', title: 't', acceptance: ['x'] }, { key: 'b', title: 't', acceptance: ['x'], depends_on: ['a'] }] }, 'project_required'],
    ['project 缺 name', { project: { description: 'd' }, tasks: [{ key: 'a', title: 't', acceptance: ['x'] }] }, 'project_name_missing'],
    ['project_id 与 project 同时给', { project_id: ROOT_ID, project: { name: 'n' }, title: 't', acceptance: ['x'] }, 'project_conflict'],
  ])('校验：%s → %s，不调 Brain', async (_name, obj, code) => {
    expect(validatePlan(obj).errors.join(' ')).toContain(code);
    brain = await startBrain();
    const r = await runScript([plan(obj)], { BRAIN_URL: brain.url });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(code);
    expect(brain.posts).toEqual([]);
    expect(brain.projectPosts).toEqual([]);
  });
```

### E-3
对应: I-1
verdict: PASS

```command
git log --oneline -3 -- scripts/coding-workflow/__tests__/new-task.test.mjs; git diff a3a4c654c HEAD -- scripts/coding-workflow/__tests__/new-task.test.mjs | grep -n "^+.*\(project_required\|计划带 project：\|计划带 project_id：\)"
```

```output
5200a78f9 feat(workflow): new-task 批次自动挂 project（project 先建 / project_id 直挂）
45aa51230 feat(workflow): new-task 计划校验 project_id / project（有依赖必须挂 project）
a3a4c654c feat(workflow): coding workflow 分档接管入口——opus 别名、任务依赖、建任务脚本 (#6075)
56:+  it('计划带 project：先建 project（只一次），整批任务顶层都挂它的 id', async () => {
85:+  it('计划带 project_id：不建 project，每条任务顶层挂该 id，depends_on 仍换真实 id', async () => {
98:+  it('单条计划带 project_id：请求体顶层同样带上', async () => {
131:+    ['有依赖但没挂 project', { tasks: [{ key: 'a', title: 't', acceptance: ['x'] }, { key: 'b', title: 't', acceptance: ['x'], depends_on: ['a'] }] }, 'project_required'],
```

### E-4
对应: I-2
verdict: PASS

```command
sed -n 15,45p scripts/coding-workflow/__tests__/new-task.test.mjs; echo ----; sed -n 110,160p scripts/coding-workflow/__tests__/new-task.test.mjs; echo ----; sed -n 185,212p scripts/coding-workflow/__tests__/new-task.test.mjs
```

```output
      if (req.method === 'POST' && req.url === '/api/brain/projects') {
        const body = JSON.parse(raw);
        state.projectPosts.push(body);
        state.order.push('project');
        if (projectFail) { res.statusCode = 500; return res.end(JSON.stringify({ error: 'db_down' })); }
        res.statusCode = 201;
        return res.end(JSON.stringify({ id: PROJECT_ID, ...body }));
      }
----
  it('计划带 project：先建 project（只一次），整批任务顶层都挂它的 id', async () => {
    brain = await startBrain();
    const r = await runScript([plan({
      project: { name: '大改X', description: '为什么' },
      tasks: [
        { key: 'a', title: '一', acceptance: ['x'] },
        { key: 'b', title: '二', acceptance: ['x'], depends_on: ['a'] },
      ],
    })], { BRAIN_URL: brain.url });
    expect(r.code, r.stderr).toBe(0);
    expect(brain.projectPosts).toHaveLength(1);
    expect(brain.projectPosts[0]).toMatchObject({ name: '大改X', description: '为什么' });
    expect(brain.posts).toHaveLength(2);
    expect(brain.posts.every((p) => p.project_id === PROJECT_ID)).toBe(true);
    expect(brain.order).toEqual(['project', 'task', 'task']);
    expect(JSON.parse(r.stdout).map((c) => c.key)).toEqual(['a', 'b']);
  });
```

### E-5
对应: I-2
verdict: PASS

```command
cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/new-task.test.mjs --reporter=verbose 2>&1 | tail -50
```

```output
 ✓ scripts/coding-workflow/__tests__/new-task.test.mjs > new-task.mjs > 计划带 project：先建 project（只一次），整批任务顶层都挂它的 id
 ✓ scripts/coding-workflow/__tests__/new-task.test.mjs > new-task.mjs > 建 project 失败：退出非 0，stderr 说明，不建任何任务
```

### E-6
对应: I-3
verdict: PASS

```command
sed -n 15,45p scripts/coding-workflow/__tests__/new-task.test.mjs; echo ----; sed -n 110,160p scripts/coding-workflow/__tests__/new-task.test.mjs; echo ----; sed -n 185,212p scripts/coding-workflow/__tests__/new-task.test.mjs
```

```output
  it('计划带 project_id：不建 project，每条任务顶层挂该 id，depends_on 仍换真实 id', async () => {
    brain = await startBrain();
    const r = await runScript([plan({ project_id: ROOT_ID, tasks: [
      { key: 'a', title: '一', acceptance: ['x'] },
      { key: 'b', title: '二', acceptance: ['x'], depends_on: ['a'] },
    ] })], { BRAIN_URL: brain.url });
    expect(r.code, r.stderr).toBe(0);
    expect(brain.projectPosts).toEqual([]);
    expect(brain.posts).toHaveLength(2);
    expect(brain.posts.every((p) => p.project_id === ROOT_ID)).toBe(true);
    expect(brain.posts[1].payload.depends_on).toEqual(['00000000-0000-4000-8000-000000000001']);
  });

  it('单条计划带 project_id：请求体顶层同样带上', async () => {
    brain = await startBrain();
    const r = await runScript([plan({ project_id: ROOT_ID, title: '改 X', acceptance: ['x'] })], { BRAIN_URL: brain.url });
    expect(r.code, r.stderr).toBe(0);
    expect(brain.projectPosts).toEqual([]);
    expect(brain.posts).toHaveLength(1);
    expect(brain.posts[0].project_id).toBe(ROOT_ID);
  });
```

### E-7
对应: I-3
verdict: PASS

```command
cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/new-task.test.mjs --reporter=verbose 2>&1 | tail -50
```

```output
 ✓ scripts/coding-workflow/__tests__/new-task.test.mjs > new-task.mjs > 计划带 project_id：不建 project，每条任务顶层挂该 id，depends_on 仍换真实 id
 ✓ scripts/coding-workflow/__tests__/new-task.test.mjs > new-task.mjs > 单条计划带 project_id：请求体顶层同样带上
```

### E-8
对应: I-4
verdict: PASS

```command
npx vitest run scripts/coding-workflow 2>&1 | tail -15
```

```output
 ✓ scripts/coding-workflow/runner/__tests__/sandbox-env.test.mjs  (2 tests) 1ms

 Test Files  27 passed (27)
      Tests  500 passed (500)
```
