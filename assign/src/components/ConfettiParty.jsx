import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

const COLORS = ['#847dff', '#00b3dd', '#dd90d8', '#d1c9ff', '#90b8f0', '#63d990'];

/** Tiny burst of confetti chips near the top-right ("Done" side of boards) whenever a task completes. */
export default function ConfettiParty() {
  const [bits, setBits] = useState([]);
  useEffect(() => {
    const on = () => {
      const id = Math.random().toString(36).slice(2);
      const now = Date.now();
      const chips = Array.from({ length: 26 }, (_, i) => ({
        id: `${id}-${i}`,
        x0: Math.random() * 30 - 15,
        x1: (Math.random() - 0.5) * 260,
        y1: 280 + Math.random() * 380,
        rot: (Math.random() - 0.5) * 560,
        color: COLORS[i % COLORS.length],
        delay: Math.random() * 0.14,
        dur: 1 + Math.random() * 0.5,
        left: 62 + Math.random() * 26, // % of viewport — right-of-center, above the done column
      }));
      setBits((b) => [...b, ...chips]);
      setTimeout(() => setBits((b) => b.filter((x) => !chips.some((c) => c.id === x.id))), 1900);
      void now;
    };
    window.addEventListener('assign:party', on);
    return () => window.removeEventListener('assign:party', on);
  }, []);
  return (
    <AnimatePresence>
      {bits.map((bit) => (
        <motion.i key={bit.id} aria-hidden className="confetti-bit"
          style={{ left: `${bit.left}%`, background: bit.color, animationDelay: `${bit.delay}s`, animationDuration: `${bit.dur}s`, '--x0': `${bit.x0}px`, '--x1': `${bit.x1}px`, '--y1': `${bit.y1}px`, '--rot': `${bit.rot}deg` }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      ))}
    </AnimatePresence>
  );
}
