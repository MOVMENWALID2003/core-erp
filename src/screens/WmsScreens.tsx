import {useEffect, useMemo, useRef, useState} from 'react';
import {BarChart3, Boxes, Check, ChevronDown, ClipboardCheck, Download, Eye, PackagePlus, Search, Trash2, Warehouse as WarehouseIcon, X} from 'lucide-react';
import {computeInventoryReports, computeStockForVariant, computeWorkerEfficiency, suggestPickPath, suggestPutawayBin} from '../store';
import {canAccess, verifyCredential} from '../access';
import {readProductImportFile} from '../services/productImport';
import type {AccessAction, AccessResource, AppState, StockOperationStatus, StockOperationType, User} from '../types';

type Props = {
  state: AppState;
  currentUser?: User;
  stats: {inventoryValue: number; totalUnits: number; openOrders: number; reorderAlerts: number};
  can: (resource: AccessResource, action: AccessAction, warehouseId?: string) => boolean;
  globalSearch?: string;
  addWarehouse: (payload: {code: string; name: string; type: string}) => void;
  addBin: (payload: {warehouseId: string; zone: string; aisle: string; rack: string; shelf: string; bin: string; capacityQty: number}) => void;
  addProductVariant: (payload: {productName: string; brand: string; categoryId?: string; unitOfMeasure: string; color: string; size: string; sku: string; barcode: string; cost: number; salesPrice: number; reorderPoint: number; minStock: number; maxStock: number; serialTracked: boolean; lotTracked: boolean}) => void;
  deleteProducts: (productIds: string[]) => void;
  importProducts: (rows: ProductImportRow[]) => void;
  createStockOperation: (payload: {type: StockOperationType; sourceWarehouseId?: string; sourceBinId?: string; destinationWarehouseId?: string; destinationBinId?: string; destinationName?: string; assignedToUserId?: string; lines: Array<{variantId: string; quantity: number; unitCost?: number; lotNumber?: string; expirationDate?: string; serialNumbers?: string[]}>; notes?: string}) => void;
  transitionStockOperation: (operationId: string, status: StockOperationStatus) => void;
  createStocktake: (payload: {warehouseId: string; kind: 'full' | 'cycle' | 'spot'; variantIds?: string[]}) => void;
  setStocktakeLineCount: (lineId: string, quantity: number) => void;
  finaliseStocktake: (sessionId: string) => void;
};

export interface ProductImportRow {
  name: string;
  modelCode: string;
  sku: string;
  category: string;
  avgCost: number;
  initialQty: number;
}

interface ProductImportPreviewRow {
  row: ProductImportRow;
  rowNumber: number;
  errors: string[];
}

const money = (value: number) => `${value.toLocaleString('ar-EG', {maximumFractionDigits: 2})} ج.م`;
const stockTypes: Array<[StockOperationType, string]> = [
  ['receipt', 'استلام وارد'],
  ['delivery', 'تسليم / صرف'],
  ['internal', 'تحويل داخلي'],
];
const statusNames: Record<StockOperationStatus, string> = {
  draft: 'مسودة',
  waiting: 'بانتظار التجهيز',
  ready: 'جاهز',
  done: 'تم التحقق',
  cancelled: 'ملغي',
};

function Panel({title, subtitle, children, className = ''}: {title: string; subtitle?: string; children: React.ReactNode; className?: string}) {
  return <section className={`panel ${className}`}>
    <div className="section-head">
      <div><h3>{title}</h3>{subtitle && <p className="muted">{subtitle}</p>}</div>
    </div>
    {children}
  </section>;
}

function PageTitle({eyebrow, title, description, action}: {eyebrow: string; title: string; description: string; action?: React.ReactNode}) {
  return <div className="page-title">
    <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>
    {action}
  </div>;
}

function stockForWarehouse(state: AppState, variantId: string, warehouseId?: string) {
  const stock = warehouseId
    ? computeStockForVariant(state, variantId, warehouseId)
    : state.warehouses.reduce((total, warehouse) => {
      const balance = computeStockForVariant(state, variantId, warehouse.id);
      return {onHand: total.onHand + balance.onHand, reserved: total.reserved + balance.reserved, available: total.available + balance.available};
    }, {onHand: 0, reserved: 0, available: 0});
  const planned = state.stockOperations
    .filter((operation) => operation.status === 'waiting' || operation.status === 'ready')
    .reduce((total, operation) => {
      operation.lines.filter((line) => line.variantId === variantId).forEach((line) => {
        const destinationMatches = !warehouseId || operation.destinationWarehouseId === warehouseId;
        const sourceMatches = !warehouseId || operation.sourceWarehouseId === warehouseId;
        if (operation.type !== 'delivery' && destinationMatches) total.incoming += line.quantity;
        if (operation.type !== 'receipt' && sourceMatches) total.outgoing += line.quantity;
      });
      return total;
    }, {incoming: 0, outgoing: 0});
  return {...stock, ...planned, forecast: stock.onHand + planned.incoming - planned.outgoing};
}

function stockForBin(state: AppState, binId: string) {
  const movements = state.stockMovements.filter((movement) => movement.binId === binId);
  return movements.reduce((total, movement) => ({
    onHand: total.onHand + movement.qtyOnHand,
    reserved: total.reserved + movement.qtyReserved,
  }), {onHand: 0, reserved: 0});
}

