import { db } from './connection.js';

export function initSchema() {
  db.exec(`
    -- 1. Businesses (Tenant root)
    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      legal_name TEXT,
      address TEXT,
      phone TEXT,
      email TEXT,
      gstin TEXT,
      pan TEXT,
      logo_data TEXT,
      currency TEXT NOT NULL DEFAULT 'INR',
      fiscal_year_start_month INTEGER NOT NULL DEFAULT 4,
      fiscal_year_start_day INTEGER NOT NULL DEFAULT 1,
      date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
      number_format TEXT NOT NULL DEFAULT 'en-IN',
      valuation_method TEXT NOT NULL DEFAULT 'WEIGHTED_AVG' CHECK (valuation_method IN ('WEIGHTED_AVG', 'FIFO')),
      default_weight_unit TEXT NOT NULL DEFAULT 'kg',
      bag_prefix TEXT NOT NULL DEFAULT 'BAG',
      receiving_prefix TEXT NOT NULL DEFAULT 'RCV',
      lot_prefix TEXT NOT NULL DEFAULT 'LOT',
      batch_prefix TEXT NOT NULL DEFAULT 'PRD',
      purchase_prefix TEXT NOT NULL DEFAULT 'PUR',
      sales_prefix TEXT NOT NULL DEFAULT 'SAL',
      receipt_prefix TEXT NOT NULL DEFAULT 'RCP',
      payment_prefix TEXT NOT NULL DEFAULT 'PAY',
      expense_prefix TEXT NOT NULL DEFAULT 'EXP',
      journal_prefix TEXT NOT NULL DEFAULT 'JRN',
      label_layout_json TEXT NOT NULL DEFAULT '{}',
      approval_thresholds_json TEXT NOT NULL DEFAULT '{}',
      offline_sync_settings_json TEXT NOT NULL DEFAULT '{}',
      tax_disclaimer_acknowledged INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT
    );

    -- 2. Roles & Permissions
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      description TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      permissions_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      UNIQUE(business_id, code)
    );

    -- 3. Users
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      username TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      password_hash TEXT NOT NULL,
      role_id TEXT NOT NULL REFERENCES roles(id),
      preferred_lang TEXT NOT NULL DEFAULT 'en' CHECK (preferred_lang IN ('en', 'hi', 'mr')),
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      UNIQUE(business_id, username)
    );

    -- 4. Devices & Sessions
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      device_key TEXT NOT NULL,
      device_name TEXT NOT NULL,
      platform TEXT,
      is_revoked INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(business_id, device_key)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      device_id TEXT NOT NULL REFERENCES devices(id),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      is_revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    -- 5. Warehouses & Rack/Bin Locations
    CREATE TABLE IF NOT EXISTS warehouses (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      address TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      UNIQUE(business_id, code)
    );

    CREATE TABLE IF NOT EXISTS warehouse_locations (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(warehouse_id, code)
    );

    -- 6. Suppliers & Customers
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      gstin TEXT,
      payment_terms TEXT,
      opening_balance REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      UNIQUE(business_id, code)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      gstin TEXT,
      payment_terms TEXT,
      credit_limit REAL NOT NULL DEFAULT 0,
      opening_balance REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      UNIQUE(business_id, code)
    );

    -- 7. Products, Varieties, Grades, Packaging, Units
    CREATE TABLE IF NOT EXISTS units (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      kg_factor REAL NOT NULL,
      is_base INTEGER NOT NULL DEFAULT 0,
      is_configurable INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(business_id, code)
    );

    CREATE TABLE IF NOT EXISTS product_varieties (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(business_id, name)
    );

    CREATE TABLE IF NOT EXISTS product_grades (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(business_id, name)
    );

    CREATE TABLE IF NOT EXISTS packaging_types (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      standard_net_kg REAL NOT NULL DEFAULT 50,
      tare_kg REAL NOT NULL DEFAULT 0.2,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(business_id, name)
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      material_type TEXT NOT NULL CHECK (material_type IN ('PADDY', 'RICE', 'BROKEN_RICE', 'BRAN', 'HUSK', 'PACKAGING', 'OTHER')),
      variety_id TEXT REFERENCES product_varieties(id),
      grade_id TEXT REFERENCES product_grades(id),
      default_packaging_id TEXT REFERENCES packaging_types(id),
      default_unit TEXT NOT NULL DEFAULT 'kg',
      low_stock_threshold_kg REAL NOT NULL DEFAULT 500,
      default_sale_rate_per_kg REAL NOT NULL DEFAULT 0,
      default_tax_id TEXT,
      hsn_code TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      UNIQUE(business_id, sku)
    );

    -- 8. Tax Settings (Configurable, never hard-coded)
    CREATE TABLE IF NOT EXISTS tax_settings (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      rate_percent REAL NOT NULL DEFAULT 0,
      cgst_percent REAL NOT NULL DEFAULT 0,
      sgst_percent REAL NOT NULL DEFAULT 0,
      igst_percent REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(business_id, code)
    );

    -- 9. Trucks & Inbound Lots
    CREATE TABLE IF NOT EXISTS trucks (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      receiving_number TEXT NOT NULL,
      received_at TEXT NOT NULL,
      truck_number TEXT NOT NULL,
      driver_name TEXT,
      driver_phone TEXT,
      supplier_id TEXT REFERENCES suppliers(id),
      supplier_invoice_no TEXT,
      po_reference TEXT,
      weighbridge_gross_kg REAL NOT NULL DEFAULT 0,
      tare_kg REAL NOT NULL DEFAULT 0,
      net_kg REAL NOT NULL DEFAULT 0,
      display_unit TEXT NOT NULL DEFAULT 'kg',
      freight_charges REAL NOT NULL DEFAULT 0,
      other_charges REAL NOT NULL DEFAULT 0,
      payment_terms TEXT,
      notes TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      UNIQUE(business_id, receiving_number)
    );

    CREATE TABLE IF NOT EXISTS inbound_lots (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      lot_number TEXT NOT NULL,
      truck_id TEXT NOT NULL REFERENCES trucks(id),
      supplier_id TEXT REFERENCES suppliers(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      material_type TEXT NOT NULL,
      variety_id TEXT REFERENCES product_varieties(id),
      grade_id TEXT REFERENCES product_grades(id),
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      location_id TEXT REFERENCES warehouse_locations(id),
      received_qty_kg REAL NOT NULL,
      display_unit TEXT NOT NULL DEFAULT 'kg',
      moisture_percent REAL,
      foreign_matter_percent REAL,
      broken_percent REAL,
      quality_remarks TEXT,
      rate_per_kg REAL NOT NULL DEFAULT 0,
      freight_per_kg REAL NOT NULL DEFAULT 0,
      landed_cost_per_kg REAL NOT NULL DEFAULT 0,
      tax_id TEXT REFERENCES tax_settings(id),
      wastage_adjusted_kg REAL NOT NULL DEFAULT 0,
      wastage_reason TEXT,
      wastage_approved_by TEXT,
      status TEXT NOT NULL DEFAULT 'Received' CHECK (status IN ('Draft', 'Received', 'In Processing', 'Partially Bagged', 'Completed', 'Cancelled')),
      notes TEXT,
      sync_status TEXT NOT NULL DEFAULT 'Synced',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      UNIQUE(business_id, lot_number)
    );

    -- 10. Production & Milling Batches
    CREATE TABLE IF NOT EXISTS production_batches (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      batch_number TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      machine_line TEXT,
      operator_id TEXT REFERENCES users(id),
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      total_input_kg REAL NOT NULL DEFAULT 0,
      finished_rice_kg REAL NOT NULL DEFAULT 0,
      broken_rice_kg REAL NOT NULL DEFAULT 0,
      bran_kg REAL NOT NULL DEFAULT 0,
      husk_kg REAL NOT NULL DEFAULT 0,
      waste_loss_kg REAL NOT NULL DEFAULT 0,
      approved_variance_kg REAL NOT NULL DEFAULT 0,
      variance_reason TEXT,
      variance_approved_by TEXT,
      moisture_before REAL,
      moisture_after REAL,
      quality_notes TEXT,
      total_input_cost REAL NOT NULL DEFAULT 0,
      processing_cost REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'In Progress', 'Completed', 'Cancelled')),
      sync_status TEXT NOT NULL DEFAULT 'Synced',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      UNIQUE(business_id, batch_number)
    );

    CREATE TABLE IF NOT EXISTS production_inputs (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      batch_id TEXT NOT NULL REFERENCES production_batches(id),
      lot_id TEXT NOT NULL REFERENCES inbound_lots(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      qty_kg REAL NOT NULL,
      unit_cost_per_kg REAL NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS production_outputs (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      batch_id TEXT NOT NULL REFERENCES production_batches(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      output_category TEXT NOT NULL CHECK (output_category IN ('FINISHED_RICE', 'BROKEN_RICE', 'BRAN', 'HUSK', 'WASTE')),
      qty_kg REAL NOT NULL,
      allocated_cost REAL NOT NULL DEFAULT 0,
      cost_per_kg REAL NOT NULL DEFAULT 0,
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      created_at TEXT NOT NULL
    );

    -- 11. Bags, QR Tokens, Bag Event History & Print Jobs
    CREATE TABLE IF NOT EXISTS qr_tokens (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
      created_at TEXT NOT NULL,
      created_by TEXT
    );

    CREATE TABLE IF NOT EXISTS bags (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      bag_number TEXT NOT NULL,
      qr_token_id TEXT NOT NULL UNIQUE REFERENCES qr_tokens(id),
      qr_token TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL CHECK (source_type IN ('LOT', 'PRODUCTION', 'OPENING')),
      truck_id TEXT REFERENCES trucks(id),
      lot_id TEXT REFERENCES inbound_lots(id),
      production_batch_id TEXT REFERENCES production_batches(id),
      supplier_id TEXT REFERENCES suppliers(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      variety_id TEXT REFERENCES product_varieties(id),
      grade_id TEXT REFERENCES product_grades(id),
      brand TEXT,
      packaging_type_id TEXT REFERENCES packaging_types(id),
      standard_size_kg REAL NOT NULL DEFAULT 50,
      gross_weight_kg REAL NOT NULL,
      tare_weight_kg REAL NOT NULL DEFAULT 0,
      net_weight_kg REAL NOT NULL,
      display_unit TEXT NOT NULL DEFAULT 'kg',
      packing_date TEXT NOT NULL,
      best_before_date TEXT,
      moisture_percent REAL,
      batch_lot_ref TEXT,
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      location_id TEXT REFERENCES warehouse_locations(id),
      cost_rate_per_kg REAL NOT NULL DEFAULT 0,
      cost_value REAL NOT NULL DEFAULT 0,
      sale_price_per_kg REAL NOT NULL DEFAULT 0,
      customer_id TEXT REFERENCES customers(id),
      sales_document_id TEXT,
      current_status TEXT NOT NULL DEFAULT 'Generated' CHECK (current_status IN (
        'Generated', 'Printed', 'Applied', 'Filled', 'Weighed', 'Scanned', 'Sealed',
        'In Stock', 'Reserved', 'Dispatched', 'Sold', 'Delivered',
        'Rejected', 'Damaged', 'Returned', 'Repacked', 'Adjusted', 'Cancelled'
      )),
      print_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      sync_status TEXT NOT NULL DEFAULT 'Synced',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      UNIQUE(business_id, bag_number)
    );

    CREATE TABLE IF NOT EXISTS bag_events (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      bag_id TEXT NOT NULL REFERENCES bags(id),
      previous_status TEXT,
      new_status TEXT NOT NULL,
      scan_mode TEXT,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      synced_at TEXT,
      gps_lat REAL,
      gps_lng REAL,
      reason TEXT,
      note TEXT,
      photo_attachment_id TEXT,
      idempotency_key TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS print_jobs (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      printer_type TEXT NOT NULL DEFAULT 'A4_HP',
      layout_config_json TEXT NOT NULL,
      bag_ids_json TEXT NOT NULL,
      bag_count INTEGER NOT NULL,
      is_reprint INTEGER NOT NULL DEFAULT 0,
      reprint_reason TEXT,
      printed_by TEXT NOT NULL,
      device_id TEXT NOT NULL,
      printed_at TEXT NOT NULL
    );

    -- 12. Inventory Movements (Stock Ledger)
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      movement_type TEXT NOT NULL CHECK (movement_type IN (
        'GOODS_RECEIVED', 'PRODUCTION_IN', 'PRODUCTION_OUT', 'BAG_SEALED',
        'TRANSFER_IN', 'TRANSFER_OUT', 'RESERVATION', 'DISPATCH',
        'SALE', 'SALE_RETURN', 'PURCHASE_RETURN', 'DAMAGED', 'ADJUSTMENT', 'STOCK_COUNT', 'OPENING'
      )),
      product_id TEXT NOT NULL REFERENCES products(id),
      variety_id TEXT,
      grade_id TEXT,
      lot_id TEXT REFERENCES inbound_lots(id),
      batch_id TEXT REFERENCES production_batches(id),
      bag_id TEXT REFERENCES bags(id),
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      location_id TEXT REFERENCES warehouse_locations(id),
      qty_kg REAL NOT NULL,
      display_unit TEXT NOT NULL DEFAULT 'kg',
      unit_cost REAL NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      source_doc_type TEXT NOT NULL,
      source_doc_id TEXT NOT NULL,
      source_doc_number TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      note TEXT,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0
    );

    -- 13. Purchases & Purchase Returns
    CREATE TABLE IF NOT EXISTS purchase_documents (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      doc_type TEXT NOT NULL CHECK (doc_type IN ('INVOICE', 'RETURN')),
      doc_number TEXT NOT NULL,
      doc_date TEXT NOT NULL,
      due_date TEXT,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      truck_id TEXT REFERENCES trucks(id),
      lot_id TEXT REFERENCES inbound_lots(id),
      original_purchase_id TEXT REFERENCES purchase_documents(id),
      subtotal REAL NOT NULL DEFAULT 0,
      freight_amount REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Posted', 'Reversed')),
      journal_entry_id TEXT,
      reversed_by_entry_id TEXT,
      notes TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      UNIQUE(business_id, doc_number)
    );

    CREATE TABLE IF NOT EXISTS purchase_lines (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      purchase_id TEXT NOT NULL REFERENCES purchase_documents(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      qty_kg REAL NOT NULL,
      display_unit TEXT NOT NULL DEFAULT 'kg',
      rate_per_kg REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_id TEXT REFERENCES tax_settings(id),
      tax_rate_percent REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL DEFAULT 0,
      description TEXT
    );

    -- 14. Sales, Orders, Quotations & Sales Returns
    CREATE TABLE IF NOT EXISTS sales_documents (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      doc_type TEXT NOT NULL CHECK (doc_type IN ('QUOTATION', 'ORDER', 'INVOICE', 'RETURN')),
      doc_number TEXT NOT NULL,
      doc_date TEXT NOT NULL,
      due_date TEXT,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      original_sales_id TEXT REFERENCES sales_documents(id),
      payment_terms TEXT,
      subtotal REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      received_amount REAL NOT NULL DEFAULT 0,
      total_cogs REAL NOT NULL DEFAULT 0,
      delivery_status TEXT NOT NULL DEFAULT 'Pending' CHECK (delivery_status IN ('Pending', 'Dispatched', 'Delivered', 'Returned')),
      status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Posted', 'Reversed', 'Converted')),
      journal_entry_id TEXT,
      cogs_journal_entry_id TEXT,
      notes TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      UNIQUE(business_id, doc_number)
    );

    CREATE TABLE IF NOT EXISTS sales_lines (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      sales_id TEXT NOT NULL REFERENCES sales_documents(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      bag_id TEXT REFERENCES bags(id),
      qty_kg REAL NOT NULL,
      display_unit TEXT NOT NULL DEFAULT 'kg',
      rate_per_kg REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_id TEXT REFERENCES tax_settings(id),
      tax_rate_percent REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL DEFAULT 0,
      cogs_unit_cost REAL NOT NULL DEFAULT 0,
      cogs_total REAL NOT NULL DEFAULT 0,
      description TEXT
    );

    -- 15. Expenses & Other Income
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      voucher_type TEXT NOT NULL DEFAULT 'EXPENSE' CHECK (voucher_type IN ('EXPENSE', 'INCOME')),
      voucher_number TEXT NOT NULL,
      voucher_date TEXT NOT NULL,
      account_id TEXT NOT NULL,
      payment_account_id TEXT,
      vendor_name TEXT,
      payment_method TEXT NOT NULL DEFAULT 'CASH',
      reference_no TEXT,
      amount REAL NOT NULL,
      tax_id TEXT REFERENCES tax_settings(id),
      tax_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL,
      approval_status TEXT NOT NULL DEFAULT 'Approved' CHECK (approval_status IN ('Pending', 'Approved', 'Rejected')),
      status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Posted', 'Reversed')),
      journal_entry_id TEXT,
      notes TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      UNIQUE(business_id, voucher_number)
    );

    -- 16. Payments, Receipts & Contra
    CREATE TABLE IF NOT EXISTS payments_receipts (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      voucher_type TEXT NOT NULL CHECK (voucher_type IN ('PAYMENT', 'RECEIPT', 'CONTRA')),
      voucher_number TEXT NOT NULL,
      voucher_date TEXT NOT NULL,
      party_type TEXT CHECK (party_type IN ('SUPPLIER', 'CUSTOMER', 'NONE')),
      party_id TEXT,
      payment_account_id TEXT NOT NULL,
      target_account_id TEXT,
      payment_method TEXT NOT NULL DEFAULT 'CASH' CHECK (payment_method IN ('CASH', 'BANK', 'UPI', 'CHEQUE', 'OTHER')),
      reference_no TEXT,
      amount REAL NOT NULL,
      linked_doc_id TEXT,
      status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Posted', 'Reversed')),
      journal_entry_id TEXT,
      notes TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT,
      updated_by TEXT,
      UNIQUE(business_id, voucher_number)
    );

    -- 17. Double-Entry Accounting: COA, Mappings, Periods, Journals
    CREATE TABLE IF NOT EXISTS chart_of_accounts (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      account_type TEXT NOT NULL CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE')),
      subtype TEXT NOT NULL,
      parent_id TEXT REFERENCES chart_of_accounts(id),
      is_system INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      opening_balance REAL NOT NULL DEFAULT 0,
      opening_side TEXT NOT NULL DEFAULT 'DEBIT' CHECK (opening_side IN ('DEBIT', 'CREDIT')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(business_id, code)
    );

    CREATE TABLE IF NOT EXISTS account_mappings (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      mapping_key TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
      description TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(business_id, mapping_key)
    );

    CREATE TABLE IF NOT EXISTS fiscal_periods (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      is_closed INTEGER NOT NULL DEFAULT 0,
      closed_at TEXT,
      closed_by TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      entry_number TEXT NOT NULL,
      entry_date TEXT NOT NULL,
      entry_type TEXT NOT NULL CHECK (entry_type IN (
        'PURCHASE', 'PURCHASE_RETURN', 'SALE', 'SALE_COGS', 'SALE_RETURN',
        'PRODUCTION', 'EXPENSE', 'INCOME', 'PAYMENT', 'RECEIPT', 'CONTRA',
        'JOURNAL', 'OPENING', 'STOCK_ADJUSTMENT', 'DEPRECIATION', 'REVERSAL'
      )),
      source_doc_type TEXT,
      source_doc_id TEXT,
      source_doc_number TEXT,
      narration TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Posted' CHECK (status IN ('Draft', 'Posted', 'Reversed')),
      reversed_entry_id TEXT REFERENCES journal_entries(id),
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      approved_by TEXT,
      UNIQUE(business_id, entry_number)
    );

    CREATE TABLE IF NOT EXISTS journal_lines (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id),
      account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
      party_type TEXT,
      party_id TEXT,
      debit REAL NOT NULL DEFAULT 0 CHECK (debit >= 0),
      credit REAL NOT NULL DEFAULT 0 CHECK (credit >= 0),
      narration TEXT
    );

    -- 18. Attachments
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      data_base64 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );

    -- 19. Audit Logs
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      summary TEXT,
      before_json TEXT,
      after_json TEXT,
      created_at TEXT NOT NULL
    );

    -- 20. Offline Sync Operations & Conflict Queue
    CREATE TABLE IF NOT EXISTS sync_operations (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      idempotency_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('APPLIED', 'CONFLICT', 'REJECTED')),
      result_json TEXT,
      offline_created_at TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      UNIQUE(business_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS sync_conflicts (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      idempotency_key TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      conflict_type TEXT NOT NULL,
      description TEXT NOT NULL,
      client_payload_json TEXT NOT NULL,
      server_snapshot_json TEXT,
      resolution_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (resolution_status IN ('PENDING', 'RESOLVED_SERVER', 'RESOLVED_CLIENT', 'DISMISSED')),
      resolved_by TEXT,
      resolved_at TEXT,
      resolution_note TEXT,
      created_at TEXT NOT NULL,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL
    );

    -- 21. Configurable Custom Fields
    CREATE TABLE IF NOT EXISTS custom_field_definitions (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      entity_type TEXT NOT NULL CHECK (entity_type IN ('LOT', 'BAG', 'PRODUCT', 'SUPPLIER', 'CUSTOMER', 'PRODUCTION')),
      field_key TEXT NOT NULL,
      label TEXT NOT NULL,
      field_type TEXT NOT NULL CHECK (field_type IN ('TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN')),
      options_json TEXT DEFAULT '[]',
      is_required INTEGER NOT NULL DEFAULT 0,
      is_sensitive INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE(business_id, entity_type, field_key)
    );

    CREATE TABLE IF NOT EXISTS custom_field_values (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      definition_id TEXT NOT NULL REFERENCES custom_field_definitions(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      value_text TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(definition_id, entity_id)
    );

    -- 22. Pending Approvals (Wastage, Variance, Adjustments, High-value)
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      approval_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
      decided_by TEXT,
      decided_at TEXT,
      decision_note TEXT
    );

    -- Indexes for fast QR lookup, ledger queries, and multi-tenant isolation
    CREATE INDEX IF NOT EXISTS idx_bags_biz_qr ON bags(business_id, qr_token);
    CREATE INDEX IF NOT EXISTS idx_bags_biz_lot ON bags(business_id, lot_id);
    CREATE INDEX IF NOT EXISTS idx_bags_biz_status ON bags(business_id, current_status);
    CREATE INDEX IF NOT EXISTS idx_bag_events_bag ON bag_events(bag_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_inv_mov_biz_prod ON inventory_movements(business_id, product_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_journal_lines_acc ON journal_lines(business_id, account_id);
    CREATE INDEX IF NOT EXISTS idx_audit_biz_time ON audit_logs(business_id, created_at);
  `);

  // Safe additive column migrations for existing databases
  const ensureCol = (table: string, col: string, def: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def};`);
    }
  };
  ensureCol('trucks', 'customer_name', 'TEXT');
  ensureCol('trucks', 'customer_phone', 'TEXT');
  ensureCol('trucks', 'weight_mode', "TEXT DEFAULT 'EXACT'");
  ensureCol('inbound_lots', 'bill_type', "TEXT DEFAULT 'SUPPLY_ONLY'");
  ensureCol('inbound_lots', 'bill_document_id', 'TEXT');
  ensureCol('purchase_documents', 'bill_type', "TEXT DEFAULT 'SUPPLY_ONLY'");
  ensureCol('sales_documents', 'bill_type', "TEXT DEFAULT 'SUPPLY_ONLY'");

  // Security, 2FA & Google Sign-In columns
  ensureCol('users', 'failed_login_attempts', 'INTEGER DEFAULT 0');
  ensureCol('users', 'locked_until', 'TEXT');
  ensureCol('users', 'totp_enabled', 'INTEGER DEFAULT 0');
  ensureCol('users', 'totp_secret_enc', 'TEXT');
  ensureCol('users', 'totp_backup_codes_json', 'TEXT');
  ensureCol('users', 'last_totp_step', 'INTEGER DEFAULT -1');
  ensureCol('users', 'google_email', 'TEXT');
  ensureCol('users', 'google_sub', 'TEXT');
  ensureCol('businesses', 'google_client_id', 'TEXT');
  ensureCol('businesses', 'require_2fa_all', 'INTEGER DEFAULT 0');

  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_challenges (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL UNIQUE,
      auth_method TEXT NOT NULL DEFAULT 'PASSWORD',
      device_key TEXT NOT NULL,
      device_name TEXT NOT NULL,
      platform TEXT,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
}
