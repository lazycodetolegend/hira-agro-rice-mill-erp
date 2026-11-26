import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, CameraOff, CheckCircle2, AlertTriangle, XCircle, ShieldAlert, Search } from 'lucide-react';
import { apiFetch, safeRandomUUID } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { useSync } from '../context/SyncContext';
import { getOfflineBagByQrOrNumber, putOfflineBag } from '../offline/db';
import { StatusBadge } from '../components/StatusBadge';

type ScanMode = 'RECEIVE' | 'PRINT_VERIFY' | 'SEAL' | 'STOCK_CHECK' | 'DISPATCH' | 'SALE_RETURN' | 'AUDIT';

export function ScannerPage() {
  const { hasPerm } = useAuth();
  const { t } = useI18n();
  const { isOnline, queueOfflineOp } = useSync();

  const [scanMode, setScanMode] = useState<ScanMode>('SEAL');
  const [cameraActive, setCameraActive] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [enableGps, setEnableGps] = useState(false);
  const [lookupResult, setLookupResult] = useState<any | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const readerId = 'ricemill-qr-reader';

  const stopCamera = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        await scannerRef.current.clear();
      } catch {
        // ignore stop cleanup error
      }
      scannerRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    setActionMessage(null);
    try {
      const qr = new Html5Qrcode(readerId);
      scannerRef.current = qr;
      setCameraActive(true);
      await qr.start(
        { facingMode: 'environment' },
        { fps: 12, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
          setManualToken(decodedText);
          handleLookup(decodedText);
          stopCamera();
        },
        () => {}
      );
    } catch (err: any) {
      setCameraActive(false);
      setActionMessage({
        type: 'err',
        text: `Camera unavailable (${err?.message || 'permission denied'}). Use hardware scanner or manual input below.`,
      });
    }
  };

  const handleLookup = async (rawInput?: string) => {
    const query = (rawInput ?? manualToken).trim();
    if (!query) return;
    setActionMessage(null);
    setBusy(true);

    try {
      if (isOnline) {
        // Support looking up either QR token or Bag Number via lookup-qr / bags search
        let res = await apiFetch('/bags/lookup-qr', {
          method: 'POST',
          body: JSON.stringify({ token: query }),
        });
        if (res.validity === 'UNKNOWN' && !query.startsWith('RM1-')) {
          const list = await apiFetch<any[]>(`/bags?search=${encodeURIComponent(query)}`);
          if (list.length > 0) {
            res = await apiFetch('/bags/lookup-qr', {
              method: 'POST',
              body: JSON.stringify({ token: list[0].qr_token }),
            });
          }
        }
        setLookupResult(res);
        if (res.bag) await putOfflineBag(res.bag);
      } else {
        // Offline IndexedDB fallback!
        const bag = await getOfflineBagByQrOrNumber(query);
        if (!bag) {
          setLookupResult({ validity: 'UNKNOWN', token: query, bag: null, offline: true });
        } else {
          let validity = 'VALID';
          if (bag.current_status === 'Cancelled') validity = 'CANCELLED';
          else if (bag.current_status === 'Damaged') validity = 'DAMAGED';
          else if (['Sold', 'Delivered'].includes(bag.current_status)) validity = 'SOLD';
          else if (['Sealed', 'In Stock'].includes(bag.current_status)) validity = 'ALREADY_SEALED';
          setLookupResult({ validity, token: bag.qr_token, bag, offline: true });
        }
      }
    } catch (err: any) {
      setActionMessage({ type: 'err', text: err.message || 'Lookup failed' });
    } finally {
      setBusy(false);
    }
  };

  const getGps = (): Promise<{ lat: number; lng: number } | null> => {
    if (!enableGps || !navigator.geolocation) return Promise.resolve(null);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 3000 }
      );
    });
  };

  const handleTransition = async (newStatus: string) => {
    const bag = lookupResult?.bag;
    if (!bag) return;
    setActionMessage(null);
    setBusy(true);

    try {
      const gps = await getGps();
      const idempotencyKey = safeRandomUUID();

      if (isOnline) {
        const res = await apiFetch(`/bags/${bag.id}/transition`, {
          method: 'POST',
          body: JSON.stringify({
            newStatus,
            scanMode,
            note: note || `Scanned in ${scanMode} mode`,
            gpsLat: gps?.lat ?? null,
            gpsLng: gps?.lng ?? null,
            idempotencyKey,
          }),
        });
        const refreshed = await apiFetch('/bags/lookup-qr', {
          method: 'POST',
          body: JSON.stringify({ token: bag.qr_token }),
        });
        setLookupResult(refreshed);
        if (refreshed.bag) await putOfflineBag(refreshed.bag);
        setActionMessage({
          type: 'ok',
          text: `${bag.bag_number} -> ${res.newStatus} recorded cleanly.`,
        });
      } else {
        // Offline transition validation & durable outbox queue
        if (newStatus === 'Sealed' && ['Sealed', 'In Stock', 'Sold', 'Delivered', 'Cancelled', 'Damaged'].includes(bag.current_status)) {
          throw new Error(t('scanner.alreadySealed'));
        }
        await queueOfflineOp('BAG_TRANSITION', `BAG_${newStatus.toUpperCase()}`, {
          bagId: bag.id,
          newStatus,
          scanMode,
          note: note || `Offline scan (${scanMode})`,
          gpsLat: gps?.lat ?? null,
          gpsLng: gps?.lng ?? null,
        });
        const updatedBag = { ...bag, current_status: newStatus, sync_status: 'Local' };
        await putOfflineBag(updatedBag);
        setLookupResult({ ...lookupResult, validity: newStatus === 'Sealed' ? 'ALREADY_SEALED' : 'VALID', bag: updatedBag });
        setActionMessage({
          type: 'ok',
          text: `${bag.bag_number} -> ${newStatus} saved offline (queued for sync).`,
        });
      }
      setNote('');
    } catch (err: any) {
      setActionMessage({ type: 'err', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const renderValidityBanner = () => {
    if (!lookupResult) return null;
    const v = lookupResult.validity;
    if (v === 'VALID') {
      return (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-400 text-emerald-950 flex items-center gap-2 font-bold">
          <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0" />
          <span>{t('scanner.validBag')}</span>
        </div>
      );
    }
    if (v === 'ALREADY_SEALED') {
      return (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-400 text-amber-950 flex items-center gap-2 font-bold">
          <AlertTriangle className="w-6 h-6 text-[#D97706] shrink-0" />
          <span>{t('scanner.alreadySealed')}</span>
        </div>
      );
    }
    if (v === 'OTHER_BUSINESS') {
      return (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-400 text-red-950 flex items-center gap-2 font-bold">
          <ShieldAlert className="w-6 h-6 text-red-700 shrink-0" />
          <span>{t('scanner.otherBusiness')}</span>
        </div>
      );
    }
    if (v === 'UNKNOWN') {
      return (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-400 text-red-950 flex items-center gap-2 font-bold">
          <XCircle className="w-6 h-6 text-red-700 shrink-0" />
          <span>{t('scanner.unknownToken')}</span>
        </div>
      );
    }
    const mapMsg: Record<string, string> = {
      SOLD: t('scanner.soldBag'),
      CANCELLED: t('scanner.cancelledBag'),
      DAMAGED: t('scanner.damagedBag'),
    };
    return (
      <div className="p-3.5 rounded-xl bg-red-50 border border-red-400 text-red-950 flex items-center gap-2 font-bold">
        <AlertTriangle className="w-6 h-6 text-red-700 shrink-0" />
        <span>{mapMsg[v] || v}</span>
      </div>
    );
  };

  const bag = lookupResult?.bag;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="card p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-[#1B4D3E]">{t('scanner.title')}</h1>
          <label className="flex items-center gap-2 text-xs font-semibold text-stone-600 cursor-pointer">
            <input
              type="checkbox"
              checked={enableGps}
              onChange={(e) => setEnableGps(e.target.checked)}
              className="w-4 h-4 accent-[#1B4D3E]"
            />
            Record GPS (Opt-in)
          </label>
        </div>

        {/* Scan Mode Selector */}
        <div>
          <label className="block text-xs font-bold uppercase text-stone-500 mb-1.5">
            {t('scanner.mode')}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(['SEAL', 'RECEIVE', 'PRINT_VERIFY', 'STOCK_CHECK', 'DISPATCH', 'SALE_RETURN', 'AUDIT'] as ScanMode[]).map(
              (m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setScanMode(m)}
                  className={`px-3 py-2.5 rounded-xl text-xs font-bold border transition ${
                    scanMode === m
                      ? 'bg-[#1B4D3E] text-white border-[#1B4D3E]'
                      : 'bg-[#FAF7F0] text-[#1F2937] border-stone-300 hover:bg-stone-200'
                  }`}
                >
                  {t(`scanner.modes.${m}`)}
                </button>
              )
            )}
          </div>
        </div>

        {/* Camera Scanner Box */}
        <div className="space-y-2">
          <div id={readerId} className={cameraActive ? 'w-full rounded-xl overflow-hidden border border-stone-300' : 'hidden'} />
          <div className="flex flex-wrap gap-2">
            {!cameraActive ? (
              <button type="button" onClick={startCamera} className="btn-primary flex-1">
                <Camera className="w-5 h-5" /> {t('scanner.startCamera')}
              </button>
            ) : (
              <button type="button" onClick={stopCamera} className="btn-danger flex-1">
                <CameraOff className="w-5 h-5" /> {t('scanner.stopCamera')}
              </button>
            )}
          </div>
        </div>

        {/* Manual / USB Barcode Scanner Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleLookup();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            placeholder={t('scanner.manualInput')}
            className="input-field flex-1 font-mono text-sm"
          />
          <button type="submit" disabled={busy} className="btn-secondary shrink-0">
            <Search className="w-5 h-5" /> {t('scanner.lookup')}
          </button>
        </form>
      </div>

      {actionMessage && (
        <div
          className={`p-4 rounded-2xl border font-semibold text-sm ${
            actionMessage.type === 'ok'
              ? 'bg-emerald-50 border-emerald-400 text-emerald-950'
              : 'bg-red-50 border-red-400 text-red-950'
          }`}
        >
          {actionMessage.text}
        </div>
      )}

      {lookupResult && (
        <div className="card p-4 space-y-4">
          {renderValidityBanner()}

          {bag && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-3">
                <div>
                  <div className="text-2xl font-bold text-[#1F2937]">{bag.bag_number}</div>
                  <div className="text-sm font-semibold text-[#1B4D3E]">
                    {bag.product_name} {bag.variety_name ? `• ${bag.variety_name}` : ''} {bag.grade_name ? `• ${bag.grade_name}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={bag.current_status} />
                  {bag.sync_status && <StatusBadge status={bag.sync_status} />}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div className="bg-[#FAF7F0] p-2.5 rounded-xl">
                  <div className="text-xs text-stone-500">Net Weight</div>
                  <div className="font-bold text-base">{bag.net_weight_kg} kg</div>
                </div>
                <div className="bg-[#FAF7F0] p-2.5 rounded-xl">
                  <div className="text-xs text-stone-500">Warehouse</div>
                  <div className="font-bold">{bag.warehouse_name}</div>
                </div>
                <div className="bg-[#FAF7F0] p-2.5 rounded-xl">
                  <div className="text-xs text-stone-500">Lot / Batch</div>
                  <div className="font-bold">{bag.lot_number || bag.production_batch_number || bag.batch_lot_ref || '—'}</div>
                </div>
                <div className="bg-[#FAF7F0] p-2.5 rounded-xl">
                  <div className="text-xs text-stone-500">Truck / Source</div>
                  <div className="font-bold">{bag.truck_number || bag.source_type}</div>
                </div>
                <div className="bg-[#FAF7F0] p-2.5 rounded-xl">
                  <div className="text-xs text-stone-500">Packing Date</div>
                  <div className="font-bold">{bag.packing_date}</div>
                </div>
                {bag.cost_rate_per_kg !== undefined && (
                  <div className="bg-[#FAF7F0] p-2.5 rounded-xl">
                    <div className="text-xs text-stone-500">Cost Rate (Restricted)</div>
                    <div className="font-bold">₹{bag.cost_rate_per_kg}/kg</div>
                  </div>
                )}
              </div>

              {/* Action Controls */}
              <div className="space-y-3 pt-2 border-t border-stone-200">
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional scan note / reason..."
                  className="input-field text-sm"
                />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {hasPerm('bags.seal') &&
                    ['Generated', 'Printed', 'Applied', 'Filled', 'Weighed', 'Scanned'].includes(bag.current_status) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleTransition('Sealed')}
                        className="btn-primary text-base"
                      >
                        <CheckCircle2 className="w-5 h-5" /> {t('scanner.sealNow')}
                      </button>
                    )}

                  {bag.current_status === 'Sealed' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleTransition('In Stock')}
                      className="btn-primary"
                    >
                      {t('scanner.markInStock')}
                    </button>
                  )}

                  {['Sealed', 'In Stock', 'Reserved'].includes(bag.current_status) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleTransition('Damaged')}
                      className="btn-danger"
                    >
                      {t('scanner.markDamaged')}
                    </button>
                  )}

                  {scanMode === 'PRINT_VERIFY' && bag.current_status === 'Printed' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleTransition('Applied')}
                      className="btn-secondary"
                    >
                      Verify Label Applied
                    </button>
                  )}
                </div>
              </div>

              {/* Immutable Event History */}
              {Array.isArray(bag.events) && bag.events.length > 0 && (
                <div className="pt-3 border-t border-stone-200">
                  <h3 className="text-xs font-bold uppercase text-stone-500 mb-2">
                    Immutable Bag Event History
                  </h3>
                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {bag.events.map((ev: any) => (
                      <div key={ev.id} className="text-xs p-2 rounded-lg bg-[#FAF7F0] border border-stone-200 flex justify-between gap-2">
                        <div>
                          <span className="font-bold text-[#1B4D3E]">
                            {ev.previous_status ? `${ev.previous_status} → ` : ''}{ev.new_status}
                          </span>
                          {ev.note && <span className="text-stone-600 ml-2">({ev.note})</span>}
                          <div className="text-stone-500">By {ev.user_name || ev.user_id} • Mode: {ev.scan_mode || '—'}</div>
                        </div>
                        <div className="text-stone-500 shrink-0">
                          {new Date(ev.occurred_at).toLocaleString('en-IN')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
