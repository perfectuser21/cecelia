import { it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strictLock } from '../runtime-lock.mjs';
let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-strict-lock-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
it('只允许一个持有者且释放后可再获取', () => {
  const first = strictLock(root); expect(first).toBeTruthy(); expect(strictLock(root)).toBeNull(); first.release();
  const next = strictLock(root); expect(next).toBeTruthy(); next.release();
});
it('未知/陈旧锁不被自动回收，避免竞争者删除新锁', () => {
  const dir = path.join(root, 'coding-workflow-runner.lock'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'pid'), '999999999'); fs.writeFileSync(path.join(dir, 'started_at'), '1');
  expect(strictLock(root)).toBeNull(); expect(strictLock(root)).toBeNull(); expect(fs.readFileSync(path.join(dir, 'pid'), 'utf8')).toBe('999999999');
});
it('token已变时不删除新持有者', () => {
  const first = strictLock(root); const dir = path.join(root, 'coding-workflow-runner.lock');
  fs.writeFileSync(path.join(dir, 'token'), 'new-owner'); expect(() => first.release()).toThrow('runtime_lock_owner_changed'); expect(fs.existsSync(dir)).toBe(true);
});
