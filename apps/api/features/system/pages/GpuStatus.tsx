export interface GpuObservation {
  status: 'unknown' | 'present';
  source: string;
  observed_at: string | null;
  devices: {name: string; utilization_percent: number | null; memory_kind: 'unified' | 'unknown'; memory_used_bytes: number | null}[];
}
export default function GpuStatus({gpu}: {gpu?: GpuObservation}) {
  if (!gpu || gpu.status !== 'present' || !gpu.devices.length) {
    return <div className="mb-3 text-xs text-slate-400">GPU：未知</div>;
  }
  return <div className="mb-3 space-y-1 text-xs text-slate-400" aria-label="GPU 观测">
    {gpu.devices.map((device,index) => <div key={`${device.name}-${index}`}>
      <div className="flex justify-between"><span>GPU · {device.name}</span><span>{device.utilization_percent === null ? '利用率未知' : `${device.utilization_percent}%`}</span></div>
      {device.memory_kind === 'unified' && <div>{device.memory_used_bytes === null ? '统一内存用量未知' : `统一内存已用 ${Math.round(device.memory_used_bytes / 1048576)} MiB`}（与系统共享）</div>}
    </div>)}
    <div>来源：{gpu.source === 'macos-ioreg' ? 'macOS IORegistry' : gpu.source}{gpu.observed_at && <> · <time dateTime={gpu.observed_at}>{new Date(gpu.observed_at).toLocaleTimeString('zh-CN')}</time></>}</div>
  </div>;
}
