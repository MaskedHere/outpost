import type { Transition, Variants } from 'framer-motion';

export const easeOut: Transition = { duration: 0.22, ease: [0.16, 1, 0.3, 1] };

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: easeOut },
  exit: { opacity: 0, y: -6, transition: { duration: 0.15, ease: [0.4, 0, 1, 1] } },
};

export const staggerContainer: Variants = {
  animate: { transition: { staggerChildren: 0.045, delayChildren: 0.02 } },
};

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: easeOut },
  exit: { opacity: 0, scale: 0.85, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } },
};

export const cardHover = {
  whileHover: { y: -3, transition: easeOut },
  whileTap: { scale: 0.98 },
};
