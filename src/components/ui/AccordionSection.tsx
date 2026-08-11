import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

interface DisclosureChevronProps {
  /** Mirrors the parent section's expanded state — drives the rotation. */
  open: boolean;
}

/**
 * Rotating chevron that sits in a disclosure's trigger button.
 *
 * Points right when collapsed, down when expanded. Kept separate from
 * `Disclosure` because the trigger and the collapsing body are siblings in the
 * markup — the button owns the chevron, the panel owns the content — so a
 * single wrapper component would force one to be nested inside the other.
 *
 * `aria-hidden` because the trigger button already carries the accessible
 * label; the chevron is pure decoration and would otherwise be announced twice.
 */
export function DisclosureChevron({ open }: DisclosureChevronProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.span
      aria-hidden
      className="inline-flex shrink-0"
      animate={{ rotate: open ? 90 : 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' }}
    >
      <ChevronRight size={14} />
    </motion.span>
  );
}

interface DisclosureProps {
  open: boolean;
  children: ReactNode;
}

/**
 * Collapsible body of a settings section.
 *
 * Animates on height rather than opacity alone so surrounding rows reflow as
 * the section opens — an opacity-only fade would leave a hole in the layout
 * while collapsed. `height: 'auto'` is safe here because framer-motion measures
 * the child and interpolates to the measured px value.
 *
 * `overflow-hidden` is required: mid-animation the wrapper is shorter than its
 * content, and without it the content would spill over the rows below.
 *
 * Unmounts when closed (via AnimatePresence) so collapsed sections cost nothing
 * — the settings overlay renders many of these, and several hold live inputs.
 */
export function Disclosure({ open, children }: DisclosureProps) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          className="overflow-hidden"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
