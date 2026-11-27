import { jsPDF } from 'jspdf';
import { Printer, Download, X } from 'lucide-react';

export interface BillData {
  docNumber: string;
  docDate: string;
  billType: 'GST' | 'SUPPLY_ONLY';
  partyLabel: string;
  partyName: string;
  partyPhone?: string;
  partyGstin?: string;
  partyAddress?: string;
  truckNumber?: string;
  challanNo?: string;
  lotNumber?: string;
  subtotal: number;
  freightAmount?: number;
  discountAmount?: number;
  taxAmount: number;
  totalAmount: number;
  notes?: string;
  lines: Array<{
    description: string;
    hsnCode?: string;
    qtyKg: number;
    ratePerKg: number;
    taxRatePercent: number;
    taxAmount: number;
    lineTotal: number;
  }>;
}

function numberToIndianWords(num: number): string {
  const whole = Math.round(num);
  if (whole === 0) return 'Zero Rupees Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Thirteen', 'Eighteen', 'Nineteen'];
  // Fix 17 cleanly
  ones[17] = 'Seventeen';
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const twoDigits = (n: number): string => {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  };
  const threeDigits = (n: number): string => {
    if (n < 100) return twoDigits(n);
    return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + twoDigits(n % 100) : '');
  };

  let rem = whole;
  const parts: string[] = [];
  const crore = Math.floor(rem / 10000000);
  if (crore) { parts.push(threeDigits(crore) + ' Crore'); rem %= 10000000; }
  const lakh = Math.floor(rem / 100000);
  if (lakh) { parts.push(twoDigits(lakh) + ' Lakh'); rem %= 100000; }
  const thousand = Math.floor(rem / 1000);
  if (thousand) { parts.push(twoDigits(thousand) + ' Thousand'); rem %= 1000; }
  if (rem) parts.push(threeDigits(rem));
  return parts.join(' ') + ' Rupees Only';
}

