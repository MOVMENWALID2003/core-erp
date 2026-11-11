import {useMemo, useState} from 'react';
import {Check, KeyRound, LockKeyhole, Plus, Save, Shield, UserRound, Warehouse} from 'lucide-react';
import {accessActions, accessResources, hashCredential} from '../access';
import {UserAvatar} from '../components/UserAvatar';
import {generateId} from '../store';
import type {AccessAction, AccessResource, AppState, Role, User} from '../types';

type Props = {
  state: AppState;
  onSaveUser: (user: User) => void;
  onToggleUser: (userId: string) => void;
  onSaveRole: (role: Role) => void;
};

type EmployeeDraft = {
  id?: string;
  fullName: string;
  username: string;
  jobTitle: string;
  department: string;
  email: string;
  phone: string;
  avatarUrl?: string;
  roleId: string;
  active: boolean;
  warehouseIds: string[];
  workstationName: string;
  password: string;
  pin: string;
  passwordHash?: string;
  pinHash?: string;
  createdAt?: string;
  lastLoginAt?: string;
  lastActiveAt?: string;
};

const emptyDraft = (roleId: string): EmployeeDraft => ({
  fullName: '', username: '', jobTitle: '', department: '', email: '', phone: '',
  roleId, active: true, warehouseIds: [], workstationName: '', password: '', pin: '',
});

