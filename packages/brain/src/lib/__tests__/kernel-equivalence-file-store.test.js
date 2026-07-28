import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createReadOnlyBundleReader,
} from '../kernel-equivalence-file-store.js';

const HASH = 'a'.repeat(64);

describe('createReadOnlyBundleReader', () => {
  it('reads only an exact content-addressed regular JSON file', () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-eq-store-'));
    try {
      const bundle = { schema_version: 'fixture', value: 1 };
      writeFileSync(join(root, `${HASH}.json`), JSON.stringify(bundle));
      const readBundle = createReadOnlyBundleReader({ directory: root });

      expect(readBundle(HASH)).toEqual(bundle);
      expect(() => readBundle('../secret')).toThrowError(
        expect.objectContaining({ code: 'receipt_reference_invalid' }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects symlinked stores and symlinked bundle files', () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-eq-store-'));
    try {
      const actual = join(root, 'actual');
      mkdirSync(actual);
      writeFileSync(join(actual, `${HASH}.json`), '{}');
      const linkedDirectory = join(root, 'linked');
      symlinkSync(actual, linkedDirectory);
      expect(() => createReadOnlyBundleReader({ directory: linkedDirectory }))
        .toThrowError(expect.objectContaining({ code: 'receipt_store_unsafe' }));

      const safe = join(root, 'safe');
      mkdirSync(safe);
      symlinkSync(
        join(actual, `${HASH}.json`),
        join(safe, `${HASH}.json`),
      );
      const reader = createReadOnlyBundleReader({ directory: safe });
      expect(() => reader(HASH)).toThrowError(
        expect.objectContaining({ code: 'receipt_bundle_path_unsafe' }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a hard-linked file whose inode is shared outside the store', () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-eq-store-'));
    try {
      const outside = join(root, 'outside.json');
      const safe = join(root, 'safe');
      mkdirSync(safe);
      writeFileSync(outside, '{"outside":true}');
      linkSync(outside, join(safe, `${HASH}.json`));

      const reader = createReadOnlyBundleReader({ directory: safe });
      expect(() => reader(HASH)).toThrowError(
        expect.objectContaining({ code: 'receipt_bundle_path_unsafe' }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not write or mutate the store while reading', () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-eq-store-'));
    try {
      writeFileSync(join(root, `${HASH}.json`), '{"stable":true}');
      const before = readFileSync(join(root, `${HASH}.json`), 'utf8');
      const reader = createReadOnlyBundleReader({ directory: root });
      reader(HASH);
      const after = readFileSync(join(root, `${HASH}.json`), 'utf8');
      expect(after).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
