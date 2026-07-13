import { describe, it, expect } from 'vitest';
import { buildSshCommand } from '../infra-status.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SRV = { sshUser: 'u', tailscaleIp: '100.0.0.1' };

describe('buildSshCommand', () => {
  it('恒带 UserKnownHostsFile=/dev/null(容器只读 FS 兼容)', () => {
    const c = buildSshCommand(SRV, 'hostname');
    expect(c).toContain('-o UserKnownHostsFile=/dev/null');
    expect(c).toContain('-o ConnectTimeout=5');
    expect(c).toContain('-o BatchMode=yes');
    expect(c).toContain('"u@100.0.0.1"');
  });
  it('identity 文件存在时带 -i <path>', () => {
    const tmp = path.join(os.tmpdir(), `key-${process.pid}`);
    fs.writeFileSync(tmp, 'x');
    try {
      const c = buildSshCommand(SRV, 'hostname', { identityPath: tmp });
      expect(c).toContain(`-i ${tmp}`);
    } finally { fs.unlinkSync(tmp); }
  });
  it('identity 文件不存在时不带 -i', () => {
    const c = buildSshCommand(SRV, 'hostname', { identityPath: '/nonexistent/key' });
    expect(c).not.toContain('-i ');
  });
});
