/**
 * LLM 观测 — 嵌入 Langfuse UI（通过 Tailscale 访问 HK VPS 自托管实例）
 *
 * 访问前提：浏览器所在设备必须连 Tailscale。
 */

const DEFAULT_LANGFUSE_URL = 'http://100.86.118.99:3000';

export default function LangfuseObservability() {
  const langfuseUrl =
    (import.meta as any).env?.VITE_LANGFUSE_URL || DEFAULT_LANGFUSE_URL;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        minHeight: 'calc(100vh - 120px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <iframe
        src={langfuseUrl}
        title="Langfuse LLM Observability"
        style={{
          width: '100%',
          height: '100%',
          minHeight: 'calc(100vh - 120px)',
          border: 0,
          flex: 1,
        }}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
