import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { initCommittableRepo, git } from './helpers/git.mjs';

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

describe('固定 Git 权威引用', () => {
  it('固定清单拒绝路径替换和自造提交，允许可信旧版本回放', async () => {
    const { loadAuthorityIndex, validateAuthority, resolveAuthority } = await import('../lib/authority-refs.mjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-authority-bound-'));
    try {
      initCommittableRepo(root, path.join(root, '.hooks'));
      const registered = ['spec', 'rule', 'sample', 'implementation'].map((kind) => ({ ref_id: kind, kind, path: `${kind}.md`, required: true }));
      const indexPath = path.join(root, 'docs/registry/coding-workflow-authority.json');
      fs.mkdirSync(path.dirname(indexPath), { recursive: true });
      fs.writeFileSync(indexPath, JSON.stringify({ object_id: 'coding-workflow', refs: registered }));
      for (const { kind } of registered) fs.writeFileSync(path.join(root, `${kind}.md`), `${kind} A`);
      fs.writeFileSync(path.join(root, 'package.json'), '{}');
      git(root, 'add', '.'); git(root, 'commit', '-qm', 'trusted A');
      const old = git(root, 'rev-parse', 'HEAD').trim();
      for (const { kind } of registered) fs.writeFileSync(path.join(root, `${kind}.md`), `${kind} B`);
      git(root, 'commit', '-qam', 'trusted B');
      const bound = git(root, 'rev-parse', 'HEAD').trim();
      git(root, 'update-ref', 'refs/remotes/origin/main', bound);
      const index = loadAuthorityIndex(root, bound);
      const refs = registered.map((r) => ({ ...r, revision: old, digest: sha(`${r.kind} A`) }));
      expect(validateAuthority({ object_id: 'coding-workflow', refs }, index)).toEqual([]);
      expect(resolveAuthority(root, refs, { trustedSha: bound }).every((r) => r.status === 'found')).toBe(true);
      const replaced = refs.map((r) => ({ ...r, path: 'package.json', digest: sha('{}') }));
      expect(validateAuthority({ object_id: 'coding-workflow', refs: replaced }, index)).toContain('authority_path_mismatch');
      const forgedIndex = { object_id: 'coding-workflow', refs: registered.map((r) => ({ ...r, path: 'package.json' })) };
      fs.writeFileSync(indexPath, JSON.stringify(forgedIndex));
      git(root, 'add', indexPath); git(root, 'commit', '-qm', 'untrusted index');
      const forgedSha = git(root, 'rev-parse', 'HEAD').trim();
      expect(loadAuthorityIndex(root, bound)).toEqual(index);
      expect(() => loadAuthorityIndex(root, forgedSha)).toThrow('authority_index_untrusted');
      expect(resolveAuthority(root, refs.map((r) => ({ ...r, revision: forgedSha, digest: sha(`${r.kind} B`) })), { trustedSha: bound })[0].reason).toBe('authority_revision_untrusted');
      fs.writeFileSync(path.join(root, 'rule.md'), 'forged body');
      git(root, 'commit', '-qam', 'untrusted content');
      const contentSha = git(root, 'rev-parse', 'HEAD').trim();
      expect(resolveAuthority(root, [{ ...refs[1], revision: contentSha, digest: sha('forged body') }], { trustedSha: bound })[0].reason).toBe('authority_revision_untrusted');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('Git replace 不能替换固定提交的索引或正文', async () => {
    const { loadAuthorityIndex, resolveAuthority } = await import('../lib/authority-refs.mjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-authority-replace-'));
    try {
      initCommittableRepo(root, path.join(root, '.hooks'));
      const refs = ['spec', 'rule', 'sample', 'implementation'].map((kind) => ({ ref_id: kind, kind, path: 'rule.md', required: true }));
      const indexPath = path.join(root, 'docs/registry/coding-workflow-authority.json');
      fs.mkdirSync(path.dirname(indexPath), { recursive: true });
      fs.writeFileSync(indexPath, JSON.stringify({ object_id: 'coding-workflow', refs }));
      fs.writeFileSync(path.join(root, 'rule.md'), 'original');
      git(root, 'add', '.'); git(root, 'commit', '-qm', 'original');
      const original = git(root, 'rev-parse', 'HEAD').trim();
      git(root, 'update-ref', 'refs/remotes/origin/main', original);
      fs.writeFileSync(indexPath, JSON.stringify({ object_id: 'coding-workflow', refs: refs.map((r) => ({ ...r, path: 'package.json' })) }));
      fs.writeFileSync(path.join(root, 'rule.md'), 'substituted');
      git(root, 'commit', '-qam', 'substituted');
      const substitute = git(root, 'rev-parse', 'HEAD').trim();
      git(root, 'replace', original, substitute);
      expect(git(root, 'show', `${original}:rule.md`)).toBe('substituted');
      expect(loadAuthorityIndex(root, original).refs).toEqual(refs);
      expect(resolveAuthority(root, [{ ...refs[0], revision: original, digest: sha('original') }], { trustedSha: original })[0].status).toBe('found');
      expect(resolveAuthority(root, [{ ...refs[0], revision: original, digest: sha('substituted') }], { trustedSha: original })[0].reason).toBe('authority_digest_mismatch');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

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
