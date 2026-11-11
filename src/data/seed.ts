import type { AppState, Warehouse, Bin, Category, Product, Variant, PriceList, VariantPrice, Role, User, StockMovement, StocktakeSession, StocktakeLine, AuditLog, NotificationItem } from '../types';
import {defaultRoles} from '../access';

const now = new Date().toISOString();

const company = {
  id: 'company-1',
  name: 'CORE ERP — القاهرة',
  code: 'CORE',
  taxNumber: '3001234567',
  country: 'EG',
  address: 'القاهرة، مصر',
  currency: 'EGP',
  defaultWarehouseId: 'wh-01',
  createdAt: now,
};

const companies = [
  company,
  {
    id: 'company-2',
    name: 'CORE ERP — دبي',
    code: 'CORE-DXB',
    taxNumber: '',
    country: 'AE',
    address: 'دبي، الإمارات العربية المتحدة',
    currency: 'AED',
    defaultWarehouseId: 'wh-04',
    createdAt: now,
  },
];

const warehouses: Warehouse[] = [
  { id: 'wh-01', companyId: company.id, code: 'WH-01', name: 'المستودع الرئيسي', type: 'main', status: 'active', createdAt: now },
  { id: 'wh-02', companyId: company.id, code: 'WH-02', name: 'المستودع الفرعي', type: 'sub', status: 'active', createdAt: now },
  { id: 'wh-03', companyId: company.id, code: 'WH-03', name: 'معرض الملابس', type: 'showroom', status: 'active', createdAt: now },
  { id: 'wh-04', companyId: 'company-2', code: 'DXB-01', name: 'مستودع دبي الرئيسي', type: 'main', status: 'active', createdAt: now },
];

const bins: Bin[] = [
  { id: 'bin-01', companyId: company.id, warehouseId: 'wh-01', zone: 'Z01', aisle: 'A03', rack: 'R02', shelf: 'B05', bin: 'B05', code: 'WH1-Z01-A03-R02-B05', capacityQty: 120, status: 'active', createdAt: now },
  { id: 'bin-02', companyId: company.id, warehouseId: 'wh-01', zone: 'Z01', aisle: 'A03', rack: 'R02', shelf: 'B06', bin: 'B06', code: 'WH1-Z01-A03-R02-B06', capacityQty: 120, status: 'active', createdAt: now },
  { id: 'bin-03', companyId: company.id, warehouseId: 'wh-02', zone: 'Z03', aisle: 'A02', rack: 'R07', shelf: 'B11', bin: 'B11', code: 'WH2-Z03-A02-R07-B11', capacityQty: 90, status: 'active', createdAt: now },
];

const categories: Category[] = [
  { id: 'cat-01', companyId: company.id, code: 'APP', name: 'ملابس رجالية' },
  { id: 'cat-02', companyId: company.id, code: 'KID', name: 'ملابس أطفال' },
];

const products: Product[] = [
  { id: 'prod-01', companyId: company.id, modelCode: 'MOD105', name: 'جينز كلاسيك', categoryId: 'cat-01', brand: 'CORE', description: 'جينز تصميم أسود', active: true, createdAt: now },
  { id: 'prod-02', companyId: company.id, modelCode: 'MOD210', name: 'قميص أساسي', categoryId: 'cat-01', brand: 'CORE', description: 'قميص أنيق', active: true, createdAt: now },
];

const variants: Variant[] = [
  { id: 'var-01', productId: 'prod-01', color: 'أسود', size: 'XL', sku: 'CAT-MOD105-BLK-XL', barcode: '750100000001', reorderPoint: 8, avgCost: 82, active: true, createdAt: now },
  { id: 'var-02', productId: 'prod-01', color: 'أسود', size: 'L', sku: 'CAT-MOD105-BLK-L', barcode: '750100000002', reorderPoint: 6, avgCost: 82, active: true, createdAt: now },
  { id: 'var-03', productId: 'prod-02', color: 'أبيض', size: 'S', sku: 'CAT-MOD210-WHT-S', barcode: '750100000003', reorderPoint: 10, avgCost: 44, active: true, createdAt: now },
];

const priceLists: PriceList[] = [
  { id: 'pl-01', companyId: company.id, name: 'السعر الجملة', code: 'WHOLESALE', active: true, createdAt: now },
  { id: 'pl-02', companyId: company.id, name: 'سعر نص الجملة', code: 'SEMI', active: true, createdAt: now },
  { id: 'pl-03', companyId: company.id, name: 'السعر القطاعي', code: 'RETAIL', active: true, createdAt: now },
];

const variantPrices: VariantPrice[] = [
  { id: 'vp-01', variantId: 'var-01', priceListId: 'pl-01', minQty: 1, price: 120 },
  { id: 'vp-02', variantId: 'var-01', priceListId: 'pl-02', minQty: 1, price: 145 },
  { id: 'vp-03', variantId: 'var-01', priceListId: 'pl-03', minQty: 1, price: 170 },
  { id: 'vp-04', variantId: 'var-02', priceListId: 'pl-01', minQty: 1, price: 110 },
  { id: 'vp-05', variantId: 'var-03', priceListId: 'pl-01', minQty: 1, price: 70 },
];

const roles: Role[] = defaultRoles;

