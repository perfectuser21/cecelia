import { createRuntime, readHealth, ROOT } from './runtime.mjs';
import { fail } from './policy.mjs';
const [command, ...args] = process.argv.slice(2);
try {
  if (!['begin', 'finish'].includes(command) || args.length !== (command === 'begin' ? 3 : 2)) throw fail('INVALID_COMMAND');
  const base = process.env.BRAIN_URL || 'http://127.0.0.1:5221';
  if (!['http://127.0.0.1:5221', 'http://localhost:5221', 'http://host.docker.internal:5221'].includes(base)) throw fail('INVALID_HEALTH_ENDPOINT');
  const runtime = await createRuntime({ root: process.env.CECELIA_IMAGE_RETENTION_DIR || ROOT, health: () => readHealth(base) });
  if (!runtime) {
    if (command !== 'begin') throw fail('HOST_CONFIG_MISSING');
    process.stdout.write('disabled\n');
  } else if (command === 'begin') {
    const [deployment_id, version, git_sha] = args;
    const result = await runtime.ledger.begin({ deployment_id, version, git_sha });
    if (result.receipt) throw fail('DEPLOYMENT_ALREADY_FINISHED');
    process.stdout.write(`${deployment_id}\n`);
  } else {
    const receipt = await runtime.ledger.finish(args[0], args[1]);
    process.stdout.write(`${receipt.outcome}\n`);
  }
} catch (error) { process.stderr.write(`${error.code || 'IMAGE_RETENTION_UNCONFIRMED'}\n`); process.exitCode = 1; }
