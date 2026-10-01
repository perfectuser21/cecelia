'use strict';
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

// Docker 非 TTY 的八字节帧头；流式处理，不按远端声明长度分配内存。
async function* stdoutFrames(socket) {
  let header = Buffer.alloc(0), remaining = 0, type = 0;
  for await (const chunk of socket) {
    let offset = 0;
    while (offset < chunk.length) {
      if (!remaining) {
        const count = Math.min(8 - header.length, chunk.length - offset);
        header = Buffer.concat([header, chunk.subarray(offset, offset + count)]); offset += count;
        if (header.length < 8) continue;
        type = header[0]; remaining = header.readUInt32BE(4);
        if (type > 2 || header[1] || header[2] || header[3] || remaining > 4194304) {
          throw Error('appserver_attach_stream_invalid');
        }
        header = Buffer.alloc(0);
        if (!remaining) continue;
      }
      const count = Math.min(remaining, chunk.length - offset);
      if (type !== 2 && count) yield chunk.subarray(offset, offset + count);
      offset += count; remaining -= count;
    }
  }
  if (header.length || remaining) throw Error('appserver_attach_stream_invalid');
}

// 只有 daemon 完成 HTTP Upgrade 才返回。断开 socket 不向容器发送信号。
function attachUnixSocket(socketPath, id, deadline) {
  return new Promise((resolve, reject) => {
    let settled = false, attached;
    const timeout = Math.min(5000, deadline - Date.now());
    if (!(timeout > 0)) { reject(Error('appserver_attach_unconfirmed')); return; }
    const request = http.request({ socketPath, method: 'POST',
      path: `/v1.44/containers/${id}/attach?stream=1&stdin=1&stdout=1&stderr=1&logs=0`,
      headers: { Connection: 'Upgrade', Upgrade: 'tcp', 'Content-Length': '0' },
    });
    const fail = () => {
      if (settled) return;
      settled = true; clearTimeout(timer); attached?.destroy(); request.destroy();
      reject(Error('appserver_attach_unconfirmed'));
    };
    const timer = setTimeout(fail, timeout);
    request.once('response', response => { response.destroy(); fail(); });
    request.once('error', fail);
    request.once('upgrade', (response, socket, head) => {
      attached = socket;
      if (settled) { socket.destroy(); return; }
      if (response.statusCode !== 101 || response.headers.upgrade?.toLowerCase() !== 'tcp'
          || !['application/vnd.docker.raw-stream', 'application/vnd.docker.multiplexed-stream']
            .includes(response.headers['content-type']) || Date.now() >= deadline || socket.destroyed) {
        fail(); return;
      }
      settled = true; clearTimeout(timer);
      socket.pause(); if (head.length) socket.unshift(head);
      const channel = new EventEmitter();
      const stdout = Readable.from(stdoutFrames(socket), { objectMode: false, highWaterMark: 65536 });
      // 在调用者安装监听前出现错误也不能成为未捕获异常，且不会记录原始数据。
      channel.on('error', () => {});
      stdout.on('error', () => { socket.destroy(); channel.emit('error', Error('appserver_attach_stream_invalid')); });
      socket.on('error', () => channel.emit('error', Error('appserver_attach_stream_invalid')));
      socket.once('close', () => { channel.closed = true; channel.emit('close', null); });
      Object.assign(channel, { stdin: socket, stdout, closed: false, kill: () => socket.destroy() });
      resolve(channel);
    });
    request.end();
  });
}

module.exports = { attachUnixSocket };
