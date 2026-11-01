import {describe, it, expect} from 'vitest';
import {readFile} from 'node:fs/promises';

describe('harness-controller 独立 Judge 放行合同', () => {
  it('只有 verdict=PASS 且 judged=true 才允许进入 merge', async () => {
    const skill = await readFile(new URL(
      '../../../workflows/skills/harness-controller/SKILL.md',
      import.meta.url,
    ), 'utf8');

    expect(skill).toContain("JUDGED=$(echo \"$JUDGE_RESP\" | jq -r '.judged // false')");
    expect(skill).toContain(
      'if [ "$VERDICT" != "PASS" ] || [ "$JUDGED" != "true" ]; then',
    );
    expect(skill).toContain('Authorization: Bearer $CECELIA_INTERNAL_TOKEN');
  });

  it('Step 6 只能调用 Brain exact-run merge authority，禁止客户端直接 gh merge', async () => {
    const skill = await readFile(new URL(
      '../../../workflows/skills/harness-controller/SKILL.md',
      import.meta.url,
    ), 'utf8');
    const step6 = skill.slice(skill.indexOf('## Step 6:'), skill.indexOf('## Step 7:'));
    expect(step6).toContain('/api/brain/harness/runs/${HARNESS_RUN_ID}/merge');
    expect(step6).not.toContain('gh pr merge --squash --delete-branch');
  });

  it('Step 6 的重评分支必须是可执行 shell，不得把中文流程说明当作命令', async () => {
    const skill = await readFile(new URL(
      '../../../workflows/skills/harness-controller/SKILL.md',
      import.meta.url,
    ), 'utf8');
    const step6 = skill.slice(skill.indexOf('## Step 6:'), skill.indexOf('## Step 7:'));

    expect(step6).not.toMatch(/\|\|\s*回 Step/);
    expect(step6).not.toMatch(/^\s*回 Step/m);
    expect(step6).toContain('exit 2');
  });
});