export function Dashboard({state, stats, can}: Props) {
  const recent = state.stockMovements.slice(0, 6);
  const activeOperations = state.stockOperations.filter((operation) => !['done', 'cancelled'].includes(operation.status));
  const dailyActivity = Array.from({length: 7}, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const day = date.toISOString().slice(0, 10);
    return {
      label: date.toLocaleDateString('ar-EG', {weekday: 'short'}),
      count: state.stockMovements.filter((movement) => movement.createdAt.slice(0, 10) === day).length,
    };
  });
  const largestDay = Math.max(1, ...dailyActivity.map((item) => item.count));
  const workerEfficiency = computeWorkerEfficiency(state);

  return <div className="page-content">
    <PageTitle eyebrow="نظرة عامة" title="مركز العمليات" description="ملخص لحظي للمخزون وحركة المستودعات." />
    <div className="stats-grid">
      {can('reports', 'read') && <div className="stat-card"><span>قيمة المخزون</span><strong>{money(stats.inventoryValue)}</strong><small>على أساس متوسط التكلفة</small></div>}
      <div className="stat-card"><span>الوحدات المتاحة</span><strong>{stats.totalUnits.toLocaleString('ar-EG')}</strong><small>في المستودعات المصرح بها</small></div>
      <div className="stat-card"><span>عمليات مفتوحة</span><strong>{activeOperations.length.toLocaleString('ar-EG')}</strong><small>بانتظار التنفيذ أو التحقق</small></div>
      <div className="stat-card warning-card"><span>تنبيهات إعادة الطلب</span><strong>{stats.reorderAlerts.toLocaleString('ar-EG')}</strong><small>أصناف عند الحد الأدنى أو أقل</small></div>
    </div>
    <div className="dashboard-grid">
      <Panel title="حركة المخزون" subtitle="عدد الحركات المسجلة خلال آخر سبعة أيام">
        <div className="activity-chart" role="img" aria-label="حركة المخزون خلال آخر سبعة أيام">
          {dailyActivity.map((day) => <div className="activity-column" key={day.label}>
            <strong>{day.count}</strong><div className="activity-track"><span style={{height: `${Math.max(8, day.count / largestDay * 100)}%`}} /></div><small>{day.label}</small>
          </div>)}
        </div>
      </Panel>
      <Panel title="العمليات المفتوحة" subtitle="استلام، صرف، وتحويل داخلي">
        {activeOperations.length ? <div className="operation-list">
          {activeOperations.slice(0, 5).map((operation) => <div className="operation-list-row" key={operation.id}>
            <span className={`operation-dot ${operation.type}`} />
            <div><strong>{operation.reference}</strong><small>{stockTypes.find(([type]) => type === operation.type)?.[1]}</small></div>
            <span className={`status-pill ${operation.status}`}>{statusNames[operation.status]}</span>
          </div>)}
        </div> : <div className="empty-state">لا توجد عمليات مفتوحة حالياً.</div>}
      </Panel>
    </div>
    <Panel title="كفاءة تنفيذ المشغلين" subtitle="عمليات مكتملة خلال آخر 7 أيام؛ يقاس زمن التنفيذ من بدء التجهيز حتى التحقق.">
      {workerEfficiency.length ? <div className="worker-kpi-grid">{workerEfficiency.map((worker) => {
        const hours = worker.elapsedMs / (60 * 60 * 1000);
        const rate = hours > 0 ? worker.units / hours : undefined;
        return <article className="worker-kpi-card" key={worker.userId}>
          <strong>{worker.name}</strong>
          <span>{worker.operations.toLocaleString('ar-EG')} عملية · {worker.units.toLocaleString('ar-EG')} وحدة</span>
          <small>{rate === undefined ? 'معدل التنفيذ غير متاح بعد' : `${rate.toLocaleString('ar-EG', {maximumFractionDigits: 1})} وحدة/ساعة تنفيذ`}</small>
        </article>;
      })}</div> : <div className="empty-state">عيّن مشغلاً للعمليات لتسجيل وقياس الإنجاز.</div>}
    </Panel>
    <Panel title="آخر الحركات" subtitle="سجل المخزون — الحركات المرحلة فقط">
      <div className="table-wrap"><table className="erp-table">
        <thead><tr><th>المرجع</th><th>الصنف</th><th>الموقع</th><th>نوع الحركة</th><th>الكمية</th><th>التاريخ</th></tr></thead>
        <tbody>{recent.map((movement) => {
          const variant = state.variants.find((item) => item.id === movement.variantId);
          const product = state.products.find((item) => item.id === variant?.productId);
          const warehouse = state.warehouses.find((item) => item.id === movement.warehouseId);
          return <tr key={movement.id}>
            <td>{movement.refId ? state.stockOperations.find((item) => item.id === movement.refId)?.reference ?? movement.id : movement.id}</td>
            <td><strong>{product?.name ?? 'صنف محذوف'}</strong><small className="cell-subtitle">{variant?.sku}</small></td>
            <td>{warehouse?.code ?? '—'}</td><td>{movement.movementType}</td>
            <td className={movement.qtyOnHand < 0 ? 'negative-quantity' : 'positive-quantity'}>{movement.qtyOnHand > 0 ? '+' : ''}{movement.qtyOnHand}</td>
            <td>{new Date(movement.createdAt).toLocaleString('ar-EG')}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </Panel>
  </div>;
}

export function Inventory({state, addProductVariant, deleteProducts, importProducts, globalSearch = '', can}: Props) {
  const [form, setForm] = useState({productName: '', brand: 'CORE', categoryId: '', unitOfMeasure: 'قطعة', color: '', size: '', sku: '', barcode: '', cost: 0, salesPrice: 0, reorderPoint: 0, minStock: 0, maxStock: 0, serialTracked: false, lotTracked: false});
  const [query, setQuery] = useState(globalSearch);
  const [warehouseId, setWarehouseId] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [groupBy, setGroupBy] = useState<'none' | 'category' | 'availability'>('none');
  const [view, setView] = useState<'list' | 'kanban'>('list');
  const [sortKey, setSortKey] = useState<'name' | 'sku' | 'available'>('name');
  const [selected, setSelected] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [importPreview, setImportPreview] = useState<ProductImportPreviewRow[] | null>(null);
  const [importError, setImportError] = useState('');
  const importInput = useRef<HTMLInputElement>(null);
  const canViewValuation = can('reports', 'read');
  const canSetValuation = can('inventory', 'approve');
  const canDeleteProducts = can('inventory', 'delete');
  const canImportProducts = can('inventory', 'create');
  useEffect(() => setQuery(globalSearch), [globalSearch]);
  useEffect(() => {
    const closeDialogs = () => {
      setPendingDelete(null);
      setImportPreview(null);
    };
    window.addEventListener('core-erp:escape', closeDialogs);
    return () => window.removeEventListener('core-erp:escape', closeDialogs);
  }, []);
  useEffect(() => {
    const existingIds = new Set(state.products.map((product) => product.id));
    setSelected((current) => current.filter((productId) => existingIds.has(productId)));
  }, [state.products]);

  const rows = useMemo(() => state.variants.map((variant) => {
    const product = state.products.find((item) => item.id === variant.productId);
    const stock = stockForWarehouse(state, variant.id, warehouseId || undefined);
    const category = state.categories.find((item) => item.id === product?.categoryId);
    const retailPriceList = state.priceLists.find((item) => item.code === 'RETAIL');
    const salesPrice = state.variantPrices.find((item) => item.variantId === variant.id && item.priceListId === retailPriceList?.id)?.price ?? 0;
    const locationTotals = new Map<string, number>();
    state.stockMovements.filter((movement) => movement.variantId === variant.id && (!warehouseId || movement.warehouseId === warehouseId)).forEach((movement) => {
      if (!movement.binId) return;
      locationTotals.set(movement.binId, (locationTotals.get(movement.binId) ?? 0) + movement.qtyOnHand);
    });
    const locationSummary = [...locationTotals.entries()].filter(([, quantity]) => quantity !== 0).slice(0, 2).map(([binId, quantity]) => {
      const bin = state.bins.find((item) => item.id === binId);
      return `${bin?.code ?? 'موقع'}: ${quantity}`;
    }).join(' · ');
    return {variant, name: product?.name ?? '—', category: category?.name ?? 'بدون تصنيف', stock, salesPrice, locationSummary};
  }).filter((row) => {
    const term = query.trim().toLocaleLowerCase();
    const matchesText = !term || `${row.name} ${row.variant.sku} ${row.variant.barcode ?? ''} ${row.category}`.toLocaleLowerCase().includes(term);
    return matchesText && (!lowStockOnly || row.stock.available <= row.variant.reorderPoint);
  }).sort((left, right) => sortKey === 'sku'
    ? left.variant.sku.localeCompare(right.variant.sku)
    : sortKey === 'available' ? left.stock.available - right.stock.available : left.name.localeCompare(right.name)), [state, query, warehouseId, lowStockOnly, sortKey]);
  const groupedRows = useMemo(() => {
    if (groupBy === 'none') return [{name: '', items: rows}];
    const groups = new Map<string, typeof rows>();
    rows.forEach((row) => {
      const label = groupBy === 'category' ? row.category : row.stock.available <= row.variant.reorderPoint ? 'عند حد إعادة الطلب' : 'متوفر';
      groups.set(label, [...(groups.get(label) ?? []), row]);
    });
    return [...groups.entries()].map(([name, items]) => ({name, items}));
  }, [groupBy, rows]);

  const exportSelected = () => {
    const content = [['SKU', 'Product', 'Available'], ...rows.filter(({variant}) => selected.includes(variant.productId)).map(({variant, name, stock}) => [variant.sku, name, String(stock.available)])]
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([content], {type: 'text/csv;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'core-erp-selected-stock.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const visibleProductIds = [...new Set(rows.map(({variant}) => variant.productId))];

  const downloadProductTemplate = () => {
    const content = [
      ['name', 'model_code', 'sku', 'category', 'avg_cost', 'initial_qty'],
      ['قميص قطني', 'MOD-001', 'CORE-COTTON-BLK-M', 'ملابس رجالية', '75', '24'],
    ].map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF', content], {type: 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'core-erp-product-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const parseProductFile = async (file?: File) => {
    if (!file) return;
    setImportError('');
    try {
      const sourceRows = await readProductImportFile(file);
      if (!sourceRows.length) throw new Error('الملف لا يحتوي على صفوف منتجات.');
      const seenSkus = new Set<string>();
      const seenModelNames = new Map<string, string>();
      const previews = sourceRows.map((source, index): ProductImportPreviewRow => {
        const values = new Map(Object.entries(source).map(([key, value]) => [key.replace(/^\uFEFF/, '').trim().toLowerCase(), value]));
        const text = (key: string) => String(values.get(key) ?? '').trim();
        const name = text('name');
        const modelCode = text('model_code');
        const sku = text('sku');
        const effectiveModelCode = modelCode || (sku ? `MOD-${sku}` : '');
        const category = text('category');
        const costText = text('avg_cost');
        const quantityText = text('initial_qty');
        const avgCost = costText ? Number(costText) : 0;
        const initialQty = quantityText ? Number(quantityText) : 0;
        const errors: string[] = [];
        if (!name) errors.push('اسم المنتج مطلوب');
        if (!sku) errors.push('SKU مطلوب');
        if (sku && state.variants.some((variant) => variant.sku.trim().toLocaleLowerCase() === sku.toLocaleLowerCase())) errors.push('SKU مسجل مسبقاً');
        if (sku && seenSkus.has(sku.toLocaleLowerCase())) errors.push('SKU مكرر داخل الملف');
        if (sku) seenSkus.add(sku.toLocaleLowerCase());
        const modelKey = effectiveModelCode.toLocaleLowerCase();
        const previousModelName = seenModelNames.get(modelKey);
        if (previousModelName && previousModelName !== name.toLocaleLowerCase()) errors.push('رمز الموديل مرتبط باسم مختلف في الملف');
        if (effectiveModelCode && !previousModelName) seenModelNames.set(modelKey, name.toLocaleLowerCase());
        const existingModel = state.products.find((product) => product.companyId === state.company.id && product.modelCode.toLocaleLowerCase() === modelKey);
        if (existingModel && existingModel.name.toLocaleLowerCase() !== name.toLocaleLowerCase()) errors.push('رمز الموديل مسجل باسم منتج آخر');
        if (!Number.isFinite(avgCost) || avgCost < 0) errors.push('التكلفة يجب أن تكون رقماً غير سالب');
        if (!Number.isFinite(initialQty) || initialQty < 0) errors.push('الرصيد الافتتاحي يجب أن يكون رقماً غير سالب');
        if (!canSetValuation && avgCost > 0) errors.push('إدخال التكلفة يتطلب صلاحية اعتماد التقييم');
        if (initialQty > 0 && !state.warehouses.length) errors.push('أضف مستودعاً قبل استيراد رصيد افتتاحي');
        const receivingWarehouseId = state.warehouses[0]?.id;
        if (initialQty > 0 && receivingWarehouseId && !can('operations', 'execute', receivingWarehouseId)) errors.push('إدخال الرصيد الافتتاحي يتطلب صلاحية تنفيذ الاستلام');
        return {row: {name, modelCode, sku, category, avgCost, initialQty}, rowNumber: index + 2, errors};
      });
      setImportPreview(previews);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'تعذر قراءة ملف المنتجات.');
    } finally {
      if (importInput.current) importInput.current.value = '';
    }
  };

  const confirmImport = () => {
    if (!importPreview) return;
    const validRows = importPreview.filter(({errors}) => errors.length === 0).map(({row}) => row);
    if (!validRows.length) return;
    importProducts(validRows);
    setImportPreview(null);
  };

  return <div className="page-content">
    <PageTitle eyebrow="الكتالوج والمخزون" title="الأصناف" description="إدارة المنتجات والمتغيرات ومتابعة الأرصدة المتاحة." action={can('inventory', 'create') ? <button className="action-btn primary" onClick={() => document.getElementById('new-product-name')?.focus()}><PackagePlus size={16}/> صنف جديد</button> : undefined} />
    {can('inventory', 'create') && <Panel title="إنشاء صنف / متغير" subtitle="أنشئ بطاقة المنتج وأضف متغيراً بوحدة القياس والباركود وحدود إعادة الطلب.">
      <form className="form-grid product-form" onSubmit={(event) => {event.preventDefault(); addProductVariant(form); setForm({...form, productName: '', sku: '', barcode: ''});}}>
        <label>اسم المنتج<input id="new-product-name" required value={form.productName} onChange={(event) => setForm({...form, productName: event.target.value})} placeholder="مثال: صندوق تخزين" /></label>
        <label>العلامة التجارية<input value={form.brand} onChange={(event) => setForm({...form, brand: event.target.value})} /></label>
        <label>التصنيف<select value={form.categoryId} onChange={(event) => setForm({...form, categoryId: event.target.value})}><option value="">بدون تصنيف</option>{state.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
        <label>وحدة القياس<input required value={form.unitOfMeasure} onChange={(event) => setForm({...form, unitOfMeasure: event.target.value})} /></label>
        <label>المتغير (لون / سمة)<input value={form.color} onChange={(event) => setForm({...form, color: event.target.value})} placeholder="اختياري" /></label>
        <label>المتغير (مقاس / سمة)<input value={form.size} onChange={(event) => setForm({...form, size: event.target.value})} placeholder="اختياري" /></label>
        <label>المرجع الداخلي (SKU)<input required value={form.sku} onChange={(event) => setForm({...form, sku: event.target.value})} /></label>
        <label>الباركود<input value={form.barcode} onChange={(event) => setForm({...form, barcode: event.target.value})} /></label>
        {canSetValuation && <label>تكلفة الوحدة<input type="number" min="0" step="0.01" value={form.cost} onChange={(event) => setForm({...form, cost: Number(event.target.value)})} /></label>}
        {canSetValuation && <label>سعر البيع<input type="number" min="0" step="0.01" value={form.salesPrice} onChange={(event) => setForm({...form, salesPrice: Number(event.target.value)})} /></label>}
        <label>حد إعادة الطلب<input type="number" min="0" value={form.reorderPoint} onChange={(event) => setForm({...form, reorderPoint: Number(event.target.value)})} /></label>
        <label>الحد الأدنى<input type="number" min="0" value={form.minStock} onChange={(event) => setForm({...form, minStock: Number(event.target.value)})} /></label>
        <label>الحد الأقصى<input type="number" min="0" value={form.maxStock} onChange={(event) => setForm({...form, maxStock: Number(event.target.value)})} /></label>
        <label className="checkbox-field"><input type="checkbox" checked={form.lotTracked} onChange={(event) => setForm({...form, lotTracked: event.target.checked})}/> تتبع أرقام التشغيلات والصلاحية</label>
        <label className="checkbox-field"><input type="checkbox" checked={form.serialTracked} onChange={(event) => setForm({...form, serialTracked: event.target.checked})}/> تتبع الأرقام التسلسلية</label>
        <button className="action-btn primary" type="submit">حفظ الصنف</button>
      </form>
    </Panel>}
    <Panel title="الأصناف والأرصدة" subtitle={`${rows.length} متغير في السجل`}>
      <div className="inventory-toolbar">
        <label className="search-field"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث بالاسم أو SKU أو الباركود" /></label>
        <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} aria-label="تصفية حسب المستودع"><option value="">كل المستودعات</option>{state.warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}</select>
        <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as typeof groupBy)} aria-label="تجميع حسب"><option value="none">بدون تجميع</option><option value="category">تجميع حسب الفئة</option><option value="availability">تجميع حسب التوفر</option></select>
        <label className="filter-toggle"><input type="checkbox" checked={lowStockOnly} onChange={(event) => setLowStockOnly(event.target.checked)}/> أقل من حد الطلب</label>
        <div className="view-switch"><button className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}>قائمة</button><button className={view === 'kanban' ? 'selected' : ''} onClick={() => setView('kanban')}>بطاقات</button></div>
        <button type="button" className="action-btn" onClick={downloadProductTemplate}><Download size={15}/> تحميل قالب المنتجات (Template)</button>
        {canImportProducts && <>
          <input ref={importInput} className="visually-hidden" type="file" tabIndex={-1} accept=".csv,.xlsx" aria-label="اختيار ملف منتجات للاستيراد" onChange={(event) => void parseProductFile(event.target.files?.[0])}/>
          <button type="button" className="action-btn" onClick={() => importInput.current?.click()}><PackagePlus size={15}/> استيراد ملف منتجات (Bulk Import)</button>
        </>}
      </div>
      {importError && <div className="system-banner error" role="alert">{importError}</div>}
      {selected.length > 0 && <div className="bulk-toolbar"><span>تم تحديد {selected.length} منتج</span><button className="action-btn" onClick={exportSelected}><Download size={15}/> تصدير المحدد</button>{canDeleteProducts && <button className="action-btn danger-action" onClick={() => setPendingDelete(selected)}><Trash2 size={15}/> حذف المحدد ({selected.length})</button>}<button className="text-button" onClick={() => setSelected([])}>إلغاء التحديد</button></div>}
      {view === 'list' ? <div className="table-wrap"><table className="erp-table">
        <thead><tr><th><input type="checkbox" aria-label="تحديد جميع المنتجات الظاهرة" checked={visibleProductIds.length > 0 && visibleProductIds.every((id) => selected.includes(id))} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, ...visibleProductIds])] : current.filter((id) => !visibleProductIds.includes(id)))}/></th><th><button className="sort-button" onClick={() => setSortKey('sku')}>المرجع الداخلي <ChevronDown size={13}/></button></th><th><button className="sort-button" onClick={() => setSortKey('name')}>الصنف <ChevronDown size={13}/></button></th><th>التصنيف</th><th>الموقع</th><th>الفعلي</th><th>المحجوز</th><th><button className="sort-button" onClick={() => setSortKey('available')}>المتاح <ChevronDown size={13}/></button></th><th>وارد</th><th>صادر</th><th>متوقع</th>{canViewValuation && <><th>التكلفة</th><th>سعر البيع</th></>}<th>الحالة</th>{canDeleteProducts && <th>إجراءات</th>}</tr></thead>
        <tbody>{groupedRows.flatMap((group) => [
          ...(groupBy === 'none' ? [] : [<tr className="group-row" key={`group-${group.name}`}><td colSpan={(canViewValuation ? 14 : 12) + (canDeleteProducts ? 1 : 0)}>{group.name}<span>{group.items.length} صنف</span></td></tr>]),
          ...group.items.map(({variant, name, category, stock, salesPrice, locationSummary}) => <tr key={variant.id}>
          <td><input type="checkbox" aria-label={`تحديد ${name}`} checked={selected.includes(variant.productId)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, variant.productId])] : current.filter((id) => id !== variant.productId))}/></td>
          <td className="mono">{variant.sku}</td><td><strong>{name}</strong><small className="cell-subtitle">{[variant.color, variant.size].filter(Boolean).join(' · ') || 'متغير افتراضي'}</small></td><td>{category}</td>
          <td>{locationSummary || (warehouseId ? state.warehouses.find((warehouse) => warehouse.id === warehouseId)?.code : `${state.warehouses.length} مستودع`)}</td>
          <td>{stock.onHand}</td><td>{stock.reserved}</td><td><strong>{stock.available}</strong></td><td className="positive-quantity">{stock.incoming || '—'}</td><td className="negative-quantity">{stock.outgoing || '—'}</td><td>{stock.forecast}</td>{canViewValuation && <><td>{money(variant.avgCost)}</td><td>{money(salesPrice)}</td></>}
          <td><span className={`status-pill ${stock.available <= variant.reorderPoint ? 'waiting' : 'done'}`}>{stock.available <= variant.reorderPoint ? 'إعادة الطلب' : 'متوفر'}</span></td>{canDeleteProducts && <td><button type="button" className="icon-btn danger-icon" aria-label={`حذف ${name}`} title="حذف المنتج" onClick={() => setPendingDelete([variant.productId])}><Trash2 size={15}/></button></td>}
        </tr>),
        ])}</tbody>
      </table>{rows.length === 0 && <div className="empty-state">لا توجد أصناف تطابق عوامل التصفية.</div>}</div>
      : <div className="product-card-grid">{rows.map(({variant, name, category, stock, salesPrice}) => <article className="product-card" key={variant.id}>
        <div className="product-card-icon"><Boxes size={20}/></div><div className="product-card-title"><strong>{name}</strong><span>{variant.sku}</span></div>
        <span className={`status-pill ${stock.available <= variant.reorderPoint ? 'waiting' : 'done'}`}>{stock.available <= variant.reorderPoint ? 'إعادة الطلب' : 'متوفر'}</span>
        <div className="product-card-meta"><span>المتاح <b>{stock.available}</b></span><span>الفعلي <b>{stock.onHand}</b></span><span>وارد <b>{stock.incoming || '—'}</b></span><span>صادر <b>{stock.outgoing || '—'}</b></span><span>متوقع <b>{stock.forecast}</b></span>{canViewValuation && <><span>التكلفة <b>{money(variant.avgCost)}</b></span><span>سعر البيع <b>{money(salesPrice)}</b></span></>}<span>{category}</span></div>
      </article>)}</div>}
    </Panel>
    {pendingDelete && <div className="product-dialog-backdrop" onMouseDown={(event) => {if (event.target === event.currentTarget) setPendingDelete(null);}}>
      <section className="product-dialog" role="alertdialog" aria-modal="true" aria-labelledby="product-delete-title" aria-describedby="product-delete-message" dir="rtl">
        <div className="product-dialog-icon danger"><X size={21}/></div>
        <h3 id="product-delete-title">تحذير حذف منتجات</h3>
        <p id="product-delete-message">هل أنت متأكد من رغبتك في حذف المنتجات المحددة؟ لا يمكن التراجع عن هذا الإجراء وقد يؤثر على سجلات حركة المخزون المرتبطة.</p>
        <div className="product-dialog-actions"><button type="button" className="action-btn" onClick={() => setPendingDelete(null)}>إلغاء</button><button type="button" className="action-btn danger-action" onClick={() => {deleteProducts(pendingDelete); setPendingDelete(null);}}>تأكيد الحذف</button></div>
      </section>
    </div>}
    {importPreview && <div className="product-dialog-backdrop" onMouseDown={(event) => {if (event.target === event.currentTarget) setImportPreview(null);}}>
      <section className="product-dialog product-import-dialog" role="dialog" aria-modal="true" aria-labelledby="product-import-title" dir="rtl">
        <div className="product-dialog-heading"><div><h3 id="product-import-title">معاينة استيراد المنتجات</h3><p className="muted">راجع البيانات قبل إضافتها إلى قاعدة البيانات المحلية.</p></div><button type="button" className="icon-btn" aria-label="إغلاق" onClick={() => setImportPreview(null)}><X size={16}/></button></div>
        <div className="import-summary"><span>إجمالي الصفوف: {importPreview.length}</span><span className="import-valid">صالحة: {importPreview.filter(({errors}) => !errors.length).length}</span><span className="import-invalid">تحتاج مراجعة: {importPreview.filter(({errors}) => errors.length > 0).length}</span></div>
        <div className="table-wrap import-preview-table"><table className="erp-table"><thead><tr><th>الصف</th><th>اسم المنتج</th><th>Model Code</th><th>SKU</th><th>التصنيف</th><th>التكلفة</th><th>الرصيد الافتتاحي</th><th>التحقق</th></tr></thead><tbody>
          {importPreview.map(({row, rowNumber, errors}) => <tr key={rowNumber}><td>{rowNumber}</td><td>{row.name || '—'}</td><td>{row.modelCode || '—'}</td><td className="mono">{row.sku || '—'}</td><td>{row.category || '—'}</td><td>{Number.isFinite(row.avgCost) ? row.avgCost : '—'}</td><td>{Number.isFinite(row.initialQty) ? row.initialQty : '—'}</td><td>{errors.length ? <span className="import-invalid">{errors.join('، ')}</span> : <span className="import-valid">جاهز للاستيراد</span>}</td></tr>)}
        </tbody></table></div>
        <div className="product-dialog-actions"><button type="button" className="action-btn" onClick={() => setImportPreview(null)}>إلغاء</button><button type="button" className="action-btn primary" disabled={!importPreview.some(({errors}) => errors.length === 0)} onClick={confirmImport}>استيراد {importPreview.filter(({errors}) => errors.length === 0).length} منتج</button></div>
      </section>
    </div>}
  </div>;
}

