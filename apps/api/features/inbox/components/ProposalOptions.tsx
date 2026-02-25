import React, { useState } from 'react';
import { Check } from 'lucide-react';
import type { ProposalOption } from '../hooks/useProposals';

interface ProposalOptionsProps {
  options: ProposalOption[];
  onSelect: (optionId: string) => Promise<void>;
}

export default function ProposalOptions({ options, onSelect }: ProposalOptionsProps): React.ReactElement {
  const [selecting, setSelecting] = useState<string | null>(null);

  const handleSelect = async (optionId: string) => {
    setSelecting(optionId);
    try {
      await onSelect(optionId);
    } catch {
      setSelecting(null);
    }
  };

  return (
    <div className="space-y-2 mt-3">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
        选择方案
      </p>
      <div className="grid gap-2">
        {options.map((opt) => (
          <button
            key={opt.id}
            onClick={() => handleSelect(opt.id)}
            disabled={selecting !== null}
            className={`
              flex items-start gap-3 p-3 rounded-xl border text-left transition-all
              ${selecting === opt.id
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                : 'border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }
              ${selecting !== null && selecting !== opt.id ? 'opacity-50' : ''}
            `}
          >
            <div className={`
              mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors
              ${selecting === opt.id
                ? 'border-blue-500 bg-blue-500'
                : 'border-slate-300 dark:border-slate-600'
              }
            `}>
              {selecting === opt.id && <Check className="w-3 h-3 text-white" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {opt.label}
              </p>
              {opt.description && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {opt.description}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
