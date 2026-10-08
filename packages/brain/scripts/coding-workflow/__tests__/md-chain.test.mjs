import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkChain, extractAnchors, parseFrontmatter } from '../lib/md-chain.mjs';
import { renderIntent } from '../lib/intent.mjs';

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

  it('02-spec 未覆盖时同时报 <file>_not_covered 与兼容的 intent_not_covered', () => {
    writeIntent();
    writeSpec(['01-intent.md#I-1']);
    const r = checkChain({ dir, taskId: TASK });
    expect(r.errors).toContain('02-spec.md_not_covered:I-2');
    expect(r.errors).toContain('intent_not_covered:I-2');
  });

  it('step 与文件不符 -> step_mismatch', () => {
    writeIntent();
    fs.writeFileSync(
      path.join(dir, '02-spec.md'),
      `${fm(TASK, 'build', ['01-intent.md#I-1', '01-intent.md#I-2'])}\n### S-1\n`,
    );
    const r = checkChain({ dir, taskId: TASK });
    expect(r.errors).toContain('step_mismatch:02-spec.md');
  });
});

describe('md-chain 四文件链（files 指定本次应存在的链文件）', () => {
  let dir;
  const ALL = ['01-intent.md', '02-spec.md', '03-build.md', '04-evidence.md'];
  const write = (file, step, upstream, body) => fs.writeFileSync(path.join(dir, file), `${fm(TASK, step, upstream)}\n${body}`);
  const intentRefs = ['01-intent.md#I-1', '01-intent.md#I-2'];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-chain4-'));
    write('01-intent.md', 'intent', [], '### I-1\n一\n\n### I-2\n二\n');
    write('02-spec.md', 'spec', intentRefs, '### S-1\n一\n\n### S-2\n二\n');
    write('03-build.md', 'build', ['02-spec.md#S-1', '02-spec.md#S-2'], '### B-1\n一\n');
    write('04-evidence.md', 'verify', intentRefs, '### E-1\n一\n\n### E-2\n二\n');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('合法四文件链通过，files 按链顺序返回', () => {
    const r = checkChain({ dir, taskId: TASK, files: ['04-evidence.md', '01-intent.md', '03-build.md', '02-spec.md'] });
    expect(r).toEqual({ ok: true, errors: [], files: ALL });
  });

  it('03-build 未覆盖全部 S-n -> 03-build.md_not_covered:S-2', () => {
    write('03-build.md', 'build', ['02-spec.md#S-1'], '### B-1\n');
    const r = checkChain({ dir, taskId: TASK, files: ALL });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('03-build.md_not_covered:S-2');
  });

  it('04-evidence 未覆盖全部 I-n -> 04-evidence.md_not_covered:I-1', () => {
    write('04-evidence.md', 'verify', ['01-intent.md#I-2'], '### E-1\n');
    const r = checkChain({ dir, taskId: TASK, files: ALL });
    expect(r.errors).toContain('04-evidence.md_not_covered:I-1');
  });

  it('04-evidence 引用不存在的 I-n -> upstream_anchor_missing', () => {
    write('04-evidence.md', 'verify', [...intentRefs, '01-intent.md#I-7'], '### E-1\n');
    const r = checkChain({ dir, taskId: TASK, files: ALL });
    expect(r.errors).toContain('upstream_anchor_missing:01-intent.md#I-7');
  });

  it('files 声明了 04-evidence 但文件不存在 -> file_missing', () => {
    fs.rmSync(path.join(dir, '04-evidence.md'));
    const r = checkChain({ dir, taskId: TASK, files: ALL });
    expect(r.errors).toContain('file_missing:04-evidence.md');
  });

  it('只有 01/02 的旧 sprint 仍可校验：files 只列 01/02 时不要求 03/04', () => {
    fs.rmSync(path.join(dir, '03-build.md'));
    fs.rmSync(path.join(dir, '04-evidence.md'));
    const r = checkChain({ dir, taskId: TASK, files: ['01-intent.md', '02-spec.md'] });
    expect(r).toEqual({ ok: true, errors: [], files: ['01-intent.md', '02-spec.md'] });
  });

  it('不认识的链文件 -> file_unknown', () => {
    const r = checkChain({ dir, taskId: TASK, files: ['01-intent.md', '09-x.md'] });
    expect(r.errors).toContain('file_unknown:09-x.md');
  });
});

