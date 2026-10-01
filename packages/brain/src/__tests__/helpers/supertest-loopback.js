import Test from 'supertest/lib/test.js';

// Supertest uses IPv4 URLs even when its default listener is IPv6-only.
// Keep its listen/close lifecycle, and align only the test request destination.
const marker = Symbol.for('cecelia.supertest.listener-family');
const original = Test.prototype.serverAddress;

if (!original[marker]) {
  function listenerAddress(app, path) {
    const url = original.call(this, app, path);
    const address = app.address();
    if (!address || typeof address === 'string' || address.family !== 'IPv6') return url;
    const host = address.address === '::' ? '::1' : address.address;
    return url.replace('://127.0.0.1:', `://[${host}]:`);
  }
  Object.defineProperty(listenerAddress, marker, { value: true });
  Test.prototype.serverAddress = listenerAddress;
}
