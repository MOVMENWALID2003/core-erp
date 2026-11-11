import { createSeedState } from './data/seed';
import {normalizeRoles} from './access';
import type { AppState, AuditLog, NotificationItem, PickAllocation, StockMovement, StockOperation, StockOperationStatus, StockOperationType, StocktakeLine, StocktakeSession, Variant } from './types';

export const STORAGE_KEY = 'gs-erp-state-v1';

const collectionKeys = [
  'companies', 'warehouses', 'bins', 'categories', 'products', 'variants', 'priceLists', 'variantPrices',
  'users', 'roles', 'stockMovements', 'stockOperations', 'stocktakeSessions', 'stocktakeLines', 'auditLogs',
  'notifications',
] as const;

function normalizeAppState(value: unknown): AppState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ملف البيانات لا يحتوي على حالة CORE ERP صالحة');
  }

  const parsed = value as Partial<AppState>;
  const seed = createSeedState();
  const normalized = {...seed, ...parsed} as AppState;
  for (const key of collectionKeys) {
    if (!Array.isArray(parsed[key])) Object.assign(normalized, {[key]: seed[key]});
  }
  const normalizeCompanyBrand = (company: AppState['company']): AppState['company'] => {
    const name = company.name.replace(/^GS ERP(?=\s|$)/, 'CORE ERP');
    const code = company.code === 'GS' ? 'CORE' : company.code === 'GS-DXB' ? 'CORE-DXB' : company.code;
    return name === company.name && code === company.code ? company : {...company, name, code};
  };
  normalized.company = normalizeCompanyBrand(parsed.company && typeof parsed.company === 'object' ? parsed.company : seed.company);
  normalized.companies = Array.isArray(parsed.companies)
    ? parsed.companies.map(normalizeCompanyBrand)
    : [normalized.company, ...seed.companies.filter((company) => company.id !== normalized.company.id)];
  if (!normalized.companies.some((company) => company.id === normalized.company.id)) {
    normalized.companies = [normalized.company, ...normalized.companies];
  }
  const warehouseCompanies = new Map(normalized.warehouses.map((warehouse) => [warehouse.id, warehouse.companyId]));
  normalized.categories = normalized.categories.map((category) => ({...category, companyId: category.companyId ?? normalized.company.id}));
  normalized.bins = normalized.bins.map((bin) => ({...bin, companyId: warehouseCompanies.get(bin.warehouseId) ?? normalized.company.id}));
  normalized.stockMovements = normalized.stockMovements.map((movement) => ({
    ...movement,
    companyId: warehouseCompanies.get(movement.warehouseId) ?? normalized.company.id,
  }));
  normalized.stockOperations = normalized.stockOperations.map((operation) => ({
    ...operation,
    companyId: warehouseCompanies.get(operation.sourceWarehouseId ?? operation.destinationWarehouseId ?? '') ?? normalized.company.id,
  }));
  normalized.auditLogs = normalized.auditLogs.map((entry) => ({...entry, companyId: entry.companyId ?? normalized.company.id}));
  normalized.roles = normalizeRoles(parsed.roles);
  normalized.products = normalized.products.map((product) =>
    (product.id === 'prod-01' || product.id === 'prod-02') && product.brand === 'GS'
      ? {...product, brand: 'CORE'}
      : product,
  );
  return normalized;
}

export function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function readPersistedSnapshot(): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.error('Failed to read persisted state:', error);
    return null;
  }
}

function writePersistedSnapshot(payload: string): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.setItem(STORAGE_KEY, payload);
    return true;
  } catch (error) {
    console.error('Failed to persist app state:', error);
    return false;
  }
}

export function loadAppState(): AppState {
  const fallback = createSeedState();
  try {
    const raw = readPersistedSnapshot();
    if (!raw) {
      saveAppState(fallback);
      return fallback;
    }

    return normalizeAppState(JSON.parse(raw));
  } catch (error) {
    console.error('Failed to load app state:', error);
    saveAppState(fallback);
    return fallback;
  }
}

export function saveAppState(nextState: AppState): boolean {
  try {
    const payload = JSON.stringify(nextState);
    return writePersistedSnapshot(payload);
  } catch (error) {
    console.error('Failed to persist app state:', error);
    return false;
  }
}

const DATABASE_NAME = 'gs-erp';
const DATABASE_VERSION = 3;
const STATE_STORE = 'application';
const LEGACY_SYNC_QUEUE_STORE = 'sync_queue';
const LEGACY_SYNC_META_STORE = 'sync_meta';
const STATE_RECORD_KEY = 'state';
let persistenceQueue: Promise<void> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function openStateDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this environment'));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STATE_STORE)) {
        request.result.createObjectStore(STATE_STORE);
      }
      if (request.result.objectStoreNames.contains(LEGACY_SYNC_QUEUE_STORE)) request.result.deleteObjectStore(LEGACY_SYNC_QUEUE_STORE);
      if (request.result.objectStoreNames.contains(LEGACY_SYNC_META_STORE)) request.result.deleteObjectStore(LEGACY_SYNC_META_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open the local database'));
    request.onblocked = () => reject(new Error('The local database is blocked by another open application window'));
  });
}