export function downloadBillPdf(bill: BillData, business: any) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const isGst = bill.billType === 'GST';

  doc.setFillColor(27, 77, 62);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(business?.name || 'Hira Agro Industry', 14, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if (business?.address) doc.text(String(business.address).slice(0, 80), 14, 18);
  const contactLine = [
    business?.phone ? `Ph: ${business.phone}` : '',
    isGst && business?.gstin ? `GSTIN: ${business.gstin}` : '',
  ].filter(Boolean).join('  |  ');
  if (contactLine) doc.text(contactLine, 14, 24);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(isGst ? 'TAX INVOICE (GST BILL)' : 'BILL OF SUPPLY (SUPPLY ONLY)', 196, 13, { align: 'right' });
  doc.setFontSize(9);
  doc.text(`Bill #: ${bill.docNumber}`, 196, 20, { align: 'right' });
  doc.text(`Date: ${bill.docDate}`, 196, 25, { align: 'right' });

  doc.setTextColor(31, 41, 55);
  let y = 38;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(`${bill.partyLabel}:`, 14, y);
  doc.setFont('helvetica', 'normal');
  doc.text(bill.partyName || 'Walk-in Customer', 48, y);
  y += 5;
  if (bill.partyPhone) {
    doc.text(`Customer Phone: ${bill.partyPhone}`, 14, y);
    y += 5;
  }
  if (isGst && bill.partyGstin) {
    doc.text(`Party GSTIN: ${bill.partyGstin}`, 14, y);
    y += 5;
  }
  const refParts = [
    bill.truckNumber ? `Truck: ${bill.truckNumber}` : '',
    bill.challanNo ? `Challan: ${bill.challanNo}` : '',
    bill.lotNumber ? `Lot: ${bill.lotNumber}` : '',
  ].filter(Boolean);
  if (refParts.length) {
    doc.text(refParts.join('   |   '), 14, y);
    y += 6;
  }

  y += 3;
  doc.setFillColor(245, 242, 234);
  doc.rect(14, y - 4.5, 182, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Item / Description', 16, y);
  if (isGst) doc.text('HSN', 86, y);
  doc.text('Qty (kg)', 110, y, { align: 'right' });
  doc.text('Rate', 132, y, { align: 'right' });
  if (isGst) doc.text('GST', 158, y, { align: 'right' });
  doc.text('Amount (INR)', 194, y, { align: 'right' });

  y += 7;
  doc.setFont('helvetica', 'normal');
  for (const l of bill.lines) {
    doc.text(String(l.description || '').slice(0, 36), 16, y);
    if (isGst) doc.text(String(l.hsnCode || '-'), 86, y);
    doc.text(Number(l.qtyKg).toLocaleString('en-IN'), 110, y, { align: 'right' });
    doc.text(Number(l.ratePerKg).toFixed(2), 132, y, { align: 'right' });
    if (isGst) doc.text(`${l.taxRatePercent}% (${l.taxAmount.toFixed(2)})`, 158, y, { align: 'right' });
    doc.text(Number(l.lineTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 }), 194, y, { align: 'right' });
    y += 6;
  }

  y += 4;
  doc.line(14, y, 196, y);
  y += 7;
  doc.text('Subtotal:', 150, y, { align: 'right' });
  doc.text(`Rs. ${Number(bill.subtotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 194, y, { align: 'right' });
  y += 5.5;
  if (bill.freightAmount) {
    doc.text('Freight / Other:', 150, y, { align: 'right' });
    doc.text(`Rs. ${Number(bill.freightAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 194, y, { align: 'right' });
    y += 5.5;
  }
  if (isGst && bill.taxAmount > 0) {
    const halfTax = Number((bill.taxAmount / 2).toFixed(2));
    doc.text('CGST + SGST:', 150, y, { align: 'right' });
    doc.text(`Rs. ${halfTax.toFixed(2)} + ${halfTax.toFixed(2)}`, 194, y, { align: 'right' });
    y += 5.5;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Grand Total:', 150, y + 1, { align: 'right' });
  doc.text(`Rs. ${Number(bill.totalAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 194, y + 1, { align: 'right' });

  y += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`Amount in Words: ${numberToIndianWords(bill.totalAmount)}`, 14, y);
  if (!isGst) {
    y += 6;
    doc.text('Note: Supply Only Bill (No GST Charged).', 14, y);
  }

  doc.save(`${bill.docNumber}-${bill.billType}.pdf`);
}

export function BillPreviewModal({
  bill,
  business,
  onClose,
}: {
  bill: BillData;
  business: any;
  onClose: () => void;
}) {
  const isGst = bill.billType === 'GST';
  const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-5 sm:p-6 space-y-4 shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 no-print">
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${isGst ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`}>
            {isGst ? 'GST BILL (TAX INVOICE)' : 'SUPPLY ONLY BILL (BILL OF SUPPLY)'}
          </span>
          <div className="flex gap-2">
            <button onClick={() => downloadBillPdf(bill, business)} className="btn-primary !min-h-[40px] !py-1.5 text-xs">
              <Download className="w-4 h-4" /> Download Bill PDF
            </button>
            <button onClick={() => window.print()} className="btn-secondary !min-h-[40px] !py-1.5 text-xs">
              <Printer className="w-4 h-4" /> Print Bill
            </button>
            <button onClick={onClose} className="btn-secondary !min-h-[40px] !py-1.5 !px-3 text-xs">
              <X className="w-4 h-4" /> Close
            </button>
          </div>
        </div>

        {/* Printable Bill Body */}
        <div className="border border-stone-300 rounded-xl p-5 space-y-4 text-sm">
          <div className="flex flex-wrap justify-between items-start border-b border-stone-300 pb-3 gap-3">
            <div>
              <h2 className="text-xl font-bold text-[#1B4D3E]">{business?.name || 'Hira Agro Industry'}</h2>
              {business?.address && <div className="text-xs text-stone-600">{business.address}</div>}
              <div className="text-xs text-stone-600">
                {business?.phone && <span>Ph: {business.phone} </span>}
                {isGst && business?.gstin && <span>• GSTIN: <strong>{business.gstin}</strong></span>}
              </div>
            </div>
            <div className="text-right">
              <div className="font-bold text-base text-[#1F2937]">
                {isGst ? 'TAX INVOICE (GST BILL)' : 'BILL OF SUPPLY'}
              </div>
              <div className="text-xs">Bill No: <strong>{bill.docNumber}</strong></div>
              <div className="text-xs">Date: <strong>{bill.docDate}</strong></div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-[#FAF7F0] p-3 rounded-xl">
            <div>
              <div><strong>{bill.partyLabel}:</strong> {bill.partyName}</div>
              {bill.partyPhone && <div><strong>Customer Phone:</strong> {bill.partyPhone}</div>}
              {isGst && bill.partyGstin && <div><strong>GSTIN:</strong> {bill.partyGstin}</div>}
            </div>
            <div className="sm:text-right">
              {bill.truckNumber && <div><strong>Truck No:</strong> {bill.truckNumber}</div>}
              {bill.challanNo && <div><strong>Challan No:</strong> {bill.challanNo}</div>}
              {bill.lotNumber && <div><strong>Lot Ref:</strong> {bill.lotNumber}</div>}
            </div>
          </div>

          <table className="w-full text-xs">
            <thead className="bg-[#FAF7F0] border-y border-stone-300">
              <tr>
                <th className="p-2 text-left">Item</th>
                {isGst && <th className="p-2 text-left">HSN</th>}
                <th className="p-2 text-right">Qty (kg)</th>
                <th className="p-2 text-right">Rate (₹/kg)</th>
                {isGst && <th className="p-2 text-right">GST</th>}
                <th className="p-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {bill.lines.map((l, idx) => (
                <tr key={idx}>
                  <td className="p-2 font-medium">{l.description}</td>
                  {isGst && <td className="p-2">{l.hsnCode || '—'}</td>}
                  <td className="p-2 text-right">{Number(l.qtyKg).toLocaleString('en-IN')}</td>
                  <td className="p-2 text-right">₹{Number(l.ratePerKg).toFixed(2)}</td>
                  {isGst && <td className="p-2 text-right">{l.taxRatePercent}% ({fmt(l.taxAmount)})</td>}
                  <td className="p-2 text-right font-bold">{fmt(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="border-t border-stone-300 pt-3 flex flex-col items-end space-y-1 text-xs">
            <div>Subtotal: <strong>{fmt(bill.subtotal)}</strong></div>
            {Boolean(bill.freightAmount) && <div>Freight & Charges: <strong>{fmt(bill.freightAmount || 0)}</strong></div>}
            {isGst && bill.taxAmount > 0 && (
              <div>CGST + SGST: <strong>{fmt(bill.taxAmount / 2)} + {fmt(bill.taxAmount / 2)}</strong></div>
            )}
            <div className="text-base font-bold text-[#1B4D3E] pt-1">Grand Total: {fmt(bill.totalAmount)}</div>
          </div>

          <div className="text-xs text-stone-600 border-t border-stone-200 pt-2">
            <strong>In Words:</strong> {numberToIndianWords(bill.totalAmount)}
          </div>
        </div>
      </div>
    </div>
  );
}
