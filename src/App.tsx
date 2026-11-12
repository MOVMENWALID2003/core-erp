import React, {useEffect, useMemo, useRef, useState} from 'react';
import {motion} from 'framer-motion';
import {
  Bell,
  Boxes,
  Building2,
  BarChart3,
  ChevronDown,
  ClipboardCheck,
  Database,
  Download,
  LayoutDashboard,
  ListChecks,
  LogIn,
  Maximize2,
  Minimize2,
  Menu,
  Moon,
  Copy,
  Search,
  ShieldCheck,
  Sun,
  Upload,
  Warehouse,
  X,
  Users,
} from 'lucide-react';
import {Logo} from './ui';
import {AvatarUpload} from './components/AvatarUpload';
import {SplashScreen} from './components/SplashScreen';
import {UserAvatar} from './components/UserAvatar';
import {Audit, Dashboard, Inventory, Locations, Operations, Reports, Stocktakes} from './screens/WmsScreens';
import type {ProductImportRow} from './screens/WmsScreens';
import {EmployeesAccess} from './screens/EmployeesAccess';
import {CompanySettings} from './screens/CompanySettings';
import {applyWarehouseRecordRules, canAccess, filterCompanyState, initializeDefaultAdmin, verifyCredential} from './access';
import {createAuditLogEntry, createNewStocktakeSession, createStockOperation as createOperation, finalizeStocktakeSession, generateId, loadAppState, loadDurableAppState, parseAppStateBackup, pushNotification, recordStockMovement, saveAppState, saveDurableAppState, setStocktakeLineCount as updateStocktakeLineCount, transitionStockOperation as updateStockOperation, upsertVariantPrice, computeDashboardStats, computeStockForVariant} from './store';
import type {AccessAction, AccessResource, AppState, MovementType, Product, Role, StockOperationStatus, StockOperationType, User, Variant, WarehouseType} from './types';

const tabs = [
  ['مركز العمليات', LayoutDashboard, Dashboard],
  ['الأصناف والمخزون', Boxes, Inventory],
  ['العمليات المخزنية', ListChecks, Operations],
  ['المستودعات والمواقع', Warehouse, Locations],
  ['الجرد والتسويات', ClipboardCheck, Stocktakes],
  ['تحليل المخزون', BarChart3, Reports],
  ['سجل الحركات', ShieldCheck, Audit],
  ['الموظفون والصلاحيات', Users, EmployeesAccess],
  ['الشركات وإعداداتها', Building2, CompanySettings],
] as const;

const tabResources: AccessResource[] = ['dashboard', 'inventory', 'operations', 'locations', 'stocktakes', 'reports', 'audit', 'employees', 'companies'];

class AppErrorBoundary extends React.Component<React.PropsWithChildren, {error: Error | null}> {
  state: {error: Error | null} = {error: null};

  static getDerivedStateFromError(error: Error) {
    return {error};
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('CORE ERP view errored:', error, info.componentStack);
  }

  render() {
    const currentError = this.state.error;

    if (currentError) {
      return (
        <div className="panel" dir="rtl" role="alert">
          <div className="section-head">
            <h3>تعذر تحميل العرض</h3>
          </div>
          <p className="muted">حدث خطأ في شاشة CORE ERP. يمكنك إعادة المحاولة أو إعادة تشغيل التطبيق.</p>
          <pre className="boot-error-pre">{currentError.message}</pre>
          <div className="toolbar">
            <button type="button" className="action-btn primary" onClick={() => window.location.reload()}>إعادة تحميل التطبيق</button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const [state, setState] = useState<AppState>(() => loadAppState());
  const stateRef = useRef(state);
  stateRef.current = state;
  const [currentUserId, setCurrentUserId] = useState(() => {
    try {
      return window.sessionStorage.getItem('gs-erp-session-user') ?? '';
    } catch (error) {
      console.error('Failed to restore the current local session:', error);
      return '';
    }
  });
  const [accountLoginOpen, setAccountLoginOpen] = useState(() => !currentUserId);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [activeCompanyId, setActiveCompanyId] = useState(() => {
    try {
      return window.localStorage.getItem('gs-erp-active-company') ?? 'company-1';
    } catch (error) {
      console.error('Failed to restore the active company:', error);
      return 'company-1';
    }
  });
  const [activeTab, setActiveTab] = useState(0);
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return window.localStorage.getItem('gs-erp-dark-mode') === 'true';
    } catch (error) {
      console.error('Failed to read display preference:', error);
      return false;
    }
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth <= 760);
  const [globalSearch, setGlobalSearch] = useState('');
  const globalSearchRef = useRef<HTMLInputElement>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [desktopWindowState, setDesktopWindowState] = useState({maximized: false, fullscreen: false});
  const [banner, setBanner] = useState<{type: 'success' | 'error' | 'info'; message: string} | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [storageHealthy, setStorageHealthy] = useState<boolean | null>(null);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [bootComplete, setBootComplete] = useState(false);
  const backupInput = useRef<HTMLInputElement>(null);
  const desktop = window.coreDesktop;

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    desktop.getState().then((windowState) => {
      if (active) setDesktopWindowState(windowState);
    }).catch((error: unknown) => console.error('Failed to read desktop window state:', error));
    const unsubscribe = desktop.onStateChanged(setDesktopWindowState);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [desktop]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAccountLoginOpen(false);
        setNotificationsOpen(false);
        window.dispatchEvent(new CustomEvent('core-erp:escape'));
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        globalSearchRef.current?.focus();
        globalSearchRef.current?.select();
        return;
      }

      if (desktop && (event.key === 'F11' || (event.altKey && event.key === 'Enter'))) {
        event.preventDefault();
        desktop.toggleFullscreen().catch((error: unknown) => console.error('Failed to toggle fullscreen:', error));
        return;
      }