const users: User[] = [
  { id: 'user-01', companyId: company.id, username: 'admin', fullName: 'مدير النظام', passwordHash: 'demo-hash', roleId: 'role-01', active: true, workstationName: 'MAIN-PC', email: 'admin@gserp.com', jobTitle: 'مدير النظام', department: 'الإدارة', companyIds: companies.map((item) => item.id), warehouseIds: warehouses.map((warehouse) => warehouse.id), lastLoginAt: now, lastActiveAt: now, createdAt: now },
  { id: 'user-02', companyId: company.id, username: 'warehouse', fullName: 'أمين المخزن', passwordHash: 'demo-hash', roleId: 'role-02', active: true, workstationName: 'WH-01', email: 'warehouse@gs-erp.local', phone: '', jobTitle: 'أمين مخزن', department: 'عمليات المستودعات', companyIds: [company.id], warehouseIds: ['wh-01'], lastLoginAt: now, lastActiveAt: now, createdAt: now },
  { id: 'user-03', companyId: company.id, username: 'auditor', fullName: 'مسؤول الجرد', passwordHash: 'demo-hash', roleId: 'role-03', active: true, workstationName: 'WH-02', email: 'auditor@gs-erp.local', jobTitle: 'مسؤول الجرد', department: 'الرقابة على المخزون', warehouseIds: ['wh-02'], lastLoginAt: now, lastActiveAt: now, createdAt: now },
  { id: 'user-04', companyId: company.id, username: 'viewer', fullName: 'مراقب المخزون', passwordHash: 'demo-hash', roleId: 'role-04', active: true, workstationName: 'REPORTS-PC', email: 'viewer@gs-erp.local', jobTitle: 'مراقب', department: 'التقارير', warehouseIds: warehouses.map((warehouse) => warehouse.id), lastLoginAt: now, lastActiveAt: now, createdAt: now },
];

const stockMovements: StockMovement[] = [
  { id: 'sm-01', companyId: company.id, variantId: 'var-01', warehouseId: 'wh-01', binId: 'bin-01', movementType: 'receipt', qtyOnHand: 40, qtyReserved: 0, unitCost: 82, userName: 'أمين المخزن', createdAt: '2026-11-10T08:30:00.000Z', notes: 'استلام دفعة أولى' },
  { id: 'sm-02', companyId: company.id, variantId: 'var-02', warehouseId: 'wh-01', binId: 'bin-02', movementType: 'receipt', qtyOnHand: 22, qtyReserved: 0, unitCost: 82, userName: 'أمين المخزن', createdAt: '2026-11-10T08:40:00.000Z', notes: 'استلام دفعة ثانية' },
  { id: 'sm-03', companyId: company.id, variantId: 'var-03', warehouseId: 'wh-02', binId: 'bin-03', movementType: 'receipt', qtyOnHand: 48, qtyReserved: 5, unitCost: 44, userName: 'أمين المخزن', createdAt: '2026-11-10T09:05:00.000Z', notes: 'استلام وارد' },
  { id: 'sm-04', companyId: company.id, variantId: 'var-01', warehouseId: 'wh-01', movementType: 'issue', qtyOnHand: -6, qtyReserved: 0, unitCost: 82, userName: 'أمين المخزن', createdAt: '2026-11-10T09:20:00.000Z', notes: 'صرف مخزني' },
];

const stocktakeSessions: StocktakeSession[] = [
  { id: 'st-01', companyId: company.id, warehouseId: 'wh-01', kind: 'full', status: 'closed', createdBy: 'user-02', createdAt: '2026-11-10T07:00:00.000Z', closedAt: '2026-11-10T08:00:00.000Z' },
  { id: 'st-02', companyId: company.id, warehouseId: 'wh-02', kind: 'cycle', status: 'open', createdBy: 'user-02', createdAt: '2026-11-10T10:00:00.000Z' },
];

const stocktakeLines: StocktakeLine[] = [
  { id: 'stl-01', sessionId: 'st-01', variantId: 'var-01', binId: 'bin-01', bookQty: 40, countedQty: 38, unitCost: 82, varianceQty: -2, varianceValue: -164, status: 'variance', createdAt: now },
  { id: 'stl-02', sessionId: 'st-02', variantId: 'var-03', binId: 'bin-03', bookQty: 48, countedQty: 50, unitCost: 44, varianceQty: 2, varianceValue: 88, status: 'variance', createdAt: now },
];

const auditLogs: AuditLog[] = [
  { id: 'al-01', userId: 'user-01', userName: 'مدير النظام', roleName: 'Super Admin', actionType: 'تسجيل دخول', sectionName: 'security', deviceName: 'MAIN-PC', createdAt: '2026-11-10T07:15:00.000Z' },
  { id: 'al-02', userId: 'user-02', userName: 'أمين المخزن', roleName: 'Warehouse Manager', actionType: 'تعديل حد إعادة الطلب', sectionName: 'inventory', oldValue: '{"reorderPoint":4}', newValue: '{"reorderPoint":6}', deviceName: 'WH-01', createdAt: '2026-11-10T10:42:00.000Z' },
];

const notifications: NotificationItem[] = [
  { id: 'n-01', companyId: company.id, warehouseId: 'wh-01', kind: 'low_stock', message: 'SKU CAT-MOD105-BLK-L وصل إلى نقطة إعادة الطلب.', severity: 'warning', readFlag: false, createdAt: now },
  { id: 'n-02', companyId: company.id, warehouseId: 'wh-02', kind: 'stocktake', message: 'جلسة الجرد WH-02 تحتاج اعتماد الإدارة.', severity: 'info', readFlag: false, createdAt: now },
];

export const createSeedState = (): AppState => ({
  company,
  companies,
  warehouses,
  bins,
  categories,
  products,
  variants,
  priceLists,
  variantPrices,
  users,
  roles,
  stockMovements,
  stockOperations: [],
  stocktakeSessions,
  stocktakeLines,
  auditLogs,
  notifications,
});
