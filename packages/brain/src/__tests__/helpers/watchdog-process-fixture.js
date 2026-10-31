export const lockDirectory = '/fixture/watchdog-locks';

// Raw OS and lock-file fixtures only; sampling, tree traversal and policy stay real.
export const processFixture = {
  rows: new Map(),
  slots: new Map(),
  unexpected: [],
  reset() { this.rows.clear(); this.slots.clear(); this.unexpected.length = 0; },
  addProcess({ pid, ppid = 1, rss = 100, cpuTicks = 100, alive = true, command = 'claude -p fixture' }) {
    this.rows.set(pid, { pid, ppid, rss, cpuTicks, alive, command });
  },
  addTask(index, { rss = 800 - index * 10, started = Date.now() - 120000, alive = true, childRss = 0 } = {}) {
    const pid = 70000 + index * 10;
    this.addProcess({ pid, rss, alive });
    if (childRss) this.addProcess({ pid: pid + 1, ppid: pid, rss: childRss });
    this.slots.set(`slot-${index}`, { task_id: `task-${index}`, pid, pgid: pid, started: new Date(started).toISOString() });
    return pid;
  },
  readFileSync(path) {
    const slot = String(path).match(/^\/fixture\/watchdog-locks\/(slot-\d+)\/info.json$/);
    if (slot && this.slots.has(slot[1])) return JSON.stringify(this.slots.get(slot[1]));
    const proc = String(path).match(/^\/proc\/(\d+)\/(statm|stat|cmdline)$/);
    const row = proc && this.rows.get(Number(proc[1]));
    if (row?.alive) {
      if (proc[2] === 'statm') return `0 ${row.rss * 256} 0 0 0 0 0`;
      if (proc[2] === 'cmdline') return row.command.split(' ').join('\0');
      const fields = Array(40).fill('0');
      fields[0] = 'S'; fields[1] = String(row.ppid); fields[11] = String(row.cpuTicks);
      return `${row.pid} (claude worker) ${fields.join(' ')}`;
    }
    this.unexpected.push(`read:${path}`);
    throw new Error(`Missing fixture file: ${path}`);
  },
  existsSync(path) {
    const slot = String(path).match(/^\/fixture\/watchdog-locks\/(slot-\d+)\/info.json$/);
    if (slot) return this.slots.has(slot[1]);
    const proc = String(path).match(/^\/proc\/(\d+)$/);
    return proc ? this.rows.get(Number(proc[1]))?.alive === true : false;
  },
  readdirSync(path) {
    const names = path === lockDirectory ? [...this.slots.keys()]
      : path === '/proc' ? [...this.rows.values()].filter(row => row.alive).map(row => String(row.pid)) : [];
    return names.map(name => ({ name, isDirectory: () => true }));
  },
  execSync(command) {
    if (command === 'getconf PAGE_SIZE') return '4096\n';
    if (command === 'ps -ax -o pid= -o ppid= -o rss= -o time=') {
      return [...this.rows.values()].filter(row => row.alive).map(row => `${row.pid} ${row.ppid} ${row.rss * 1024} 0:${(row.cpuTicks / 100).toFixed(2)}`).join('\n');
    }
    this.unexpected.push(`exec:${command}`);
    throw new Error(`Host command forbidden: ${command}`);
  },
};

export const fixtureFs = Object.fromEntries(['readFileSync', 'existsSync', 'readdirSync'].map(name => [name, processFixture[name].bind(processFixture)]));

export async function loadWatchdog(platform) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
  try {
    return platform === 'darwin'
      ? await import('../../watchdog.js?fixture_platform=darwin')
      : await import('../../watchdog.js?fixture_platform=linux');
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
}