export function Locations({state, addWarehouse, addBin, can}: Props) {
  const [warehouseForm, setWarehouseForm] = useState({code: '', name: '', type: 'main'});
  const [binForm, setBinForm] = useState({warehouseId: state.warehouses[0]?.id ?? '', zone: '', aisle: '', rack: '', shelf: '', bin: '', capacityQty: 0});
  const locations = useMemo(() => state.warehouses.map((warehouse) => ({
    warehouse,
    bins: state.bins.filter((bin) => bin.warehouseId === warehouse.id),
    units: state.variants.reduce((total, variant) => total + computeStockForVariant(state, variant.id, warehouse.id).onHand, 0),
  })), [state]);

  return <div className="page-content">
    <PageTitle eyebrow="إعداد المستودعات" title="المستودعات والمواقع" description="إدارة المواقع الداخلية وتقسيمات الرفوف والخانات." action={<span className="subtle-count"><WarehouseIcon size={16}/> {state.warehouses.length} مستودعات</span>} />
    <div className="dashboard-grid">
      {can('locations', 'create') && <Panel title="إنشاء مستودع" subtitle="أضف مستودعاً أو موقع عبور جديداً.">
        <form className="form-grid" onSubmit={(event) => {event.preventDefault(); addWarehouse(warehouseForm); setWarehouseForm({code: '', name: '', type: 'main'});}}>
          <label>رمز المستودع<input required value={warehouseForm.code} onChange={(event) => setWarehouseForm({...warehouseForm, code: event.target.value})} placeholder="WH-04"/></label>
          <label>اسم المستودع<input required value={warehouseForm.name} onChange={(event) => setWarehouseForm({...warehouseForm, name: event.target.value})} placeholder="المستودع الرئيسي"/></label>
          <label>نوع الموقع<select value={warehouseForm.type} onChange={(event) => setWarehouseForm({...warehouseForm, type: event.target.value})}><option value="main">رئيسي</option><option value="sub">فرعي</option><option value="transit">مخزون عبور</option><option value="damaged">تالف / حجر</option><option value="showroom">تخزين داخلي</option><option value="3pl">مستودع طرف ثالث</option><option value="office">افتراضي</option></select></label>
          <button type="submit" className="action-btn primary">حفظ المستودع</button>
        </form>
      </Panel>}
      {can('locations', 'create', binForm.warehouseId) && <Panel title="إضافة خانة تخزين" subtitle="حدد مستودعاً ثم أدخل المسار الهرمي للموقع.">
        <form className="form-grid" onSubmit={(event) => {event.preventDefault(); addBin(binForm);}}>
          <label>المستودع<select required value={binForm.warehouseId} onChange={(event) => setBinForm({...binForm, warehouseId: event.target.value})}>{state.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}</select></label>
          <label>منطقة<input required value={binForm.zone} onChange={(event) => setBinForm({...binForm, zone: event.target.value})} placeholder="Z01"/></label>
          <label>ممر<input required value={binForm.aisle} onChange={(event) => setBinForm({...binForm, aisle: event.target.value})} placeholder="A01"/></label>
          <label>رف<input required value={binForm.rack} onChange={(event) => setBinForm({...binForm, rack: event.target.value})} placeholder="R01"/></label>
          <label>طبقة<input required value={binForm.shelf} onChange={(event) => setBinForm({...binForm, shelf: event.target.value})} placeholder="S01"/></label>
          <label>خانة<input required value={binForm.bin} onChange={(event) => setBinForm({...binForm, bin: event.target.value})} placeholder="B01"/></label>
          <label>السعة<input type="number" min="0" value={binForm.capacityQty} onChange={(event) => setBinForm({...binForm, capacityQty: Number(event.target.value)})}/></label>
          <button type="submit" className="action-btn primary">حفظ الموقع</button>
        </form>
      </Panel>}
    </div>
    <div className="warehouse-card-grid">{locations.map(({warehouse, bins, units}) => <article className="warehouse-card" key={warehouse.id}>
      <div className="warehouse-card-head"><span className="warehouse-icon"><WarehouseIcon size={20}/></span><span className={`status-pill ${warehouse.status === 'active' ? 'done' : 'cancelled'}`}>{warehouse.status === 'active' ? 'نشط' : warehouse.status}</span></div>
      <h3>{warehouse.name}</h3><span className="mono">{warehouse.code}</span><div className="warehouse-card-metrics"><span><strong>{units.toLocaleString('ar-EG')}</strong> وحدة</span><span><strong>{bins.length}</strong> مواقع</span></div>
      <div className="bin-list">{bins.length ? bins.slice(0, 4).map((bin) => {
        const stock = stockForBin(state, bin.id);
        return <div key={bin.id}><span>{bin.code}<small>{stock.onHand} وحدة</small></span><small>سعة {bin.capacityQty}</small></div>;
      }) : <small>لا توجد خانات معرفة</small>}</div>
    </article>)}</div>
  </div>;
}

