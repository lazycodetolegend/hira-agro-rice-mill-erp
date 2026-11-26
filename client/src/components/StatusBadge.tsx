import { useI18n } from '../context/I18nContext';

const STYLE_MAP: Record<string, string> = {
  Generated: 'bg-stone-200 text-stone-800 border-stone-300',
  Printed: 'bg-blue-100 text-blue-900 border-blue-300',
  Applied: 'bg-indigo-100 text-indigo-900 border-indigo-300',
  Filled: 'bg-cyan-100 text-cyan-900 border-cyan-300',
  Weighed: 'bg-teal-100 text-teal-900 border-teal-300',
  Scanned: 'bg-sky-100 text-sky-900 border-sky-300',
  Sealed: 'bg-emerald-100 text-emerald-900 border-emerald-400 font-bold',
  'In Stock': 'bg-green-100 text-green-900 border-green-400',
  Reserved: 'bg-amber-100 text-amber-900 border-amber-400',
  Dispatched: 'bg-purple-100 text-purple-900 border-purple-300',
  Sold: 'bg-emerald-800 text-white border-emerald-900',
  Delivered: 'bg-emerald-900 text-white border-emerald-950',
  Damaged: 'bg-red-100 text-red-900 border-red-400',
  Cancelled: 'bg-red-200 text-red-950 border-red-400',
  Returned: 'bg-orange-100 text-orange-900 border-orange-400',
  Draft: 'bg-stone-100 text-stone-700 border-stone-300',
  Received: 'bg-blue-100 text-blue-900 border-blue-300',
  'In Processing': 'bg-amber-100 text-amber-900 border-amber-400',
  'Partially Bagged': 'bg-sky-100 text-sky-900 border-sky-300',
  Completed: 'bg-emerald-100 text-emerald-900 border-emerald-400',
  Posted: 'bg-emerald-100 text-emerald-900 border-emerald-400',
  Reversed: 'bg-red-100 text-red-900 border-red-400',
  Local: 'bg-amber-100 text-amber-900 border-amber-400',
  Syncing: 'bg-blue-100 text-blue-900 border-blue-300',
  Synced: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  Conflict: 'bg-red-100 text-red-900 border-red-400',
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const cls = STYLE_MAP[status] || 'bg-stone-100 text-stone-800 border-stone-300';
  const translated = t(`status.${status}`);
  const label = translated.startsWith('status.') ? status : translated;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
      {label}
    </span>
  );
}
