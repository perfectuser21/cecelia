---
task_id: b0828022-fd36-4e9d-b8ac-f4ce487d259c
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---
# 验收证据

### E-1
对应: I-1
verdict: PASS

```command
cd packages/brain && node --input-type=module -e "
import { renderIntent } from './scripts/coding-workflow/lib/intent.mjs';
import { extractAnchors } from './scripts/coding-workflow/lib/md-chain.mjs';
const withBg = renderIntent({ taskId: 't1', title: 'T', items: ['a','b'], description: '背景原文\n### I-9\n- 列表 ### x' });
console.log(withBg);
console.log('bg_before_I1=', withBg.indexOf('## 背景') < withBg.indexOf('### I-1'));
console.log('anchors=', JSON.stringify(extractAnchors(withBg)));
const noBg = renderIntent({ taskId: 't1', title: 'T', items: ['a'], description: '' });
const undef = renderIntent({ taskId: 't1', title: 'T', items: ['a'] });
console.log('empty_has_bg=', noBg.includes('## 背景'), 'undef_has_bg=', undef.includes('## 背景'), 'equal=', noBg === undef);
"
```

```output
---
task_id: t1
step: intent
upstream: []
---
# T

## 背景

背景原文
\### I-9
- 列表 ### x

### I-1
a

### I-2
b

bg_before_I1= true
anchors= ["I-1","I-2"]
empty_has_bg= false undef_has_bg= false equal= true
```

### E-2
对应: I-1
verdict: PASS

```command
grep -n "description" ../../packages/brain/scripts/coding-workflow/activities/intent.mjs
```

```output
37:  fs.writeFileSync(intentPath, renderIntent({ taskId, title: task?.title, items, description: task?.description }));
```

### E-3
对应: I-2
verdict: PASS

```command
npx vitest run scripts/coding-workflow/__tests__/md-chain.test.mjs -t "带背景" 2>&1 | tail -12
```

```output
 ✓ scripts/coding-workflow/__tests__/md-chain.test.mjs  (22 tests | 20 skipped) 1ms

 Test Files  1 passed (1)
      Tests  2 passed | 20 skipped (22)
```

### E-4
对应: I-2
verdict: PASS

```command
grep -n "背景\|description" packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs packages/brain/scripts/coding-workflow/__tests__/md-chain*.test.mjs
```

```output
packages/brain/scripts/coding-workflow/__tests__/md-chain.test.mjs:193:  it('带背景的 01-intent.md：背景里的标题/列表/伪锚点都不成为锚点', () => {
packages/brain/scripts/coding-workflow/__tests__/md-chain.test.mjs:194:    const md = renderIntent({ taskId: TASK, title: '意图', items: ['一', '二'], description: BACKGROUND });
packages/brain/scripts/coding-workflow/__tests__/md-chain.test.mjs:195:    expect(md).toContain('## 背景');
packages/brain/scripts/coding-workflow/__tests__/md-chain.test.mjs:199:  it('带背景的 01-intent.md + 只覆盖 I-1/I-2 的 02-spec.md：checkChain 通过', () => {
packages/brain/scripts/coding-workflow/__tests__/md-chain.test.mjs:204:        renderIntent({ taskId: TASK, title: '意图', items: ['一', '二'], description: BACKGROUND }),
packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs:69:  it('description 非空：在标题与 ### I-1 之间写入 ## 背景 与原文，frontmatter 不变', () => {
packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs:84:  ])('description 为%s：不出现 ## 背景，且与不传 description 逐字节一致', (_name, description) => {
packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs:87:    expect(md).not.toContain('## 背景');
```

### E-5
对应: I-3
verdict: PASS

```command
npx vitest run scripts/coding-workflow/__tests__/intent.test.mjs 2>&1 | tail -15
```

```output
 ✓ scripts/coding-workflow/__tests__/intent.test.mjs  (36 tests) 609ms

 Test Files  1 passed (1)
      Tests  36 passed (36)
```

### E-6
对应: I-3
verdict: PASS

```command
grep -n "背景\|description" packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs packages/brain/scripts/coding-workflow/__tests__/md-chain*.test.mjs
```

```output
packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs:69:  it('description 非空：在标题与 ### I-1 之间写入 ## 背景 与原文，frontmatter 不变', () => {
packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs:72:    expect(md).toContain('## 背景\n\n背景第一行\n\n背景第二行\n验收：①A ②B\n\n### I-1');
packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs:73:    expect(md.indexOf('# 标题')).toBeLessThan(md.indexOf('## 背景'));
packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs:74:    expect(md.indexOf('## 背景')).toBeLessThan(md.indexOf('### I-1'));
packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs:84:  ])('description 为%s：不出现 ## 背景，且与不传 description 逐字节一致', (_name, description) => {
packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs:87:    expect(md).not.toContain('## 背景');
```

### E-7
对应: I-4
verdict: PASS

```command
npx vitest run scripts/coding-workflow 2>&1 | tail -15
```

```output
 Test Files  28 passed (28)
      Tests  519 passed (519)
```