export function Operations({state, createStockOperation, transitionStockOperation, can, currentUser}: Props) {
  const firstWarehouseId = state.warehouses[0]?.id ?? '';
  const firstBinId = state.bins.find((bin) => bin.warehouseId === firstWarehouseId)?.id ?? '';
  const [form, setForm] = useState({type: 'receipt' as StockOperationType, sourceWarehouseId: firstWarehouseId, sourceBinId: firstBinId, destinationWarehouseId: firstWarehouseId, destinationBinId: firstBinId, destinationName: '', assignedToUserId: state.users.find((user) => user.active)?.id ?? '', variantId: state.variants[0]?.id ?? '', quantity: 1, unitCost: state.variants[0]?.avgCost ?? 0, lotNumber: '', expirationDate: '', serialNumbers: '', notes: ''});
  const [draftLines, setDraftLines] = useState<Array<{variantId: string; quantity: number; unitCost?: number; lotNumber?: string; expirationDate?: string; serialNumbers?: string[]}>>([]);
  const [view, setView] = useState<'list' | 'kanban'>('kanban');
  const [filter, setFilter] = useState<StockOperationType | 'all'>('all');
  const [scanCode, setScanCode] = useState('');
  const [scanPin, setScanPin] = useState('');
  const [scanFeedback, setScanFeedback] = useState('');
  const operations = state.stockOperations.filter((operation) => filter === 'all' || operation.type === filter);
  const needsSource = form.type !== 'receipt';
  const canCreateOperation = can('operations', 'create', needsSource ? form.sourceWarehouseId : form.destinationWarehouseId)
    && (form.type === 'delivery' || can('operations', 'create', form.destinationWarehouseId));
  const selectedVariant = state.variants.find((variant) => variant.id === form.variantId);
  const sourceBins = state.bins.filter((bin) => bin.warehouseId === form.sourceWarehouseId && bin.status === 'active');
  const destinationBins = state.bins.filter((bin) => bin.warehouseId === form.destinationWarehouseId && bin.status === 'active');
  useEffect(() => setDraftLines([]), [state.stockOperations.length]);
  useEffect(() => {
    if (form.type === 'delivery') return;
    const suggestion = suggestPutawayBin(
      state,
      form.variantId,
      form.destinationWarehouseId,
      form.quantity,
      form.type === 'internal' && form.sourceWarehouseId === form.destinationWarehouseId ? form.sourceBinId : undefined,
    );
    setForm((current) => current.destinationBinId === (suggestion?.id ?? '') ? current : {...current, destinationBinId: suggestion?.id ?? ''});
  }, [state, form.type, form.variantId, form.sourceWarehouseId, form.sourceBinId, form.destinationWarehouseId, form.quantity]);

  const changeType = (type: StockOperationType) => setForm((current) => {
    const otherWarehouse = state.warehouses.find((warehouse) => warehouse.id !== current.sourceWarehouseId);
    const destinationWarehouseId = type === 'internal' && current.destinationWarehouseId === current.sourceWarehouseId
      ? otherWarehouse?.id ?? current.destinationWarehouseId
      : current.destinationWarehouseId;
    return {
      ...current,
      type,
      sourceBinId: type === 'delivery' ? '' : current.sourceBinId || firstBinId,
      destinationWarehouseId,
      destinationBinId: destinationWarehouseId === current.destinationWarehouseId
        ? current.destinationBinId
        : state.bins.find((bin) => bin.warehouseId === destinationWarehouseId)?.id ?? '',
    };
  });
  const scanItem = (value: string) => {
    const code = value.trim();
    if (!code) return;
    const matchedVariant = state.variants.find((variant) => variant.active
        && (variant.barcode?.trim().toLocaleLowerCase() === code.toLocaleLowerCase()
          || variant.sku.toLocaleLowerCase() === code.toLocaleLowerCase()));
    if (matchedVariant) {
        setForm((current) => ({
          ...current,
          variantId: matchedVariant.id,
          quantity: matchedVariant.serialTracked ? 0 : current.variantId === matchedVariant.id ? current.quantity + 1 : 1,
          unitCost: matchedVariant.avgCost,
          serialNumbers: matchedVariant.serialTracked ? '' : current.serialNumbers,
        }));
        setScanFeedback(`تم التعرف على ${matchedVariant.sku}`);
        setScanCode('');
        return;
    }

    const serialVariant = state.variants.find((variant) => variant.active && variant.serialTracked
        && state.stockMovements.some((movement) => movement.variantId === variant.id && (movement.serialNumbers ?? []).includes(code)));
    const targetVariant = serialVariant ?? selectedVariant;
    if (targetVariant?.serialTracked) {
        const serials = form.serialNumbers.split(/[\s,،]+/).filter(Boolean);
        if (serials.includes(code)) {
          setScanFeedback('تم مسح هذا الرقم التسلسلي مسبقاً');
        } else {
          setForm((current) => ({...current, variantId: targetVariant.id, serialNumbers: [...serials, code].join(', '), quantity: serials.length + 1}));
          setScanFeedback(`تمت إضافة الرقم التسلسلي للصنف ${targetVariant.sku}`);
        }
        setScanCode('');
        return;
    }
    setScanFeedback('لم يتم العثور على صنف بهذا الباركود أو SKU');
  };
  const scanWithPin = async (value: string) => {
    if (currentUser?.pinHash) {
      try {
        if (!await verifyCredential(scanPin, currentUser.pinHash)) {
          setScanFeedback('رقم PIN غير صحيح؛ لم تتم إضافة الصنف.');
          return;
        }
      } catch (error) {
        setScanFeedback(error instanceof Error ? error.message : 'تعذر التحقق من رقم PIN.');
        return;
      }
      setScanPin('');
    }
    scanItem(value);
  };
  const scannedSerials = form.serialNumbers.split(/[\s,،]+/).filter(Boolean);
  const pickPath = form.type === 'delivery'
    ? suggestPickPath(state, form.variantId, form.sourceWarehouseId, form.quantity, scannedSerials, form.sourceBinId || undefined)
    : [];
  const putawaySuggestion = form.type !== 'delivery'
    ? suggestPutawayBin(state, form.variantId, form.destinationWarehouseId, form.quantity,
        form.type === 'internal' && form.sourceWarehouseId === form.destinationWarehouseId ? form.sourceBinId : undefined)
    : undefined;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    createStockOperation({
      type: form.type,
      sourceWarehouseId: needsSource ? form.sourceWarehouseId : undefined,
      sourceBinId: needsSource ? form.sourceBinId || undefined : undefined,
      destinationWarehouseId: form.type === 'delivery' ? undefined : form.destinationWarehouseId,
      destinationBinId: form.type === 'delivery' ? undefined : form.destinationBinId || undefined,
      destinationName: form.type === 'delivery' ? form.destinationName : undefined,
      assignedToUserId: form.assignedToUserId || undefined,
      lines: draftLines.length ? draftLines : [{
        variantId: form.variantId,
        quantity: form.quantity,
        unitCost: form.type === 'receipt' ? form.unitCost : undefined,
        lotNumber: form.lotNumber,
        expirationDate: form.expirationDate,
        serialNumbers: form.serialNumbers.split(/[\s,،]+/).filter(Boolean),
      }],
      notes: form.notes,
    });
  };
  const addDraftLine = () => {
    setDraftLines((lines) => [...lines, {
      variantId: form.variantId,
      quantity: form.quantity,
      unitCost: form.type === 'receipt' ? form.unitCost : undefined,
      lotNumber: form.lotNumber,
      expirationDate: form.expirationDate,
      serialNumbers: form.serialNumbers.split(/[\s,،]+/).filter(Boolean),
    }]);
    setForm((current) => ({...current, quantity: selectedVariant?.serialTracked ? 0 : 1, lotNumber: '', expirationDate: '', serialNumbers: ''}));
  };
  const describeLocation = (warehouseId?: string, binId?: string) => {
    const warehouse = state.warehouses.find((item) => item.id === warehouseId);
    const bin = state.bins.find((item) => item.id === binId);
    return [warehouse?.code, bin?.code].filter(Boolean).join(' · ') || '—';
  };
  const describeSource = (operation: AppState['stockOperations'][number]) => {
    if (operation.type !== 'delivery') return describeLocation(operation.sourceWarehouseId, operation.sourceBinId);
    const pickedBins = [...new Set(operation.lines.flatMap((line) => line.pickAllocations?.map((pick) => pick.binId) ?? []))];
    return pickedBins.length
      ? `${state.warehouses.find((warehouse) => warehouse.id === operation.sourceWarehouseId)?.code ?? '—'} · ${pickedBins.map((binId) => state.bins.find((bin) => bin.id === binId)?.code ?? '—').join(' → ')}`
      : describeLocation(operation.sourceWarehouseId, operation.sourceBinId);
  };
  const actionFor = (operation: AppState['stockOperations'][number]) => {
    const canExecute = can('operations', 'execute', operation.sourceWarehouseId ?? operation.destinationWarehouseId)
      && (!operation.destinationWarehouseId || can('operations', 'execute', operation.destinationWarehouseId));
    const receiptApprovalRequired = operation.type === 'receipt' && operation.status === 'ready'
      && !can('operations', 'approve', operation.destinationWarehouseId);
    const advance = !canExecute || receiptApprovalRequired ? null : operation.status === 'draft'
      ? <button className="action-btn small-action" onClick={() => transitionStockOperation(operation.id, 'waiting')}>تأكيد العملية</button>
      : operation.status === 'waiting'
        ? <button className="action-btn small-action" onClick={() => transitionStockOperation(operation.id, 'ready')}>تجهيز</button>
        : operation.status === 'ready'
          ? <button className="action-btn primary small-action" onClick={() => transitionStockOperation(operation.id, 'done')}><Check size={14}/> تحقق</button>
          : null;
    return <div className="operation-actions">{advance}{receiptApprovalRequired && <small className="muted">بانتظار اعتماد المدير</small>}{canExecute && !['done', 'cancelled'].includes(operation.status) && <button className="text-button" onClick={() => transitionStockOperation(operation.id, 'cancelled')}>إلغاء</button>}</div>;
  };

  return <div className="page-content">
    <PageTitle eyebrow="حركات المخزون" title="العمليات المخزنية" description="أنشئ إيصالات الاستلام وعمليات الصرف والتحويل، ثم راجعها قبل ترحيل الأرصدة." />
    {canCreateOperation && <Panel title="عملية جديدة" subtitle="تُسجّل العملية كمسودة. التحقق النهائي يرحّل الحركة إلى دفتر المخزون.">
      <form className="form-grid operation-form" onSubmit={submit}>
        <label>نوع العملية<select value={form.type} onChange={(event) => changeType(event.target.value as StockOperationType)}>{stockTypes.map(([type, label]) => <option value={type} key={type}>{label}</option>)}</select></label>
        <label className="wide-field">مسح باركود / SKU / رقم تسلسلي<input autoComplete="off" value={scanCode} onChange={(event) => {setScanCode(event.target.value); setScanFeedback('');}} onKeyDown={(event) => {if (event.key === 'Enter') {event.preventDefault(); void scanWithPin(scanCode);}}} placeholder="استخدم قارئ الباركود أو أدخل الرمز ثم Enter"/></label>
        {currentUser?.pinHash && <label className="wide-field">PIN المسح الأمني<input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={scanPin} onChange={(event) => setScanPin(event.target.value.replace(/\D/g, ''))} placeholder="أدخل PIN قبل مسح الصنف"/></label>}
        {scanFeedback && <small className="muted wide-field" role="status">{scanFeedback}</small>}
        {needsSource && <label>مستودع المصدر<select required value={form.sourceWarehouseId} onChange={(event) => {
          const sourceWarehouseId = event.target.value;
          const destinationWarehouseId = form.type === 'internal' && form.destinationWarehouseId === sourceWarehouseId
            ? state.warehouses.find((warehouse) => warehouse.id !== sourceWarehouseId)?.id ?? ''
            : form.destinationWarehouseId;
          setForm({
            ...form,
            sourceWarehouseId,
            sourceBinId: state.bins.find((bin) => bin.warehouseId === sourceWarehouseId)?.id ?? '',
            destinationWarehouseId,
            destinationBinId: destinationWarehouseId === form.destinationWarehouseId ? form.destinationBinId : state.bins.find((bin) => bin.warehouseId === destinationWarehouseId)?.id ?? '',
          });
        }}>{state.warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}</select></label>}
        {needsSource && sourceBins.length > 0 && <label>موقع المصدر<select value={form.sourceBinId} onChange={(event) => setForm({...form, sourceBinId: event.target.value})}><option value="">أي خانة بالمستودع</option>{sourceBins.map((bin) => <option value={bin.id} key={bin.id}>{bin.code}</option>)}</select></label>}
        {form.type === 'delivery' && <div className="pick-path-preview wide-field">
          <strong>مسار الالتقاط المقترح (FEFO ثم أقصر مسار مواقع)</strong>
          {pickPath.length ? <ol>{pickPath.map((pick) => <li key={`${pick.binId}-${pick.lotNumber ?? ''}`}><span>{state.bins.find((bin) => bin.id === pick.binId)?.code ?? 'موقع غير معروف'}</span><b>{pick.quantity}</b>{pick.lotNumber && <small>تشغيلة {pick.lotNumber}{pick.expirationDate ? ` · تنتهي ${pick.expirationDate}` : ''}</small>}</li>)}</ol> : <small>لا يوجد رصيد متاح لهذا الصنف في المستودع المحدد.</small>}
          {pickPath.reduce((sum, pick) => sum + pick.quantity, 0) < form.quantity && <small className="negative-quantity">المسار المقترح يغطي {pickPath.reduce((sum, pick) => sum + pick.quantity, 0)} من {form.quantity} وحدة فقط.</small>}
        </div>}
        {form.type === 'delivery'
          ? <label>العميل / المستلم<input value={form.destinationName} onChange={(event) => setForm({...form, destinationName: event.target.value})} placeholder="اسم العميل أو الجهة المستلمة"/></label>
          : <label>مستودع الوجهة<select required value={form.destinationWarehouseId} onChange={(event) => setForm({...form, destinationWarehouseId: event.target.value, destinationBinId: state.bins.find((bin) => bin.warehouseId === event.target.value)?.id ?? ''})}>{state.warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}</select></label>}
        {form.type !== 'delivery' && destinationBins.length > 0 && <><label>موقع الوجهة<select value={form.destinationBinId} onChange={(event) => setForm({...form, destinationBinId: event.target.value})}><option value="">أي خانة بالمستودع</option>{destinationBins.map((bin) => <option value={bin.id} key={bin.id}>{bin.code} · سعة {bin.capacityQty}</option>)}</select></label><small className="muted">{putawaySuggestion ? `اقتراح التخزين: ${putawaySuggestion.code}` : 'لا توجد خانة نشطة تتسع للكمية المطلوبة.'}</small></>}
        <label>الصنف<select required value={form.variantId} onChange={(event) => {const variant = state.variants.find((item) => item.id === event.target.value); setForm({...form, variantId: event.target.value, unitCost: variant?.avgCost ?? 0, quantity: variant?.serialTracked ? 0 : form.quantity, serialNumbers: ''});}}>{state.variants.map((variant) => <option value={variant.id} key={variant.id}>{variant.sku} — {state.products.find((product) => product.id === variant.productId)?.name}</option>)}</select></label>
        <label>الكمية<input type="number" min={selectedVariant?.serialTracked ? '0' : '1'} step="1" required value={form.quantity} onChange={(event) => setForm({...form, quantity: Number(event.target.value)})}/></label>
        {form.type === 'receipt' && can('operations', 'approve', form.destinationWarehouseId) && <label>تكلفة الوحدة<input type="number" min="0" step="0.01" value={form.unitCost} onChange={(event) => setForm({...form, unitCost: Number(event.target.value)})}/></label>}
        {selectedVariant?.lotTracked && form.type !== 'delivery' && <label>رقم التشغيلة<input required value={form.lotNumber} onChange={(event) => setForm({...form, lotNumber: event.target.value})}/></label>}
        {selectedVariant?.lotTracked && form.type !== 'delivery' && <label>تاريخ الصلاحية<input type="date" value={form.expirationDate} onChange={(event) => setForm({...form, expirationDate: event.target.value})}/></label>}
        {selectedVariant?.serialTracked && <label className="wide-field">الأرقام التسلسلية<input required value={form.serialNumbers} onChange={(event) => {const serialNumbers = event.target.value; setForm({...form, serialNumbers, quantity: serialNumbers.split(/[\s,،]+/).filter(Boolean).length});}} placeholder="امسح أو أدخل رقماً فريداً لكل وحدة"/></label>}
        <label>المشغل المسؤول<select value={form.assignedToUserId} onChange={(event) => setForm({...form, assignedToUserId: event.target.value})}><option value="">غير معين</option>{state.users.filter((user) => canAccess(state, user, 'operations', 'execute', needsSource ? form.sourceWarehouseId : form.destinationWarehouseId)).map((user) => <option value={user.id} key={user.id}>{user.fullName}</option>)}</select></label>
        <label className="wide-field">ملاحظات<input value={form.notes} onChange={(event) => setForm({...form, notes: event.target.value})} placeholder="رقم مستند المورد أو سبب الحركة"/></label>
        <div className="draft-line-tools wide-field">
          <button type="button" className="action-btn" onClick={addDraftLine}>إضافة سطر للصنف</button>
          {draftLines.map((line, index) => <div className="draft-line-chip" key={`${line.variantId}-${index}`}>
            <span>{state.variants.find((variant) => variant.id === line.variantId)?.sku} × {line.quantity}</span>
            <button type="button" aria-label="حذف السطر" onClick={() => setDraftLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}><Trash2 size={13}/></button>
          </div>)}
          <small className="muted">{draftLines.length ? 'ستتضمن المسودة الأسطر المضافة أعلاه.' : 'يمكنك إضافة أكثر من صنف إلى العملية.'}</small>
        </div>
        <button type="submit" className="action-btn primary">إنشاء مسودة</button>
      </form>
    </Panel>}
    <Panel title="سير العمليات" subtitle={`${operations.length} عملية${operations.length === 1 ? '' : 'ات'} مسجلة`}>
      <div className="inventory-toolbar"><select value={filter} onChange={(event) => setFilter(event.target.value as StockOperationType | 'all')} aria-label="تصفية نوع العملية"><option value="all">جميع الأنواع</option>{stockTypes.map(([type, label]) => <option value={type} key={type}>{label}</option>)}</select><div className="view-switch"><button className={view === 'kanban' ? 'selected' : ''} onClick={() => setView('kanban')}>مراحل</button><button className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}>قائمة</button></div></div>
      {view === 'kanban' ? <div className="kanban-board">{(['draft', 'waiting', 'ready', 'done', 'cancelled'] as StockOperationStatus[]).map((status) => {
        const items = operations.filter((operation) => operation.status === status);
        return <section className="kanban-column" key={status}><header><span>{statusNames[status]}</span><b>{items.length}</b></header>
          {items.map((operation) => <article className="operation-card" key={operation.id}>
            <div className="operation-card-top"><strong>{operation.reference}</strong><span className={`operation-dot ${operation.type}`}/></div>
            <small>{stockTypes.find(([type]) => type === operation.type)?.[1]}</small>
            {operation.lines.map((line) => <div className="operation-line" key={line.variantId}><span>{state.variants.find((variant) => variant.id === line.variantId)?.sku}</span><b>{line.quantity}</b></div>)}
            <small>{operation.type === 'receipt' ? 'من مورد' : describeSource(operation)} → {operation.type === 'delivery' ? operation.destinationName ?? 'العميل' : describeLocation(operation.destinationWarehouseId, operation.destinationBinId)}</small>
            {operation.assignedToUserId && <small>المشغل: {state.users.find((user) => user.id === operation.assignedToUserId)?.fullName ?? '—'}</small>}
            {actionFor(operation)}
          </article>)}
          {!items.length && <div className="kanban-empty">لا توجد عمليات</div>}
        </section>;
      })}</div> : <div className="table-wrap"><table className="erp-table"><thead><tr><th>المرجع</th><th>النوع</th><th>المصدر</th><th>الوجهة</th><th>الأصناف</th><th>المشغل</th><th>الحالة</th><th>الإجراء</th></tr></thead>
        <tbody>{operations.map((operation) => <tr key={operation.id}><td className="mono">{operation.reference}</td><td>{stockTypes.find(([type]) => type === operation.type)?.[1]}</td><td>{operation.type === 'receipt' ? 'مورد' : describeSource(operation)}</td><td>{operation.type === 'delivery' ? operation.destinationName ?? 'العميل' : describeLocation(operation.destinationWarehouseId, operation.destinationBinId)}</td><td>{operation.lines.length}</td><td>{state.users.find((user) => user.id === operation.assignedToUserId)?.fullName ?? '—'}</td><td><span className={`status-pill ${operation.status}`}>{statusNames[operation.status]}</span></td><td>{actionFor(operation)}</td></tr>)}</tbody>
      </table></div>}
      {operations.some((operation) => operation.status === 'cancelled') && <p className="muted">العمليات الملغاة محفوظة في سجل الحركة ولا تؤثر على الرصيد.</p>}
    </Panel>
  </div>;
}

