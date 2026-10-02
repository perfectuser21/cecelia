// 专属session leader一直存活到整组终止，避免CLI先退出后对已回收PID发组信号。
import { spawn } from 'node:child_process';
const [executable, ...args] = process.argv.slice(2);
const terminate = () => process.kill(-process.pid, 'SIGKILL');
process.on('disconnect', terminate);
process.on('message', message => { if (message?.type === 'terminate') terminate(); });
process.on('SIGTERM', terminate);
setInterval(() => {}, 1000);
let sent = false;
const report = code => {
  if (sent) return; sent = true;
  if (!process.connected) return terminate();
  process.send({ type: 'result', code }, error => { if (error) terminate(); });
};
const child = spawn(executable, args, { stdio: ['ignore', 'inherit', 'inherit', 3] });
child.once('error', () => report(127));
child.once('exit', code => report(Number.isInteger(code) ? code : 128));