describe('md-chain 含 02-review（spec_review 评审文件）', () => {
  let dir;
  const FILES = ['01-intent.md', '02-spec.md', '02-review.md', '03-build.md', '04-evidence.md'];
  const write = (file, step, upstream, body) => fs.writeFileSync(path.join(dir, file), `${fm(TASK, step, upstream)}\n${body}`);
  const intentRefs = ['01-intent.md#I-1', '01-intent.md#I-2'];
  const specRefs = ['02-spec.md#S-1', '02-spec.md#S-2'];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-chain-review-'));
    write('01-intent.md', 'intent', [], '### I-1\n一\n\n### I-2\n二\n');
    write('02-spec.md', 'spec', intentRefs, '### S-1\n一\n\n### S-2\n二\n');
    write('02-review.md', 'spec_review', specRefs, 'verdict: APPROVE\n');
    write('03-build.md', 'build', specRefs, '### B-1\n一\n');
    write('04-evidence.md', 'verify', intentRefs, '### E-1\n一\n');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('02-review 覆盖 02-spec 全部 S-n -> 无错误，files 按链顺序（02-review 在 02-spec 与 03-build 之间）', () => {
    const r = checkChain({ dir, taskId: TASK, files: ['04-evidence.md', '02-review.md', '03-build.md', '01-intent.md', '02-spec.md'] });
    expect(r).toEqual({ ok: true, errors: [], files: FILES });
  });

  it('02-review upstream 漏掉 S-2 -> 02-review.md_not_covered:S-2', () => {
    write('02-review.md', 'spec_review', ['02-spec.md#S-1'], 'verdict: APPROVE\n');
    const r = checkChain({ dir, taskId: TASK, files: FILES });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('02-review.md_not_covered:S-2');
  });

  it('02-review step 写错 -> step_mismatch:02-review.md', () => {
    write('02-review.md', 'review', specRefs, 'verdict: APPROVE\n');
    const r = checkChain({ dir, taskId: TASK, files: FILES });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('step_mismatch:02-review.md');
  });
});

describe('extractAnchors', () => {
  it('只提取 ### <ID> 锚点标题', () => {
    expect(extractAnchors('### I-1\n### S-2\n## X-3')).toEqual(['I-1', 'S-2']);
  });

  it('ID 后可跟说明文字（空白或冒号分隔），ID 必须完整（真实 claude c2afa8ba：### S-1 plist 模板…）', () => {
    expect(extractAnchors('### S-1 plist 模板增加占位\n### S-2：渲染\n### S-10\n### S-3a\n### S-4-x')).toEqual(['S-1', 'S-2', 'S-10']);
  });

  const BACKGROUND = '## 小标题\n#### I-9\n- I-7 列表\n正文提到 I-5 字样\n### I-8 伪锚点\n验收：①一 ②二';

  it('带背景的 01-intent.md：背景里的标题/列表/伪锚点都不成为锚点', () => {
    const md = renderIntent({ taskId: TASK, title: '意图', items: ['一', '二'], description: BACKGROUND });
    expect(md).toContain('## 背景');
    expect(extractAnchors(parseFrontmatter(md).body)).toEqual(['I-1', 'I-2']);
  });

  it('带背景的 01-intent.md + 只覆盖 I-1/I-2 的 02-spec.md：checkChain 通过', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-chain-bg-'));
    try {
      fs.writeFileSync(
        path.join(dir, '01-intent.md'),
        renderIntent({ taskId: TASK, title: '意图', items: ['一', '二'], description: BACKGROUND }),
      );
      fs.writeFileSync(
        path.join(dir, '02-spec.md'),
        `${fm(TASK, 'spec', ['01-intent.md#I-1', '01-intent.md#I-2'])}\n### S-1\n一\n\n### S-2\n二\n`,
      );
      const r = checkChain({ dir, taskId: TASK });
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