export function Stocktakes({state, createStocktake, setStocktakeLineCount, finaliseStocktake, can}: Props) {
  const canApproveStocktakes = can('stocktakes', 'approve');
  const [form, setForm] = useState<{warehouseId: string; kind: 'full' | 'cycle' | 'spot'; variantId: string}>({
    warehouseId: state.warehouses[0]?.id ?? '',
    kind: canApproveStocktakes ? 'full' : 'cycle',
    variantId: state.variants[0]?.id ?? '',
  });
  const [selectedId, setSelectedId] = useState(state.stocktakeSessions.find((session) => session.status !== 'closed')?.id ?? state.stocktakeSessions[0]?.id ?? '');
  const session = state.stocktakeSessions.find((item) => item.id === selectedId);
  const lines = state.stocktakeLines.filter((line) => line.sessionId === selectedId);
  const counted = lines.filter((line) => line.countedQty !== undefined).length;
  const canApprove = !!session && session.status !== 'closed' && lines.length > 0 && counted === lines.length && can('stocktakes', 'approve', session.warehouseId);
  useEffect(() => {
    if (!canApproveStocktakes && form.kind !== 'cycle') setForm((current) => ({...current, kind: 'cycle'}));
  }, [canApproveStocktakes, form.kind]);

  return <div className="page-content">
    <PageTitle eyebrow="الرقابة على المخزون" title="الجرد والتسويات" description="قارن الرصيد الدفتري بالعد الفعلي، ثم اعتمد الفروقات لترحيلها." />
    {can('stocktakes', 'create', form.warehouseId) && <Panel title="بدء جرد جديد" subtitle="يُحفظ الرصيد الدفتري عند إنشاء الجلسة. أدخل الكميات الفعلية قبل الاعتماد.">
      <form className="form-grid" onSubmit={(event) => {event.preventDefault(); createStocktake({warehouseId: form.warehouseId, kind: form.kind, variantIds: form.kind === 'spot' ? [form.variantId] : undefined});}}>
        <label>المستودع<select value={form.warehouseId} onChange={(event) => setForm({...form, warehouseId: event.target.value})}>{state.warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}</select></label>
        <label>نوع الجرد<select value={form.kind} onChange={(event) => setForm({...form, kind: event.target.value as typeof form.kind})}>{canApproveStocktakes && <><option value="full">شامل</option><option value="spot">عينة</option></>}<option value="cycle">دوري (الأصناف ذات الرصيد)</option></select></label>
        {form.kind === 'spot' && <label>الصنف<select required value={form.variantId} onChange={(event) => setForm({...form, variantId: event.target.value})}>{state.variants.filter((variant) => variant.active).map((variant) => <option value={variant.id} key={variant.id}>{variant.sku} — {state.products.find((product) => product.id === variant.productId)?.name}</option>)}</select></label>}
        <button className="action-btn primary" type="submit"><ClipboardCheck size={16}/> إنشاء جلسة</button>
      </form>
    </Panel>}
    <div className="dashboard-grid stocktake-grid">
      <Panel title="جلسات الجرد">
        <div className="session-list">{state.stocktakeSessions.map((item) => <button key={item.id} className={`session-item ${selectedId === item.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)}>
          <span><strong>{item.id}</strong><small>{state.warehouses.find((warehouse) => warehouse.id === item.warehouseId)?.name} · {item.kind}</small></span><span className={`status-pill ${item.status === 'closed' ? 'done' : 'waiting'}`}>{item.status === 'closed' ? 'مغلق' : 'مفتوح'}</span>
        </button>)}</div>
      </Panel>
      <Panel title={session ? `تفاصيل ${session.id}` : 'تفاصيل الجلسة'} subtitle={session ? `${counted} من ${lines.length} صنف تم عده` : 'اختر جلسة جرد لعرض تفاصيلها'}>
        {session && <div className="table-wrap"><table className="erp-table"><thead><tr><th>الصنف</th><th>الموقع</th><th>الرصيد الدفتري</th><th>العد الفعلي</th><th>الفرق</th></tr></thead>
          <tbody>{lines.map((line) => {
            const variant = state.variants.find((item) => item.id === line.variantId);
            return <tr key={line.id}><td><strong>{state.products.find((product) => product.id === variant?.productId)?.name ?? '—'}</strong><small className="cell-subtitle">{variant?.sku}</small></td><td>{state.bins.find((bin) => bin.id === line.binId)?.code ?? 'غير محدد'}</td><td>{line.bookQty}</td><td><input aria-label={`الكمية المعدودة ${variant?.sku} ${state.bins.find((bin) => bin.id === line.binId)?.code ?? 'غير محدد'}`} type="number" min="0" step="1" disabled={session.status === 'closed' || !can('stocktakes', 'write', session.warehouseId)} value={line.countedQty ?? ''} placeholder="أدخل العدد" onChange={(event) => event.target.value !== '' && setStocktakeLineCount(line.id, Number(event.target.value))}/></td><td className={line.varianceQty ? 'negative-quantity' : ''}>{line.varianceQty ?? '—'}</td></tr>;
          })}</tbody>
        </table></div>}
        {session && <div className="toolbar">{can('stocktakes', 'approve', session.warehouseId) && <button className="action-btn primary" disabled={!canApprove} onClick={() => finaliseStocktake(session.id)}>اعتماد التسوية وترحيل الفروقات</button>}{!can('stocktakes', 'approve', session.warehouseId) && session.status !== 'closed' && <span className="muted">تم إدخال العد؛ اعتماد فروقات الجرد يتطلب مدير النظام.</span>}{session.status !== 'closed' && counted < lines.length && <span className="muted">أكمل عدّ جميع الأصناف قبل الاعتماد.</span>}</div>}
      </Panel>
    </div>
  </div>;
}

export function Reports({state}: Props) {
  const rows = useMemo(() => computeInventoryReports(state), [state]);
  const totalValue = rows.reduce((total, item) => total + item.averageValue, 0);
  const byCategory = state.categories.map((category) => ({
    name: category.name,
    value: state.variants.filter((variant) => state.products.find((product) => product.id === variant.productId)?.categoryId === category.id)
      .reduce((sum, variant) => sum + stockForWarehouse(state, variant.id).onHand * variant.avgCost, 0),
  })).sort((left, right) => right.value - left.value);
  const maxCategory = Math.max(1, ...byCategory.map((item) => item.value));

  return <div className="page-content">
    <PageTitle eyebrow="التحليل والتقارير" title="تحليل المخزون" description="تقييم المخزون ومراجعة الصرف والتوزيع حسب الفئة." />
    <div className="stats-grid">
      <div className="stat-card"><span>قيمة المخزون — متوسط التكلفة</span><strong>{money(totalValue)}</strong></div>
      <div className="stat-card"><span>قيمة المخزون — FIFO</span><strong>{money(rows.reduce((total, item) => total + item.fifoValue, 0))}</strong></div>
      <div className="stat-card"><span>عدد المتغيرات</span><strong>{rows.length.toLocaleString('ar-EG')}</strong></div>
      <div className="stat-card"><span>قيمة المخزون لكل وحدة</span><strong>{money(rows.length ? totalValue / Math.max(1, rows.reduce((total, item) => total + item.onHand, 0)) : 0)}</strong></div>
    </div>
    <div className="dashboard-grid">
      <Panel title="قيمة المخزون حسب الفئة"><div className="category-chart">{byCategory.map((category) => <div className="category-bar-row" key={category.name}><span>{category.name}</span><div className="category-bar-track"><span style={{width: `${category.value / maxCategory * 100}%`}}/></div><b>{money(category.value)}</b></div>)}</div></Panel>
      <Panel title="أساس التقييم"><div className="valuation-note"><BarChart3 size={22}/><strong>متوسط التكلفة المرجح</strong><p>قيمة المخزون تعتمد على التكلفة المرجحة الحالية للصنف. تقرير FIFO يعرض قيمة الطبقات المتبقية من سجل الحركات.</p></div></Panel>
    </div>
    <Panel title="تفاصيل التقييم وتحليل ABC"><div className="table-wrap"><table className="erp-table"><thead><tr><th>SKU</th><th>الصنف</th><th>الرصيد</th><th>متوسط التكلفة</th><th>FIFO</th><th>صرف 90 يوم</th><th>ABC</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.id}><td className="mono">{row.sku}</td><td>{row.productName}</td><td>{row.onHand}</td><td>{money(row.averageValue)}</td><td>{money(row.fifoValue)}</td><td>{row.outbound90Days}</td><td><span className="abc-badge">{row.abcClass}</span></td></tr>)}
    </tbody></table></div></Panel>
  </div>;
}

function parseAuditValue(value: string | null | undefined): {empty: boolean; formatted: string} {
  if (value == null || !value.trim() || value.trim() === 'undefined') return {empty: true, formatted: ''};
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed == null) return {empty: true, formatted: ''};
    return {empty: false, formatted: JSON.stringify(parsed, null, 2)};
  } catch {
    return {empty: false, formatted: JSON.stringify(value, null, 2)};
  }
}

function JsonViewer({value}: {value: string}) {
  const tokenPattern = /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"\s*:)|("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/g;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push(value.slice(cursor, index));
    const token = match[0];
    const tokenClass = match[1] ? 'json-key' : match[2] ? 'json-string' : 'json-literal';
    parts.push(<span className={tokenClass} key={`${index}-${token}`}>{token}</span>);
    cursor = index + token.length;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return <pre className="audit-json-viewer" dir="ltr"><code>{parts}</code></pre>;
}

export function Audit({state}: Props) {
  const [detail, setDetail] = useState<{title: string; value: string} | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetail(null);
    };
    const closeOnAppEscape = () => setDetail(null);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('core-erp:escape', closeOnAppEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('core-erp:escape', closeOnAppEscape);
    };
  }, []);

  const renderAuditValue = (value: string | undefined, title: string) => {
    const parsed = parseAuditValue(value);
    if (parsed.empty) return <span className="audit-empty">—</span>;
    return <button className="audit-value-button" type="button" onClick={() => setDetail({title, value: parsed.formatted})} aria-label={`عرض ${title}`}>
      <Eye size={14}/><span>عرض التفاصيل</span>
    </button>;
  };

  return <div className="page-content">
    <PageTitle eyebrow="سجل النشاط" title="سجل الحركات" description="تتبّع تغييرات البيانات والإجراءات المؤثرة على المخزون." />
    <Panel title="سجل التدقيق" subtitle={`${state.auditLogs.length} أحداث محفوظة`}>
      <div className="table-wrap"><table className="erp-table"><thead><tr><th>الإجراء</th><th>القسم</th><th>المستخدم</th><th>القيمة السابقة</th><th>القيمة الجديدة</th><th>التاريخ والوقت</th></tr></thead>
        <tbody>{state.auditLogs.map((log) => <tr key={log.id}><td><strong>{log.actionType}</strong></td><td>{log.sectionName || '—'}</td><td>{log.userName || '—'}</td><td className="audit-value">{renderAuditValue(log.oldValue, 'القيمة السابقة')}</td><td className="audit-value">{renderAuditValue(log.newValue, 'القيمة الجديدة')}</td><td>{new Date(log.createdAt).toLocaleString('ar-EG')}</td></tr>)}</tbody>
      </table></div>
    </Panel>
    {detail && <div className="audit-dialog-backdrop" onMouseDown={(event) => {if (event.target === event.currentTarget) setDetail(null);}}>
      <section className="audit-dialog" role="dialog" aria-modal="true" aria-labelledby="audit-dialog-title" dir="rtl">
        <header><h3 id="audit-dialog-title">{detail.title}</h3><button className="icon-btn" type="button" aria-label="إغلاق" onClick={() => setDetail(null)}><X size={17}/></button></header>
        <JsonViewer value={detail.value}/>
      </section>
    </div>}
  </div>;
}
