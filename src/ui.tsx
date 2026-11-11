import React,{useEffect} from 'react';
import {animate,motion,useMotionValue,useTransform} from 'framer-motion';

export const Counter = ({to, suffix = ''}: {to: number; suffix?: string}) => {
  const value = useMotionValue(0);
  const text = useTransform(value, (x) => `${Math.round(x).toLocaleString('ar-EG')}${suffix}`);

  useEffect(() => {
    const controls = animate(value, to, {duration: 1.2, ease: 'easeOut'});
    return () => controls.stop();
  }, [to, value]);

  return <motion.span>{text}</motion.span>;
};

export const Logo = ({size = 44}: {size?: number}) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-label="CORE ERP logo" role="img">
    <motion.path
      d="M47.2 15.1A23 23 0 1 0 47 48.8"
      fill="none"
      stroke="#B08D57"
      strokeWidth="5"
      strokeLinecap="round"
      initial={{pathLength: 0}}
      animate={{pathLength: 1}}
      transition={{duration: 1, ease: 'easeOut'}}
    />
    <motion.path
      d="M26 39 52 13m-13 0h13v13"
      fill="none"
      stroke="#B08D57"
      strokeWidth="5"
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={{pathLength: 0}}
      animate={{pathLength: 1}}
      transition={{delay: .35, duration: .65, ease: 'easeOut'}}
    />
  </svg>
);

export const Page = ({children}: {children: React.ReactNode}) => (
  <motion.div
    initial={{opacity: 0, y: 18, scale: 0.98}}
    animate={{opacity: 1, y: 0, scale: 1}}
    exit={{opacity: 0, y: -12}}
    transition={{type: 'spring', stiffness: 220, damping: 24}}
  >
    {children}
  </motion.div>
);

export const Rows = ({rows, head}: {rows: Array<Array<string | number | React.ReactNode>>; head: string[]}) => (
  <table className="erp-table">
    <thead>
      <tr>
        {head.map((h) => (
          <th key={h}>{h}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((r, i) => (
        <motion.tr
          key={i}
          initial={{opacity: 0, x: 18}}
          animate={{opacity: 1, x: 0}}
          transition={{delay: i * 0.06}}
        >
          {r.map((c, j) => (
            <td key={`${i}-${j}`}>{c}</td>
          ))}
        </motion.tr>
      ))}
    </tbody>
  </table>
);