export async function loadDurableAppState(): Promise<AppState> {
  const database = await openStateDatabase();
  try {
    const savedState = await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction(STATE_STORE, 'readonly')
        .objectStore(STATE_STORE)
        .get(STATE_RECORD_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Unable to read the local database'));
    });

    if (savedState !== undefined) return normalizeAppState(savedState);

    const migratedState = loadAppState();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STATE_STORE, 'readwrite');
      transaction.objectStore(STATE_STORE).put(migratedState, STATE_RECORD_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Unable to migrate local inventory data'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Local inventory migration was aborted'));
    });
    return migratedState;
  } finally {
    database.close();
  }
}

export async function saveDurableAppState(nextState: AppState): Promise<boolean> {
  const write = persistenceQueue.then(async () => {
    const database = await openStateDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STATE_STORE, 'readwrite');
        const stateStore = transaction.objectStore(STATE_STORE);
        stateStore.put(nextState, STATE_RECORD_KEY);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Unable to save the local database'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Saving local inventory data was aborted'));
      });
    } finally {
      database.close();
    }
  });
  persistenceQueue = write.then(() => undefined, () => undefined);
  try {
    await write;
    return true;
  } catch (error) {
    console.error('Failed to persist app state to IndexedDB:', error);
    return false;
  }
}

export function parseAppStateBackup(text: string): AppState {
  try {
    return normalizeAppState(JSON.parse(text));
  } catch (error) {
    if (error instanceof Error && error.message.includes('حالة CORE ERP')) throw error;
    throw new Error('تعذر قراءة النسخة الاحتياطية. تحقق من أن الملف JSON صالح.');
  }
}

export function getWarehouseById(state: AppState, warehouseId: string) {
  return state.warehouses.find((warehouse) => warehouse.id === warehouseId);
}

export function getBinById(state: AppState, binId?: string) {
  if (!binId) return undefined;
  return state.bins.find((bin) => bin.id === binId);
}

export function computeStockForVariant(state: AppState, variantId: string, warehouseId: string) {
  const stockMoves = state.stockMovements.filter((movement) => movement.variantId === variantId && movement.warehouseId === warehouseId);

  const onHand = stockMoves.reduce((sum, movement) => sum + movement.qtyOnHand, 0);
  const reserved = stockMoves.reduce((sum, movement) => sum + movement.qtyReserved, 0);

  return {
    onHand,
    reserved,
    available: Math.max(onHand - reserved, 0),
  };
}

export function computeStockForBin(state: AppState, variantId: string, binId: string) {
  const movements = state.stockMovements.filter((movement) => movement.variantId === variantId && movement.binId === binId);
  const onHand = movements.reduce((sum, movement) => sum + movement.qtyOnHand, 0);
  const reserved = movements.reduce((sum, movement) => sum + movement.qtyReserved, 0);
  return {onHand, reserved, available: Math.max(onHand - reserved, 0)};
}

function compareBinPath(left: AppState['bins'][number], right: AppState['bins'][number]) {
  return [left.zone, left.aisle, left.rack, left.shelf, left.bin]
    .join('-')
    .localeCompare([right.zone, right.aisle, right.rack, right.shelf, right.bin].join('-'), undefined, {numeric: true});
}

export function suggestPutawayBin(state: AppState, variantId: string, warehouseId: string, quantity: number, excludedBinId?: string) {
  const candidates = state.bins.filter((bin) => bin.warehouseId === warehouseId && bin.status === 'active')
    .filter((bin) => bin.id !== excludedBinId)
    .map((bin) => {
      const occupied = state.stockMovements.filter((movement) => movement.binId === bin.id)
        .reduce((sum, movement) => sum + movement.qtyOnHand, 0);
      const remaining = bin.capacityQty > 0 ? bin.capacityQty - occupied : Number.POSITIVE_INFINITY;
      const alreadyStoresVariant = state.stockMovements.some((movement) => movement.binId === bin.id && movement.variantId === variantId && movement.qtyOnHand > 0);
      return {bin, remaining, alreadyStoresVariant};
    })
    .filter((candidate) => candidate.remaining >= quantity)
    .sort((left, right) => Number(right.alreadyStoresVariant) - Number(left.alreadyStoresVariant)
      || left.remaining - right.remaining
      || compareBinPath(left.bin, right.bin));
  return candidates[0]?.bin;
}

