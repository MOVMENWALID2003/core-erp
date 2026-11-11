import type {AccessAction, AccessResource, AppState, Role, User} from './types';

export const accessResources: Array<{id: AccessResource; label: string}> = [
  {id: 'dashboard', label: 'مركز العمليات'},
  {id: 'inventory', label: 'الأصناف والمخزون'},
  {id: 'operations', label: 'العمليات المخزنية'},
  {id: 'locations', label: 'المستودعات والمواقع'},
  {id: 'stocktakes', label: 'الجرد والتسويات'},
  {id: 'reports', label: 'التقارير والتقييم'},
  {id: 'audit', label: 'سجل الحركات'},
  {id: 'employees', label: 'الموظفون والصلاحيات'},
  {id: 'companies', label: 'الشركات'},
  {id: 'settings', label: 'إعدادات النظام'},
];

export const accessActions: Array<{id: AccessAction; label: string}> = [
  {id: 'read', label: 'قراءة'},
  {id: 'create', label: 'إنشاء'},
  {id: 'write', label: 'تعديل'},
  {id: 'delete', label: 'حذف'},
  {id: 'execute', label: 'تنفيذ'},
  {id: 'approve', label: 'اعتماد'},
  {id: 'manage', label: 'إدارة'},
];

const allActions: AccessAction[] = accessActions.map(({id}) => id);

export const defaultRoles: Role[] = [
  {
    id: 'role-01',
    name: 'مدير النظام',
    description: 'مدير النظام — صلاحية كاملة لجميع التطبيقات والبيانات.',
    permissions: Object.fromEntries(accessResources.map(({id}) => [id, [...allActions]])),
    warehouseScope: 'all',
  },
  {
    id: 'role-02',
    name: 'أمين مخزن / مشرف حركة',
    description: 'تنفيذ الاستلام والتسليم والتحويلات ضمن المستودعات المخصصة.',
    permissions: {
      dashboard: ['read'],
      inventory: ['read'],
      operations: ['read', 'create', 'write', 'execute'],
      locations: ['read'],
      stocktakes: ['read'],
    },
    warehouseScope: 'assigned',
  },
  {
    id: 'role-03',
    name: 'مسؤول الجرد',
    description: 'عرض الأرصدة وإدخال العد الفعلي دون اعتماد التسويات.',
    permissions: {
      dashboard: ['read'],
      inventory: ['read'],
      stocktakes: ['read', 'create', 'write'],
    },
    warehouseScope: 'assigned',
  },
  {
    id: 'role-04',
    name: 'مشاهد / مراقب',
    description: 'قراءة لوحات المعلومات والمخزون والتقارير فقط.',
    permissions: {
      dashboard: ['read'],
      inventory: ['read'],
      reports: ['read'],
    },
    warehouseScope: 'all',
  },
];

export function normalizeRoles(roles: Role[] | undefined): Role[] {
  const saved = Array.isArray(roles) ? roles : [];
  return defaultRoles.map((defaults) => {
    const existing = saved.find((role) => role.id === defaults.id);
    if (!existing) return defaults;
    return {
      ...defaults,
      ...existing,
      permissions: {...defaults.permissions, ...existing.permissions},
      warehouseScope: existing.warehouseScope ?? defaults.warehouseScope,
    };
  }).concat(saved.filter((role) => !defaultRoles.some((defaults) => defaults.id === role.id)));
}

export function getUserRole(state: AppState, user: User): Role | undefined {
  return state.roles.find((role) => role.id === user.roleId);
}

export function canAccess(
  state: AppState,
  user: User | undefined,
  resource: AccessResource,
  action: AccessAction,
  warehouseId?: string,
): boolean {
  if (!user?.active) return false;
  const role = getUserRole(state, user);
  if (!role) return false;

  const allowed = role.permissions?.[resource] ?? [];
  if (!allowed.includes(action) && !allowed.includes('manage')) return false;
  if (!warehouseId || role.warehouseScope !== 'assigned') return true;
  return user.warehouseIds?.includes(warehouseId) ?? false;
}

export function applyWarehouseRecordRules(state: AppState, user: User | undefined): AppState {
  if (!user?.active) {
    return {
      ...state,
      users: [],
      warehouses: [],
      bins: [],
      stockMovements: [],
      stockOperations: [],
      stocktakeSessions: [],
      stocktakeLines: [],
      auditLogs: [],
      notifications: [],
    };
  }
  const role = getUserRole(state, user);
  if (!role || role.warehouseScope !== 'assigned') return state;

  const warehouseIds = new Set(user.warehouseIds ?? []);
  const users = state.users.filter((candidate) => {
    if (!candidate.active || candidate.id === user.id) return candidate.id === user.id;
    const candidateRole = getUserRole(state, candidate);
    return candidateRole?.warehouseScope !== 'assigned'
      || (candidate.warehouseIds ?? []).some((warehouseId) => warehouseIds.has(warehouseId));
  });
  const bins = state.bins.filter((bin) => warehouseIds.has(bin.warehouseId));
  const binIds = new Set(bins.map((bin) => bin.id));
  const stocktakeSessions = state.stocktakeSessions.filter((session) => warehouseIds.has(session.warehouseId));
  const sessionIds = new Set(stocktakeSessions.map((session) => session.id));
  const stockOperations = state.stockOperations.filter((operation) =>
    (!operation.sourceWarehouseId || warehouseIds.has(operation.sourceWarehouseId))
    && (!operation.destinationWarehouseId || warehouseIds.has(operation.destinationWarehouseId)));

  return {
    ...state,
    users,
    warehouses: state.warehouses.filter((warehouse) => warehouseIds.has(warehouse.id)),
    bins,
    stockMovements: state.stockMovements.filter((movement) => warehouseIds.has(movement.warehouseId)),
    stockOperations,
    stocktakeSessions,
    stocktakeLines: state.stocktakeLines.filter((line) => sessionIds.has(line.sessionId) && (!line.binId || binIds.has(line.binId))),
    notifications: state.notifications.filter((notification) => !!notification.warehouseId && warehouseIds.has(notification.warehouseId)),
  };
}

