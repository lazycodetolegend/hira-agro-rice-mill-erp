# Rice Mill ERP — Setup, Onboarding, Printing & Operations Manual

## 1. Setup & Run Instructions
- **Prerequisites**: Node.js v22+ (tested on Node v26.13.0) and npm. No external database server is needed; SQLite (`node:sqlite` WAL mode) is embedded.
- **Install dependencies**:
  ```bash
  npm run install:all
  ```
- **Build & Start Production Server**:
  ```bash
  npm run build
  npm start
  ```
  Then open `http://localhost:4000` in Chrome/Edge on desktop, tablet, or Android phone (on the same Wi-Fi/LAN, open `http://<SERVER-LAN-IP>:4000` and install as PWA).
- **Development Mode** (two terminals):
  ```bash
  npm run dev:server
  npm run dev:client
  ```
- **Run Automated Tests**:
  ```bash
  npm test
  ```

## 2. Admin Onboarding Instructions
1. Open the app and sign in with the seeded Admin account (`admin` / `Demo@123`).
2. Go to **Admin & Settings → Users & Roles** and change the `admin` password immediately, then create staff accounts (`Accountant`, `Store / Inventory Manager`, `Production Operator`, `Sales / Dispatch User`, `Viewer`).
3. Go to **Admin & Settings → Business & Valuation** to set your Rice Mill Name, Address, Phone, GSTIN, Financial Year Start Month (default April), Inventory Valuation Method (`Weighted Average` or `FIFO`), and document numbering prefixes.
4. Go to **Masters → TAX & UNITS** and have your Chartered Accountant confirm or add your applicable Indian tax treatments.
5. Before entering real mill transactions, go to **Admin & Settings → Backup & Demo Data** and click **Clear Demo Transactions** so demo data does not mix with live accounting.

## 3. HP Inkjet / Laser A4 Label Printer Setup
- **Recommended Hardware**: Any standard INR ~8,000 HP Inkjet or Laser printer with A4 self-adhesive sticker sheets (e.g., 24-label 42×42 mm or 18-label sheets).
- **Printing Steps**:
  1. Create bags under **Bags & QR**, select the bags, and click **Print QR Labels**.
  2. Adjust **Rows**, **Columns**, **Width/Height (35–45 mm default)**, **Margins**, and **Gaps** to match your A4 sticker sheet.
  3. Click **Download A4 PDF** (or **Print Directly**). In the HP print dialog, select **Paper: A4** and **Scale: 100% / Actual Size** (never "Fit to Page").
- **Security**: QR codes contain only an opaque random token (`RM1-...`). Third-party QR scanners cannot read supplier names, rates, or accounting values.

## 4. Offline Usage Instructions
- Sign in once while connected to the mill Wi-Fi/internet. Your session (encrypted locally via WebCrypto when supported) and active master/bag catalog are cached in IndexedDB.
- On the mill floor without internet, tap **Unlock Offline Session** on the login screen.
- You can scan QR codes, look up cached bags, create new fixed/variable-weight bags with offline QR tokens, seal bags, enter weights, download A4 PDFs, and record draft truck receipts.
- When connectivity returns, operations sync automatically in order with idempotency keys. Any concurrent sealing or collision conflicts appear in **Sync & Conflicts** for Admin resolution.

## 5. Backup and Recovery Instructions
- **JSON Backup**: Go to **Admin & Settings → Backup & Demo Data → Export Full JSON Backup** daily and save it off-device (USB/Google Drive).
- **SQLite File Backup**: Copy `server/data/ricemill.sqlite` (while server is idle or via SQLite backup) to an external drive.
- **Recovery**: Restore `ricemill.sqlite` into `server/data/` and restart `npm start`.

## 6. Accounting Configuration Instructions
- Default Chart of Accounts covers Assets, Liabilities, Equity, Income, and Expenses (`1010`–`5200`).
- Customize accounts under **Accounts & Reports → Chart of Accounts** and map automated transaction posting accounts under **Admin & Settings → Account Mappings**.
- Posted documents (Purchases, Sales, Expenses, Payments, Receipts, Journals) are immutable; corrections create balanced reversal entries.
- **Accountant Verification**: All tax rates, HSN codes, and statutory reports must be verified by the business's accountant before filing.

## 7. Known Limitations
- Finalizing/posting accounting journals and generating statutory financial statements requires synchronization with the server database (offline mode allows field operations and drafts).
- Live bank feed / UPI auto-reconciliation is not included; manual UPI/Cheque/NEFT references are supported.
- Direct browser camera scanning on Android phones over LAN requires HTTPS (or `localhost` / USB debugging) due to browser camera security policies; USB/Bluetooth QR scanners and manual entry work over plain HTTP as well.

## 8. Recommended Future Enhancements
- **4-Inch Thermal Label Printer**: Modular `Thermal4InchStubAdapter` is already built into `client/src/print/engine.ts` and ready for ZPL/ESC-POS thermal printers.
- **Weighbridge Serial/USB Integration**: Auto-read gross/tare weights directly from the weighbridge indicator.
- **WhatsApp Notifications**: Dispatch & payment alerts to suppliers and customers.
- **GST E-Invoice / E-Way Bill Integration**: Only after professional CA/tax verification and GST Suvidha Provider (GSP) onboarding.
