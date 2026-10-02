import type { ModelChangeReceipt } from './modelChange';

export default function ModelChangeResult({ receipt }: { receipt: ModelChangeReceipt }) {
  return (
    <div role="status" style={{ marginBottom: 20, padding: 12, border: '1px solid #238636', borderRadius: 6, fontSize: 12 }}>
      <div>已生效：{receipt.previous.model} → {receipt.current.model}</div>
      <div>服务商：{receipt.previous.provider} → {receipt.current.provider}</div>
      <div>变更记录：{receipt.id}</div>
      <div>执行来源：{receipt.actor} · 验证时间：{receipt.verified_at}</div>
    </div>
  );
}