export function EmployeesAccess({state, onSaveUser, onToggleUser, onSaveRole}: Props) {
  const [section, setSection] = useState<'employees' | 'groups'>('employees');
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<'personal' | 'access' | 'warehouses' | 'security'>('personal');
  const [draft, setDraft] = useState<EmployeeDraft>(() => emptyDraft(state.roles[0]?.id ?? ''));
  const [selectedRoleId, setSelectedRoleId] = useState(state.roles[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const selectedRole = state.roles.find((role) => role.id === selectedRoleId);
  const employees = useMemo(() => state.users.filter((user) => {
    const query = search.trim().toLocaleLowerCase();
    return !query || `${user.fullName} ${user.username} ${user.email ?? ''} ${user.department ?? ''}`.toLocaleLowerCase().includes(query);
  }), [search, state.users]);

  const editUser = (user?: User) => {
    setError('');
    setTab('personal');
    setDraft(user ? {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      jobTitle: user.jobTitle ?? '',
      department: user.department ?? '',
      email: user.email ?? '',
      phone: user.phone ?? '',
      avatarUrl: user.avatarUrl,
      roleId: user.roleId ?? state.roles[0]?.id ?? '',
      active: user.active,
      warehouseIds: [...(user.warehouseIds ?? [])],
      workstationName: user.workstationName ?? '',
      password: '',
      pin: '',
      passwordHash: user.passwordHash,
      pinHash: user.pinHash,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      lastActiveAt: user.lastActiveAt,
    } : emptyDraft(state.roles[0]?.id ?? ''));
    setEditing(true);
  };

  const saveUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const fullName = draft.fullName.trim();
    const username = draft.username.trim();
    if (!fullName || !username || !draft.roleId) {
      setError('الاسم الكامل واسم الدخول ومجموعة الصلاحيات حقول مطلوبة.');
      return;
    }
    if (state.users.some((user) => user.username.toLowerCase() === username.toLowerCase() && user.id !== draft.id)) {
      setError('اسم الدخول مستخدم بالفعل.');
      return;
    }
    if (!draft.id && draft.password.length < 10) {
      setError('كلمة المرور للمستخدم الجديد يجب ألا تقل عن 10 أحرف.');
      return;
    }
    if (draft.password && draft.password.length < 10) {
      setError('كلمة المرور يجب ألا تقل عن 10 أحرف.');
      return;
    }
    if (draft.pin && !/^\d{4,8}$/.test(draft.pin)) {
      setError('رقم PIN يجب أن يتكون من 4 إلى 8 أرقام.');
      return;
    }
    try {
      const passwordHash = draft.password ? await hashCredential(draft.password) : draft.passwordHash;
      if (!passwordHash) {
        setError('أدخل كلمة مرور لحساب الدخول.');
        return;
      }
      const pinHash = draft.pin ? await hashCredential(draft.pin) : draft.pinHash;
      onSaveUser({
        id: draft.id ?? generateId('user'),
        companyId: state.company.id,
        username,
        fullName,
        passwordHash,
        roleId: draft.roleId,
        active: draft.active,
        workstationName: draft.workstationName.trim() || undefined,
        lastLoginAt: draft.lastLoginAt,
        lastActiveAt: draft.lastActiveAt,
        createdAt: draft.createdAt ?? new Date().toISOString(),
        jobTitle: draft.jobTitle.trim() || undefined,
        department: draft.department.trim() || undefined,
        email: draft.email.trim() || undefined,
        phone: draft.phone.trim() || undefined,
        avatarUrl: draft.avatarUrl,
        warehouseIds: [...draft.warehouseIds],
        pinHash,
      });
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'تعذر حفظ الحساب.');
    }
  };

  const updateRolePermission = (resource: AccessResource, action: AccessAction, enabled: boolean) => {
    if (!selectedRole) return;
    const current = selectedRole.permissions?.[resource] ?? [];
    const permissions = {
      ...selectedRole.permissions,
      [resource]: enabled ? [...new Set([...current, action])] : current.filter((item) => item !== action),
    };
    onSaveRole({...selectedRole, permissions});
  };

  const updateWarehouseSelection = (warehouseId: string, checked: boolean) => {
    const warehouseIds = checked
      ? [...new Set([...draft.warehouseIds, warehouseId])]
      : draft.warehouseIds.filter((id) => id !== warehouseId);
    setDraft({...draft, warehouseIds});
  };

  return <div className="page-content" dir="rtl">
    <div className="page-title">
      <div><span className="eyebrow">الإدارة والصلاحيات</span><h2>الموظفون والصلاحيات</h2><p>إدارة ملفات الموظفين ومجموعات الوصول وقواعد نطاق المستودعات.</p></div>
      {section === 'employees' && <button className="action-btn primary" type="button" onClick={() => editUser()}><Plus size={16}/> مستخدم جديد</button>}
    </div>
    <div className="access-section-tabs" role="tablist" aria-label="إدارة المستخدمين والمجموعات">
      <button type="button" role="tab" aria-selected={section === 'employees'} className={section === 'employees' ? 'selected' : ''} onClick={() => {setSection('employees'); setEditing(false);}}><UserRound size={16}/> الموظفون</button>
      <button type="button" role="tab" aria-selected={section === 'groups'} className={section === 'groups' ? 'selected' : ''} onClick={() => {setSection('groups'); setEditing(false);}}><Shield size={16}/> مجموعات الصلاحيات</button>
    </div>

    {section === 'employees' && !editing && <>
      <section className="panel">
        <div className="section-head"><div><h3>دليل الموظفين</h3><p className="muted">{employees.length} موظف / حساب مرتبط</p></div>
          <input className="employee-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالاسم أو البريد أو اسم الدخول" aria-label="بحث الموظفين"/>
        </div>
        <div className="table-wrap"><table className="erp-table employee-table"><thead><tr><th>الموظف</th><th>القسم / المسمى</th><th>مجموعة الصلاحيات</th><th>آخر نشاط</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
          <tbody>{employees.map((user) => {
            const role = state.roles.find((item) => item.id === user.roleId);
            const lastActiveAt = user.lastActiveAt ?? user.lastLoginAt;
            return <tr key={user.id}>
              <td><div className="employee-identity"><UserAvatar name={user.fullName} avatarUrl={user.avatarUrl} size={34}/><span><strong>{user.fullName}</strong><small className="cell-subtitle">{user.username} · {user.email ?? 'بلا بريد'}</small></span></div></td>
              <td>{user.department ?? '—'}<small className="cell-subtitle">{user.jobTitle ?? '—'}</small></td>
              <td>{role?.name ?? 'بدون مجموعة'}</td>
              <td>{lastActiveAt ? new Date(lastActiveAt).toLocaleString('ar-EG') : 'لم يسجل الدخول'}</td>
              <td><span className={`status-pill ${user.active ? 'active' : 'cancelled'}`}>{user.active ? 'نشط' : 'غير نشط'}</span></td>
              <td><div className="employee-actions"><button type="button" className="text-button" onClick={() => editUser(user)}>فتح</button><button type="button" className="text-button" onClick={() => onToggleUser(user.id)}>{user.active ? 'تعطيل' : 'تفعيل'}</button></div></td>
            </tr>;
          })}</tbody>
        </table></div>
        {!employees.length && <div className="empty-state">لا توجد نتائج مطابقة.</div>}
      </section>
      <div className="security-notice"><LockKeyhole size={17}/><span>كلمات المرور وأرقام PIN تُخزّن كـ PBKDF2-SHA-256 مع salt عشوائي. التفويض هنا يطبق داخل تطبيق التخزين المحلي؛ ربطه بخدمة دخول موثوقة يتطلب مصادقة وصلاحيات على خادم.</span></div>
    </>}

    {section === 'employees' && editing && <section className="panel">
      <div className="section-head"><div><h3>{draft.id ? 'ملف الموظف' : 'إنشاء حساب موظف'}</h3><p className="muted">معلومات الموظف وحساب الدخول ومجموعات الوصول.</p></div><button type="button" className="text-button" onClick={() => setEditing(false)}>العودة إلى القائمة</button></div>
      <div className="access-form-tabs" role="tablist" aria-label="أقسام ملف الموظف">
        <button type="button" className={tab === 'personal' ? 'selected' : ''} onClick={() => setTab('personal')}>المعلومات الشخصية</button>
        <button type="button" className={tab === 'access' ? 'selected' : ''} onClick={() => setTab('access')}>حقوق الوصول</button>
        <button type="button" className={tab === 'warehouses' ? 'selected' : ''} onClick={() => setTab('warehouses')}>المستودعات المخصصة</button>
        <button type="button" className={tab === 'security' ? 'selected' : ''} onClick={() => setTab('security')}>الأمان وPIN</button>
      </div>
      <form className="employee-form" onSubmit={(event) => void saveUser(event)}>
        {tab === 'personal' && <div className="form-grid employee-fields">
          <label>الاسم الكامل<input required autoComplete="name" value={draft.fullName} onChange={(event) => setDraft({...draft, fullName: event.target.value})}/></label>
          <label>المسمى الوظيفي<input value={draft.jobTitle} onChange={(event) => setDraft({...draft, jobTitle: event.target.value})}/></label>
          <label>القسم<input value={draft.department} onChange={(event) => setDraft({...draft, department: event.target.value})}/></label>
          <label>البريد الإلكتروني<input type="email" autoComplete="email" value={draft.email} onChange={(event) => setDraft({...draft, email: event.target.value})}/></label>
          <label>رقم الهاتف<input type="tel" autoComplete="tel" value={draft.phone} onChange={(event) => setDraft({...draft, phone: event.target.value})}/></label>
          <label>محطة العمل<input value={draft.workstationName} onChange={(event) => setDraft({...draft, workstationName: event.target.value})}/></label>
        </div>}
        {tab === 'access' && <div className="form-grid employee-fields">
          <label>اسم الدخول<input required autoComplete="username" value={draft.username} onChange={(event) => setDraft({...draft, username: event.target.value})}/></label>
          <label>مجموعة الصلاحيات<select required value={draft.roleId} onChange={(event) => setDraft({...draft, roleId: event.target.value})}>{state.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
          <label className="checkbox-field employee-status"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({...draft, active: event.target.checked})}/> حساب نشط</label>
          <div className="access-hint"><Shield size={17}/><span>{state.roles.find((role) => role.id === draft.roleId)?.description ?? 'اختر مجموعة الصلاحيات المناسبة.'}</span></div>
        </div>}
        {tab === 'warehouses' && <div className="warehouse-assignment">
          <p className="muted">تُستخدم هذه التعيينات كقاعدة سجل لمجموعات نطاقها «المستودعات المخصصة».</p>
          {state.warehouses.map((warehouse) => <label className="warehouse-assignment-row" key={warehouse.id}><span><Warehouse size={16}/><strong>{warehouse.name}</strong><small>{warehouse.code}</small></span><input type="checkbox" checked={draft.warehouseIds.includes(warehouse.id)} onChange={(event) => updateWarehouseSelection(warehouse.id, event.target.checked)}/></label>)}
          {!state.warehouses.length && <div className="empty-state">أضف مستودعاً قبل تعيين نطاق الوصول.</div>}
        </div>}
        {tab === 'security' && <div className="form-grid employee-fields">
          <label>كلمة المرور{draft.id ? ' الجديدة (اتركها فارغة دون تغيير)' : ''}<input type="password" autoComplete="new-password" minLength={10} value={draft.password} onChange={(event) => setDraft({...draft, password: event.target.value})} required={!draft.id}/></label>
          <label>PIN للمسح بالباركود (4–8 أرقام)<input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={draft.pin} onChange={(event) => setDraft({...draft, pin: event.target.value.replace(/\D/g, '')})} placeholder={draft.pinHash ? 'تم تعيين PIN — اكتب قيمة جديدة للاستبدال' : 'اختياري'}/></label>
          <div className="access-hint"><KeyRound size={17}/><span>لا يتم عرض بيانات الاعتماد المخزنة. تغيير كلمة المرور أو PIN يستبدل التجزئة الحالية.</span></div>
        </div>}
        {error && <div className="system-banner error" role="alert">{error}</div>}
        <div className="toolbar"><button className="action-btn primary" type="submit"><Save size={16}/> حفظ الموظف</button><button className="action-btn" type="button" onClick={() => setEditing(false)}>إلغاء</button></div>
      </form>
    </section>}

    {section === 'groups' && <div className="access-group-layout">
      <section className="panel">
        <div className="section-head"><div><h3>مجموعات الأمان</h3><p className="muted">ACL لكل نموذج وقواعد نطاق المستودعات.</p></div></div>
        <div className="access-role-list">{state.roles.map((role) => <button type="button" key={role.id} className={`access-role-item ${role.id === selectedRoleId ? 'selected' : ''}`} onClick={() => setSelectedRoleId(role.id)}><Shield size={16}/><span><strong>{role.name}</strong><small>{state.users.filter((user) => user.roleId === role.id).length} مستخدم</small></span></button>)}</div>
      </section>
      {selectedRole && <section className="panel access-matrix-panel">
        <div className="section-head"><div><h3>{selectedRole.name}</h3><p className="muted">{selectedRole.description}</p></div></div>
        <label className="record-rule-select">قاعدة السجلات (المستودعات)
          <select value={selectedRole.warehouseScope ?? 'all'} onChange={(event) => onSaveRole({...selectedRole, warehouseScope: event.target.value as Role['warehouseScope']})}>
            <option value="all">جميع المستودعات</option><option value="assigned">المستودعات المخصصة للموظف</option>
          </select>
        </label>
        <div className="table-wrap"><table className="erp-table permission-matrix"><thead><tr><th>النموذج / التطبيق</th>{accessActions.map((action) => <th key={action.id}>{action.label}</th>)}</tr></thead>
          <tbody>{accessResources.map((resource) => <tr key={resource.id}><td><strong>{resource.label}</strong></td>{accessActions.map((action) => <td key={action.id}><label className="permission-check"><input aria-label={`${resource.label}: ${action.label}`} type="checkbox" checked={!!selectedRole.permissions?.[resource.id]?.includes(action.id)} onChange={(event) => updateRolePermission(resource.id, action.id, event.target.checked)}/>{selectedRole.permissions?.[resource.id]?.includes(action.id) && <Check size={12}/>}</label></td>)}</tr>)}</tbody>
        </table></div>
      </section>}
    </div>}
  </div>;
}
