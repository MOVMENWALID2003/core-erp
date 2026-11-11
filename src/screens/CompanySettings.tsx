import {useEffect, useState} from 'react';
import {Building2, Save} from 'lucide-react';
import {generateId} from '../store';
import type {AppState, Company} from '../types';

type Props = {
  state: AppState;
  onSaveCompany: (company: Company) => void;
};

function blankCompany(): Company {
  return {
    id: generateId('company'),
    name: '',
    code: '',
    taxNumber: '',
    country: '',
    address: '',
    currency: 'EGP',
    createdAt: new Date().toISOString(),
  };
}

export function CompanySettings({state, onSaveCompany}: Props) {
  const [form, setForm] = useState<Company>(state.company);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!creating) setForm(state.company);
  }, [state.company, creating]);

  const startNew = () => {
    setError('');
    setForm(blankCompany());
    setCreating(true);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!form.name.trim() || !form.code.trim()) {
      setError('اسم الشركة ورمزها مطلوبان.');
      return;
    }
    if (!creating && form.defaultWarehouseId
      && !state.warehouses.some((warehouse) => warehouse.companyId === form.id && warehouse.id === form.defaultWarehouseId)) {
      setError('اختر مستودعاً تابعاً للشركة الحالية.');
      return;
    }
    onSaveCompany({...form, name: form.name.trim(), code: form.code.trim().toUpperCase()});
    setCreating(false);
  };

  return <div className="page-content" dir="rtl">
    <div className="page-title">
      <div><span className="eyebrow">الإعدادات متعددة الشركات</span><h2>ملف الشركة</h2><p>إدارة بيانات الكيان الحالي والمستودع الافتراضي.</p></div>
      {!creating && <button className="action-btn" type="button" onClick={startNew}><Building2 size={16}/> إنشاء شركة</button>}
    </div>
    <section className="panel company-profile-panel">
      <div className="section-head"><div><h3>{creating ? 'شركة جديدة' : form.name}</h3><p className="muted">{creating ? 'يُنشأ مستودع رئيسي افتراضي تلقائياً للشركة الجديدة.' : `رمز الشركة: ${form.code}`}</p></div></div>
      <form className="form-grid company-profile-form" onSubmit={submit}>
        <label>اسم الشركة<input required value={form.name} onChange={(event) => setForm({...form, name: event.target.value})}/></label>
        <label>رمز الشركة<input required value={form.code} onChange={(event) => setForm({...form, code: event.target.value.toUpperCase()})}/></label>
        <label>الرقم الضريبي<input value={form.taxNumber} onChange={(event) => setForm({...form, taxNumber: event.target.value})}/></label>
        <label>الدولة<input value={form.country} onChange={(event) => setForm({...form, country: event.target.value})}/></label>
        <label>العملة<input maxLength={3} value={form.currency ?? ''} onChange={(event) => setForm({...form, currency: event.target.value.toUpperCase()})} placeholder="EGP"/></label>
        <label>بيانات صورة الشعار المحلية<input type="text" value={form.logoUrl ?? ''} onChange={(event) => setForm({...form, logoUrl: event.target.value})} placeholder="data:image/png;base64,..."/></label>
        <label className="company-address-field">العنوان<textarea rows={3} value={form.address ?? ''} onChange={(event) => setForm({...form, address: event.target.value})}/></label>
        {!creating && <label>المستودع الافتراضي<select value={form.defaultWarehouseId ?? ''} onChange={(event) => setForm({...form, defaultWarehouseId: event.target.value || undefined})}><option value="">غير محدد</option>{state.warehouses.filter((warehouse) => warehouse.companyId === form.id).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}</select></label>}
        {error && <div className="system-banner error company-form-error" role="alert">{error}</div>}
        <div className="toolbar company-form-actions"><button className="action-btn primary" type="submit"><Save size={16}/> حفظ بيانات الشركة</button>{creating && <button className="action-btn" type="button" onClick={() => {setCreating(false); setForm(state.company);}}>إلغاء</button>}</div>
      </form>
    </section>
    <div className="security-notice"><Building2 size={17}/><span>المخزون والمستودعات والعمليات والمستخدمون تُعرض حسب الشركة النشطة. لا تُمنح صلاحية الانتقال لشركة إلا إذا كانت ضمن شركات المستخدم المصرح بها.</span></div>
  </div>;
}
