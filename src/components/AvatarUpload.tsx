import {useRef, useState} from 'react';
import {Camera, LoaderCircle} from 'lucide-react';
import {UserAvatar} from './UserAvatar';

type Props = {
  fullName: string;
  avatarUrl?: string;
  onUploaded: (dataUrl: string) => Promise<void>;
};

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 512;

async function compressImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('اختر صورة بصيغة JPG أو PNG أو WebP.');
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('يجب ألا يتجاوز حجم الصورة 8 ميغابايت.');
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('متصفح التطبيق لا يدعم معالجة الصور.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('تعذر تجهيز الصورة للرفع.'));
      }, 'image/jpeg', 0.82);
    });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('تعذر حفظ الصورة محلياً.'));
      reader.onerror = () => reject(reader.error ?? new Error('تعذر قراءة الصورة.'));
      reader.readAsDataURL(blob);
    });
  } finally {
    bitmap.close();
  }
}

export function AvatarUpload({fullName, avatarUrl, onUploaded}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const uploadAvatar = async (file?: File) => {
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const dataUrl = await compressImage(file);
      await onUploaded(dataUrl);
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'حدث خطأ غير متوقع أثناء حفظ الصورة.';
      console.error('Local avatar save failed:', uploadError);
      setError(message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="avatar-upload">
      <UserAvatar name={fullName} avatarUrl={avatarUrl} size={56}/>
      <div className="avatar-upload-details">
        <strong>الصورة الشخصية</strong>
        <small>JPG أو PNG أو WebP، حتى 8 ميغابايت. يتم ضغطها وحفظها محلياً للعمل دون اتصال.</small>
        <button type="button" className="action-btn" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <LoaderCircle className="loading-spinner" size={16}/> : <Camera size={16}/>}
          {uploading ? 'جار حفظ الصورة...' : 'اختيار صورة'}
        </button>
        <input
          ref={inputRef}
          className="avatar-file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="اختيار صورة الملف الشخصي"
          disabled={uploading}
          onChange={(event) => void uploadAvatar(event.target.files?.[0])}
        />
      </div>
      {error && <div className="avatar-upload-error" role="alert">{error}</div>}
    </div>
  );
}
