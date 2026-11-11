import {useEffect, useState} from 'react';
import {UserRound} from 'lucide-react';

type Props = {
  name: string;
  avatarUrl?: string;
  size?: number;
  className?: string;
};

export function UserAvatar({name, avatarUrl, size = 36, className = ''}: Props) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [avatarUrl]);

  return (
    <span
      className={`user-avatar ${className}`}
      style={{width: size, height: size}}
      role="img"
      aria-label={`صورة ${name}`}
    >
      {avatarUrl && !imageFailed
        ? <img src={avatarUrl} alt="" onError={() => setImageFailed(true)}/>
        : <UserRound size={Math.max(16, Math.round(size * .52))} aria-hidden="true"/>}
    </span>
  );
}
