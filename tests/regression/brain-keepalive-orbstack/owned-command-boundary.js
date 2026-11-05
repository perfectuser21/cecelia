import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SYNTHETIC_WEBHOOK = 'https://notify.invalid/owned-keepalive';

// 每个可执行命令都由本夹具提供；PATH没有系统工具或真实docker/curl回退。
export function createCommandBoundary(dir, keepalive) {
  const tools = join(dir, 'tools');
  mkdirSync(tools);
  const denied = join(dir, 'denied.log');
  const target = join(dir, 'notification-target');
  const body = join(dir, 'notification-body.json');
  const count = join(dir, 'notification-count');
  for (const file of [denied, target, body, count]) writeFileSync(file, '');
  const prelude = `#!/bin/bash
set -euo pipefail
deny() { printf '%s\\n' "$1" >> "$OWN_DENIED"; exit 97; }
[[ -z "\${KEEPALIVE_TEST_FOREIGN_SECRET:-}" ]] || deny inherited-env
owned() { [[ "$1" == "$OWN_DIR/"* && "$1" != *"/../"* && "$1" != *"/./"* ]]; }
`;
  const commands = {
    dirname: `[[ $# == 1 && "$1" == "$OWN_KEEPALIVE" ]] || deny dirname
printf '%s\\n' "$OWN_KEEPALIVE_DIR"
`,
    touch: `[[ $# == 1 ]] && owned "$1" || deny touch
/usr/bin/touch -- "$1"
`,
    rm: `[[ $# == 2 && "$1" == '-f' ]] && owned "$2" || deny rm
/bin/rm -f -- "$2"
`,
    sleep: `[[ $# == 1 && "$1" == 0 ]] || deny sleep
`,
    date: 'deny unexpected-date\n',
    stat: 'deny unexpected-stat\n',
    curl: `[[ "\${OWN_ALLOW_NOTIFICATION:-0}" == 1 ]] || deny curl-unarranged
[[ $# == 10 && "$1" == '-s' && "$2" == '-X' && "$3" == 'POST' && "$4" == "$OWN_EXPECTED_WEBHOOK" && "$5" == '-H' && "$6" == 'Content-Type: application/json' && "$7" == '-d' && "$9" == '--max-time' && "\${10}" == 10 ]] || deny curl-contract
printf '%s' "$4" > "$OWN_NOTIFICATION_TARGET"
printf '%s' "$8" > "$OWN_NOTIFICATION_BODY"
printf 'curl\\n' >> "$OWN_NOTIFICATION_COUNT"
`,
  };
  for (const [name, script] of Object.entries(commands)) {
    const file = join(tools, name);
    writeFileSync(file, prelude + script);
    chmodSync(file, 0o755);
  }
  return {
    tools, denied, target, body, count,
    env: {
      PATH: tools,
      HOME: dir,
      OWN_DIR: dir,
      OWN_KEEPALIVE: keepalive,
      OWN_KEEPALIVE_DIR: dirname(keepalive),
      OWN_DENIED: denied,
      OWN_NOTIFICATION_TARGET: target,
      OWN_NOTIFICATION_BODY: body,
      OWN_NOTIFICATION_COUNT: count,
      OWN_EXPECTED_WEBHOOK: SYNTHETIC_WEBHOOK,
    },
  };
}