      if (desktop && (event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r'))) {
        event.preventDefault();
        const latestState = stateRef.current;
        saveAppState(latestState);
        void saveDurableAppState(latestState).then((saved) => {
          if (!saved) {
            setStorageHealthy(false);
            setBanner({type: 'error', message: 'تعذر حفظ آخر التغييرات؛ أُوقف التحديث لحماية بياناتك.'});
            return;
          }
          window.location.reload();
        });
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [desktop]);

  useEffect(() => {
    let active = true;
    loadDurableAppState().then(initializeDefaultAdmin).then((savedState) => {
      if (!active) return;
      setState(savedState);
      setPersistenceReady(true);
      setStorageHealthy(true);
      setBootComplete(true);
    }).catch(async (error: unknown) => {
      console.error('Failed to initialize the local inventory database:', error);
      if (!active) return;
      setBanner({type: 'error', message: 'تعذر فتح قاعدة البيانات المحلية؛ سيتم الاحتفاظ بالنسخة المحلية الحالية.'});
      let fallbackState: AppState;
      try {
        fallbackState = await initializeDefaultAdmin(loadAppState());
      } catch (initializationError) {
        console.error('Failed to initialize the development administrator account:', initializationError);
        setBanner({type: 'error', message: 'تعذر تهيئة حساب المدير. تحقق من دعم التشفير في بيئة التشغيل.'});
        setState(loadAppState());
        setStorageHealthy(false);
        setBootComplete(true);
        return;
      }
      if (!active) return;
      setState(fallbackState);
      setStorageHealthy(false);
      setBootComplete(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    saveAppState(state);
    if (!persistenceReady) return;
    void saveDurableAppState(state).then(setStorageHealthy);
  }, [state, persistenceReady]);

  useEffect(() => {
    try {
      window.localStorage.setItem('gs-erp-dark-mode', String(darkMode));
    } catch (error) {
      console.error('Failed to save display preference:', error);
    }
  }, [darkMode]);

  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(null), 2400);
    return () => window.clearTimeout(timer);
  }, [banner]);

  const currentUser = state.users.find((user) => user.id === currentUserId && user.active);
  const activeCompanyAllowed = !currentUser || currentUser.companyId === activeCompanyId || currentUser.companyIds?.includes(activeCompanyId);
  const effectiveCompanyId = state.companies.some((company) => company.id === activeCompanyId) && activeCompanyAllowed
    ? activeCompanyId
    : currentUser?.companyId ?? state.company.id;
  const activeCompany = state.companies.find((company) => company.id === effectiveCompanyId) ?? state.company;
  const visibleState = useMemo(() => applyWarehouseRecordRules(filterCompanyState(state, effectiveCompanyId), currentUser), [state, currentUser, effectiveCompanyId]);

  useEffect(() => {
    if (state.company.id === effectiveCompanyId) return;
    const company = state.companies.find((item) => item.id === effectiveCompanyId);
    if (!company) return;
    setState((current) => current.company.id === company.id ? current : {...current, company});
    setActiveCompanyId(company.id);
    try {
      window.localStorage.setItem('gs-erp-active-company', company.id);
    } catch (error) {
      console.error('Failed to reconcile the active company:', error);
    }
  }, [effectiveCompanyId, state.company.id, state.companies]);
  const permitted = (resource: AccessResource, action: AccessAction, warehouseId?: string) =>
    canAccess(state, currentUser, resource, action, warehouseId);
  const stats = useMemo(() => computeDashboardStats(visibleState), [visibleState]);

  const exportBackup = () => {
    if (!requireAccess('settings', 'manage')) return;
    const blob = new Blob([JSON.stringify(state, null, 2)], {type: 'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gs-erp-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setBanner({type: 'success', message: 'تم تنزيل النسخة الاحتياطية'});
  };

  const exportInventoryCsv = () => {
    if (!requireAccess('inventory', 'read')) return;
    const header = ['SKU', 'المنتج', 'المستودع', 'اللون', 'المقاس', 'الرصيد الفعلي', 'المتاح', 'التكلفة'];
    const rows = visibleState.variants.flatMap((variant) => {
      const product = visibleState.products.find((item) => item.id === variant.productId);
      return visibleState.warehouses.map((warehouse) => {
        const stock = computeStockForVariant(visibleState, variant.id, warehouse.id);
        return [variant.sku, product?.name ?? '-', warehouse.code, variant.color ?? '-', variant.size ?? '-', String(stock.onHand), String(stock.available), String(variant.avgCost)];
      });
    });

    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gs-erp-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setBanner({type: 'success', message: 'تم تصدير ملف المخزون بصيغة CSV'});
  };

  const importBackup = async (file?: File) => {
    if (!requireAccess('settings', 'manage')) return;
    if (!file) return;
    setPendingAction('جار استعادة النسخة الاحتياطية...');
    try {
      const restored = parseAppStateBackup(await file.text());
      setState(restored);
      setBanner({type: 'success', message: 'تمت استعادة البيانات بنجاح'});
    } catch (error) {
      setBanner({type: 'error', message: friendlyError(error, 'تعذر استعادة النسخة الاحتياطية. تأكد من ملف JSON صالح')});
    } finally {
      setPendingAction(null);
      if (backupInput.current) backupInput.current.value = '';
    }
  };

  const friendlyError = (error: unknown, fallback = 'حدث خطأ غير متوقع') => {
    const raw = error instanceof Error ? error.message : fallback;
    if (raw.includes('السعة المتبقية')) return raw;
    if (raw.includes('SKU') || raw.includes('مكرر') || raw.includes('SKU')) return 'تأكد من أن SKU فريد وصالح قبل الحفظ';
    if (raw.includes('المستودع') || raw.includes('warehouse')) return 'يرجى اختيار مستودع صحيح قبل المتابعة';
    if (raw.includes('الكمية') || raw.includes('qty') || raw.includes('quantity')) return 'تحقق من قيمة الكمية قبل تنفيذ الحركة';
    if (raw.includes('التكلفة') || raw.includes('cost')) return 'قيمة التكلفة غير صالحة. أدخل رقمًا صحيحًا';
    if (raw.includes('تاريخ') || raw.includes('expiration')) return 'تأكد من صحة تاريخ الصلاحية والرقم التسلسلي';
    return raw;
  };

  const requireAccess = (resource: AccessResource, action: AccessAction, warehouseId?: string) => {
    if (currentUser && currentUser.companyId !== effectiveCompanyId && !currentUser.companyIds?.includes(effectiveCompanyId)) {
      setBanner({type: 'error', message: 'لا تملك صلاحية الوصول إلى الشركة النشطة.'});
      return false;
    }
    if (state.company.id !== effectiveCompanyId) {
      setBanner({type: 'info', message: 'يتم تحديث سياق الشركة؛ حاول مرة أخرى.'});
      return false;
    }
    if (warehouseId && !state.warehouses.some((warehouse) => warehouse.id === warehouseId && warehouse.companyId === effectiveCompanyId)) {
      setBanner({type: 'error', message: 'هذا المستودع لا ينتمي إلى الشركة النشطة.'});
      return false;
    }
    if (permitted(resource, action, warehouseId)) return true;
    setBanner({type: 'error', message: 'ليس لديك صلاحية لتنفيذ هذا الإجراء أو الوصول إلى هذا المستودع.'});
    return false;
  };

  const authenticateAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    const identity = loginUsername.trim().toLowerCase();
    const user = state.users.find((item) => item.username.toLowerCase() === identity || item.email?.toLowerCase() === identity);
    if (!user?.active) {
      setBanner({type: 'error', message: 'اسم الدخول غير صحيح أو أن الحساب غير نشط.'});
      return;
    }
    try {
      if (!await verifyCredential(loginPassword, user.passwordHash)) {
        setBanner({type: 'error', message: 'بيانات الدخول غير صحيحة. الحسابات القديمة تحتاج إلى تعيين كلمة مرور جديدة من ملف الموظف.'});
        return;
      }
      const lastLoginAt = new Date().toISOString();
      setCurrentUserId(user.id);
      const accessibleCompanyId = user.companyId === activeCompanyId || user.companyIds?.includes(activeCompanyId)
        ? activeCompanyId
        : user.companyId;
      const loginCompany = state.companies.find((company) => company.id === accessibleCompanyId) ?? state.company;
      setActiveCompanyId(loginCompany.id);
      try {
        window.localStorage.setItem('gs-erp-active-company', loginCompany.id);
      } catch (storageError) {
        console.error('Failed to persist the active company after login:', storageError);
      }
      setState((current) => {
        const updated = {...current, company: loginCompany, users: current.users.map((item) => item.id === user.id ? {...item, lastLoginAt, lastActiveAt: lastLoginAt} : item)};
        const role = current.roles.find((item) => item.id === user.roleId);
        const loggedIn = createAuditLogEntry(updated, 'تسجيل دخول', 'security', null, {userId: user.id}, user.fullName);
        return {...loggedIn, auditLogs: loggedIn.auditLogs.map((entry, index) => index === 0 ? {...entry, userId: user.id, roleName: role?.name} : entry)};
      });
      try {
        window.sessionStorage.setItem('gs-erp-session-user', user.id);
      } catch (storageError) {
        console.error('Failed to persist the local session identity:', storageError);
      }
      setLoginPassword('');
      setAccountLoginOpen(false);
      setBanner({type: 'success', message: `تم تسجيل الدخول باسم ${user.fullName}`});
    } catch (error) {
      console.error('Local account verification failed:', error);
      setBanner({type: 'error', message: 'تعذر التحقق من بيانات الدخول.'});
    }
  };

  const quickLoginAsAdmin = () => {
    if (!import.meta.env.DEV || !bootComplete) return;
    const admin = state.users.find((user) => user.email === 'admin@gserp.com' && user.active);
    if (!admin) {
      setBanner({type: 'error', message: 'حساب التطوير الافتراضي غير موجود. أعد تشغيل تهيئة قاعدة البيانات.'});
      return;
    }
    setCurrentUserId(admin.id);
    try {
      window.sessionStorage.setItem('gs-erp-session-user', admin.id);
    } catch (error) {
      console.error('Failed to persist the quick-login session:', error);
    }
    setAccountLoginOpen(false);
    setBanner({type: 'success', message: 'تم تسجيل الدخول السريع كمدير النظام (بيئة التطوير).'});
  };

  const switchCompany = (companyId: string) => {
    const company = state.companies.find((item) => item.id === companyId);
    const mayAccess = currentUser?.companyIds?.includes(companyId) || currentUser?.companyId === companyId;
    if (!company || !mayAccess) {
      setBanner({type: 'error', message: 'لا تملك صلاحية الوصول إلى هذه الشركة.'});
      return;
    }
    setActiveCompanyId(companyId);
    setState((current) => ({...current, company}));
    setActiveTab(0);
    try {
      window.localStorage.setItem('gs-erp-active-company', companyId);
    } catch (error) {
      console.error('Failed to persist active company selection:', error);
    }
    setBanner({type: 'success', message: `تم التبديل إلى ${company.name}`});
  };

  const endSession = () => {
    setCurrentUserId('');
    setAccountLoginOpen(true);
    try {
      window.sessionStorage.removeItem('gs-erp-session-user');
    } catch (error) {
      console.error('Failed to clear the local session identity:', error);
    }
  };

  const commit = (mutation: (current: AppState) => AppState, successMessage?: string) => {
    try {
      setPendingAction(successMessage ?? 'جاري التنفيذ...');
      const mutatedState = mutation(state);
      const activeUserExists = mutatedState.users.some((user) => user.id === currentUserId);
      let nextState = activeUserExists
        ? {...mutatedState, users: mutatedState.users.map((user) => user.id === currentUserId ? {...user, lastActiveAt: new Date().toISOString()} : user)}
        : mutatedState;
      const newAuditEntry = mutatedState.auditLogs[0]?.id !== state.auditLogs[0]?.id ? nextState.auditLogs[0] : undefined;
      if (currentUser && newAuditEntry) {
        const roleName = nextState.roles.find((role) => role.id === currentUser.roleId)?.name;
        nextState = {
          ...nextState,
          auditLogs: nextState.auditLogs.map((entry, index) => index === 0
            ? {...entry, userId: currentUser.id, userName: currentUser.fullName, roleName}
            : entry),
        };
      }
      setState(nextState);
      if (successMessage) {
        setBanner({type: 'success', message: successMessage});
      }
    } catch (error) {
      setBanner({type: 'error', message: friendlyError(error)});
    } finally {
      setPendingAction(null);
    }
  };

  const updateCurrentUserAvatar = async (avatarUrl: string) => {
    if (!currentUser) return;
    const nextState = {
      ...stateRef.current,
      users: stateRef.current.users.map((user) => user.id === currentUser.id ? {...user, avatarUrl} : user),
    };
    const saved = await saveDurableAppState(nextState);
    if (!saved) {
      setStorageHealthy(false);
      throw new Error('تعذر حفظ الصورة الشخصية في قاعدة البيانات المحلية.');
    }
    saveAppState(nextState);
    setState(nextState);
    setStorageHealthy(true);
    setBanner({type: 'success', message: 'تم حفظ الصورة الشخصية محلياً'});
  };

  const addWarehouse = (payload: {code: string; name: string; type: string}) => {
    if (!requireAccess('locations', 'create')) return;
    commit((current) => {
      const code = payload.code.trim();
      const name = payload.name.trim();
      if (!code || !name) throw new Error('مطلوب كود واسم للمستودع');
      const supportedTypes: WarehouseType[] = ['main', 'sub', 'transit', 'damaged', 'showroom', '3pl', 'office'];
      if (!supportedTypes.includes(payload.type as WarehouseType)) throw new Error('نوع المستودع غير صالح');
      if (current.warehouses.some((warehouse) => warehouse.code.toLowerCase() === code.toLowerCase())) {
        throw new Error('هذا الكود مستخدم بالفعل');
      }

      const warehouse = {
        id: generateId('warehouse'),
        companyId: current.company.id,
        code,
        name,
        type: payload.type as WarehouseType,
        status: 'active' as const,
        createdAt: new Date().toISOString(),
      };

      const next = { ...current, warehouses: [warehouse, ...current.warehouses] };
      return createAuditLogEntry(next, 'إضافة مستودع', 'warehouse', null, warehouse, 'System', 'Desktop-App');
    }, 'تمت إضافة المستودع بنجاح');
  };

  const addBin = (payload: {warehouseId: string; zone: string; aisle: string; rack: string; shelf: string; bin: string; capacityQty: number}) => {
    if (!requireAccess('locations', 'create', payload.warehouseId)) return;
    commit((current) => {
      if (!payload.warehouseId) throw new Error('اختر مستودعاً أولاً');
      const code = `WH${payload.warehouseId.slice(-2)}-${payload.zone}-${payload.aisle}-${payload.rack}-${payload.shelf}-${payload.bin}`.toUpperCase();
      const bin = {
        id: generateId('bin'),
        companyId: current.company.id,
        warehouseId: payload.warehouseId,
        zone: payload.zone.trim(),
        aisle: payload.aisle.trim(),
        rack: payload.rack.trim(),
        shelf: payload.shelf.trim(),
        bin: payload.bin.trim(),
        code,
        capacityQty: payload.capacityQty || 0,
        status: 'active' as const,
        createdAt: new Date().toISOString(),
      };

      if (current.bins.some((item) => item.code.toLowerCase() === code.toLowerCase())) {
        throw new Error('رمز المكان موجود مسبقاً');
      }

      const next = { ...current, bins: [bin, ...current.bins] };
      return createAuditLogEntry(next, 'إضافة مكان تخزين', 'warehouse', null, bin, 'System', 'Desktop-App');
    }, 'تمت إضافة مكان التخزين بنجاح');
  };

  const addProductVariant = (payload: {productName: string; brand: string; categoryId?: string; unitOfMeasure: string; color: string; size: string; sku: string; barcode: string; cost: number; salesPrice: number; reorderPoint: number; minStock: number; maxStock: number; serialTracked: boolean; lotTracked: boolean}) => {
    if (!requireAccess('inventory', 'create')) return;
    const canSetValuation = permitted('inventory', 'approve');
    const cost = canSetValuation ? payload.cost : 0;
    const salesPrice = canSetValuation ? payload.salesPrice : 0;
    commit((current) => {
      const trimmedName = payload.productName.trim();
      const trimmedSku = payload.sku.trim();
      if (!trimmedName || !trimmedSku) throw new Error('اسم المنتج وSKU مطلوبان');
      if (cost < 0 || salesPrice < 0 || payload.minStock < 0 || payload.maxStock < 0 || (payload.maxStock > 0 && payload.maxStock < payload.minStock)) {
        throw new Error('تحقق من الحد الأدنى والأقصى للمخزون');
      }
      if (current.variants.some((variant) => variant.sku.toLowerCase() === trimmedSku.toLowerCase())) {
        throw new Error('SKU موجود فعلاً');
      }

      let product = current.products.find((item) => item.name.toLowerCase() === trimmedName.toLowerCase());
      if (!product) {
        product = {
          id: generateId('product'),
          companyId: current.company.id,
          modelCode: `MOD-${Date.now().toString().slice(-5)}`,
          name: trimmedName,
          brand: payload.brand.trim() || 'CORE',
          categoryId: payload.categoryId || undefined,
          unitOfMeasure: payload.unitOfMeasure.trim() || 'قطعة',
          active: true,
          createdAt: new Date().toISOString(),
        };
      } else {
        product = {
          ...product,
          brand: payload.brand.trim() || product.brand,
          categoryId: payload.categoryId || product.categoryId,
          unitOfMeasure: payload.unitOfMeasure.trim() || product.unitOfMeasure || 'قطعة',
        };
      }

      const variant: Variant = {
        id: generateId('variant'),
        productId: product.id,
        color: payload.color.trim() || 'متنوع',
        size: payload.size.trim() || 'متنوع',
        sku: trimmedSku,
        barcode: payload.barcode.trim() || undefined,
        reorderPoint: Number(payload.reorderPoint) || 0,
        minStock: Number(payload.minStock) || 0,
        maxStock: Number(payload.maxStock) || 0,
        serialTracked: payload.serialTracked,
        lotTracked: payload.lotTracked,
        avgCost: Number(cost) || 0,
        active: true,
        createdAt: new Date().toISOString(),
      };

      const next = {
        ...current,
        products: product ? [product, ...current.products.filter((item) => item.id !== product!.id)] : current.products,
        variants: [variant, ...current.variants],
      };

      const retailPriceList = current.priceLists.find((item) => item.code === 'RETAIL') ?? {
        id: generateId('price-list'),
        companyId: current.company.id,
        name: 'سعر التجزئة',
        code: 'RETAIL',
        active: true,
        createdAt: new Date().toISOString(),
      };
      const priced = upsertVariantPrice(
        {...next, priceLists: current.priceLists.some((item) => item.id === retailPriceList.id) ? next.priceLists : [retailPriceList, ...next.priceLists]},
        variant.id,
        retailPriceList.id,
        1,
        salesPrice,
      );
      return createAuditLogEntry(priced, 'إضافة منتج/متغير', 'inventory', null, {product, variant, salesPrice}, 'System', 'Desktop-App');
    }, 'تم حفظ الصنف بنجاح');
  };

  const deleteProducts = (productIds: string[]) => {
    if (!requireAccess('inventory', 'delete')) return;
    commit((current) => {
      const requestedIds = new Set(productIds);
      const productsToDelete = current.products.filter((product) => requestedIds.has(product.id) && product.companyId === effectiveCompanyId);
      if (!productsToDelete.length || productsToDelete.length !== requestedIds.size) {
        throw new Error('تعذر حذف بعض المنتجات أو أنها لا تنتمي إلى الشركة النشطة.');
      }
      const deletingProductIds = new Set(productsToDelete.map((product) => product.id));
      const variantsToDelete = current.variants.filter((variant) => deletingProductIds.has(variant.productId));
      const deletingVariantIds = new Set(variantsToDelete.map((variant) => variant.id));
      const next = {
        ...current,
        products: current.products.filter((product) => !deletingProductIds.has(product.id)),
        variants: current.variants.filter((variant) => !deletingVariantIds.has(variant.id)),
        variantPrices: current.variantPrices.filter((price) => !deletingVariantIds.has(price.variantId)),
        stockMovements: current.stockMovements.filter((movement) => !deletingVariantIds.has(movement.variantId)),
        stockOperations: current.stockOperations
          .map((operation) => ({...operation, lines: operation.lines.filter((line) => !deletingVariantIds.has(line.variantId))}))
          .filter((operation) => operation.lines.length > 0),
        stocktakeLines: current.stocktakeLines.filter((line) => !deletingVariantIds.has(line.variantId)),
      };
      return createAuditLogEntry(
        next,
        'حذف منتجات',
        'inventory',
        {products: productsToDelete, variants: variantsToDelete},
        {deletedProductIds: productsToDelete.map((product) => product.id), deletedVariantIds: [...deletingVariantIds]},
        currentUser?.fullName ?? 'System',
      );
    }, `تم حذف ${productIds.length} منتج وحفظ التغيير محلياً`);
  };

  const importProducts = (rows: ProductImportRow[]) => {
    if (!requireAccess('inventory', 'create')) return;
    if (rows.some((row) => row.avgCost > 0) && !requireAccess('inventory', 'approve')) return;
    const receivingWarehouseId = state.warehouses.find((warehouse) => warehouse.companyId === effectiveCompanyId
      && permitted('operations', 'execute', warehouse.id))?.id;
    if (rows.some((row) => row.initialQty > 0)
      && (!receivingWarehouseId || !requireAccess('operations', 'execute', receivingWarehouseId))) return;
    commit((current) => {
      if (!rows.length) throw new Error('لا توجد منتجات صالحة للاستيراد.');
      const activeCompanyProductIds = new Set(current.products.filter((product) => product.companyId === effectiveCompanyId).map((product) => product.id));
      const seenSkus = new Set(current.variants
        .filter((variant) => activeCompanyProductIds.has(variant.productId))
        .map((variant) => variant.sku.trim().toLocaleLowerCase()));
      const modelProducts = new Map(current.products
        .filter((product) => product.companyId === effectiveCompanyId)
        .map((product) => [product.modelCode.trim().toLocaleLowerCase(), product]));
      const categoryByName = new Map(current.categories
        .filter((category) => !category.companyId || category.companyId === effectiveCompanyId)
        .map((category) => [category.name.trim().toLocaleLowerCase(), category]));
      const newProducts: Product[] = [];
      const newVariants: Variant[] = [];
      const newCategories: AppState['categories'] = [];
      const updatedExistingProducts = new Map<string, Product>();
      const stockReceipts: Array<{variantId: string; quantity: number; unitCost: number}> = [];
      const timestamp = new Date().toISOString();
      const namesByModelCode = new Map<string, string>();

      for (const row of rows) {
        const name = row.name.trim();
        const sku = row.sku.trim();
        const modelCode = row.modelCode.trim() || `MOD-${sku}`;
        const modelKey = modelCode.toLocaleLowerCase();
        const normalizedName = name.toLocaleLowerCase();
        if (!name || !sku) throw new Error('اسم المنتج وSKU مطلوبان.');
        if (seenSkus.has(sku.toLocaleLowerCase())) throw new Error(`SKU ${sku} مسجل مسبقاً أو مكرر في الملف.`);
        if (!Number.isFinite(row.avgCost) || row.avgCost < 0 || !Number.isFinite(row.initialQty) || row.initialQty < 0) {
          throw new Error(`بيانات التكلفة أو الرصيد غير صالحة للمنتج ${name}.`);
        }
        const previousName = namesByModelCode.get(modelKey);
        if (previousName && previousName !== normalizedName) throw new Error(`رمز الموديل ${modelCode} مرتبط بأكثر من اسم.`);
        namesByModelCode.set(modelKey, normalizedName);

        let product = modelProducts.get(modelKey);
        if (product && product.name.toLocaleLowerCase() !== normalizedName) throw new Error(`رمز الموديل ${modelCode} مستخدم لمنتج آخر.`);
        let categoryId: string | undefined;
        const categoryName = row.category.trim();
        if (categoryName) {
          let category = categoryByName.get(categoryName.toLocaleLowerCase());
          if (!category) {
            category = {
              id: generateId('category'),
              companyId: effectiveCompanyId,
              code: `IMP-${Date.now().toString(36).toUpperCase()}`,
              name: categoryName,
            };
            categoryByName.set(categoryName.toLocaleLowerCase(), category);
            newCategories.push(category);
          }
          categoryId = category.id;
        }
        if (!product) {
          product = {
            id: generateId('product'),
            companyId: effectiveCompanyId,
            modelCode,
            name,
            categoryId,
            unitOfMeasure: 'قطعة',
            brand: 'CORE',
            active: true,
            createdAt: timestamp,
          };
          modelProducts.set(modelKey, product);
          newProducts.push(product);
        } else if (categoryId && !product.categoryId) {
          product = {...product, categoryId};
          modelProducts.set(modelKey, product);
          const index = newProducts.findIndex((item) => item.id === product?.id);
          if (index >= 0) newProducts[index] = product;
          else updatedExistingProducts.set(product.id, product);
        }

        const variant: Variant = {
          id: generateId('variant'),
          productId: product.id,
          color: 'متنوع',
          size: 'متنوع',
          sku,
          reorderPoint: 0,
          avgCost: row.avgCost,
          active: true,
          createdAt: timestamp,
        };
        newVariants.push(variant);
        seenSkus.add(sku.toLocaleLowerCase());
        if (row.initialQty > 0) stockReceipts.push({variantId: variant.id, quantity: row.initialQty, unitCost: row.avgCost});
      }

      let next: AppState = {
        ...current,
        categories: [...newCategories, ...current.categories],
        products: [...newProducts, ...current.products.map((product) => updatedExistingProducts.get(product.id) ?? product)],
        variants: [...newVariants, ...current.variants],
      };
      const receivingWarehouse = current.warehouses.find((warehouse) => warehouse.id === receivingWarehouseId);
      if (stockReceipts.length && !receivingWarehouse) throw new Error('لا يوجد مستودع تابع للشركة النشطة لتسجيل الرصيد الافتتاحي.');
      const receivingBin = receivingWarehouse && current.bins.find((bin) => bin.warehouseId === receivingWarehouse.id);
      for (const receipt of stockReceipts) {
        next = recordStockMovement(next, {
          variantId: receipt.variantId,
          warehouseId: receivingWarehouse!.id,
          binId: receivingBin?.id,
          movementType: 'receipt',
          qtyOnHand: receipt.quantity,
          unitCost: receipt.unitCost,
          userName: currentUser?.fullName ?? 'System',
          notes: 'رصيد افتتاحي من استيراد المنتجات',
          refType: 'product_import',
        });
      }
      return createAuditLogEntry(next, 'استيراد منتجات', 'inventory', null, {
        count: rows.length,
        productCount: newProducts.length,
        skuList: newVariants.map((variant) => variant.sku),
        openingStockLines: stockReceipts.length,
      }, currentUser?.fullName ?? 'System');
    }, `تم استيراد ${rows.length} منتج محلياً بنجاح`);
  };

  const recordInventoryMovement = (payload: {variantId: string; warehouseId: string; qty: number; movementType: MovementType; unitCost?: number; notes?: string; lotNumber?: string; expirationDate?: string; serialNumbers?: string[]}) => {
    const permission = payload.movementType === 'stocktake_adjustment'
      ? ['stocktakes', 'approve'] as const
      : payload.movementType === 'writeoff'
        ? ['inventory', 'approve'] as const
        : ['operations', 'execute'] as const;
    if (!requireAccess(permission[0], permission[1], payload.warehouseId)) return;
    commit((current) => {
      const variant = current.variants.find((item) => item.id === payload.variantId);
      if (!variant) throw new Error('المنتج غير موجود');
      const warehouse = current.warehouses.find((item) => item.id === payload.warehouseId);
      if (!warehouse) throw new Error('المستودع غير موجود');
      if (!Number.isFinite(payload.qty) || payload.qty <= 0) throw new Error('الكمية يجب أن تكون أكبر من صفر');
      const unitCost = permitted('operations', 'approve', warehouse.id) ? payload.unitCost ?? variant.avgCost : variant.avgCost;
      if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error('تكلفة الوحدة غير صالحة');

      const balances = current.stockMovements
        .filter((movement) => movement.variantId === payload.variantId && movement.warehouseId === payload.warehouseId)
        .reduce((total, movement) => ({
          onHand: total.onHand + movement.qtyOnHand,
          reserved: total.reserved + movement.qtyReserved,
        }), {onHand: 0, reserved: 0});
      const available = balances.onHand - balances.reserved;
      const outboundTypes: MovementType[] = ['issue', 'sale', 'transfer_out', 'writeoff'];
      const inboundTypes: MovementType[] = ['receipt', 'return', 'transfer_in'];
      const reservedDelta = payload.movementType === 'reserve' ? payload.qty : payload.movementType === 'release' ? -payload.qty : 0;
      const qtyOnHand = outboundTypes.includes(payload.movementType) ? -payload.qty : inboundTypes.includes(payload.movementType) ? payload.qty : 0;

      const serialNumbers = [...new Set((payload.serialNumbers ?? []).map((serial) => serial.trim()).filter(Boolean))];
      if (variant.lotTracked && qtyOnHand !== 0 && !payload.lotNumber?.trim()) throw new Error('هذا الصنف يتطلب رقم تشغيلة لكل حركة فعلية');
      if (payload.expirationDate && !/^\d{4}-\d{2}-\d{2}$/.test(payload.expirationDate)) throw new Error('تاريخ الصلاحية غير صالح');
      if (qtyOnHand > 0 && payload.expirationDate && payload.expirationDate < new Date().toISOString().slice(0, 10)) throw new Error('لا يمكن استلام تشغيلة منتهية الصلاحية');
      if (variant.serialTracked && qtyOnHand !== 0) {
        if (serialNumbers.length !== payload.qty || serialNumbers.length !== (payload.serialNumbers ?? []).length) {
          throw new Error(`أدخل رقماً تسلسلياً فريداً لكل وحدة (${payload.qty})`);
        }
        const activeSerials = new Set<string>();
        current.stockMovements
          .filter((movement) => movement.variantId === variant.id && movement.warehouseId === warehouse.id)
          .slice()
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .forEach((movement) => (movement.serialNumbers ?? []).forEach((serial) => {
            if (movement.qtyOnHand > 0) activeSerials.add(serial);
            if (movement.qtyOnHand < 0) activeSerials.delete(serial);
          }));
        if (qtyOnHand > 0 && serialNumbers.some((serial) => activeSerials.has(serial))) throw new Error('أحد الأرقام التسلسلية موجود بالفعل في هذا المستودع');
        if (qtyOnHand < 0 && serialNumbers.some((serial) => !activeSerials.has(serial))) throw new Error('الأرقام التسلسلية المحددة غير موجودة في رصيد المستودع');
      }

      if (qtyOnHand < 0 && payload.qty > available) throw new Error(`الكمية المطلوبة غير متاحة. المتاح: ${available}`);
      if (reservedDelta > available) throw new Error(`الرصيد المتاح للحجز غير كافٍ. المتاح: ${available}`);
      if (reservedDelta < 0 && payload.qty > balances.reserved) throw new Error(`الكمية المحجوزة غير كافية. المحجوز: ${balances.reserved}`);

      const next = recordStockMovement(current, {
        variantId: payload.variantId,
        warehouseId: payload.warehouseId,
        movementType: payload.movementType,
        qtyOnHand,
        qtyReserved: reservedDelta,
        unitCost,
        userName: 'System',
        notes: payload.notes ?? 'حركة مخزنية',
        lotNumber: payload.lotNumber?.trim() || undefined,
        expirationDate: payload.expirationDate || undefined,
        serialNumbers,
      });

      const updatedVariant = inboundTypes.includes(payload.movementType) && balances.onHand + payload.qty > 0
        ? {...variant, avgCost: (balances.onHand * variant.avgCost + payload.qty * unitCost) / (balances.onHand + payload.qty)}
        : variant;

      const variantState = {
        ...next,
        variants: next.variants.map((item) => item.id === variant.id ? updatedVariant : item),
      };

      const nextAvailable = available + qtyOnHand - reservedDelta;
      const withAlert = nextAvailable <= variant.reorderPoint
        ? pushNotification(variantState, nextAvailable <= 0 ? 'out_of_stock' : 'low_stock', `الصنف ${variant.sku} وصل إلى حد إعادة الطلب في ${warehouse.code}.`, nextAvailable <= 0 ? 'critical' : 'warning', warehouse.id)
        : variantState;
      return createAuditLogEntry(withAlert, 'تحديث رصيد المخزون', 'inventory', {variantId: payload.variantId, available}, {movementType: payload.movementType, qty: payload.qty, available: nextAvailable}, 'System', 'Desktop-App');
    }, 'تمت حركة المخزون بنجاح');
  };

  const transferInventory = (payload: {variantId: string; fromWarehouseId: string; toWarehouseId: string; qty: number; notes?: string; lotNumber?: string; expirationDate?: string; serialNumbers?: string[]}) => {
    if (!requireAccess('operations', 'execute', payload.fromWarehouseId) || !requireAccess('operations', 'execute', payload.toWarehouseId)) return;
    commit((current) => {
      if (payload.fromWarehouseId === payload.toWarehouseId) throw new Error('اختر مستودعين مختلفين للتحويل');
      if (!Number.isInteger(payload.qty) || payload.qty <= 0) throw new Error('كمية التحويل يجب أن تكون عدداً صحيحاً أكبر من صفر');
      const variant = current.variants.find((item) => item.id === payload.variantId);
      const source = current.warehouses.find((item) => item.id === payload.fromWarehouseId);
      const destination = current.warehouses.find((item) => item.id === payload.toWarehouseId);
      if (!variant || !source || !destination) throw new Error('بيانات الصنف أو المستودع غير مكتملة');
      const stock = computeStockForVariant(current, variant.id, source.id);
      if (payload.qty > stock.available) throw new Error(`الرصيد المتاح في ${source.code} هو ${stock.available} فقط`);

      const transferId = generateId('transfer');
      const outbound = recordStockMovement(current, {
        variantId: variant.id,
        warehouseId: source.id,
        movementType: 'transfer_out',
        qtyOnHand: -payload.qty,
        unitCost: variant.avgCost,
        userName: 'System',
        notes: `تحويل ${transferId}: ${source.code} إلى ${destination.code}`,
        lotNumber: payload.lotNumber,
        expirationDate: payload.expirationDate,
        serialNumbers: payload.serialNumbers,
      });
      const inbound = recordStockMovement(outbound, {
        variantId: variant.id,
        warehouseId: destination.id,
        movementType: 'transfer_in',
        qtyOnHand: payload.qty,
        unitCost: variant.avgCost,
        userName: 'System',
        notes: `تحويل ${transferId}: ${source.code} إلى ${destination.code}`,
        lotNumber: payload.lotNumber,
        expirationDate: payload.expirationDate,
        serialNumbers: payload.serialNumbers,
      });
      return createAuditLogEntry(inbound, 'تحويل بين المستودعات', 'inventory', {warehouse: source.code}, {warehouse: destination.code, sku: variant.sku, qty: payload.qty}, 'System', 'Desktop-App');
    }, 'تم التحويل بين المستودعات بنجاح');
  };

  const createStocktake = (payload: {warehouseId: string; kind: 'full' | 'cycle' | 'spot'; variantIds?: string[]}) => {
    if (!requireAccess('stocktakes', 'create', payload.warehouseId)) return;
    if (payload.kind !== 'cycle' && !requireAccess('stocktakes', 'approve', payload.warehouseId)) return;
    commit((current) => {
      if (!payload.warehouseId) throw new Error('اختر مستودعاً');
      const session = createNewStocktakeSession(current, payload.kind, payload.warehouseId, 'user-02', payload.variantIds);
      return createAuditLogEntry(session, 'إنشاء جلسة جرد', 'stocktake', null, {sessionId: session.stocktakeSessions[0]?.id}, 'System', 'Desktop-App');
    }, 'تم إنشاء جلسة الجرد بنجاح');
  };

  const createStockOperation = (payload: {type: StockOperationType; sourceWarehouseId?: string; sourceBinId?: string; destinationWarehouseId?: string; destinationBinId?: string; destinationName?: string; assignedToUserId?: string; lines: Array<{variantId: string; quantity: number; unitCost?: number; lotNumber?: string; expirationDate?: string; serialNumbers?: string[]}>; notes?: string}) => {
    if (!requireAccess('operations', 'create', payload.sourceWarehouseId ?? payload.destinationWarehouseId)
      || (payload.destinationWarehouseId && !requireAccess('operations', 'create', payload.destinationWarehouseId))) return;
    commit((current) => {
      const operationPayload = payload.type !== 'receipt' || permitted('operations', 'approve', payload.destinationWarehouseId)
        ? payload
        : {
          ...payload,
          lines: payload.lines.map((line) => ({
            ...line,
            unitCost: current.variants.find((variant) => variant.id === line.variantId)?.avgCost,
          })),
        };
      return createOperation(current, operationPayload);
    }, 'تم إنشاء العملية المخزنية كمسودة');
  };

  const transitionStockOperation = (operationId: string, status: StockOperationStatus) => {
    const operation = state.stockOperations.find((item) => item.id === operationId);
    if (operation?.companyId && operation.companyId !== effectiveCompanyId) {
      setBanner({type: 'error', message: 'هذه العملية لا تنتمي إلى الشركة النشطة.'});
      return;
    }
    if (!requireAccess('operations', 'execute', operation?.sourceWarehouseId ?? operation?.destinationWarehouseId)
      || (operation?.destinationWarehouseId && !requireAccess('operations', 'execute', operation.destinationWarehouseId))) return;
    if (status === 'done' && operation?.type === 'receipt'
      && !requireAccess('operations', 'approve', operation.destinationWarehouseId)) return;
    commit((current) => updateStockOperation(current, operationId, status), status === 'done' ? 'تم التحقق وترحيل الحركة إلى المخزون' : 'تم تحديث حالة العملية');
  };

  const setStocktakeLineCount = (lineId: string, quantity: number) => {
    const line = state.stocktakeLines.find((item) => item.id === lineId);
    const session = state.stocktakeSessions.find((item) => item.id === line?.sessionId);
    if (session?.companyId !== effectiveCompanyId) {
      setBanner({type: 'error', message: 'جلسة الجرد لا تنتمي إلى الشركة النشطة.'});
      return;
    }
    if (!requireAccess('stocktakes', 'write', session?.warehouseId)) return;
    commit((current) => updateStocktakeLineCount(current, lineId, quantity));
  };

  const finaliseStocktake = (sessionId: string) => {
    const session = state.stocktakeSessions.find((item) => item.id === sessionId);
    if (session?.companyId !== effectiveCompanyId) {
      setBanner({type: 'error', message: 'جلسة الجرد لا تنتمي إلى الشركة النشطة.'});
      return;
    }
    if (!requireAccess('stocktakes', 'approve', session?.warehouseId)) return;
    commit((current) => {
      const sessionLines = current.stocktakeLines.filter((line) => line.sessionId === sessionId);
      if (!sessionLines.length) throw new Error('لا توجد خطوط جرد في هذه الجلسة');
      if (sessionLines.some((line) => line.countedQty === undefined)) throw new Error('أدخل الكمية المعدودة لجميع الأصناف قبل الاعتماد');
      const values = sessionLines.map((line) => ({
        variantId: line.variantId,
        binId: line.binId,
        countedQty: line.countedQty!,
        unitCost: line.unitCost,
      }));
      return finalizeStocktakeSession(current, sessionId, values);
    }, 'تم اعتماد تسوية الجرد');
  };

  const saveEmployee = (user: User) => {
    if (!requireAccess('employees', 'manage')) return;
    const storedEmployee = state.users.find((item) => item.id === user.id);
    if (storedEmployee && storedEmployee.companyId !== effectiveCompanyId && !storedEmployee.companyIds?.includes(effectiveCompanyId)) {
      setBanner({type: 'error', message: 'هذا المستخدم لا ينتمي إلى الشركة النشطة.'});
      return;
    }
    if (user.id === currentUser?.id && !user.active) {
      setBanner({type: 'error', message: 'لا يمكن تعطيل الحساب المستخدم في الجلسة الحالية.'});
      return;
    }
    if (user.id === currentUser?.id && user.roleId !== currentUser.roleId
      && !state.users.some((existing) => existing.id !== currentUser.id && existing.active && existing.roleId === currentUser.roleId)) {
      setBanner({type: 'error', message: 'عيّن مدير نظام نشطاً آخر قبل تغيير مجموعة الحساب الحالي.'});
      return;
    }
    commit((current) => {
      if (user.id !== 'user-01' && current.users.some((item) => item.username.toLowerCase() === user.username.toLowerCase() && item.id !== user.id)) {
        throw new Error('اسم الدخول مستخدم بالفعل');
      }
      const users = current.users.some((item) => item.id === user.id)
        ? current.users.map((item) => item.id === user.id ? {...user, companyIds: item.companyIds} : item)
        : [{...user, companyId: current.company.id, companyIds: [current.company.id]}, ...current.users];
      return createAuditLogEntry({...current, users}, 'حفظ ملف موظف وصلاحياته', 'security', null, {userId: user.id, roleId: user.roleId, active: user.active}, currentUser?.fullName ?? 'System', 'Desktop-App');
    }, 'تم حفظ ملف الموظف');
  };

  const toggleEmployee = (userId: string) => {
    if (!requireAccess('employees', 'write')) return;
    if (userId === currentUser?.id) {
      setBanner({type: 'error', message: 'لا يمكن تعطيل الحساب المستخدم في الجلسة الحالية.'});
      return;
    }
    commit((current) => {
      const user = current.users.find((item) => item.id === userId);
      if (!user) throw new Error('الموظف غير موجود');
      const users = current.users.map((item) => item.id === userId ? {...item, active: !item.active} : item);
      return createAuditLogEntry({...current, users}, user.active ? 'تعطيل حساب موظف' : 'تفعيل حساب موظف', 'security', {active: user.active}, {active: !user.active}, currentUser?.fullName ?? 'System', 'Desktop-App');
    }, 'تم تحديث حالة الموظف');
  };

  const saveRole = (role: Role) => {
    if (!requireAccess('employees', 'manage')) return;
    if (role.id === 'role-01') {
      setBanner({type: 'error', message: 'مجموعة مدير النظام الأساسية محمية من تعديل الصلاحيات.'});
      return;
    }
    commit((current) => {
      const roles = current.roles.map((item) => item.id === role.id ? role : item);
      if (!current.roles.some((item) => item.id === role.id)) roles.push(role);
      return createAuditLogEntry({...current, roles}, 'تعديل مجموعة صلاحيات', 'security', null, {roleId: role.id, permissions: role.permissions, warehouseScope: role.warehouseScope}, currentUser?.fullName ?? 'System', 'Desktop-App');
    }, 'تم حفظ مجموعة الصلاحيات');
  };

  const saveCompany = (company: AppState['company']) => {
    if (!requireAccess('companies', 'manage')) return;
    commit((current) => {
      const code = company.code.trim().toUpperCase();
      const name = company.name.trim();
      if (!name || !code) throw new Error('اسم الشركة ورمزها مطلوبان.');
      if (current.companies.some((item) => item.code.toLowerCase() === code.toLowerCase() && item.id !== company.id)) {
        throw new Error('رمز الشركة مستخدم بالفعل.');
      }
      const isNew = !current.companies.some((item) => item.id === company.id);
      let savedCompany = {...company, code, name};
      let warehouses = current.warehouses;
      if (isNew) {
        const warehouseId = generateId('warehouse');
        const warehouse = {
          id: warehouseId,
          companyId: company.id,
          code: `${code}-01`,
          name: `${name} — المستودع الرئيسي`,
          type: 'main' as const,
          status: 'active' as const,
          createdAt: new Date().toISOString(),
        };
        warehouses = [warehouse, ...warehouses];
        savedCompany = {...savedCompany, defaultWarehouseId: warehouseId};
      } else if (savedCompany.defaultWarehouseId
        && !current.warehouses.some((warehouse) => warehouse.id === savedCompany.defaultWarehouseId && warehouse.companyId === company.id)) {
        throw new Error('المستودع الافتراضي يجب أن يتبع للشركة المحددة.');
      }
      const companies = isNew
        ? [...current.companies, savedCompany]
        : current.companies.map((item) => item.id === company.id ? savedCompany : item);
      const users = current.users.map((user) => user.id === currentUser?.id
        ? {...user, companyIds: [...new Set([...(user.companyIds ?? [user.companyId]), company.id])]}
        : user);
      const updated = {...current, companies, warehouses, users, company: current.company.id === company.id ? savedCompany : current.company};
      return createAuditLogEntry(updated, isNew ? 'إنشاء شركة' : 'تعديل بيانات الشركة', 'companies', null, {companyId: company.id, name, code}, currentUser?.fullName ?? 'System');
    }, 'تم حفظ بيانات الشركة');
  };

  const selectedTab = tabs.findIndex((_, index) => permitted(tabResources[index], 'read'));
  const activeTabAllowed = permitted(tabResources[activeTab], 'read');
  const effectiveTab = activeTabAllowed ? activeTab : selectedTab >= 0 ? selectedTab : 0;
  const CurrentScreen = tabs[effectiveTab]?.[2];
  const SelectedWarehouse = visibleState.warehouses[0]?.id ?? '';
  const visibleNotificationIds = new Set(visibleState.notifications.map((item) => item.id));
  const screenProps = {
    state: visibleState,
    currentUser,
    banner,
    pendingAction,
    stats,
    globalSearch,
    can: permitted,
    addWarehouse,
    addBin,
    addProductVariant,
    deleteProducts,
    importProducts,
    recordInventoryMovement,
    transferInventory,
    createStockOperation,
    transitionStockOperation,
    createStocktake,
    setStocktakeLineCount,
    finaliseStocktake,
    selectedWarehouseId: SelectedWarehouse,
    onSaveUser: saveEmployee,
    onToggleUser: toggleEmployee,
    onSaveRole: saveRole,
    onSaveCompany: saveCompany,
  };

  const unreadNotifications = visibleState.notifications.filter((item) => !item.readFlag).length;
  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${desktop && !desktopWindowState.fullscreen ? 'desktop-frameless' : ''} ${bootComplete ? '' : 'booting'}`} data-theme={darkMode ? 'dark' : 'light'}>
      {desktop && !desktopWindowState.fullscreen && <div className="window-titlebar" dir="ltr">
        <div className="window-titlebar-drag">
          <Logo size={19}/>
          <span>CORE ERP</span>
        </div>
        <div className="window-controls">
          <button type="button" className="window-control" aria-label="تصغير النافذة" title="تصغير" onClick={() => desktop.minimize().catch((error: unknown) => console.error('Failed to minimize window:', error))}><Minimize2 size={14}/></button>
          <button type="button" className="window-control" aria-label={desktopWindowState.maximized ? 'استعادة النافذة' : 'تكبير النافذة'} title={desktopWindowState.maximized ? 'استعادة' : 'تكبير'} onClick={() => desktop.toggleMaximize().catch((error: unknown) => console.error('Failed to toggle maximize:', error))}>{desktopWindowState.maximized ? <Copy size={13}/> : <Maximize2 size={13}/>}</button>
          <button type="button" className="window-control close" aria-label="إغلاق النافذة" title="إغلاق" onClick={() => desktop.close().catch((error: unknown) => console.error('Failed to close window:', error))}><X size={15}/></button>
        </div>
      </div>}
      <aside className="sidebar">
        <div className="brand-wrap">
          <Logo size={40} />
          <div className="brand-text">
            <span className="brand-name">CORE ERP</span>
            <small>نظام إدارة الموارد المتكامل</small>
          </div>
          <button type="button" className="icon-btn sidebar-toggle" aria-label="طي القائمة" onClick={() => setSidebarCollapsed((value) => !value)}><Menu size={17}/></button>
        </div>

        <nav className="nav-list">
          {tabs.map(([label, Icon], index) => permitted(tabResources[index], 'read') ? (
            <motion.button key={label} type="button" title={label} className={`nav-btn ${effectiveTab === index ? 'active' : ''}`} onClick={() => setActiveTab(index)} whileTap={{scale: 0.98}}>
              <Icon size={18} />
              <span>{label}</span>
            </motion.button>
          ) : null)}
        </nav>
        <div className="sidebar-footer"><span className="online-indicator"/><span>قاعدة المخزون المحلية</span></div>
        <div className="sidebar-credit">CORE ERP v1.0.1 | تم التطوير بواسطة MOAMEN ELBARADEI</div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="icon-btn mobile-menu" aria-label="فتح القائمة" onClick={() => setSidebarCollapsed((value) => !value)}><Menu size={18}/></button>
            <div className="global-search">
              <Search size={17}/>
              <input ref={globalSearchRef} value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} onKeyDown={(event) => {if (event.key === 'Enter') setActiveTab(1);}} placeholder="بحث عن صنف أو SKU أو باركود..." aria-label="بحث عام"/>
              <kbd>Enter</kbd>
            </div>
          </div>
          <div className="topbar-actions">
            <label className="company-switcher" title="الشركة النشطة">
              <span className="company-mark"><Logo size={24}/></span>
              <span><strong>{activeCompany.name}</strong><small>الشركة الحالية</small></span>
              <select aria-label="الشركة النشطة" value={effectiveCompanyId} onChange={(event) => switchCompany(event.target.value)} disabled={!currentUser || state.companies.filter((company) => currentUser.companyIds?.includes(company.id) || currentUser.companyId === company.id).length < 2}>
                {state.companies.filter((company) => currentUser?.companyIds?.includes(company.id) || currentUser?.companyId === company.id).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
              <ChevronDown size={14}/>
            </label>
            <div className="account-session">
              <button type="button" className="account-session-button" aria-expanded={accountLoginOpen} onClick={() => setAccountLoginOpen((open) => !open)}>
                {currentUser
                  ? <UserAvatar name={currentUser.fullName} avatarUrl={currentUser.avatarUrl} size={27}/>
                  : <LogIn size={16}/>}
                <span>{currentUser?.fullName ?? 'تسجيل الدخول'}</span>
              </button>
              {accountLoginOpen && <form className="account-login-popover" onSubmit={(event) => void authenticateAccount(event)}>
                {currentUser && <section className="account-profile-section" aria-label="الملف الشخصي">
                  <AvatarUpload
                    fullName={currentUser.fullName}
                    avatarUrl={currentUser.avatarUrl}
                    onUploaded={updateCurrentUserAvatar}
                  />
                </section>}
                <strong>{currentUser ? 'تبديل الحساب' : 'تسجيل الدخول إلى CORE ERP'}</strong>
                <label>البريد الإلكتروني أو اسم الدخول<input autoComplete="username" value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} required disabled={!bootComplete}/></label>
                <label>كلمة المرور<input type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required disabled={!bootComplete}/></label>
                <button className="action-btn primary" type="submit" disabled={!bootComplete}>تسجيل الدخول</button>
                {import.meta.env.DEV && !currentUser && <button className="action-btn" type="button" disabled={!bootComplete} onClick={quickLoginAsAdmin}>دخول سريع كمدير النظام</button>}
                {import.meta.env.DEV && !currentUser && <small className="login-default-hint">بيانات التطوير الأولية: admin@gserp.com / admin123</small>}
                {currentUser && <button className="text-button" type="button" onClick={endSession}>تسجيل الخروج من الجلسة الحالية</button>}
              </form>}
            </div>
            <span className={`storage-status ${storageHealthy === false ? 'error' : ''}`} role="status" aria-label={storageHealthy === false ? 'تعذر حفظ قاعدة البيانات المحلية' : 'تخزين محلي IndexedDB'} title="قاعدة البيانات المحلية IndexedDB">
              <Database size={15} />
              <span>{storageHealthy === null ? 'جار الاتصال' : storageHealthy ? 'محلي' : 'تعذر الحفظ'}</span>
            </span>
            {permitted('settings', 'manage') && <button type="button" className="icon-btn" title="تصدير نسخة احتياطية" aria-label="تصدير نسخة احتياطية" onClick={exportBackup}><Download size={17}/></button>}
            {permitted('settings', 'manage') && <button type="button" className="icon-btn" title="استعادة نسخة احتياطية" aria-label="استعادة نسخة احتياطية" onClick={() => backupInput.current?.click()}><Upload size={17}/></button>}
            <input ref={backupInput} className="backup-input" type="file" accept="application/json,.json" onChange={(event) => void importBackup(event.target.files?.[0])} />
            <button type="button" className="icon-btn" title={darkMode ? 'الوضع الفاتح' : 'الوضع الداكن'} aria-label="تغيير المظهر" onClick={() => setDarkMode((value) => !value)}>{darkMode ? <Sun size={17}/> : <Moon size={17}/>}</button>
            <div className="notification-wrap">
              <button type="button" className="icon-btn notification-btn" aria-label={`الإشعارات ${unreadNotifications}`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((value) => !value)}>
                <Bell size={17}/>{unreadNotifications > 0 && <span className="notification-count">{unreadNotifications}</span>}
              </button>
              {notificationsOpen && <div className="notification-popover">
                <div className="notification-popover-head"><strong>الإشعارات</strong><button className="text-button" onClick={() => setState((current) => ({...current, notifications: current.notifications.map((item) => visibleNotificationIds.has(item.id) ? {...item, readFlag: true} : item)}))}>تعليم الكل كمقروء</button></div>
                {visibleState.notifications.slice(0, 5).map((notification) => <div className={`notification-entry ${notification.readFlag ? '' : 'unread'}`} key={notification.id}><span className={`notification-severity ${notification.severity}`}/><span>{notification.message}</span></div>)}
                {!visibleState.notifications.length && <div className="empty-state">لا توجد إشعارات جديدة.</div>}
              </div>}
            </div>
          </div>
        </header>

        {banner ? (
          <div className={`system-banner ${banner.type}`} role="status">
            {banner.message}
          </div>
        ) : null}

        {!currentUser || selectedTab < 0
          ? <div className="panel permission-denied" role="alert"><ShieldCheck size={24}/><h2>لا يوجد حساب نشط بصلاحيات</h2><p>تحقق من حالة المستخدم ومجموعة الصلاحيات قبل متابعة العمل.</p></div>
          : <AppErrorBoundary key={effectiveTab}><CurrentScreen {...screenProps} /></AppErrorBoundary>}
        {pendingAction && <div className="busy-indicator" role="status">{pendingAction}</div>}
      </main>
      <SplashScreen ready={bootComplete}/>
    </div>
  );
}
