import { useEffect, useState } from 'react';
import { Printer, Download, History } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { useSync } from '../context/SyncContext';
import {
  DEFAULT_A4_LAYOUT,
  PRINT_ADAPTERS,
  renderQrDataUrl,
  type LabelLayoutConfig,
  type PrintableBagItem,
} from '../print/engine';
import { listOfflineBags } from '../offline/db';

export function PrintLabelsPage({ preselectedBags }: { preselectedBags?: any[] }) {
  const { business } = useAuth();
  const { t } = useI18n();
  const { isOnline } = useSync();

  const [allBags, setAllBags] = useState<PrintableBagItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set((preselectedBags || []).map((b) => b.id))
  );
  const [layout, setLayout] = useState<LabelLayoutConfig>(() => {
    try {
      const saved = business?.label_layout_json ? JSON.parse(business.label_layout_json) : {};
      return { ...DEFAULT_A4_LAYOUT, ...saved };
    } catch {
      return DEFAULT_A4_LAYOUT;
    }
  });
  const [adapterId, setAdapterId] = useState<'A4_HP' | 'THERMAL_4INCH'>('A4_HP');
  const [reprintReason, setReprintReason] = useState('');
  const [previewQrMap, setPreviewQrMap] = useState<Record<string, string>>({});
  const [printJobs, setPrintJobs] = useState<any[]>([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const load = async () => {
      if (isOnline) {
        const [bagsRes, jobsRes] = await Promise.all([
          apiFetch<any[]>('/bags'),
          apiFetch<any[]>('/bags/print-jobs').catch(() => []),
        ]);
        setAllBags(bagsRes);
        setPrintJobs(jobsRes);
        if (!preselectedBags?.length && bagsRes.length) {
          setSelectedIds(new Set(bagsRes.slice(0, 8).map((b) => b.id)));
        }
      } else {
        const off = await listOfflineBags();
        setAllBags(off);
        if (!preselectedBags?.length && off.length) {
          setSelectedIds(new Set(off.slice(0, 8).map((b) => b.id)));
        }
      }
    };
    load();
  }, [isOnline]);

  const selectedBags = allBags.filter((b) => selectedIds.has(b.id));

  useEffect(() => {
    let active = true;
    (async () => {
      const next: Record<string, string> = {};
      for (const b of selectedBags.slice(0, 24)) {
        next[b.qr_token] = await renderQrDataUrl(b.qr_token);
      }
      if (active) setPreviewQrMap(next);
    })();
    return () => {
      active = false;
    };
  }, [selectedIds, allBags]);

  const recordJobOnServer = async () => {
    if (!isOnline || !selectedBags.length) return;
    await apiFetch('/bags/print-jobs', {
      method: 'POST',
      body: JSON.stringify({
        printerType: adapterId,
        layoutConfig: layout,
        bagIds: selectedBags.map((b) => b.id),
        reprintReason: reprintReason || undefined,
      }),
    });
    const jobs = await apiFetch<any[]>('/bags/print-jobs').catch(() => []);
    setPrintJobs(jobs);
  };

  const handleDownloadPdf = async () => {
    if (!selectedBags.length) return;
    const adapter = PRINT_ADAPTERS[adapterId];
    const doc = await adapter.generatePdf(selectedBags, layout, business?.name || 'Rice Mill');
    doc.save(`QR-Labels-${adapterId}-${new Date().toISOString().slice(0, 10)}.pdf`);
    await recordJobOnServer();
    setMsg(`Downloaded ${selectedBags.length} QR labels PDF (${adapter.name}) and logged print job.`);
  };

  const handleBrowserPrint = async () => {
    if (!selectedBags.length) return;
    await recordJobOnServer();
    window.print();
  };

  const perPage = Math.max(1, layout.rows * layout.cols);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <div>
          <h1 className="text-2xl font-bold text-[#1F2937]">{t('print.title')}</h1>
          <p className="text-sm text-stone-600">
            Designed for normal HP Inkjet/Laser printers on A4 adhesive sticker sheets (35–45 mm default), modular for future 4-inch thermal printers.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleDownloadPdf} disabled={!selectedBags.length} className="btn-primary">
            <Download className="w-5 h-5" /> {t('print.downloadPdf')}
          </button>
          <button onClick={handleBrowserPrint} disabled={!selectedBags.length} className="btn-secondary">
            <Printer className="w-5 h-5" /> {t('print.browserPrint')}
          </button>
        </div>
      </div>

      {msg && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-sm font-semibold no-print">{msg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 no-print">
        {/* Configurator */}
        <div className="card p-4 space-y-3">
          <h2 className="font-bold text-base text-[#1B4D3E]">Print Engine & A4 Layout</h2>

          <div>
            <label className="text-xs font-bold text-stone-600">Printer Module</label>
            <select value={adapterId} onChange={(e) => setAdapterId(e.target.value as any)} className="input-field">
              <option value="A4_HP">A4 HP Inkjet / Laser Sticker Sheet</option>
              <option value="THERMAL_4INCH">4-Inch Thermal Label Printer (Modular)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold text-stone-600">{t('print.rows')}</label>
              <input type="number" min="1" max="12" value={layout.rows} onChange={(e) => setLayout({ ...layout, rows: Number(e.target.value) })} className="input-field" />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">{t('print.cols')}</label>
              <input type="number" min="1" max="8" value={layout.cols} onChange={(e) => setLayout({ ...layout, cols: Number(e.target.value) })} className="input-field" />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Width (mm)</label>
              <input type="number" min="25" max="80" value={layout.labelWidthMm} onChange={(e) => setLayout({ ...layout, labelWidthMm: Number(e.target.value) })} className="input-field" />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Height (mm)</label>
              <input type="number" min="25" max="80" value={layout.labelHeightMm} onChange={(e) => setLayout({ ...layout, labelHeightMm: Number(e.target.value) })} className="input-field" />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Margin Top/Left (mm)</label>
              <input type="number" min="2" max="25" value={layout.marginTopMm} onChange={(e) => setLayout({ ...layout, marginTopMm: Number(e.target.value), marginLeftMm: Number(e.target.value) })} className="input-field" />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">{t('print.gapMm')}</label>
              <input type="number" min="0" max="15" value={layout.gapXMm} onChange={(e) => setLayout({ ...layout, gapXMm: Number(e.target.value), gapYMm: Number(e.target.value) })} className="input-field" />
            </div>
          </div>

          <div className="space-y-1.5 text-xs font-semibold pt-2 border-t border-stone-200">
            <label className="flex items-center gap-2"><input type="checkbox" checked={layout.showBusinessName} onChange={(e) => setLayout({ ...layout, showBusinessName: e.target.checked })} /> Show Business Name</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={layout.showProduct} onChange={(e) => setLayout({ ...layout, showProduct: e.target.checked })} /> Show Product / Rice Type</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={layout.showWeight} onChange={(e) => setLayout({ ...layout, showWeight: e.target.checked })} /> Show Net Weight</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={layout.showLotBatch} onChange={(e) => setLayout({ ...layout, showLotBatch: e.target.checked })} /> Show Lot / Batch Number</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={layout.showPackingDate} onChange={(e) => setLayout({ ...layout, showPackingDate: e.target.checked })} /> Show Packing Date</label>
          </div>

          <div>
            <label className="text-xs font-bold text-stone-600">{t('print.reprintReason')}</label>
            <input value={reprintReason} onChange={(e) => setReprintReason(e.target.value)} placeholder="Damaged sticker / faded print" className="input-field text-sm" />
          </div>
        </div>

        {/* Bag Picker */}
        <div className="card p-4 space-y-2 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-base text-[#1B4D3E]">Select Bags ({selectedBags.length} selected • {perPage}/page)</h2>
            <div className="flex gap-2">
              <button onClick={() => setSelectedIds(new Set(allBags.slice(0, perPage).map((b) => b.id)))} className="btn-secondary !min-h-[34px] !py-1 text-xs">First Page ({perPage})</button>
              <button onClick={() => setSelectedIds(new Set())} className="btn-secondary !min-h-[34px] !py-1 text-xs">Clear</button>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-stone-200 border border-stone-200 rounded-xl">
            {allBags.map((b: any) => (
              <label key={b.id} className="flex items-center justify-between p-2.5 text-sm hover:bg-stone-50 cursor-pointer">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(b.id)}
                    onChange={() => {
                      const next = new Set(selectedIds);
                      if (next.has(b.id)) next.delete(b.id);
                      else next.add(b.id);
                      setSelectedIds(next);
                    }}
                    className="w-4 h-4 accent-[#1B4D3E]"
                  />
                  <span className="font-bold">{b.bag_number}</span>
                  <span className="text-stone-600">{b.product_name} ({b.net_weight_kg} kg)</span>
                </span>
                <span className="text-xs text-stone-500">Prints: {b.print_count || 0}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Live High-Contrast Printable Preview */}
      <div className="card p-4">
        <h2 className="font-bold text-base text-[#1B4D3E] mb-3 no-print">{t('print.preview')}</h2>
        <div
          className="bg-white border border-stone-300 p-4 mx-auto"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
            gap: `${layout.gapXMm}px`,
            maxWidth: '794px',
          }}
        >
          {selectedBags.slice(0, perPage).map((b) => (
            <div
              key={b.id}
              className="border border-stone-300 bg-white p-2 flex flex-col items-center text-center"
            >
              {layout.showBusinessName && (
                <div className="text-[9px] font-bold text-black truncate w-full">{business?.name}</div>
              )}
              {previewQrMap[b.qr_token] && (
                <img src={previewQrMap[b.qr_token]} alt={b.bag_number} className="w-24 h-24 object-contain my-1" />
              )}
              <div className="text-xs font-bold text-black">{b.bag_number}</div>
              {layout.showProduct && <div className="text-[9px] text-black truncate w-full">{b.product_name}</div>}
              <div className="text-[9px] text-black">
                {layout.showWeight ? `${b.net_weight_kg} kg` : ''}
                {layout.showLotBatch && (b.batch_lot_ref || b.lot_number) ? ` • ${b.batch_lot_ref || b.lot_number}` : ''}
              </div>
              {layout.showPackingDate && <div className="text-[8px] text-stone-700">Pkg: {b.packing_date}</div>}
              <div className="text-[8px] text-stone-600 mt-0.5">{t('print.instruction')}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Reprint Audit Log */}
      <div className="card p-4 no-print">
        <h3 className="font-bold text-base flex items-center gap-2 mb-3">
          <History className="w-5 h-5 text-[#1B4D3E]" /> Label Print & Reprint Audit Log
        </h3>
        {!printJobs.length ? (
          <p className="text-sm text-stone-500">No print jobs logged yet.</p>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto text-xs">
            {printJobs.map((j) => (
              <div key={j.id} className="p-2 rounded-lg bg-[#FAF7F0] border border-stone-200 flex justify-between">
                <span>
                  <strong>{j.is_reprint ? 'REPRINT' : 'PRINT'}</strong> ({j.printer_type}) • {j.bag_count} labels • By {j.printed_by_name}
                  {j.reprint_reason ? ` • Reason: ${j.reprint_reason}` : ''}
                </span>
                <span className="text-stone-500">{new Date(j.printed_at).toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
