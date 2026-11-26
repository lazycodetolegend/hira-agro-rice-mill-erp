export function HelpDocsPage() {
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-bold text-[#1B4D3E]">Owner Setup, HP A4 Printing & Operations Guide</h1>

      <div className="card p-5 space-y-2 text-sm">
        <h2 className="font-bold text-lg">1. Admin Onboarding Checklist</h2>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Sign in as <code>admin</code> (default demo password <code>Demo@123</code>) and immediately change the Admin password in <strong>Admin & Settings → Users & Roles</strong>.</li>
          <li>Update Business Name, Address, Phone, GSTIN, Financial Year Start Month, and Inventory Valuation Method (Weighted Average or FIFO) in <strong>Admin & Settings</strong>.</li>
          <li>Review Tax Rates in <strong>Masters → TAX & UNITS</strong> with your Chartered Accountant / Accountant before issuing live tax invoices.</li>
          <li>When ready for real operations, click <strong>Clear Demo Transactions</strong> in <strong>Admin & Settings → Backup & Demo Data</strong> so sample demo records do not mix with live mill books.</li>
        </ol>
      </div>

      <div className="card p-5 space-y-2 text-sm">
        <h2 className="font-bold text-lg">2. HP Inkjet / Laser A4 QR Sticker Printing Setup</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Use standard <strong>A4 self-adhesive sticker sheets</strong> (24-up or 18-up pre-cut sheets, or full A4 sticker sheets).</li>
          <li>Open <strong>Print A4 Labels</strong>, select bags, and set label width/height to <strong>35–45 mm</strong> (default 42×42 mm, 6 rows × 4 cols = 24 labels per A4 sheet).</li>
          <li>In your HP printer dialog, set <strong>Paper Size: A4</strong>, <strong>Scale: 100% (Actual Size — do NOT use Fit to Page)</strong>, and <strong>Quality: Normal or Best</strong> for sharp black-on-white QR contrast.</li>
          <li>Every QR encodes only an opaque random token (<code>RM1-...</code>) — third-party scanners see zero supplier, cost, or personal data.</li>
        </ul>
      </div>

      <div className="card p-5 space-y-2 text-sm">
        <h2 className="font-bold text-lg">3. Offline Operation & Conflict Handling</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Once signed in on a phone/tablet, the device caches master data, bags, and QR tokens in encrypted local IndexedDB storage.</li>
          <li>Without internet, operators can unlock their offline session, scan QR codes, seal bags, enter weights, generate new QR bags, and download A4 PDFs.</li>
          <li>When internet returns, queued outbox operations sync automatically using idempotency keys. If two staff members seal the same bag offline, one is accepted and the duplicate is routed to <strong>Sync & Conflicts</strong> for Admin review.</li>
        </ul>
      </div>

      <div className="card p-5 space-y-2 text-sm">
        <h2 className="font-bold text-lg">4. Backup, Known Limitations & Future Roadmap</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Backups</strong>: Export JSON backups regularly from <strong>Admin & Settings</strong> and copy <code>server/data/ricemill.sqlite</code> to external/cloud storage.</li>
          <li><strong>Known Limitations</strong>: Finalizing posted accounting vouchers requires server sync; no live bank API integration is included unless requested; GST rates are user-configurable and require accountant verification.</li>
          <li><strong>Future Enhancements</strong>: 4-inch thermal label printer (modular adapter already stubbed), RS-232/USB weighbridge auto-capture, WhatsApp dispatch alerts, and verified GST e-Invoice/e-Way Bill integration.</li>
        </ul>
      </div>
    </div>
  );
}
