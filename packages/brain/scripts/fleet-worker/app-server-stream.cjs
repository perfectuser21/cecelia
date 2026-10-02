'use strict';
const { Transform } = require('node:stream');
const { EventEmitter } = require('node:events');

// 只约束传输帧大小；执行方法授权由上层 RPC adapter 处理。错误不含正文。
function createJsonlBoundary({ maxFrameBytes = 1048576 } = {}) {
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1 || maxFrameBytes > 4194304) {
    throw new Error('appserver_frame_limit_invalid');
  }
  let pending = Buffer.alloc(0), work = null, pumping = false;
  function pump(stream) {
    if (!work || pumping) return;
    pumping = true;
    try {
      const { data, callback } = work;
      let end;
      while ((end = data.indexOf(10, work.offset)) !== -1) {
        if (end - work.offset > maxFrameBytes) { work = null; callback(new Error('appserver_frame_too_large')); return; }
        const frame = data.subarray(work.offset, end + 1); work.offset = end + 1;
        if (!stream.push(frame)) return;
      }
      pending = Buffer.from(data.subarray(work.offset)); work = null;
      callback(pending.length > maxFrameBytes ? new Error('appserver_frame_too_large') : undefined);
    } finally { pumping = false; }
  }
  return new Transform({
    readableHighWaterMark: 65536,
    writableHighWaterMark: 65536,
    transform(chunk, _encoding, callback) {
      work = { data: pending.length ? Buffer.concat([pending, chunk]) : chunk, offset: 0, callback };
      pending = Buffer.alloc(0); pump(this);
    },
    read(size) { Transform.prototype._read.call(this, size); pump(this); },
    flush(callback) { callback(pending.length ? new Error('appserver_frame_truncated') : undefined); },
  });
}

function createBoundedAppServerStream(child, options = {}) {
  const channel = new EventEmitter();
  const stdin = createJsonlBoundary(options), stdout = createJsonlBoundary(options);
  let closed = false, stopping = false;
  const kill = () => { if (!closed && !stopping) { stopping = true; child.kill('SIGTERM'); } };
  const failure = error => {
    kill();
    if (channel.listenerCount('error')) channel.emit('error', new Error(
      /^appserver_frame_(too_large|truncated)$/.test(error.message) ? error.message : 'appserver_stream_unavailable'));
  };
  stdin.on('error', failure); stdout.on('error', failure);
  child.stdin.on('error', () => failure(new Error('appserver_stream_unavailable')));
  child.stdout.on('error', () => failure(new Error('appserver_stream_unavailable')));
  child.once('error', () => failure(new Error('appserver_stream_unavailable')));
  child.once('close', (code, signal) => {
    closed = true; stdin.destroy(); channel.emit('close', code, signal);
  });
  stdin.pipe(child.stdin); child.stdout.pipe(stdout);
  return Object.assign(channel, { stdin, stdout, kill });
}

module.exports = { createJsonlBoundary, createBoundedAppServerStream };
