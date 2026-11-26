import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';

export interface LabelLayoutConfig {
  paperSize: 'A4' | 'THERMAL_4X2';
  rows: number;
  cols: number;
  labelWidthMm: number;
  labelHeightMm: number;
  marginTopMm: number;
  marginLeftMm: number;
  gapXMm: number;
  gapYMm: number;
  showBusinessName: boolean;
  showProduct: boolean;
  showWeight: boolean;
  showLotBatch: boolean;
  showPackingDate: boolean;
  showSensitivePrice: boolean;
  instructionText: string;
}

export const DEFAULT_A4_LAYOUT: LabelLayoutConfig = {
  paperSize: 'A4',
  rows: 6,
  cols: 4,
  labelWidthMm: 42,
  labelHeightMm: 42,
  marginTopMm: 10,
  marginLeftMm: 12,
  gapXMm: 6,
  gapYMm: 6,
  showBusinessName: true,
  showProduct: true,
  showWeight: true,
  showLotBatch: true,
  showPackingDate: true,
  showSensitivePrice: false,
  instructionText: 'Scan using official app',
};

export interface PrintableBagItem {
  id: string;
  bag_number: string;
  qr_token: string;
  product_name: string;
  net_weight_kg: number;
  batch_lot_ref?: string;
  lot_number?: string;
  packing_date: string;
  sale_price_per_kg?: number;
}

export interface PrintEngineAdapter {
  id: string;
  name: string;
  generatePdf(bags: PrintableBagItem[], layout: LabelLayoutConfig, businessName: string): Promise<jsPDF>;
}

/**
 * High-contrast QR PNG Data URL (Black on pure White background for HP Inkjet/Laser clarity)
 */
export async function renderQrDataUrl(token: string): Promise<string> {
  // Encodes only the opaque token inside an official app deep-link path (zero sensitive info)
  const payload = `${window.location.origin}/scan?t=${encodeURIComponent(token)}`;
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 300,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });
}

export class A4HPStickerAdapter implements PrintEngineAdapter {
  id = 'A4_HP';
  name = 'A4 Adhesive Sticker Sheet (HP Inkjet / Laser)';

  async generatePdf(bags: PrintableBagItem[], layout: LabelLayoutConfig, businessName: string): Promise<jsPDF> {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const perPage = Math.max(1, layout.rows * layout.cols);
    const qrCache = new Map<string, string>();
    for (const bag of bags) {
      qrCache.set(bag.qr_token, await renderQrDataUrl(bag.qr_token));
    }

    for (let i = 0; i < bags.length; i++) {
      if (i > 0 && i % perPage === 0) {
        doc.addPage('a4', 'portrait');
      }
      const idxOnPage = i % perPage;
      const row = Math.floor(idxOnPage / layout.cols);
      const col = idxOnPage % layout.cols;

      const x = layout.marginLeftMm + col * (layout.labelWidthMm + layout.gapXMm);
      const y = layout.marginTopMm + row * (layout.labelHeightMm + layout.gapYMm);

      const bag = bags[i];
      const w = layout.labelWidthMm;
      const h = layout.labelHeightMm;

      // Subtle cut border
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.rect(x, y, w, h);

      let cursorY = y + 2;
      if (layout.showBusinessName && businessName) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6);
        doc.setTextColor(0, 0, 0);
        doc.text(businessName.slice(0, 26), x + w / 2, cursorY + 1.5, { align: 'center' });
        cursorY += 3;
      }

      // Square high-contrast QR
      const qrSize = Math.min(w - 8, h * 0.52);
      const qrX = x + (w - qrSize) / 2;
      const qrDataUrl = qrCache.get(bag.qr_token)!;
      doc.addImage(qrDataUrl, 'PNG', qrX, cursorY, qrSize, qrSize);
      cursorY += qrSize + 2.5;

      // Bag Number
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(0, 0, 0);
      doc.text(bag.bag_number, x + w / 2, cursorY, { align: 'center' });
      cursorY += 3;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      if (layout.showProduct) {
        doc.text((bag.product_name || '').slice(0, 26), x + w / 2, cursorY, { align: 'center' });
        cursorY += 2.6;
      }

      const metaParts: string[] = [];
      if (layout.showWeight) metaParts.push(`${bag.net_weight_kg} kg`);
      if (layout.showLotBatch && (bag.batch_lot_ref || bag.lot_number)) {
        metaParts.push(bag.batch_lot_ref || bag.lot_number || '');
      }
      if (metaParts.length > 0) {
        doc.text(metaParts.join(' | ').slice(0, 28), x + w / 2, cursorY, { align: 'center' });
        cursorY += 2.5;
      }

      if (layout.showPackingDate) {
        doc.text(`Pkg: ${bag.packing_date}`, x + w / 2, cursorY, { align: 'center' });
        cursorY += 2.3;
      }

      doc.setFontSize(5);
      doc.setTextColor(60, 60, 60);
      doc.text((layout.instructionText || 'Scan using official app').slice(0, 28), x + w / 2, y + h - 1.5, {
        align: 'center',
      });
    }

    return doc;
  }
}

/**
 * Modular stub ready for future 4-inch thermal label printer integration (ZPL/ESC-POS/4x2 PDF)
 */
export class Thermal4InchStubAdapter implements PrintEngineAdapter {
  id = 'THERMAL_4INCH';
  name = '4-Inch Thermal Label Printer (Modular Future Adapter)';

  async generatePdf(bags: PrintableBagItem[], layout: LabelLayoutConfig, businessName: string): Promise<jsPDF> {
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: [101.6, 50.8], // 4" x 2" thermal stock
    });
    for (let i = 0; i < bags.length; i++) {
      if (i > 0) doc.addPage([101.6, 50.8], 'landscape');
      const bag = bags[i];
      const qr = await renderQrDataUrl(bag.qr_token);
      doc.addImage(qr, 'PNG', 4, 4, 42, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(bag.bag_number, 50, 14);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(businessName.slice(0, 28), 50, 21);
      doc.text(bag.product_name.slice(0, 28), 50, 27);
      doc.text(`Net Wt: ${bag.net_weight_kg} kg`, 50, 33);
      doc.text(layout.instructionText || 'Scan using official app', 50, 42);
    }
    return doc;
  }
}

export const PRINT_ADAPTERS: Record<string, PrintEngineAdapter> = {
  A4_HP: new A4HPStickerAdapter(),
  THERMAL_4INCH: new Thermal4InchStubAdapter(),
};