export function suggestPickPath(
  state: AppState,
  variantId: string,
  warehouseId: string,
  quantity: number,
  serialNumbers: string[] = [],
  preferredBinId?: string,
): PickAllocation[] {
  const variant = state.variants.find((item) => item.id === variantId);
  if (!variant || quantity <= 0) return [];
  const bins = state.bins.filter((bin) => bin.warehouseId === warehouseId && bin.status === 'active'
    && (!preferredBinId || bin.id === preferredBinId));
  if (variant.serialTracked && serialNumbers.length) {
    const serialLocations = new Map<string, string>();
    state.stockMovements.filter((movement) => movement.variantId === variantId && movement.warehouseId === warehouseId)
      .slice().sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .forEach((movement) => (movement.serialNumbers ?? []).forEach((serial) => {
        if (movement.qtyOnHand > 0 && movement.binId) serialLocations.set(serial, movement.binId);
        if (movement.qtyOnHand < 0) serialLocations.delete(serial);
      }));
    const allocations = new Map<string, string[]>();
    for (const serial of serialNumbers.slice(0, quantity)) {
      const binId = serialLocations.get(serial);
      if (binId && bins.some((bin) => bin.id === binId)) allocations.set(binId, [...(allocations.get(binId) ?? []), serial]);
    }
    return [...allocations.entries()].map(([binId, serials]) => ({
      binId,
      quantity: serials.length,
      serialNumbers: serials,
    })).sort((left, right) => compareBinPath(bins.find((bin) => bin.id === left.binId)!, bins.find((bin) => bin.id === right.binId)!));
  }

  const candidates = bins.flatMap<PickAllocation>((bin) => {
    const stock = computeStockForBin(state, variantId, bin.id);
    if (stock.available <= 0) return [];
    if (!variant.lotTracked) return [{binId: bin.id, quantity: stock.available}];

    const lotBalances = new Map<string, {quantity: number; expirationDate?: string}>();
    state.stockMovements.filter((movement) => movement.variantId === variantId && movement.binId === bin.id)
      .forEach((movement) => {
        const key = movement.lotNumber ?? '';
        const lot = lotBalances.get(key) ?? {quantity: 0, expirationDate: movement.expirationDate};
        lot.quantity += movement.qtyOnHand;
        if (movement.expirationDate && (!lot.expirationDate || movement.expirationDate < lot.expirationDate)) lot.expirationDate = movement.expirationDate;
        lotBalances.set(key, lot);
      });
    const lots = [...lotBalances.entries()].filter(([, lot]) => lot.quantity > 0
      && (!lot.expirationDate || lot.expirationDate >= new Date().toISOString().slice(0, 10)))
      .map(([lotNumber, lot]) => ({binId: bin.id, lotNumber: lotNumber || undefined, expirationDate: lot.expirationDate, quantity: lot.quantity}))
      .sort((left, right) => (left.expirationDate ?? '9999-12-31').localeCompare(right.expirationDate ?? '9999-12-31'));
    let reserved = stock.reserved;
    return lots.flatMap((lot) => {
      const available = Math.max(0, lot.quantity - reserved);
      reserved = Math.max(0, reserved - lot.quantity);
      return available ? [{...lot, quantity: Math.min(available, stock.available)}] : [];
    });
  }).sort((left, right) => (left.expirationDate ?? '9999-12-31').localeCompare(right.expirationDate ?? '9999-12-31')
    || compareBinPath(bins.find((bin) => bin.id === left.binId)!, bins.find((bin) => bin.id === right.binId)!));

  let remaining = quantity;
  const allocations: PickAllocation[] = [];
  for (const candidate of candidates) {
    if (remaining <= 0) break;
    const picked = Math.min(remaining, candidate.quantity);
    if (picked > 0) allocations.push({...candidate, quantity: picked});
    remaining -= picked;
  }
  return allocations;
}

export function computeWorkerEfficiency(state: AppState) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const workers = new Map<string, {userId: string; name: string; operations: number; units: number; elapsedMs: number}>();
  state.stockOperations.filter((operation) => operation.status === 'done' && operation.assignedToUserId
    && operation.completedAt && Date.parse(operation.completedAt) >= cutoff)
    .forEach((operation) => {
    if (!operation.completedAt) return;
    const user = state.users.find((item) => item.id === operation.assignedToUserId);
      if (!user) return;
      const metrics = workers.get(user.id) ?? {userId: user.id, name: user.fullName, operations: 0, units: 0, elapsedMs: 0};
      metrics.operations += 1;
      metrics.units += operation.lines.reduce((sum, line) => sum + line.quantity, 0);
      if (operation.workStartedAt) metrics.elapsedMs += Math.max(0, Date.parse(operation.completedAt) - Date.parse(operation.workStartedAt));
      workers.set(user.id, metrics);
    });
  return [...workers.values()].sort((left, right) => right.units - left.units);
}

export function computeDashboardStats(state: AppState) {
  const inventoryValue = state.variants.reduce((sum, variant) => {
    const totalQty = state.stockMovements
      .filter((movement) => movement.variantId === variant.id)
      .reduce((q, movement) => q + movement.qtyOnHand, 0);
    return sum + totalQty * Math.max(variant.avgCost, 0);
  }, 0);

  const totalUnits = state.variants.reduce((sum, variant) => {
    return sum + state.stockMovements
      .filter((movement) => movement.variantId === variant.id)
      .reduce((quantity, movement) => quantity + movement.qtyOnHand, 0);
  }, 0);
  const openOrders = state.stockOperations.filter((operation) => !['done', 'cancelled'].includes(operation.status)).length;
  const reorderAlerts = state.variants.filter((variant) => {
    const totalAvailable = state.warehouses.reduce((sum, warehouse) => {
      return sum + computeStockForVariant(state, variant.id, warehouse.id).available;
    }, 0);
    return totalAvailable <= (variant.minStock ?? variant.reorderPoint);
  }).length;

  return {
    inventoryValue,
    totalUnits,
    openOrders,
    reorderAlerts,
  };
}

