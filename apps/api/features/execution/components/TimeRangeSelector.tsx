import { TimeRange } from '../api/agents.api';

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
}

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '24h', label: '24时' },
  { value: '72h', label: '72时' },
  { value: '7d', label: '7天' },
];

export default function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  return (
    <div className="flex bg-slate-700 rounded-lg p-1">
      {TIME_RANGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
            value === option.value
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-gray-400 hover:text-white hover:bg-slate-600'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
