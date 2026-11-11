export type WarehouseType = 'main' | 'sub' | 'transit' | 'damaged' | 'showroom' | '3pl' | 'office';
export type MovementType =
  | 'receipt'
  | 'issue'
  | 'sale'
  | 'transfer_in'
  | 'transfer_out'
  | 'reserve'
  | 'release'
  | 'return'
  | 'stocktake_adjustment'
  | 'writeoff';

export interface Company {
  id: string;
  name: string;
  code: string;
  taxNumber: string;
  country: string;
  address?: string;
  currency?: string;
  logoUrl?: string;
  defaultWarehouseId?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Warehouse {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: WarehouseType;
  status: 'active' | 'frozen' | 'archived';
  managerUserId?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Bin {
  id: string;
  companyId: string;
  warehouseId: string;
  zone: string;
  aisle: string;
  rack: string;
  shelf: string;
  bin: string;
  code: string;
  capacityQty: number;
  status: 'active' | 'blocked' | 'maintenance';
  createdAt: string;
  updatedAt?: string;
}

export interface Category {
  id: string;
  companyId?: string;
  code: string;
  name: string;
  parentId?: string;
  description?: string;
  updatedAt?: string;
}

export interface Product {
  id: string;
  companyId: string;
  modelCode: string;
  name: string;
  categoryId?: string;
  unitOfMeasure?: string;
  brand?: string;
  description?: string;
  imageUrl?: string;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface Variant {
  id: string;
  productId: string;
  color?: string;
  size?: string;
  sku: string;
  barcode?: string;
  reorderPoint: number;
  minStock?: number;
  maxStock?: number;
  serialTracked?: boolean;
  lotTracked?: boolean;
  avgCost: number;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface PriceList {
  id: string;
  companyId: string;
  name: string;
  code: string;
  active: boolean;
  createdAt: string;
}

export interface VariantPrice {
  id: string;
  variantId: string;
  priceListId: string;
  minQty: number;
  price: number;
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  permissions?: Partial<Record<AccessResource, AccessAction[]>>;
  warehouseScope?: 'all' | 'assigned';
}

export type AccessResource =
  | 'dashboard'
  | 'inventory'
  | 'operations'
  | 'locations'
  | 'stocktakes'
  | 'reports'
  | 'audit'
  | 'employees'
  | 'companies'
  | 'settings';

export type AccessAction = 'read' | 'create' | 'write' | 'delete' | 'execute' | 'approve' | 'manage';

export interface User {
  id: string;
  companyId: string;
  username: string;
  fullName: string;
  passwordHash: string;
  roleId?: string;
  active: boolean;
  workstationName?: string;
  lastLoginAt?: string;
  lastActiveAt?: string;
  createdAt: string;
  jobTitle?: string;
  department?: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  warehouseIds?: string[];
  companyIds?: string[];
  pinHash?: string;
}

export interface StockMovement {
  id: string;
  companyId: string;
  variantId: string;
  warehouseId: string;
  binId?: string;
  movementType: MovementType;
  qtyOnHand: number;
  qtyReserved: number;
  unitCost: number;
  refType?: string;
  refId?: string;
  userName: string;
  createdAt: string;
  notes?: string;
  lotNumber?: string;
  expirationDate?: string;
  serialNumbers?: string[];
  updatedAt?: string;
}

export type StockOperationType = 'receipt' | 'delivery' | 'internal';
export type StockOperationStatus = 'draft' | 'waiting' | 'ready' | 'done' | 'cancelled';

export interface StockOperationLine {
  variantId: string;
  quantity: number;
  unitCost?: number;
  lotNumber?: string;
  expirationDate?: string;
  serialNumbers?: string[];
  pickAllocations?: PickAllocation[];
}

export interface PickAllocation {
  binId: string;
  quantity: number;
  lotNumber?: string;
  expirationDate?: string;
  serialNumbers?: string[];
}

export interface StockOperation {
  id: string;
  companyId: string;
  reference: string;
  type: StockOperationType;
  status: StockOperationStatus;
  sourceWarehouseId?: string;
  sourceBinId?: string;
  destinationWarehouseId?: string;
  destinationBinId?: string;
  destinationName?: string;
  assignedToUserId?: string;
  lines: StockOperationLine[];
  notes?: string;
  createdAt: string;
  workStartedAt?: string;
  completedAt?: string;
}

export interface StocktakeSession {
  id: string;
  companyId: string;
  warehouseId: string;
  kind: 'full' | 'cycle' | 'spot';
  status: 'open' | 'in_progress' | 'locked' | 'closed' | 'cancelled';
  createdBy: string;
  createdAt: string;
  closedAt?: string;
  notes?: string;
}

export interface StocktakeLine {
  id: string;
  sessionId: string;
  variantId: string;
  binId?: string;
  bookQty: number;
  countedQty?: number;
  unitCost: number;
  assignedTo?: string;
  varianceQty?: number;
  varianceValue?: number;
  status: 'pending' | 'matched' | 'variance' | 'approved';
  createdAt: string;
}

export interface AuditLog {
  id: string;
  companyId?: string;
  userId?: string;
  userName: string;
  roleName?: string;
  actionType: string;
  sectionName?: string;
  oldValue?: string;
  newValue?: string;
  deviceName?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface NotificationItem {
  id: string;
  companyId: string;
  warehouseId?: string;
  kind: 'low_stock' | 'out_of_stock' | 'slow_moving' | 'stocktake' | 'shipping' | 'security';
  message: string;
  severity: 'info' | 'warning' | 'critical';
  readFlag: boolean;
  createdAt: string;
}

export interface AppState {
  company: Company;
  companies: Company[];
  warehouses: Warehouse[];
  bins: Bin[];
  categories: Category[];
  products: Product[];
  variants: Variant[];
  priceLists: PriceList[];
  variantPrices: VariantPrice[];
  users: User[];
  roles: Role[];
  stockMovements: StockMovement[];
  stockOperations: StockOperation[];
  stocktakeSessions: StocktakeSession[];
  stocktakeLines: StocktakeLine[];
  auditLogs: AuditLog[];
  notifications: NotificationItem[];
}
