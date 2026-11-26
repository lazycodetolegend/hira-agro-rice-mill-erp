export const PERMISSIONS = {
  // Admin & Settings
  BUSINESS_MANAGE: 'business.manage',
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',
  DEVICES_MANAGE: 'devices.manage',
  APPROVALS_DECIDE: 'approvals.decide',
  AUDIT_VIEW: 'audit.view',
  BACKUP_MANAGE: 'backup.manage',
  SYNC_RESOLVE: 'sync.resolve',
  CUSTOM_FIELDS_MANAGE: 'custom_fields.manage',

  // Masters
  MASTERS_VIEW: 'masters.view',
  MASTERS_EDIT: 'masters.edit',

  // Receiving, Lots, Bags, QR, Scanning
  LOTS_VIEW: 'lots.view',
  LOTS_MANAGE: 'lots.manage',
  BAGS_VIEW: 'bags.view',
  BAGS_CREATE: 'bags.create',
  BAGS_PRINT: 'bags.print',
  BAGS_SCAN: 'bags.scan',
  BAGS_SEAL: 'bags.seal',
  BAGS_COST_VIEW: 'bags.cost.view',
  BAGS_PRICE_VIEW: 'bags.price.view',

  // Production
  PRODUCTION_VIEW: 'production.view',
  PRODUCTION_MANAGE: 'production.manage',

  // Inventory
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_MOVE: 'inventory.move',
  INVENTORY_ADJUST: 'inventory.adjust',

  // Commercial & Accounting
  PURCHASES_VIEW: 'purchases.view',
  PURCHASES_MANAGE: 'purchases.manage',
  SALES_VIEW: 'sales.view',
  SALES_MANAGE: 'sales.manage',
  EXPENSES_VIEW: 'expenses.view',
  EXPENSES_MANAGE: 'expenses.manage',
  PAYMENTS_VIEW: 'payments.view',
  PAYMENTS_MANAGE: 'payments.manage',
  ACCOUNTING_VIEW: 'accounting.view',
  ACCOUNTING_POST: 'accounting.post',
  REPORTS_FINANCIAL_VIEW: 'reports.financial.view',
  REPORTS_STOCK_VIEW: 'reports.stock.view',
  EXPORTS_RUN: 'exports.run',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

export const DEFAULT_ROLE_PRESETS: Array<{
  code: string;
  name: string;
  description: string;
  permissions: Permission[];
}> = [
  {
    code: 'OWNER_ADMIN',
    name: 'Owner / Admin',
    description: 'Full access to business settings, users, roles, approvals, accounting, inventory, and backups.',
    permissions: ALL_PERMISSIONS,
  },
  {
    code: 'ACCOUNTANT',
    name: 'Accountant',
    description: 'Purchases, sales, expenses, payments, receipts, journals, ledgers, and financial reports.',
    permissions: [
      PERMISSIONS.MASTERS_VIEW, PERMISSIONS.MASTERS_EDIT,
      PERMISSIONS.LOTS_VIEW, PERMISSIONS.BAGS_VIEW, PERMISSIONS.BAGS_COST_VIEW, PERMISSIONS.BAGS_PRICE_VIEW,
      PERMISSIONS.PRODUCTION_VIEW, PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.PURCHASES_VIEW, PERMISSIONS.PURCHASES_MANAGE,
      PERMISSIONS.SALES_VIEW, PERMISSIONS.SALES_MANAGE,
      PERMISSIONS.EXPENSES_VIEW, PERMISSIONS.EXPENSES_MANAGE,
      PERMISSIONS.PAYMENTS_VIEW, PERMISSIONS.PAYMENTS_MANAGE,
      PERMISSIONS.ACCOUNTING_VIEW, PERMISSIONS.ACCOUNTING_POST,
      PERMISSIONS.REPORTS_FINANCIAL_VIEW, PERMISSIONS.REPORTS_STOCK_VIEW,
      PERMISSIONS.EXPORTS_RUN, PERMISSIONS.AUDIT_VIEW,
    ],
  },
  {
    code: 'STORE_MANAGER',
    name: 'Store / Inventory Manager',
    description: 'Trucks, lots, bags, QR generation, sealing, stock movements, warehouses, and stock reports.',
    permissions: [
      PERMISSIONS.MASTERS_VIEW, PERMISSIONS.MASTERS_EDIT,
      PERMISSIONS.LOTS_VIEW, PERMISSIONS.LOTS_MANAGE,
      PERMISSIONS.BAGS_VIEW, PERMISSIONS.BAGS_CREATE, PERMISSIONS.BAGS_PRINT, PERMISSIONS.BAGS_SCAN, PERMISSIONS.BAGS_SEAL,
      PERMISSIONS.PRODUCTION_VIEW,
      PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_MOVE, PERMISSIONS.INVENTORY_ADJUST,
      PERMISSIONS.REPORTS_STOCK_VIEW, PERMISSIONS.EXPORTS_RUN,
    ],
  },
  {
    code: 'PRODUCTION_OPERATOR',
    name: 'Production Operator',
    description: 'Production batches, bag creation, weights, QR printing, sealing, and scan operations.',
    permissions: [
      PERMISSIONS.MASTERS_VIEW,
      PERMISSIONS.LOTS_VIEW,
      PERMISSIONS.BAGS_VIEW, PERMISSIONS.BAGS_CREATE, PERMISSIONS.BAGS_PRINT, PERMISSIONS.BAGS_SCAN, PERMISSIONS.BAGS_SEAL,
      PERMISSIONS.PRODUCTION_VIEW, PERMISSIONS.PRODUCTION_MANAGE,
      PERMISSIONS.INVENTORY_VIEW,
    ],
  },
  {
    code: 'SALES_DISPATCH',
    name: 'Sales / Dispatch User',
    description: 'Sales orders, dispatch, customer deliveries, bag scanning, and sales documents.',
    permissions: [
      PERMISSIONS.MASTERS_VIEW,
      PERMISSIONS.BAGS_VIEW, PERMISSIONS.BAGS_SCAN, PERMISSIONS.BAGS_PRICE_VIEW,
      PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.SALES_VIEW, PERMISSIONS.SALES_MANAGE,
      PERMISSIONS.PAYMENTS_VIEW,
      PERMISSIONS.REPORTS_STOCK_VIEW,
    ],
  },
  {
    code: 'VIEWER',
    name: 'Viewer',
    description: 'Read-only access to permitted dashboards and reports.',
    permissions: [
      PERMISSIONS.MASTERS_VIEW,
      PERMISSIONS.LOTS_VIEW,
      PERMISSIONS.BAGS_VIEW,
      PERMISSIONS.PRODUCTION_VIEW,
      PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.REPORTS_STOCK_VIEW,
      PERMISSIONS.REPORTS_FINANCIAL_VIEW,
    ],
  },
];
