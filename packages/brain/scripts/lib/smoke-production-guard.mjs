#!/usr/bin/env node
// 写入 smoke 仅允许显式授权、身份可核对的本机测试容器。
import { execFileSync } from 'node:child_process';

const safeDatabases = new Set(['cecelia_test', 'cecelia_staging', 'cecelia_scratch']);
function deny(reason) {
  console.log(`[smoke] 写入未启用：${reason}`);
  process.exit(1);
}
function databaseTarget(value) {
  const uri = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(uri.protocol) || uri.search || uri.hash) {
    deny('数据库 URI 协议或覆盖参数不安全');
  }
  const host = ['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname) ? 'loopback' : uri.hostname;
  return { database: decodeURIComponent(uri.pathname.slice(1)), host, port: uri.port || '5432' };
}
function envDatabaseTarget(env, prefix, fallbackDatabase) {
  const hostname = env[`${prefix}HOST`] || 'localhost';
  return {
    database: env[prefix === 'PG' ? 'PGDATABASE' : 'DB_NAME'] || fallbackDatabase,
    host: ['localhost', '127.0.0.1', '::1'].includes(hostname) ? 'loopback' : hostname,
    port: env[`${prefix}PORT`] || '5432',
  };
}
function sameDatabase(left, right) {
  return left.database === right.database && left.host === right.host && left.port === right.port;
}
if (process.env.SMOKE_ALLOW_WRITE !== '1') deny('需 SMOKE_ALLOW_WRITE=1');
try {
  const target = new URL(process.argv[2]);
  if (target.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
      || target.username || target.password || target.search || target.hash || target.pathname !== '/') {
    deny('仅允许本机容器根地址');
  }
  const container = process.env.BRAIN_CONTAINER;
  if (!container) deny('缺少 BRAIN_CONTAINER，无法核对目标身份');
  // inspect 结果仅在内存解析；错误不输出 stderr/Env，防止泄露凭据。
  const raw = execFileSync('docker', ['inspect', '--format', '{{json .}}', container], {
    encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const info = JSON.parse(raw);
  const env = Object.fromEntries((info.Config?.Env || []).map(value => {
    const at = value.indexOf('=');
    return [value.slice(0, at), value.slice(at + 1)];
  }));
  if (!info.State?.Running || !['test', 'development'].includes(env.NODE_ENV)
      || !safeDatabases.has(env.DB_NAME)) deny('容器必须运行在已知测试环境和安全库');
  // Brain db-config.js 的真连接来自 DB_HOST/DB_PORT/DB_NAME，不使用 DATABASE_URL。
  const containerDb = envDatabaseTarget(env, 'DB_', env.DB_NAME);
  if (containerDb.host !== 'loopback') deny('容器真实数据库必须是本机测试服务');
  // 多余 URI 不能掩盖真实离散变量；冲突时保守拒绝。
  if (env.DATABASE_URL && !sameDatabase(databaseTarget(env.DATABASE_URL), containerDb)) {
    deny('容器 URI 与 Brain 实际 DB_* 连接不一致');
  }
  if (process.argv[3]) {
    const cleanupDb = process.argv[3] === '--db-env'
      ? envDatabaseTarget(process.env, 'DB_', 'cecelia')
      : process.argv[3] === '--pg-env'
        ? envDatabaseTarget(process.env, 'PG', '') : databaseTarget(process.argv[3]);
    if (cleanupDb.host !== 'loopback' || !sameDatabase(cleanupDb, containerDb)) {
      deny('操作连接必须指向容器的同一本机安全数据库服务');
    }
  }
  const containerPort = env.BRAIN_PORT || '5221';
  const targetPort = target.port || '80';
  const mode = info.HostConfig?.NetworkMode;
  const bindings = info.NetworkSettings?.Ports?.[`${containerPort}/tcp`] || [];
  const mapped = bindings.some(binding => binding.HostPort === targetPort
    && ['0.0.0.0', '127.0.0.1', '::', '::1'].includes(binding.HostIp));
  if (!(mode === 'host' && containerPort === targetPort)
      && !(!mode?.startsWith('container:') && mode !== 'host' && mapped)) {
    deny('URL 端口未对应容器的 host 监听或已发布端口');
  }
  const response = await fetch(new URL('/api/brain/health', target), {
    redirect: 'error', signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) deny('目标健康检查失败');
  const health = await response.json();
  if (health.local_execution?.role !== 'executor') deny('生产调度器或未知角色拒绝写入');
} catch {
  deny('无法核对环境身份，拒绝写入');
}