export function filterCompanyState(state: AppState, companyId: string): AppState {
  const company = state.companies.find((item) => item.id === companyId);
  if (!company) throw new Error('الشركة النشطة غير موجودة');
  const warehouses = state.warehouses.filter((item) => item.companyId === companyId);
  const warehouseIds = new Set(warehouses.map((item) => item.id));
  const bins = state.bins.filter((item) => item.companyId === companyId && warehouseIds.has(item.warehouseId));
  const binIds = new Set(bins.map((item) => item.id));
  const products = state.products.filter((item) => item.companyId === companyId);
  const productIds = new Set(products.map((item) => item.id));
  const variants = state.variants.filter((item) => productIds.has(item.productId));
  const variantIds = new Set(variants.map((item) => item.id));
  const stocktakeSessions = state.stocktakeSessions.filter((item) => item.companyId === companyId && warehouseIds.has(item.warehouseId));
  const sessionIds = new Set(stocktakeSessions.map((item) => item.id));

  return {
    ...state,
    company,
    companies: [company],
    warehouses,
    bins,
    categories: state.categories.filter((item) => item.companyId === companyId),
    products,
    variants,
    priceLists: state.priceLists.filter((item) => item.companyId === companyId),
    variantPrices: state.variantPrices.filter((item) => variantIds.has(item.variantId)),
    users: state.users.filter((item) => item.companyId === companyId || item.companyIds?.includes(companyId)),
    stockMovements: state.stockMovements.filter((item) => item.companyId === companyId
      && variantIds.has(item.variantId) && warehouseIds.has(item.warehouseId)),
    stockOperations: state.stockOperations.filter((item) => item.companyId === companyId
      && (!item.sourceWarehouseId || warehouseIds.has(item.sourceWarehouseId))
      && (!item.destinationWarehouseId || warehouseIds.has(item.destinationWarehouseId))),
    stocktakeSessions,
    stocktakeLines: state.stocktakeLines.filter((item) => sessionIds.has(item.sessionId) && variantIds.has(item.variantId) && (!item.binId || binIds.has(item.binId))),
    auditLogs: state.auditLogs.filter((item) => item.companyId === companyId || (!item.companyId && companyId === state.company.id)),
    notifications: state.notifications.filter((item) => item.companyId === companyId && (!item.warehouseId || warehouseIds.has(item.warehouseId))),
  };
}

export async function initializeDefaultAdmin(state: AppState): Promise<AppState> {
  const roles = normalizeRoles(state.roles);
  const existing = state.users.find((user) => user.id === 'user-01' || user.username === 'admin' || user.email?.toLowerCase() === 'admin@gserp.com');
  const passwordHash = existing?.passwordHash && existing.passwordHash !== 'demo-hash'
    ? existing.passwordHash
    : await hashCredential('admin123');
  const admin: User = {
    ...(existing ?? {
      id: 'user-01',
      companyId: state.company.id,
      fullName: 'مدير النظام',
      active: true,
      createdAt: new Date().toISOString(),
    }),
    username: 'admin',
    email: 'admin@gserp.com',
    passwordHash,
    roleId: 'role-01',
    active: true,
    companyIds: [...new Set([...(existing?.companyIds ?? []), ...state.companies.map((company) => company.id)])],
    warehouseIds: state.warehouses.map((warehouse) => warehouse.id),
  };
  const users = existing
    ? state.users.map((user) => user.id === existing.id ? admin : user)
    : [admin, ...state.users];
  return {...state, roles, users};
}

export async function hashCredential(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('التشفير الآمن غير متاح في هذه البيئة');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(value), 'PBKDF2', false, ['deriveBits']);
  const digest = await globalThis.crypto.subtle.deriveBits(
    {name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210000},
    key,
    256,
  );
  const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `pbkdf2-sha256$210000$${toHex(salt)}$${toHex(new Uint8Array(digest))}`;
}

export async function verifyCredential(value: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationText, saltText, digestText] = encoded.split('$');
  const iterations = Number(iterationText);
  if (algorithm !== 'pbkdf2-sha256' || !Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000
    || !/^(?:[0-9a-f]{2}){16}$/i.test(saltText ?? '') || !/^(?:[0-9a-f]{2}){32}$/i.test(digestText ?? '')) {
    return false;
  }
  if (!globalThis.crypto?.subtle) throw new Error('التحقق الآمن من كلمة المرور غير متاح في هذه البيئة');
  const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
  const key = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(value), 'PBKDF2', false, ['deriveBits']);
  const result = new Uint8Array(await globalThis.crypto.subtle.deriveBits(
    {name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltText), iterations},
    key,
    256,
  ));
  const expected = fromHex(digestText);
  let difference = result.length ^ expected.length;
  for (let index = 0; index < result.length; index += 1) difference |= result[index] ^ expected[index];
  return difference === 0;
}