export function computeInventoryReports(state: AppState) {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const rows = state.variants.map((variant) => {
    const movements = state.stockMovements
      .filter((movement) => movement.variantId === variant.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const onHand = movements.reduce((quantity, movement) => quantity + movement.qtyOnHand, 0);
    const fifoLayers: Array<{quantity: number; cost: number}> = [];

    movements.forEach((movement) => {
      if (movement.qtyOnHand > 0) {
        fifoLayers.push({quantity: movement.qtyOnHand, cost: movement.unitCost});
      } else if (movement.qtyOnHand < 0) {
        let remaining = -movement.qtyOnHand;
        while (remaining > 0 && fifoLayers.length > 0) {
          const layer = fifoLayers[0];
          const consumed = Math.min(remaining, layer.quantity);
          layer.quantity -= consumed;
          remaining -= consumed;
          if (layer.quantity === 0) fifoLayers.shift();
        }
      }
    });

    const product = state.products.find((item) => item.id === variant.productId);
    return {
      id: variant.id,
      sku: variant.sku,
      productName: product?.name ?? '-',
      onHand,
      averageValue: Math.max(onHand, 0) * variant.avgCost,
      fifoValue: fifoLayers.reduce((value, layer) => value + layer.quantity * layer.cost, 0),
      movementCount: movements.length,
      outbound90Days: movements.reduce((quantity, movement) => {
        const createdAt = Date.parse(movement.createdAt);
        return createdAt >= cutoff && movement.qtyOnHand < 0 ? quantity - movement.qtyOnHand : quantity;
      }, 0),
      lastMovementAt: movements.at(-1)?.createdAt ?? '',
    };
  }).sort((left, right) => right.averageValue - left.averageValue);

  const totalValue = rows.reduce((value, row) => value + row.averageValue, 0);
  let accumulated = 0;
  return rows.map((row) => {
    accumulated += row.averageValue;
    const share = totalValue > 0 ? accumulated / totalValue : 1;
    return {...row, abcClass: share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C'};
  });
}

export function createAuditLogEntry(
  state: AppState,
  actionType: string,
  sectionName: string,
  oldValue?: unknown,
  newValue?: unknown,
  userName = 'System',
  deviceName = 'Desktop-App',
): AppState {
  const serializeStable = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
    if (Array.isArray(value)) return `[${value.map(serializeStable).join(',')}]`;
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${serializeStable(item)}`)
      .join(',')}}`;
  };
  const stableOldValue = oldValue === undefined ? undefined : serializeStable(oldValue);
  const stableNewValue = newValue === undefined ? undefined : serializeStable(newValue);
  const normalizeStoredValue = (value: string | undefined) => {
    if (value === undefined) return undefined;
    try {
      return serializeStable(JSON.parse(value));
    } catch {
      return value;
    }
  };
  const now = Date.now();
  const recentDuplicate = state.auditLogs[0];
  if (recentDuplicate
    && recentDuplicate.companyId === state.company.id
    && recentDuplicate.actionType === actionType
    && recentDuplicate.sectionName === sectionName
    && normalizeStoredValue(recentDuplicate.oldValue) === stableOldValue
    && normalizeStoredValue(recentDuplicate.newValue) === stableNewValue
    && now - Date.parse(recentDuplicate.createdAt) >= 0
    && now - Date.parse(recentDuplicate.createdAt) < 500) {
    return state;
  }

  const entry: AuditLog = {
    id: generateId('audit'),
    companyId: state.company.id,
    userName,
    actionType,
    sectionName,
    oldValue: oldValue !== undefined ? JSON.stringify(oldValue) : undefined,
    newValue: newValue !== undefined ? JSON.stringify(newValue) : undefined,
    deviceName,
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    auditLogs: [entry, ...state.auditLogs].slice(0, 150),
  };
}

export function pushNotification(
  state: AppState,
  kind: NotificationItem['kind'],
  message: string,
  severity: NotificationItem['severity'],
  warehouseId?: string,
): AppState {
  const item: NotificationItem = {
    id: generateId('notify'),
    companyId: state.company.id,
    warehouseId,
    kind,
    message,
    severity,
    readFlag: false,
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    notifications: [item, ...state.notifications].slice(0, 30),
  };
}

export function upsertVariantPrice(
  state: AppState,
  variantId: string,
  priceListId: string,
  minQty: number,
  price: number,
): AppState {
  const existingIndex = state.variantPrices.findIndex(
    (priceEntry) => priceEntry.variantId === variantId && priceEntry.priceListId === priceListId && priceEntry.minQty === minQty,
  );

  const nextEntries = [...state.variantPrices];
  if (existingIndex >= 0) {
    nextEntries[existingIndex] = { ...nextEntries[existingIndex], price };
  } else {
    nextEntries.push({
      id: generateId('price'),
      variantId,
      priceListId,
      minQty,
      price,
    });
  }

  return { ...state, variantPrices: nextEntries };
}

export function recordStockMovement(
  state: AppState,
  payload: {
    variantId: string;
    warehouseId: string;
    binId?: string;
    movementType: StockMovement['movementType'];
    qtyOnHand: number;
    qtyReserved?: number;
    unitCost?: number;
    userName: string;
    notes?: string;
    lotNumber?: string;
    expirationDate?: string;
    serialNumbers?: string[];
    refType?: string;
    refId?: string;
  },
): AppState {
  const movement: StockMovement = {
    id: generateId('mov'),
    companyId: state.company.id,
    variantId: payload.variantId,
    warehouseId: payload.warehouseId,
    binId: payload.binId,
    movementType: payload.movementType,
    qtyOnHand: payload.qtyOnHand,
    qtyReserved: payload.qtyReserved ?? 0,
    unitCost: payload.unitCost ?? 0,
    userName: payload.userName,
    createdAt: new Date().toISOString(),
    notes: payload.notes,
    lotNumber: payload.lotNumber,
    expirationDate: payload.expirationDate,
    serialNumbers: payload.serialNumbers,
    refType: payload.refType,
    refId: payload.refId,
  };

  return {
    ...state,
    stockMovements: [movement, ...state.stockMovements],
  };
}

export function createStockOperation(
  state: AppState,
  payload: {
    type: StockOperationType;
    sourceWarehouseId?: string;
    sourceBinId?: string;
    destinationWarehouseId?: string;
    destinationBinId?: string;
    destinationName?: string;
    assignedToUserId?: string;
    lines: Array<{variantId: string; quantity: number; unitCost?: number; lotNumber?: string; expirationDate?: string; serialNumbers?: string[]}>;
    notes?: string;
  },
): AppState {
  if (!payload.lines.length) throw new Error('أضف صنفاً واحداً على الأقل إلى العملية');
  if (payload.type !== 'delivery' && !state.warehouses.some((warehouse) => warehouse.id === payload.destinationWarehouseId)) {
    throw new Error('مستودع الوجهة غير موجود');
  }
  if (payload.type !== 'receipt' && !state.warehouses.some((warehouse) => warehouse.id === payload.sourceWarehouseId)) {
    throw new Error('مستودع المصدر غير موجود');
  }
  if (payload.sourceBinId && !state.bins.some((bin) => bin.id === payload.sourceBinId && bin.warehouseId === payload.sourceWarehouseId && bin.status === 'active')) {
    throw new Error('موقع المصدر غير صالح أو غير نشط');
  }
  if (payload.destinationBinId && !state.bins.some((bin) => bin.id === payload.destinationBinId && bin.warehouseId === payload.destinationWarehouseId && bin.status === 'active')) {
    throw new Error('موقع الوجهة غير صالح أو غير نشط');
  }
  if (payload.type === 'internal' && payload.sourceWarehouseId === payload.destinationWarehouseId
      && (!payload.sourceBinId || !payload.destinationBinId || payload.sourceBinId === payload.destinationBinId)) {
    throw new Error('للنقل داخل المستودع اختر خانتي مصدر ووجهة مختلفتين');
  }

  const lines = payload.lines.map((line) => {
    if (!state.variants.some((variant) => variant.id === line.variantId)) {
      throw new Error('أحد أصناف العملية غير موجود');
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error('يجب أن تكون كميات العملية أعداداً صحيحة أكبر من صفر');
    }
    if (line.unitCost !== undefined && (!Number.isFinite(line.unitCost) || line.unitCost < 0)) {
      throw new Error('تكلفة الوحدة غير صالحة');
    }
    const normalizedLine = {
      variantId: line.variantId,
      quantity: line.quantity,
      unitCost: line.unitCost,
      lotNumber: line.lotNumber?.trim() || undefined,
      expirationDate: line.expirationDate || undefined,
      serialNumbers: line.serialNumbers?.map((serial) => serial.trim()).filter(Boolean),
    };
    const picks = payload.type === 'delivery' && payload.sourceWarehouseId
      ? suggestPickPath(state, line.variantId, payload.sourceWarehouseId, line.quantity, normalizedLine.serialNumbers, payload.sourceBinId)
      : undefined;
    return {...normalizedLine, ...(picks ? {pickAllocations: picks} : {})};
  });
  if (payload.assignedToUserId && !state.users.some((user) => user.id === payload.assignedToUserId && user.active)) {
    throw new Error('المشغل المحدد غير موجود أو غير نشط');
  }

  const prefixes: Record<StockOperationType, string> = {receipt: 'WH/IN', delivery: 'WH/OUT', internal: 'WH/INT'};
  const sequence = state.stockOperations.length + 1;
  const operation: StockOperation = {
    id: generateId('operation'),
    companyId: state.company.id,
    reference: `${prefixes[payload.type]}/${String(sequence).padStart(5, '0')}`,
    type: payload.type,
    status: 'draft',
    sourceWarehouseId: payload.type === 'receipt' ? undefined : payload.sourceWarehouseId,
    sourceBinId: payload.type === 'receipt' ? undefined : payload.sourceBinId,
    destinationWarehouseId: payload.type === 'delivery' ? undefined : payload.destinationWarehouseId,
    destinationBinId: payload.type === 'delivery' ? undefined : payload.destinationBinId,
    destinationName: payload.type === 'delivery' ? payload.destinationName?.trim() || 'العميل' : undefined,
    assignedToUserId: payload.assignedToUserId,
    lines,
    notes: payload.notes?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };
  const next = {...state, stockOperations: [operation, ...state.stockOperations]};
  return createAuditLogEntry(next, 'إنشاء عملية مخزنية', 'operations', undefined, operation);
}

export function transitionStockOperation(state: AppState, operationId: string, nextStatus: StockOperationStatus): AppState {
  const operation = state.stockOperations.find((item) => item.id === operationId);
  if (!operation) throw new Error('العملية المخزنية غير موجودة');

  const allowedTransitions: Record<StockOperationStatus, StockOperationStatus[]> = {
    draft: ['waiting', 'cancelled'],
    waiting: ['ready', 'cancelled'],
    ready: ['done', 'cancelled'],
    done: [],
    cancelled: [],
  };
  if (!allowedTransitions[operation.status].includes(nextStatus)) {
    throw new Error('انتقال حالة العملية غير مسموح');
  }

  let next = state;
  if (nextStatus === 'done') {
    const destination = state.warehouses.find((warehouse) => warehouse.id === operation.destinationWarehouseId);
    const source = state.warehouses.find((warehouse) => warehouse.id === operation.sourceWarehouseId);
    if ((operation.type !== 'delivery' && !destination) || (operation.type !== 'receipt' && !source)) throw new Error('تعذر العثور على مستودع العملية');

    for (const line of operation.lines) {
      const variant = next.variants.find((item) => item.id === line.variantId);
      if (!variant) throw new Error('أحد أصناف العملية غير موجود');
      const note = `${operation.reference}${operation.notes ? ` · ${operation.notes}` : ''}`;
      const sourceWarehouseId = source?.id;
      const destinationWarehouseId = destination?.id;
      const serialNumbers = [...new Set(line.serialNumbers ?? [])];
      const outbound = operation.type !== 'receipt';
      const inbound = operation.type !== 'delivery';
      const allocations = operation.type === 'delivery' && line.pickAllocations
        ? line.pickAllocations
        : [{binId: operation.sourceBinId, quantity: line.quantity, lotNumber: line.lotNumber, expirationDate: line.expirationDate, serialNumbers}];

      if (variant.lotTracked && (inbound
        ? !line.lotNumber
        : allocations.some((allocation) => !allocation.lotNumber))) {
        throw new Error(`رقم التشغيلة مفقود للصنف ${variant.sku}`);
      }
      if (line.expirationDate && !/^\d{4}-\d{2}-\d{2}$/.test(line.expirationDate)) throw new Error('تاريخ الصلاحية غير صالح');
      if (inbound && line.expirationDate && line.expirationDate < new Date().toISOString().slice(0, 10)) throw new Error('لا يمكن استلام تشغيلة منتهية الصلاحية');
      if (variant.serialTracked && (serialNumbers.length !== line.quantity || serialNumbers.length !== (line.serialNumbers ?? []).length)) {
        throw new Error(`أدخل رقماً تسلسلياً فريداً لكل وحدة من ${variant.sku}`);
      }

      if (outbound) {
        const allocatedQuantity = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
        if (allocatedQuantity < line.quantity) {
          const balance = operation.sourceBinId
            ? computeStockForBin(next, variant.id, operation.sourceBinId).available
            : computeStockForVariant(next, variant.id, sourceWarehouseId!).available;
          throw new Error(`الرصيد المتاح من ${variant.sku} هو ${balance} فقط؛ مسار الالتقاط يغطي ${allocatedQuantity} من ${line.quantity}`);
        }
        for (const allocation of allocations) {
          const balance = allocation.binId
            ? computeStockForBin(next, variant.id, allocation.binId)
            : computeStockForVariant(next, variant.id, sourceWarehouseId!);
          if (allocation.quantity > balance.available) {
            const sourceBin = next.bins.find((bin) => bin.id === allocation.binId);
            throw new Error(`الرصيد المتاح من ${variant.sku} في ${sourceBin?.code ?? source!.code} هو ${balance.available} فقط`);
          }
          const pickedSerials = allocation.serialNumbers ?? [];
          if (variant.serialTracked) {
            if (pickedSerials.length !== allocation.quantity) throw new Error(`أدخل رقماً تسلسلياً لكل وحدة من ${variant.sku}`);
            const currentSerials = activeSerials(next, variant.id, sourceWarehouseId!, allocation.binId);
            if (pickedSerials.some((serial) => !currentSerials.has(serial))) {
              throw new Error(`أحد الأرقام التسلسلية للصنف ${variant.sku} غير موجود في موقع الالتقاط`);
            }
          }
          next = recordStockMovement(next, {
            variantId: variant.id,
            warehouseId: source!.id,
            binId: allocation.binId,
            movementType: operation.type === 'internal' ? 'transfer_out' : 'issue',
            qtyOnHand: -allocation.quantity,
            unitCost: variant.avgCost,
            userName: state.users.find((user) => user.id === operation.assignedToUserId)?.fullName ?? 'System',
            notes: note,
            lotNumber: allocation.lotNumber,
            expirationDate: allocation.expirationDate,
            serialNumbers: pickedSerials,
            refType: 'stock.operation',
            refId: operation.id,
          });
        }
      }

      if (inbound) {
        const receivingCost = line.unitCost ?? variant.avgCost;
        if (variant.serialTracked) {
          const currentSerials = activeSerials(next, variant.id, destinationWarehouseId!, operation.destinationBinId);
          if (serialNumbers.some((serial) => currentSerials.has(serial))) {
            throw new Error(`رقم تسلسلي للصنف ${variant.sku} موجود مسبقاً في مستودع الوجهة`);
          }
        }
        const destinationBin = next.bins.find((bin) => bin.id === operation.destinationBinId);
        if (destinationBin && destinationBin.capacityQty > 0) {
          const occupied = next.stockMovements
            .filter((movement) => movement.binId === destinationBin.id)
            .reduce((sum, movement) => sum + movement.qtyOnHand, 0);
          if (occupied + line.quantity > destinationBin.capacityQty) {
            throw new Error(`السعة المتبقية في ${destinationBin.code} لا تكفي لهذه الكمية`);
          }
        }
        const previousQuantity = next.warehouses.reduce((sum, warehouse) => sum + computeStockForVariant(next, variant.id, warehouse.id).onHand, 0);
        next = recordStockMovement(next, {
          variantId: variant.id,
          warehouseId: destinationWarehouseId!,
          binId: operation.destinationBinId,
          movementType: operation.type === 'internal' ? 'transfer_in' : 'receipt',
          qtyOnHand: line.quantity,
          unitCost: receivingCost,
          userName: state.users.find((user) => user.id === operation.assignedToUserId)?.fullName ?? 'System',
          notes: note,
          lotNumber: line.lotNumber,
          expirationDate: line.expirationDate,
          serialNumbers,
          refType: 'stock.operation',
          refId: operation.id,
        });
        if (operation.type === 'receipt' && previousQuantity + line.quantity > 0) {
          const weightedCost = (previousQuantity * variant.avgCost + line.quantity * receivingCost) / (previousQuantity + line.quantity);
          next = {
            ...next,
            variants: next.variants.map((item) => item.id === variant.id ? {...item, avgCost: weightedCost} : item),
          };
        }
      }
    }
  }

  function activeSerials(state: AppState, variantId: string, warehouseId: string, binId?: string): Set<string> {
    const serials = new Set<string>();
    state.stockMovements
      .filter((movement) => movement.variantId === variantId && movement.warehouseId === warehouseId && (!binId || movement.binId === binId))
      .slice()
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .forEach((movement) => (movement.serialNumbers ?? []).forEach((serial) => {
        if (movement.qtyOnHand > 0) serials.add(serial);
        if (movement.qtyOnHand < 0) serials.delete(serial);
      }));
    return serials;
  }

  const timestamp = new Date().toISOString();
  next = {
    ...next,
    stockOperations: next.stockOperations.map((item) => item.id === operationId
      ? {
        ...item,
        status: nextStatus,
        workStartedAt: nextStatus === 'ready' ? timestamp : item.workStartedAt,
        completedAt: nextStatus === 'done' ? timestamp : item.completedAt,
      }
      : item),
  };
  if (nextStatus === 'done') {
    const affectedWarehouses = operation.type === 'receipt'
      ? [operation.destinationWarehouseId]
      : operation.type === 'delivery'
        ? [operation.sourceWarehouseId]
        : [operation.sourceWarehouseId, operation.destinationWarehouseId];
    for (const variantId of new Set(operation.lines.map((line) => line.variantId))) {
      const variant = next.variants.find((item) => item.id === variantId);
      if (!variant) continue;
      for (const warehouseId of new Set(affectedWarehouses.filter((id): id is string => !!id))) {
        const warehouse = next.warehouses.find((item) => item.id === warehouseId);
        const available = computeStockForVariant(next, variantId, warehouseId).available;
        if (warehouse && available <= variant.reorderPoint) {
          next = pushNotification(
            next,
            available <= 0 ? 'out_of_stock' : 'low_stock',
            `الصنف ${variant.sku} وصل إلى حد إعادة الطلب في ${warehouse.code}.`,
            available <= 0 ? 'critical' : 'warning',
            warehouseId,
          );
        }
      }
    }
  }
  return createAuditLogEntry(next, 'تحديث حالة العملية المخزنية', 'operations', {reference: operation.reference, status: operation.status}, {status: nextStatus});
}

export function finalizeStocktakeSession(state: AppState, sessionId: string, countedLines: Array<{ variantId: string; binId?: string; countedQty: number; unitCost: number }>): AppState {
  const session = state.stocktakeSessions.find((current) => current.id === sessionId);
  if (!session) throw new Error('جلسة الجرد غير موجودة');

  const nextState = { ...state, stocktakeSessions: state.stocktakeSessions.map((current) => current.id === sessionId ? { ...current, status: 'closed' as const, closedAt: new Date().toISOString() } : current) };

  const lines: StocktakeLine[] = countedLines.map((line) => {
    const check = state.stocktakeLines.find((existing) => existing.sessionId === sessionId && existing.variantId === line.variantId && existing.binId === line.binId);
    const prevQty = check?.bookQty ?? 0;
    const variance = Number((line.countedQty - prevQty).toFixed(2));
    const varianceValue = Number((variance * line.unitCost).toFixed(2));

    return {
      id: generateId('stocktake-line'),
      sessionId,
      variantId: line.variantId,
      binId: line.binId,
      bookQty: prevQty,
      countedQty: line.countedQty,
      unitCost: line.unitCost,
      varianceQty: variance,
      varianceValue,
      status: variance === 0 ? 'matched' : 'variance',
      createdAt: new Date().toISOString(),
    };
  });

  const updated = {
    ...nextState,
    stocktakeLines: [...lines, ...nextState.stocktakeLines.filter((line) => line.sessionId !== sessionId)],
  };

  const adjustmentEntries = lines.filter((line) => line.varianceQty !== 0).map((line) => ({
    variantId: line.variantId,
    warehouseId: session.warehouseId,
    binId: line.binId,
    movementType: 'stocktake_adjustment' as const,
    qtyOnHand: line.varianceQty ?? 0,
    userName: 'System',
    notes: `تسوية الجرد ${session.id}`,
    unitCost: line.unitCost,
  }));

  let withAdjustments = updated;
  adjustmentEntries.forEach((entry) => {
    withAdjustments = recordStockMovement(withAdjustments, entry);
  });

  return createAuditLogEntry(
    withAdjustments,
    'إغلاق جلسة جرد',
    'stocktake',
    { sessionId },
    { countedLines },
    'System',
    'Desktop-App',
  );
}

export function setStocktakeLineCount(state: AppState, lineId: string, countedQty: number): AppState {
  if (!Number.isFinite(countedQty) || countedQty < 0) throw new Error('الكمية المعدودة يجب أن تكون صفراً أو أكبر');
  const line = state.stocktakeLines.find((item) => item.id === lineId);
  if (!line) throw new Error('سطر الجرد غير موجود');
  if (line.status === 'approved' || state.stocktakeSessions.find((session) => session.id === line.sessionId)?.status === 'closed') {
    throw new Error('لا يمكن تعديل سطر جرد معتمد');
  }
  const variance = Number((countedQty - line.bookQty).toFixed(2));
  return {
    ...state,
    stocktakeLines: state.stocktakeLines.map((item) => item.id === lineId
      ? {...item, countedQty, varianceQty: variance, varianceValue: Number((variance * item.unitCost).toFixed(2)), status: variance === 0 ? 'matched' : 'variance'}
      : item),
  };
}

export function createNewStocktakeSession(state: AppState, kind: 'full' | 'cycle' | 'spot', warehouseId: string, createdBy: string, variantIds?: string[]): AppState {
  if (!state.warehouses.some((warehouse) => warehouse.id === warehouseId)) throw new Error('مستودع الجرد غير موجود');
  if (kind === 'spot' && !variantIds?.length) throw new Error('اختر صنفاً واحداً على الأقل للجرد بالعينة');
  if (variantIds?.some((variantId) => !state.variants.some((variant) => variant.id === variantId && variant.active))) {
    throw new Error('أحد أصناف الجرد غير صالح');
  }

  const session: StocktakeSession = {
    id: generateId('stocktake'),
    companyId: state.company.id,
    warehouseId,
    kind,
    status: 'open',
    createdBy,
    createdAt: new Date().toISOString(),
  };

  const selectedVariants = state.variants.filter((variant) => {
    if (!variant.active) return false;
    if (variantIds) return variantIds.includes(variant.id);
    if (kind === 'cycle') return computeStockForVariant(state, variant.id, warehouseId).onHand !== 0;
    return kind === 'full';
  });
  const warehouseBins = state.bins.filter((bin) => bin.warehouseId === warehouseId);
  const lines: StocktakeLine[] = selectedVariants.flatMap((variant) => {
    const locations: Array<{binId?: string; bookQty: number}> = warehouseBins.map((bin) => ({
      binId: bin.id,
      bookQty: computeStockForBin(state, variant.id, bin.id).onHand,
    })).filter((location) => kind !== 'cycle' || location.bookQty !== 0);
    const unlocatedQuantity = state.stockMovements
      .filter((movement) => movement.variantId === variant.id && movement.warehouseId === warehouseId && !movement.binId)
      .reduce((sum, movement) => sum + movement.qtyOnHand, 0);
    if (unlocatedQuantity !== 0 || !warehouseBins.length || kind !== 'cycle') {
      locations.push({binId: undefined, bookQty: unlocatedQuantity});
    }

    return locations.map((location) => ({
      id: generateId('stocktake-line'),
      sessionId: session.id,
      variantId: variant.id,
      binId: location.binId,
      bookQty: location.bookQty,
      unitCost: variant.avgCost,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    }));
  });
  if (!lines.length) throw new Error('لا توجد أرصدة أو مواقع لتضمينها في جلسة الجرد');

  return {
    ...state,
    stocktakeSessions: [session, ...state.stocktakeSessions],
    stocktakeLines: [...lines, ...state.stocktakeLines],
  };
}

export function getStockTableRows(state: AppState) {
  return state.variants.map((variant) => {
    const warehouse = state.warehouses[0];
    const stock = warehouse ? computeStockForVariant(state, variant.id, warehouse.id) : { onHand: 0, reserved: 0, available: 0 };
    return {
      variant,
      ...stock,
    };
  });
}
