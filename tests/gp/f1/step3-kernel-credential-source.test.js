// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：kernel run 在跑场机上取凭据
//
// 2026-09-23 实证：MMV fleet-worker 以 _cecelia（HOME=/var/empty）起 run.js，凭据在 administrator
// 目录（0644）。loader 按 os.homedir() 找不到 → credential_source_unavailable；broker 又把它改写成
// credential_payload_invalid，71 次远程 run 全死且原因不可查。修法：凭据目录经 CECELIA_CREDENTIAL_HOME_ROOT
// 指向宿主属主 home，loader 接受可信属主的 0644 文件，broker 透传 credential_* 码。
// 真 import credential-broker.js / provider-account-home.js（守卫在边上），不 mock。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCredentialBroker,
  createFileCredentialLoader,
} from '../../../packages/brain/src/orchestrator/credential-broker.js';
import {
  parseTrustedUids,
  resolveCredentialAccountHome,
} from '../../../packages/brain/src/orchestrator/provider-account-home.js';
import { resolvePrimaryWorkerId } from '../../../packages/brain/src/machine-registry.js';

const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const roots = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });

function hostHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-home-'));
  roots.push(root);
  const team = path.join(root, '.codex-team1');
  fs.mkdirSync(team, { mode: 0o755 });
  const exp = Math.floor((Date.now() + 3 * 3600e3) / 1000);
  const token = `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`;
  fs.writeFileSync(path.join(team, 'auth.json'), JSON.stringify({ tokens: { access_token: token } }), { mode: 0o644 });
  return root;
}

function brokerFor(env) {
  return createCredentialBroker({
    controllerMachineId: resolvePrimaryWorkerId(),
    loadCredential: createFileCredentialLoader({
      accountHomeResolver: (a) => resolveCredentialAccountHome('codex', a, { env }),
      trustedUids: parseTrustedUids(env),
    }),
  });
}

describe('F1 step3 · kernel run 在跑场机取凭据', () => {
  it('经 CECELIA_CREDENTIAL_HOME_ROOT 指向宿主 home，0644 的 auth.json 能签出信封', async () => {
    const root = hostHome();
    const env = { CECELIA_CREDENTIAL_HOME_ROOT: root, CECELIA_CREDENTIAL_TRUSTED_UIDS: String(process.getuid()) };
    const envelope = await brokerFor(env).issue({
      attemptId: ATTEMPT_ID, accountId: 'team1', machineId: 'us-mac-m4',
      deadlineAt: new Date(Date.now() + 3600e3).toISOString(),
    });
    expect(envelope).toMatchObject({ contract_version: 'credential-envelope/v1', account_id: 'team1' });
  });

  it('凭据根未设时错误码是 credential_source_unavailable（不再被抹成 payload_invalid）', async () => {
    const env = { CECELIA_CREDENTIAL_HOME_ROOT: fs.mkdtempSync(path.join(os.tmpdir(), 'empty-home-')) };
    roots.push(env.CECELIA_CREDENTIAL_HOME_ROOT);
    await expect(brokerFor(env).issue({
      attemptId: ATTEMPT_ID, accountId: 'team1', machineId: 'us-mac-m4',
      deadlineAt: new Date(Date.now() + 3600e3).toISOString(),
    })).rejects.toThrow('credential_source_unavailable');
  });
});
