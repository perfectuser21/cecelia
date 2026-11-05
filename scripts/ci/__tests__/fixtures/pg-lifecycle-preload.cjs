// Record-only boundary for the actual run-debt-pg CLI. Never start PostgreSQL or Vitest here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const Module = require('node:module');
const state = { identity: [], admin: [], commands: [], drops: 0, backendStopped: false };
const fakeBin = process.env.PG_LIFECYCLE_FAKE_BIN;
const trace = process.env.PG_LIFECYCLE_TRACE;
assert.ok(fakeBin && trace);
const result = () => ({ status: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
cp.spawnSync = function (command, args) {
  state.commands.push({ command, args });
  if (command === process.execPath && args[0].endsWith('/packages/brain/node_modules/vitest/vitest.mjs')) {
    const receipt = args[args.indexOf('--outputFile') + 1];
    assert.ok(receipt && receipt.startsWith(path.dirname(state.data) + '/case-'));
    fs.writeFileSync(receipt, JSON.stringify({ success: true, numTotalTests: 1, numPassedTests: 1,
      numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
      testResults: [{ assertionResults: [{ status: 'passed' }] }] }));
    return result();
  }
  const program = path.basename(command);
  assert.equal(path.dirname(command), fakeBin, 'no real command fallback');
  assert.ok(['initdb', 'pg_ctl', 'pg_isready'].includes(program));
  if (program === 'initdb') state.data = args[args.indexOf('-D') + 1];
  if (program === 'pg_ctl' && args.includes('stop')) {
    assert.ok(state.admin.length > 0 && state.admin.every(client => client.closed), 'admin wire end must complete before backend stop');
    state.backendStopped = true;
  }
  return result();
};
require('node:module').syncBuiltinESMExports();
function query(config, sql) {
  if (sql.includes('shobj_description')) return { rows: [{ db: config.database,
    host: config.host, port: config.port, owner: state.owner }] };
  if (sql.startsWith('COMMENT ON DATABASE')) state.owner = sql.match(/'(ci-debt-[a-f0-9]{16})'/)[1];
  if (sql.startsWith('DROP DATABASE')) {
    assert.equal(state.identity.filter(client => !client.closed).length, 0,
      'identity wire end must complete before force DROP');
    state.drops++;
  }
  return { rows: [] };
}
class Pool {
  constructor(config) {
    this.config = config;
    if (config.database === 'cecelia_scratch') state.identity.push(this);
    else state.admin.push(this);
  }
  async query(sql) { return query(this.config, sql); }
  end() {
    // pg-pool removes idle clients before their asynchronous wire-close callbacks.
    setImmediate(() => { this.closed = true; });
    return Promise.resolve();
  }
}
class Client {
  constructor(config) { this.config = config; (config.database === 'postgres' ? state.admin : state.identity).push(this); }
  async connect() {
    if (this.config.database === 'cecelia_scratch' && process.env.PG_LIFECYCLE_CONNECT_FAIL === '1') throw Error('synthetic identity connect failed');
  }
  async query(sql) { return query(this.config, sql); }
  async end() { await new Promise(resolve => setImmediate(resolve)); this.closed = true; }
}
const actualLoad = Module._load;
Module._load = function (name, ...args) {
  return name === 'pg' ? { Pool, Client } : actualLoad.call(this, name, ...args);
};
process.on('exit', () => fs.writeFileSync(trace, JSON.stringify(state)));
