import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkChain, extractAnchors } from '../lib/md-chain.mjs';

const TASK = 'task-123';

function fm(taskId, step, upstream) {
  return `---\ntask_id: ${taskId}\nstep: ${step}\nupstream: ${JSON.stringify(upstream)}\n---\n`;
}

describe('md-chain', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-chain-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeIntent(taskId = TASK) {
    fs.writeFileSync(
      path.join(dir, '01-intent.md'),
      `${fm(taskId, 'intent', [])}\n# 意图\n\n### I-1\n第一条\n\n### I-2\n第二条\n`,
    );
  }
  function writeSpec(upstream, taskId = TASK) {
    fs.writeFileSync(
      path.join(dir, '02-spec.md'),
      `${fm(taskId, 'spec', upstream)}\n# 规格\n\n### S-1\n内容\n`,
    );
  }

  it('合法链通过', () => {
    writeIntent();
    writeSpec(['01-intent.md#I-1', '01-intent.md#I-2']);
    const r = checkChain({ dir, taskId: TASK });
    expect(r).toEqual({ ok: true, errors: [], files: ['01-intent.md', '02-spec.md'] });
  });

  it('伪造锚点', () => {
    writeIntent();
    writeSpec(['01-intent.md#I-1', '01-intent.md#I-2', '01-intent.md#I-9']);
    const r = checkChain({ dir, taskId: TASK });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('upstream_anchor_missing:01-intent.md#I-9');
  });

  it('缺上游文件', () => {
    writeIntent();
    writeSpec(['00-x.md#I-1', '01-intent.md#I-1', '01-intent.md#I-2']);
    const r = checkChain({ dir, taskId: TASK });
    expect(r.errors).toContain('upstream_file_missing:00-x.md#I-1');
  });

  it('task_id 不一致', () => {
    writeIntent();
    writeSpec(['01-intent.md#I-1', '01-intent.md#I-2'], 'other-task');
    const r = checkChain({ dir, taskId: TASK });
    expect(r.errors).toContain('task_id_mismatch:02-spec.md');
  });

  it('未覆盖全部 I-n', () => {
    writeIntent();
    writeSpec(['01-intent.md#I-1']);
    const r = checkChain({ dir, taskId: TASK });
    expect(r.errors).toContain('intent_not_covered:I-2');
  });

  it('文件缺失', () => {
    const r = checkChain({ dir, taskId: TASK });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('file_missing:01-intent.md');
    expect(r.errors).toContain('file_missing:02-spec.md');
  });

  it('无 frontmatter', () => {
    fs.writeFileSync(path.join(dir, '01-intent.md'), '# 无头\n### I-1\n');
    writeSpec(['01-intent.md#I-1']);
    const r = checkChain({ dir, taskId: TASK });
    expect(r.errors).toContain('frontmatter_missing:01-intent.md');
  });

  it('intent 的 upstream 必须为空', () => {
    fs.writeFileSync(
      path.join(dir, '01-intent.md'),
      `${fm(TASK, 'intent', ['02-spec.md#S-1'])}\n### I-1\n`,
    );
    writeSpec(['01-intent.md#I-1']);
    const r = checkChain({ dir, taskId: TASK });
    expect(r.errors).toContain('intent_upstream_not_empty');
  });

  it('upstream 引用格式非法', () => {
    writeIntent();
    writeSpec(['bad-ref', '01-intent.md#I-1', '01-intent.md#I-2']);
    const r = checkChain({ dir, taskId: TASK });
    expect(r.errors).toContain('upstream_ref_invalid:bad-ref');
  });
});

describe('extractAnchors', () => {
  it('只提取 ### <ID> 锚点标题', () => {
    expect(extractAnchors('### I-1\n### S-2\n## X-3')).toEqual(['I-1', 'S-2']);
  });
});
