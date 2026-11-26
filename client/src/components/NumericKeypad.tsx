import { useState } from 'react';
import { Delete, Check, X } from 'lucide-react';

interface Props {
  label: string;
  initialValue?: string;
  unit?: string;
  onConfirm: (val: number) => void;
  onClose: () => void;
}

export function NumericKeypad({ label, initialValue = '', unit = 'kg', onConfirm, onClose }: Props) {
  const [val, setVal] = useState(initialValue);

  const press = (ch: string) => {
    if (ch === '.' && val.includes('.')) return;
    setVal((prev) => (prev === '0' && ch !== '.' ? ch : prev + ch));
  };

  const backspace = () => setVal((prev) => prev.slice(0, -1));

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-3">
      <div className="bg-white rounded-2xl w-full max-w-sm p-4 shadow-xl border border-stone-200">
        <div className="flex items-center justify-between mb-3">
          <span className="font-bold text-base text-[#1F2937]">{label}</span>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-stone-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-[#FAF7F0] border-2 border-[#1B4D3E] rounded-xl px-4 py-3 mb-3 flex items-baseline justify-between">
          <span className="text-3xl font-bold tracking-wide text-[#1F2937]">{val || '0'}</span>
          <span className="text-sm font-semibold text-stone-600">{unit}</span>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              className="h-14 rounded-xl bg-stone-100 hover:bg-stone-200 active:bg-stone-300 text-2xl font-bold text-[#1F2937]"
            >
              {k}
            </button>
          ))}
          <button
            type="button"
            onClick={backspace}
            className="h-14 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 flex items-center justify-center"
          >
            <Delete className="w-6 h-6" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setVal('')} className="btn-secondary">
            Clear
          </button>
          <button
            type="button"
            onClick={() => {
              const num = parseFloat(val || '0');
              if (!isNaN(num) && num >= 0) onConfirm(num);
            }}
            className="btn-primary"
          >
            <Check className="w-5 h-5" /> OK
          </button>
        </div>
      </div>
    </div>
  );
}
