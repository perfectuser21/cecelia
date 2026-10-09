---
task_id: 85058198-8234-4e6e-91b5-7e9365fc0805
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3"]
---
# 验收证据

### E-1
对应: I-1
verdict: PASS

```command
sed -n 88,160p packages/brain/scripts/coding-workflow/activities/publish.mjs
```

```output
function reviewSummary({ review_file: reviewFile, review_rounds: rounds }, dir, sprintRel) {
  if (typeof reviewFile !== 'string' || reviewFile === '') return '';
  let text;
  try {
    text = fs.readFileSync(path.join(dir, reviewFile), 'utf8');
  } catch {
    return '';
  }
  const { verdict, issues } = parseReview(text);
  const roundsText = Number.isInteger(rounds) && rounds > 0 ? rounds : '未知';
  const lines = issues.map(({ id, targets, body }) => `- ${id}（针对 ${targets.join('、')}）：${body.split('\n')[0]}`);
  return [
    `## 规格评审（${sprintRel}/${reviewFile}）`,
    `- 评审轮数：${roundsText}`,
    `- 最终 verdict：${verdict ?? '未知'}`,
    ...lines,
  ].join('\n');
}
```

### E-2
对应: I-1
verdict: PASS

```command
npx vitest run scripts/coding-workflow/__tests__/publish.test.mjs -t "review_file" --reporter=verbose 2>&1 | grep -E "✓|×|Tests|review_file"
```

```output
 ✓ scripts/coding-workflow/__tests__/publish.test.mjs > publish 活动（临时裸仓 + 假 gh） > 有 review_file：PR 正文含规格评审小节（轮数、最终 verdict、每条 R-n 首行） 371ms
 ✓ scripts/coding-workflow/__tests__/publish.test.mjs > publish 活动（临时裸仓 + 假 gh） > 无 review_file：PR 正文不带规格评审小节 464ms
      Tests  2 passed | 30 skipped (32)
```

### E-3
对应: I-2
verdict: PASS

```command
sed -n 136,182p packages/brain/scripts/coding-workflow/__tests__/publish.test.mjs
```

```output
  it('有 review_file：PR 正文含规格评审小节（轮数、最终 verdict、每条 R-n 首行）', async () => {
        '### R-1',
        '针对: S-1',
        'R-1 第一行说明',
        'R-1 第二行细节',
        '### R-2',
        '针对: I-1, S-2',
        'R-2 唯一一行',
      review_file: '02-review.md',
      review_rounds: 2,
    expect(body).toContain('## 规格评审（sprints/s1/02-review.md）');
    expect(body).toContain('- 评审轮数：2');
    expect(body).toContain('- 最终 verdict：APPROVE');
    expect(body).toContain('- R-1（针对 S-1）：R-1 第一行说明');
    expect(body).not.toContain('R-1 第二行细节');
    expect(body).toContain('- R-2（针对 I-1、S-2）：R-2 唯一一行');
  it('无 review_file：PR 正文不带规格评审小节', async () => {
    expect(create[create.indexOf('--body') + 1]).not.toContain('规格评审');
```

### E-4
对应: I-2
verdict: PASS

```command
cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/publish.test.mjs 2>&1 | tail -30
```

```output
 ✓ scripts/coding-workflow/__tests__/publish.test.mjs  (32 tests) 8544ms

 Test Files  1 passed (1)
      Tests  32 passed (32)
```

### E-5
对应: I-3
verdict: PASS

```command
npx vitest run scripts/coding-workflow 2>&1 | tail -40
```

```output
 ✓ scripts/coding-workflow/__tests__/spec-review.test.mjs  (16 tests) 3683ms
 ✓ scripts/coding-workflow/__tests__/review.test.mjs  (22 tests) 5ms

 Test Files  31 passed (31)
      Tests  575 passed (575)
```
