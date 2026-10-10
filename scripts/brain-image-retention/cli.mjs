import { createRuntime, readHealth, ROOT } from './runtime.mjs';
import { fail } from './policy.mjs';
const [command, ...args] = process.argv.slice(2);
try {
  if (!['begin', 'finish', 'rollback', 'reconcile'].includes(command) || args.length !== ({ begin: 3, finish: 2, rollback: 4, reconcile: 0 })[command]) throw fail('INVALID_COMMAND');
  const base = process.env.BRAIN_URL || 'http://127.0.0.1:5221';
  if (!['http://127.0.0.1:5221', 'http://localhost:5221', 'http://host.docker.internal:5221'].includes(base)) throw fail('INVALID_HEALTH_ENDPOINT');
  const expectedContainerId = process.env.CECELIA_IMAGE_EXPECTED_CONTAINER_ID;
  if (expectedContainerId !== undefined && (command !== 'finish' || !/^[a-f0-9]{64}$/.test(expectedContainerId))) throw fail('INVALID_CONTAINER_ID');
  const runtime = await createRuntime({ expectedContainerId, root: process.env.CECELIA_IMAGE_RETENTION_DIR || ROOT, health: () => readHealth(base) });
  if (!runtime) {
    if (!['begin', 'rollback', 'reconcile'].includes(command)) throw fail('HOST_CONFIG_MISSING');
    process.stdout.write('disabled\n');
  } else if (command === 'begin') {
    const [deployment_id, version, git_sha] = args;
    const result = await runtime.ledger.begin({ deployment_id, version, git_sha });
    if (result.receipt) throw fail('DEPLOYMENT_ALREADY_FINISHED');
    process.stdout.write(`${deployment_id}\n`);
  } else if (command === 'rollback') {
    const [deployment_id, version, git_sha, image_id] = args;
    const result = await runtime.ledger.rollback({ deployment_id, version, git_sha, image_id });
    process.stdout.write(`${result.deployment_id} ${result.outcome} ${result.image_id}\n`);
  } else if (command === 'reconcile') {
    const receipt = await runtime.ledger.reconcile();
    process.stdout.write(receipt ? `${receipt.deployment_id} ${receipt.outcome}\n` : 'none\n');
  } else {
    const receipt = await runtime.ledger.finish(args[0], args[1]);
    process.stdout.write(`${receipt.outcome}\n`);
  }
} catch (error) { process.stderr.write(`${error.code || 'IMAGE_RETENTION_UNCONFIRMED'}\n`); process.exitCode = 1; }
