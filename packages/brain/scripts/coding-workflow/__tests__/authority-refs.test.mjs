import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { initCommittableRepo, git } from './helpers/git.mjs';

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

describe('固定 Git 权威引用', () => {
  it('同路径两个 commit 读取各自原字节，拒绝坏摘要和 symlink', async () => {
    const { resolveAuthority } = await import('../lib/authority-refs.mjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-authority-'));
    try {
      initCommittableRepo(root, path.join(root, '.hooks'));
      fs.writeFileSync(path.join(root, 'rule.md'), Buffer.from([0, 255, 10]));
      git(root, 'add', 'rule.md'); git(root, 'commit', '-qm', 'first');
      const a = git(root, 'rev-parse', 'HEAD').trim();
      fs.writeFileSync(path.join(root, 'rule.md'), Buffer.from([1, 254, 10]));
      git(root, 'commit', '-qam', 'second');
      const b = git(root, 'rev-parse', 'HEAD').trim();
      const ref = (revision, digest) => ({ ref_id: 'rule', kind: 'rule', path: 'rule.md', revision, digest, required: true });
      expect(resolveAuthority(root, [ref(a, sha(Buffer.from([0,255,10])) )])[0]).toMatchObject({ status: 'found', digest: sha(Buffer.from([0,255,10])) });
      expect(resolveAuthority(root, [ref(b, sha(Buffer.from([1,254,10])) )])[0].status).toBe('found');
      expect(resolveAuthority(root, [ref(a, '0'.repeat(64))])[0].reason).toBe('authority_digest_mismatch');
      fs.symlinkSync('../outside', path.join(root, 'link.md'));
      git(root, 'add', 'link.md'); git(root, 'commit', '-qm', 'link');
      expect(resolveAuthority(root, [{ ...ref(git(root, 'rev-parse', 'HEAD').trim(), '0'.repeat(64)), path: 'link.md' }])[0].reason).toBe('authority_non_regular_file');
      fs.symlinkSync('../outside', path.join(root, 'jump'));
      git(root, 'add', 'jump'); git(root, 'commit', '-qm', 'parent-link');
      expect(resolveAuthority(root, [{ ...ref(git(root, 'rev-parse', 'HEAD').trim(), '0'.repeat(64)), path: 'jump/secret.md' }])[0].reason).toBe('authority_non_regular_file');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('结构错误、外部来源、缺文件、坏 commit 有明确原因', async () => {
    const { validateAuthority, resolveAuthority } = await import('../lib/authority-refs.mjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-authority-'));
    try {
      initCommittableRepo(root, path.join(root, '.hooks'));
      const revision = git(root, 'rev-parse', 'HEAD').trim();
      const ref = { ref_id: 'rule', kind: 'rule', path: 'missing.md', revision, digest: '0'.repeat(64), required: true };
      expect(resolveAuthority(root, [ref])[0].reason).toBe('authority_file_missing');
      expect(resolveAuthority(root, [{ ...ref, revision: 'f'.repeat(40) }])[0].reason).toBe('authority_revision_unavailable');
      expect(resolveAuthority(root, [{ ...ref, path: '../secret' }])[0].reason).toBe('authority_path_invalid');
      expect(resolveAuthority(root, [{ ...ref, path: 'https://example.com/rule' }])[0].reason).toBe('authority_source_unsupported');
      expect(validateAuthority({ object_id: 'coding-workflow', refs: [ref, ref] })).toContain('authority_ref_duplicate');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
