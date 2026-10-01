import { randomUUID } from 'node:crypto';

export const walkingProcessInstance = randomUUID();
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;

// This narrow CI control never enables general executors or production model calls.
export function assertWalkingCiMode(env = process.env) {
  const reject = () => { throw new Error('Walking restart control requires the dedicated isolated CI target'); };
  if (env.CI !== 'true' || env.WALKING_CI_OWNER !== '1' || env.NODE_ENV !== 'test'
    || env.DB_NAME !== 'cecelia_test' || !['localhost', '127.0.0.1'].includes(env.DB_HOST)
    || (env.DB_PORT || '5432') !== '5432' || env.BRAIN_PORT !== '5221'
    || ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'].some(key => env[key])
    || env.DOCKER_HOST || env.DOCKER_CONTEXT || env.PGHOSTADDR || env.PGSERVICE || env.PGSERVICEFILE) reject();
  try {
    const uri = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(uri.protocol) || !['localhost', '127.0.0.1'].includes(uri.hostname)
      || (uri.port || '5432') !== '5432' || uri.pathname !== '/cecelia_test' || uri.search || uri.hash) reject();
  } catch { reject(); }
}

export function isWalkingCheckpointWaiting(state) {
  return Array.isArray(state?.next) && state.next.includes('await_callback')
    && Array.isArray(state.tasks) && state.tasks.some(task => task.name === 'await_callback'
      && Array.isArray(task.interrupts) && task.interrupts.some(item => item.value?.type === 'wait_callback'));
}

export function walkingWorkerOptions(containerId, restartInstanceId, threadId, env = process.env) {
  if (!/^walking-skeleton-[a-f0-9]{8}$/.test(containerId)) throw new Error('Invalid Walking container identity');
  const ci = env.WALKING_CI_OWNER !== undefined;
  if (ci || restartInstanceId) assertWalkingCiMode(env);
  if (restartInstanceId && !uuid.test(restartInstanceId)) throw new Error('Invalid restart instance UUID');
  if (ci && !uuid.test(threadId || '')) throw new Error('Invalid Walking thread UUID');
  const base = ci ? 'http://127.0.0.1:5221' : 'http://host.docker.internal:5221';
  const payload = JSON.stringify({ result: `hello-from-${containerId}`, exit_code: 0 });
  const script = `response=$(mktemp)
trap 'rm -f "$response"' EXIT
sleep 2
ready=${restartInstanceId ? '0' : '1'}
checkpoint=${ci ? '0' : '1'}
remaining=40
while [ "$remaining" -gt 0 ]; do
  remaining=$((remaining - 1))
  if [ "$ready" = 0 ] && wget -q -T 2 -O "$response" '${base}/api/brain/walking-skeleton-1node/instance'; then
    token=$(awk -F'"' '/"instance_id"/ { print $4 }' "$response")
    if printf '%s' "$token" | grep -Eq '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' && [ "$token" != '${restartInstanceId || ''}' ]; then ready=1; fi
  fi
  if [ "$ready" = 1 ] && [ "$checkpoint" = 0 ] && wget -q -T 2 -O "$response" '${base}/api/brain/walking-skeleton-1node/ready/${threadId || ''}' && grep -Eq '"ready"[[:space:]]*:[[:space:]]*true' "$response"; then checkpoint=1; fi
  if [ "$ready" = 1 ] && [ "$checkpoint" = 1 ] && wget -q -T 2 -O "$response" --post-data='${payload}' --header='Content-Type: application/json' '${base}/api/brain/harness/callback/${containerId}' && grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "$response"; then exit 0; fi
  sleep 1
done
echo 'Walking callback retry exhausted' >&2
exit 1`;
  return { args: [...(ci ? ['--network', 'host'] : []), 'alpine', 'sh', '-c', script] };
}
