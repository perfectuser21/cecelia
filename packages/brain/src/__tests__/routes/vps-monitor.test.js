/**
 * Route tests: VPS Monitor
 *
 * GET /stats       — CPU/内存/磁盘/网络统计
 * GET /containers  — Docker 容器详情
 * GET /services    — Docker 容器 + PM2 服务
 * GET /history     — 简易历史指标
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock child_process.execSync
const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: (...args) => mockExecSync(...args),
}));

// Mock os 模块（保留部分真实实现，覆盖需要控制的部分）
const mockOs = {
  cpus: vi.fn(() => [
    { model: 'Intel Xeon E5-2680 v4', speed: 2400 },
    { model: 'Intel Xeon E5-2680 v4', speed: 2400 },
  ]),
  totalmem: vi.fn(() => 4 * 1024 * 1024 * 1024), // 4GB
  freemem: vi.fn(() => 1 * 1024 * 1024 * 1024),   // 1GB free
  loadavg: vi.fn(() => [0.5, 0.3, 0.2]),
  hostname: vi.fn(() => 'test-vps'),
  type: vi.fn(() => 'Linux'),
  release: vi.fn(() => '5.15.0-168-generic'),
  uptime: vi.fn(() => 86400),
  networkInterfaces: vi.fn(() => ({
    eth0: [{ address: '10.0.0.1', family: 'IPv4' }],
    lo: [{ address: '127.0.0.1', family: 'IPv4' }],
  })),
};
vi.mock('os', () => ({ default: mockOs, ...mockOs }));

const { default: router } = await import('../../routes/vps-monitor.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/vps', router);
  return app;
}

describe('vps-monitor routes', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    // 重置默认 mock 返回值
    mockOs.cpus.mockReturnValue([
      { model: 'Intel Xeon E5-2680 v4', speed: 2400 },
      { model: 'Intel Xeon E5-2680 v4', speed: 2400 },
    ]);
    mockOs.totalmem.mockReturnValue(4 * 1024 * 1024 * 1024);
    mockOs.freemem.mockReturnValue(1 * 1024 * 1024 * 1024);
    mockOs.loadavg.mockReturnValue([0.5, 0.3, 0.2]);
    mockOs.hostname.mockReturnValue('test-vps');
    mockOs.type.mockReturnValue('Linux');
    mockOs.release.mockReturnValue('5.15.0-168-generic');
    mockOs.uptime.mockReturnValue(86400);
    mockOs.networkInterfaces.mockReturnValue({
      eth0: [{ address: '10.0.0.1', family: 'IPv4' }],
      lo: [{ address: '127.0.0.1', family: 'IPv4' }],
    });
    // 默认 execSync 行为：返回空字符串
    mockExecSync.mockReturnValue('');
    app = createApp();
  });

  // ============================================================
  // GET /stats
  // ============================================================
  describe('GET /stats', () => {
    it('返回完整的系统统计信息', async () => {
      // 模拟各种 safeExec 调用
      mockExecSync
        .mockReturnValueOnce('25.3')            // top CPU
        .mockReturnValueOnce('50G 20G 28G 40%') // df 磁盘
        .mockReturnValueOnce('123456789')        // eth0 rx_bytes
        .mockReturnValueOnce('987654321')        // eth0 tx_bytes
        .mockReturnValueOnce('100000')           // eth0 rx_packets
        .mockReturnValueOnce('80000');            // eth0 tx_packets

      const res = await request(app).get('/vps/stats');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('hostname', 'test-vps');
      expect(res.body).toHaveProperty('platform', 'Linux 5.15.0-168-generic');
      expect(res.body).toHaveProperty('uptime', 86400);
      expect(res.body).toHaveProperty('timestamp');

      // CPU
      expect(res.body.cpu).toHaveProperty('model', 'Intel Xeon E5-2680 v4');
      expect(res.body.cpu).toHaveProperty('cores', 2);
      expect(res.body.cpu.usage).toBeCloseTo(25.3, 1);
      expect(res.body.cpu.loadAverage).toHaveProperty('1min');
      expect(res.body.cpu.loadAverage).toHaveProperty('5min');
      expect(res.body.cpu.loadAverage).toHaveProperty('15min');

      // 内存
      expect(res.body.memory).toHaveProperty('total', 4 * 1024 * 1024 * 1024);
      expect(res.body.memory).toHaveProperty('free', 1 * 1024 * 1024 * 1024);
      expect(res.body.memory.usagePercent).toBeCloseTo(75.0, 1);

      // 磁盘
      expect(res.body.disk).toHaveProperty('total', '50G');
      expect(res.body.disk).toHaveProperty('used', '20G');
      expect(res.body.disk).toHaveProperty('available', '28G');
      expect(res.body.disk.usagePercent).toBe(40);

      // 网络（lo 被过滤，只剩 eth0）
      expect(res.body.network).toHaveLength(1);
      expect(res.body.network[0]).toMatchObject({
        interface: 'eth0',
        bytesReceived: 123456789,
        bytesSent: 987654321,
        packetsReceived: 100000,
        packetsSent: 80000,
      });
    });

    it('过滤 lo/docker/br-/veth 接口', async () => {
      mockOs.networkInterfaces.mockReturnValue({
        eth0: [{ address: '10.0.0.1' }],
        lo: [{ address: '127.0.0.1' }],
        docker0: [{ address: '172.17.0.1' }],
        'br-abc123': [{ address: '172.18.0.1' }],
        veth1234: [{ address: '172.17.0.2' }],
        ens3: [{ address: '10.0.0.2' }],
      });

      const res = await request(app).get('/vps/stats');

      expect(res.status).toBe(200);
      // 只有 eth0 和 ens3 通过过滤
      const ifNames = res.body.network.map((n) => n.interface);
      expect(ifNames).toContain('eth0');
      expect(ifNames).toContain('ens3');
      expect(ifNames).not.toContain('lo');
      expect(ifNames).not.toContain('docker0');
      expect(ifNames).not.toContain('br-abc123');
      expect(ifNames).not.toContain('veth1234');
    });

    it('最多返回 3 个网络接口', async () => {
      mockOs.networkInterfaces.mockReturnValue({
        eth0: [{ address: '10.0.0.1' }],
        ens3: [{ address: '10.0.0.2' }],
        ens4: [{ address: '10.0.0.3' }],
        ens5: [{ address: '10.0.0.4' }],
      });

      const res = await request(app).get('/vps/stats');

      expect(res.status).toBe(200);
      expect(res.body.network.length).toBeLessThanOrEqual(3);
    });

    it('execSync 抛异常时 safeExec 返回 fallback', async () => {
      // 所有 execSync 调用都抛异常
      mockExecSync.mockImplementation(() => {
        throw new Error('Command not found');
      });

      const res = await request(app).get('/vps/stats');

      expect(res.status).toBe(200);
      // safeExec 内部已 catch，返回空字符串 fallback
      // parseFloat('') = NaN, NaN || 0 = 0，外层 catch 不会被触发
      expect(res.body.cpu.usage).toBe(0);
      // 磁盘信息使用 N/A fallback
      expect(res.body.disk.total).toBe('N/A');
      expect(res.body.disk.used).toBe('N/A');
      expect(res.body.disk.available).toBe('N/A');
      expect(res.body.disk.usagePercent).toBe(0);
      // 网络使用 0 fallback
      expect(res.body.network[0].bytesReceived).toBe(0);
      expect(res.body.network[0].bytesSent).toBe(0);
    });

    it('CPU top 返回非数字时使用 0', async () => {
      mockExecSync.mockReturnValue('not-a-number');

      const res = await request(app).get('/vps/stats');

      expect(res.status).toBe(200);
      // parseFloat('not-a-number') = NaN, || 0 → 0
      expect(res.body.cpu.usage).toBe(0);
    });
  });

  // ============================================================
  // GET /containers
  // ============================================================
  describe('GET /containers', () => {
    it('返回带 CPU/内存统计的容器列表（docker stats 有输出）', async () => {
      // 第一次 safeExec: docker stats
      mockExecSync.mockImplementation((cmd) => {
        if (cmd.includes('docker stats')) {
          return 'nginx|running|80/tcp|2.50%|50MiB / 1GiB|5.00%\nredis|running||0.30%|10MiB / 1GiB|1.00%';
        }
        if (cmd.includes('docker port')) {
          return '80/tcp -> 0.0.0.0:8080';
        }
        return '';
      });

      const res = await request(app).get('/vps/containers');

      expect(res.status).toBe(200);
      expect(res.body.containers).toHaveLength(2);
      expect(res.body.containers[0]).toMatchObject({
        name: 'nginx',
        cpuPercent: 2.5,
        memoryPercent: 5.0,
      });
      expect(res.body.containers[1]).toMatchObject({
        name: 'redis',
        cpuPercent: 0.3,
        memoryPercent: 1.0,
      });
      expect(res.body).toHaveProperty('running');
      expect(res.body).toHaveProperty('total', 2);
      expect(res.body).toHaveProperty('timestamp');
    });

    it('docker stats 无输出时 fallback 到 docker ps', async () => {
      mockExecSync.mockImplementation((cmd) => {
        if (cmd.includes('docker stats')) {
          return ''; // 空输出触发 fallback
        }
        if (cmd.includes('docker ps')) {
          return 'myapp|Up 2 hours|0.0.0.0:3000->3000/tcp';
        }
        return '';
      });

      const res = await request(app).get('/vps/containers');

      expect(res.status).toBe(200);
      expect(res.body.containers).toHaveLength(1);
      expect(res.body.containers[0]).toMatchObject({
        name: 'myapp',
        status: 'Up 2 hours',
        cpu: '0%',
        cpuPercent: 0,
        memory: 'N/A',
        memoryPercent: 0,
      });
      expect(res.body.running).toBe(1);
    });

    it('docker stats 和 docker ps 都失败时返回空列表', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('docker not available');
      });

      const res = await request(app).get('/vps/containers');

      expect(res.status).toBe(200);
      // safeExec 返回空字符串 → split → filter(Boolean) → 空数组
      expect(res.body.containers).toHaveLength(0);
      expect(res.body.running).toBe(0);
      expect(res.body.total).toBe(0);
    });

    it('running 数量正确统计包含 "up" 的容器', async () => {
      mockExecSync.mockImplementation((cmd) => {
        if (cmd.includes('docker stats')) {
          return 'app1|Up 2 hours||1%|100M|5%\napp2|Exited (0)||0%|0M|0%\napp3|Up 5 min||2%|200M|10%';
        }
        if (cmd.includes('docker port')) {
          return '';
        }
        return '';
      });

      const res = await request(app).get('/vps/containers');

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.running).toBe(2);
    });
  });

  // ============================================================
  // GET /services
  // ============================================================
  describe('GET /services', () => {
    it('返回 Docker 容器作为服务列表', async () => {
      mockExecSync.mockImplementation((cmd) => {
        if (cmd.includes('docker ps')) {
          return 'nginx-proxy|Up 3 hours|0.0.0.0:80->80/tcp\nredis-cache|Up 1 hour|';
        }
        if (cmd.includes('pm2 jlist')) {
          return '';
        }
        return '';
      });

      const res = await request(app).get('/vps/services');

      expect(res.status).toBe(200);
      expect(res.body.services).toHaveLength(2);
      // 容器名 nginx-proxy → 首字母大写 "Nginx Proxy"
      expect(res.body.services[0].name).toBe('Nginx Proxy');
      expect(res.body.services[0].containerName).toBe('nginx-proxy');
      expect(res.body.services[0].port).toBe(80);
      expect(res.body.services[0].status).toBe('running');
      expect(res.body.services[0].uptime).toBe('3 hours');

      expect(res.body.services[1].name).toBe('Redis Cache');
      expect(res.body.services[1].port).toBe(0); // 无端口映射
      expect(res.body.services[1].status).toBe('running');
      expect(res.body).toHaveProperty('timestamp');
    });

    it('包含 PM2 进程', async () => {
      const pm2Data = [
        {
          name: 'brain',
          pm2_env: { status: 'online', pm_uptime: Date.now() - 60000 },
        },
        {
          name: 'worker',
          pm2_env: { status: 'stopped', pm_uptime: null },
        },
      ];

      mockExecSync.mockImplementation((cmd) => {
        if (cmd.includes('docker ps')) {
          return '';
        }
        if (cmd.includes('pm2 jlist')) {
          return JSON.stringify(pm2Data);
        }
        return '';
      });

      const res = await request(app).get('/vps/services');

      expect(res.status).toBe(200);
      expect(res.body.services).toHaveLength(2);
      expect(res.body.services[0]).toMatchObject({
        name: 'brain',
        containerName: 'pm2:brain',
        port: 0,
        status: 'running',
      });
      expect(res.body.services[1]).toMatchObject({
        name: 'worker',
        containerName: 'pm2:worker',
        status: 'stopped',
        uptime: '0s',
      });
    });

    it('PM2 输出不合法 JSON 时不影响 Docker 服务', async () => {
      mockExecSync.mockImplementation((cmd) => {
        if (cmd.includes('docker ps')) {
          return 'my-app|Up 1 hour|0.0.0.0:5000->5000/tcp';
        }
        if (cmd.includes('pm2 jlist')) {
          return 'invalid-json{{{';
        }
        return '';
      });

      const res = await request(app).get('/vps/services');

      expect(res.status).toBe(200);
      // 只有 Docker 容器，PM2 解析失败被静默忽略
      expect(res.body.services).toHaveLength(1);
      expect(res.body.services[0].containerName).toBe('my-app');
    });

    it('docker 和 pm2 都无输出时返回空服务列表', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('commands not found');
      });

      const res = await request(app).get('/vps/services');

      expect(res.status).toBe(200);
      expect(res.body.services).toHaveLength(0);
    });

    it('容器状态非 up 时标记为 stopped', async () => {
      mockExecSync.mockImplementation((cmd) => {
        if (cmd.includes('docker ps')) {
          return 'dead-container|Exited (1) 5 hours ago|';
        }
        if (cmd.includes('pm2 jlist')) {
          return '';
        }
        return '';
      });

      const res = await request(app).get('/vps/services');

      expect(res.status).toBe(200);
      expect(res.body.services[0].status).toBe('stopped');
      expect(res.body.services[0].uptime).toBe('0s');
    });
  });

  // ============================================================
  // GET /history
  // ============================================================
  describe('GET /history', () => {
    it('默认返回 24 小时的 96 个数据点', async () => {
      mockExecSync.mockReturnValue('45%');

      const res = await request(app).get('/vps/history');

      expect(res.status).toBe(200);
      expect(res.body.metrics).toHaveLength(96); // 24h * 4 points/h
      // 每个数据点应有 time, cpu, memory, load, disk
      const point = res.body.metrics[0];
      expect(point).toHaveProperty('time');
      expect(point).toHaveProperty('cpu');
      expect(point).toHaveProperty('memory');
      expect(point).toHaveProperty('load');
      expect(point).toHaveProperty('disk');
    });

    it('支持 hours 查询参数', async () => {
      mockExecSync.mockReturnValue('30%');

      const res = await request(app).get('/vps/history?hours=6');

      expect(res.status).toBe(200);
      expect(res.body.metrics).toHaveLength(24); // 6h * 4 = 24
    });

    it('最多返回 96 个数据点（超过 24h 时）', async () => {
      mockExecSync.mockReturnValue('30%');

      const res = await request(app).get('/vps/history?hours=100');

      expect(res.status).toBe(200);
      // Math.min(100*4, 96) = 96
      expect(res.body.metrics).toHaveLength(96);
    });

    it('hours 非数字时默认 24 小时', async () => {
      mockExecSync.mockReturnValue('30%');

      const res = await request(app).get('/vps/history?hours=abc');

      expect(res.status).toBe(200);
      expect(res.body.metrics).toHaveLength(96);
    });

    it('数据点的 CPU/内存/负载在合理范围内', async () => {
      mockExecSync.mockReturnValue('50%');

      const res = await request(app).get('/vps/history?hours=1');

      expect(res.status).toBe(200);
      for (const point of res.body.metrics) {
        expect(point.cpu).toBeGreaterThanOrEqual(0);
        expect(point.cpu).toBeLessThanOrEqual(100);
        expect(point.memory).toBeGreaterThanOrEqual(0);
        expect(point.memory).toBeLessThanOrEqual(100);
        expect(point.load).toBeGreaterThanOrEqual(0);
      }
    });

    it('时间戳按升序排列（最早到最新）', async () => {
      mockExecSync.mockReturnValue('50%');

      const res = await request(app).get('/vps/history?hours=2');

      expect(res.status).toBe(200);
      const times = res.body.metrics.map((m) => new Date(m.time).getTime());
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThan(times[i - 1]);
      }
    });

    it('df 命令失败时 disk 为 0', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('df not available');
      });

      const res = await request(app).get('/vps/history?hours=1');

      expect(res.status).toBe(200);
      for (const point of res.body.metrics) {
        expect(point.disk).toBe(0);
      }
    });
  });
});
