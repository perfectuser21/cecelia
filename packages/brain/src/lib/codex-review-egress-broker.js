import dns from 'node:dns/promises';
import net from 'node:net';
import { chmod, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ipaddr from 'ipaddr.js';

const MAX_CONNECT_HEADER_BYTES = 8 * 1024;
const DNS_TIMEOUT_MS = 5_000;
const UPSTREAM_HANDSHAKE_TIMEOUT_MS = 10_000;
const TUNNEL_IDLE_TIMEOUT_MS = 30_000;
const TUNNEL_ABSOLUTE_TTL_MS = 5 * 60 * 1000;
const ALLOWED_CONNECT_HOSTS = Object.freeze(new Set([
  'auth.openai.com',
  'chatgpt.com',
]));

export function isPublicCodexReviewAddress(address) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) {
      parsed = parsed.toIPv4Address();
    }
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

export function parseCodexReviewConnectRequest(header) {
  if (
    typeof header !== 'string'
    || header.length === 0
    || Buffer.byteLength(header, 'latin1') > MAX_CONNECT_HEADER_BYTES
    || !header.endsWith('\r\n\r\n')
  ) {
    return null;
  }
  const lines = header.split('\r\n');
  const request = /^CONNECT ([a-z0-9.-]+):443 HTTP\/1\.1$/.exec(lines[0]);
  if (!request) return null;
  const hostname = request[1].toLowerCase();
  if (
    net.isIP(hostname) !== 0
    || !ALLOWED_CONNECT_HOSTS.has(hostname)
  ) {
    return null;
  }
  const hostHeaders = lines
    .slice(1)
    .filter((line) => /^host:/i.test(line))
    .map((line) => line.slice(line.indexOf(':') + 1).trim().toLowerCase());
  if (
    hostHeaders.length !== 1
    || hostHeaders[0] !== `${hostname}:443`
  ) {
    return null;
  }
  return Object.freeze({ hostname, port: 443 });
}

function reject(client, status = '403 Forbidden') {
  client.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
}

export async function startCodexReviewEgressBroker({
  socketPath,
  lookup = dns.lookup,
  connect = net.createConnection,
} = {}) {
  if (
    typeof socketPath !== 'string'
    || !socketPath.startsWith('/')
    || /[\0\r\n,]/.test(socketPath)
  ) {
    throw new Error('review_egress_socket_path_invalid');
  }
  await rm(socketPath, { force: true });
  const activeSockets = new Set();
  let closing = false;
  const server = net.createServer((client) => {
    activeSockets.add(client);
    client.setTimeout(30_000);
    let requestBuffer = Buffer.alloc(0);
    let settled = false;
    let clientClosed = false;

    const cleanup = () => {
      activeSockets.delete(client);
    };
    client.once('close', cleanup);
    client.once('close', () => {
      clientClosed = true;
    });
    client.once('timeout', () => client.destroy());
    client.once('error', () => {});
    client.on('data', async (chunk) => {
      if (settled) return;
      requestBuffer = Buffer.concat([requestBuffer, chunk]);
      if (requestBuffer.length > MAX_CONNECT_HEADER_BYTES) {
        settled = true;
        reject(client, '431 Request Header Fields Too Large');
        return;
      }
      const boundary = requestBuffer.indexOf('\r\n\r\n');
      if (boundary === -1) return;
      settled = true;
      const headerEnd = boundary + 4;
      const parsed = parseCodexReviewConnectRequest(
        requestBuffer.subarray(0, headerEnd).toString('latin1'),
      );
      if (!parsed) {
        reject(client);
        return;
      }
      try {
        let dnsTimer;
        const resolved = await Promise.race([
          lookup(parsed.hostname, {
            all: true,
            family: 4,
            verbatim: true,
          }),
          new Promise((_, rejectLookup) => {
            dnsTimer = setTimeout(
              () => rejectLookup(new Error('review_egress_dns_timeout')),
              DNS_TIMEOUT_MS,
            );
            dnsTimer.unref?.();
          }),
        ]).finally(() => clearTimeout(dnsTimer));
        if (
          !Array.isArray(resolved)
          || resolved.length === 0
          || resolved.some(
            ({ address }) => !isPublicCodexReviewAddress(address),
          )
          || closing
          || clientClosed
          || client.destroyed
        ) {
          reject(client);
          return;
        }
        const upstream = connect({
          host: resolved[0].address,
          port: parsed.port,
          family: resolved[0].family,
        });
        activeSockets.add(upstream);
        upstream.setTimeout(TUNNEL_IDLE_TIMEOUT_MS);
        const absoluteTimer = setTimeout(() => {
          upstream.destroy();
          client.destroy();
        }, TUNNEL_ABSOLUTE_TTL_MS);
        absoluteTimer.unref?.();
        const handshakeTimer = setTimeout(() => {
          upstream.destroy();
          client.destroy();
        }, UPSTREAM_HANDSHAKE_TIMEOUT_MS);
        handshakeTimer.unref?.();
        upstream.once('error', () => client.destroy());
        upstream.once('timeout', () => upstream.destroy());
        client.once('close', () => upstream.destroy());
        upstream.once('close', () => {
          clearTimeout(handshakeTimer);
          clearTimeout(absoluteTimer);
          activeSockets.delete(upstream);
        });
        upstream.once('connect', () => {
          clearTimeout(handshakeTimer);
          if (closing || clientClosed || client.destroyed) {
            upstream.destroy();
            return;
          }
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          const remainder = requestBuffer.subarray(headerEnd);
          if (remainder.length > 0) upstream.write(remainder);
          client.pipe(upstream);
          upstream.pipe(client);
        });
      } catch {
        reject(client, '502 Bad Gateway');
      }
    });
  });
  server.maxConnections = 8;
  try {
    await new Promise((resolve, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(socketPath, () => {
        server.off('error', rejectListen);
        resolve();
      });
    });
    await chmod(socketPath, 0o666);
  } catch (error) {
    for (const socket of activeSockets) socket.destroy();
    server.close();
    await rm(socketPath, { force: true }).catch(() => {});
    throw error;
  }

  let closed = false;
  return Object.freeze({
    socketPath,
    async close() {
      if (closed) return;
      closed = true;
      closing = true;
      for (const socket of activeSockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
      await rm(socketPath, { force: true });
    },
  });
}

if (
  process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1]
) {
  const socketPath = process.argv[2];
  const broker = await startCodexReviewEgressBroker({ socketPath });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await broker.close().catch(() => {});
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
