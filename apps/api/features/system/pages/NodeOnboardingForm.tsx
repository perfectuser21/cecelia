import { FormEvent, useRef, useState } from 'react';
import { nodeOnboardingApi, NodeOnboardingInput, NodeOnboardingRequest } from '../api/node-onboarding.api';

const initial: NodeOnboardingInput = {
  name: '', address: '', ssh_user: '', ssh_port: 22, credential_ref: '', host_key_fingerprint: '', role: 'observer', region: 'other',
};
const inputStyle = 'mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm';
function validate(input: NodeOnboardingInput): string | null {
  if (!input.name || !input.address || !input.ssh_user || !input.credential_ref || !input.host_key_fingerprint) return '请填写机器名称、连接地址、SSH 用户、1Password 引用和主机指纹';
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(input.name)) return '机器名称须为 2–63 位小写字母、数字或连字符';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/.test(input.address)) return '连接地址请填写 IP 或主机名';
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(input.ssh_user)) return 'SSH 用户须以字母或下划线开头，最多 32 位字母、数字、下划线或连字符';
  if (!Number.isInteger(input.ssh_port) || input.ssh_port < 1 || input.ssh_port > 65535) return 'SSH 端口须为 1–65535 的整数';
  if (!/^op:\/\/CS\/[^/\r\n]+\/[^/\r\n]+$/.test(input.credential_ref)) return '请填写 CS Vault 中的 1Password 引用（op://CS/条目/字段），不要填写明文密钥';
  if (!/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(input.host_key_fingerprint)) return '主机指纹请填写完整 SHA256 指纹';
  return null;
}

export type ExistingNode = { name: string; address: string; region: NodeOnboardingInput['region'] };
export default function NodeOnboardingForm({ onCreated, existing }: { onCreated: (request: NodeOnboardingRequest) => void; existing?: ExistingNode }) {
  const defaults = { ...initial, ...existing };
  const [input, setInput] = useState(defaults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const update = (field: keyof NodeOnboardingInput, value: string | number) => setInput(previous => ({ ...previous, [field]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const data = { ...input, name: input.name.trim(), address: input.address.trim(), ssh_user: input.ssh_user.trim(),
      credential_ref: input.credential_ref.trim(), host_key_fingerprint: input.host_key_fingerprint.trim() };
    const invalid = validate(data);
    if (invalid) { setError(invalid); return; }
    const body = JSON.stringify(data);
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    submitting.current = true; setBusy(true); setError(null);
    try {
      const result = await nodeOnboardingApi.create(data, attempt.current.key);
      onCreated(result); setInput(defaults); attempt.current = null;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '接入请求提交失败'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return (
    <form onSubmit={submit} noValidate autoComplete="off" className="space-y-4">
      <fieldset disabled={busy} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label>机器名称<input readOnly={!!existing} className={inputStyle} value={input.name} onChange={event => update('name', event.target.value)} placeholder="例如 hk-node-02" /></label>
        <label>用途<select className={inputStyle} value={input.role} onChange={event => update('role', event.target.value)}>
          <option value="observer">监控节点</option><option value="worker">执行节点</option><option value="service">服务节点</option><option value="database">数据库节点</option>
        </select></label>
        <label>地区<select className={inputStyle} value={input.region} onChange={event => update('region', event.target.value)}>
          <option value="other">其他</option><option value="US">美国</option><option value="HK">香港</option><option value="CN">中国大陆</option>
        </select></label>
      </fieldset>
      <fieldset disabled={busy} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
        <legend className="px-1 font-medium">连接设置</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label>连接地址<input className={inputStyle} value={input.address} onChange={event => update('address', event.target.value)} placeholder="IP 或主机名" /></label>
          <label>SSH 用户<input className={inputStyle} value={input.ssh_user} onChange={event => update('ssh_user', event.target.value)} /></label>
          <label>SSH 端口<input className={inputStyle} type="number" min={1} max={65535} value={input.ssh_port || ''} onChange={event => update('ssh_port', Number(event.target.value))} /></label>
          <label>1Password 引用<input className={inputStyle} value={input.credential_ref} onChange={event => update('credential_ref', event.target.value)} placeholder="op://CS/条目/字段" aria-describedby="credential-help" /></label>
          <label className="sm:col-span-2">主机指纹<input className={inputStyle} value={input.host_key_fingerprint} onChange={event => update('host_key_fingerprint', event.target.value)} placeholder="SHA256:…" aria-describedby="fingerprint-help" /></label>
        </div>
        <p id="credential-help" className="mt-2 text-xs text-gray-500">仅填写 1Password 引用，凭据保存在 CS Vault。</p>
        <p id="fingerprint-help" className="mt-1 text-xs text-gray-500">首次连接前，请从云控制台核对主机 SHA256 指纹。</p>
      </fieldset>
      {existing && <p className="text-sm text-gray-500">使用原设备记录；连接地址须与台账中的地址一致。</p>}
      {input.role === 'worker' && <p className="text-sm text-gray-500">执行验收使用独占脚本槽 1；CPU 最多 2 核且不超过总核数一半，内存池最多 4 GiB，至少保留 2 GiB 和总内存一半。资源不足时等待，验收通过后才启用。</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? '正在提交…' : '开始接入'}</button>
    </form>
  );
}
