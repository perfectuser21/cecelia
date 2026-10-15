import { InputSchema } from './invocations';
export default function BusinessInputs({ schema, value, onChange, disabled = false }: { schema?: InputSchema; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; disabled?: boolean }) {
  if (!schema?.properties) return <p className="text-sm">后端尚未提供业务输入合同。</p>;
  return <fieldset disabled={disabled} className="space-y-3"><legend className="font-semibold">业务输入</legend>{Object.entries(schema.properties).map(([key, field]) => {
    const label = field.title || key, required = schema.required?.includes(key);
    const common = { 'aria-label': label, required, className: 'block w-full rounded border p-2 dark:bg-slate-900' };
    const update = (next: unknown) => onChange({ ...value, [key]: next });
    return <label key={key} className="block text-sm">{label}{required ? '（必填）' : ''}
      {field.enum ? <select {...common} value={String(value[key] ?? '')} onChange={e => update(field.enum?.find(v => String(v) === e.target.value))}><option value="">请选择</option>{field.enum.map(v => <option key={String(v)} value={String(v)}>{v}</option>)}</select>
      : field.type === 'boolean' ? <input {...common} type="checkbox" checked={value[key] === true} onChange={e => update(e.target.checked)} />
      : field.type === 'object' || field.type === 'array' ? <textarea {...common} defaultValue={value[key] === undefined ? '' : JSON.stringify(value[key])} onChange={e => { try { update(JSON.parse(e.target.value)); e.target.setCustomValidity(''); } catch { e.target.setCustomValidity('请输入有效 JSON'); } }} />
      : <input {...common} type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'} step={field.type === 'integer' ? '1' : 'any'} value={String(value[key] ?? '')} onChange={e => update(field.type === 'number' || field.type === 'integer' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)} />}
      {field.description && <span className="text-slate-500">{field.description}</span>}
    </label>;
  })}</fieldset>;
}
