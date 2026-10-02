import { useState } from "react";
import LegacyFeatureMap from "./LegacyFeatureMap";
import CapabilitySystem from "./capability-system/CapabilitySystem";
export default function MapPage() {
  const [legacy, setLegacy] = useState(false);
  return (
    <div>
      <nav
        aria-label="地图类型"
        className="flex gap-2 border-b bg-white px-6 py-3 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
      >
        <button
          type="button"
          aria-pressed={!legacy}
          onClick={() => setLegacy(false)}
          className="rounded border px-4 py-2 aria-pressed:border-blue-600 aria-pressed:bg-blue-600 aria-pressed:text-white"
        >
          能力系统
        </button>
        <button
          type="button"
          aria-pressed={legacy}
          onClick={() => setLegacy(true)}
          className="rounded border px-4 py-2 aria-pressed:border-blue-600 aria-pressed:bg-blue-600 aria-pressed:text-white"
        >
          旧 Feature 地图
        </button>
      </nav>
      {legacy ? <LegacyFeatureMap /> : <CapabilitySystem />}
    </div>
  );
}
