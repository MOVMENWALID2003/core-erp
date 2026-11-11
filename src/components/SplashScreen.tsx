import {useEffect, useState} from 'react';
import {AnimatePresence, motion} from 'framer-motion';
import {Logo} from '../ui';

type Props = {
  ready: boolean;
};

export function SplashScreen({ready}: Props) {
  const [minimumTimeElapsed, setMinimumTimeElapsed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setMinimumTimeElapsed(true), 1600);
    return () => window.clearTimeout(timer);
  }, []);

  const visible = !ready || !minimumTimeElapsed;

  return (
    <AnimatePresence>
      {visible && <motion.div
        className="splash-screen"
        dir="rtl"
        role="status"
        aria-live="polite"
        initial={{opacity: 0}}
        animate={{opacity: 1}}
        exit={{opacity: 0}}
        transition={{duration: .42, ease: 'easeOut'}}
      >
        <div className="splash-card">
          <div className="splash-logo"><Logo size={74}/></div>
          <h1>CORE ERP</h1>
          <p>نظام إدارة الموارد المتكامل</p>
          <div className="splash-progress" aria-hidden="true"><motion.span
            initial={{x: '110%'}}
            animate={{x: '-110%'}}
            transition={{duration: 1.15, repeat: Infinity, ease: 'easeInOut'}}
          /></div>
          <small>جار تهيئة مساحة العمل بأمان</small>
        </div>
        <footer className="splash-credits">
          <span>المطور: MOAMEN ELBARADEI</span>
          <span>الإصدار v5.4.21 · نسخة التطبيق 1.0.0</span>
        </footer>
      </motion.div>}
    </AnimatePresence>
  );
}
