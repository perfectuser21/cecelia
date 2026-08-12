export function summarizeWorkRouting({ coding = 0, receipts = 0, directDev = 0, legacyExempt = 0 }) {
  return {
    coding_receipt_coverage: coding === 0 ? 1 : receipts / coding,
    coding_dev_direct: directDev,
    legacy_exempt: legacyExempt,
  };
}
