/**
 * CollapsibleSection — a reusable card that collapses to just its title bar.
 *
 * Usage:
 *   <CollapsibleSection title="Oldest Unsold Stock" count={12} defaultOpen={false}>
 *     {children}
 *   </CollapsibleSection>
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  title: string;
  /** Optional small badge count shown in the header */
  count?: number | string;
  /** Optional right-side label (e.g. "£12,000") */
  meta?: string;
  /** Icon to show left of title */
  icon?: React.ReactNode;
  /** Accent colour class for the left border stripe, e.g. 'border-l-emerald-500' */
  accent?: string;
  /** Whether to start open. Defaults to true. */
  defaultOpen?: boolean;
  children: React.ReactNode;
  /** Extra classes on the outer wrapper */
  className?: string;
}

export default function CollapsibleSection({
  title,
  count,
  meta,
  icon,
  accent = 'border-l-gray-300',
  defaultOpen = true,
  children,
  className = '',
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden ${className}`}>
      {/* Header — always visible, click to toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left group"
      >
        {/* Left accent stripe */}
        <div className={`w-1 h-6 rounded-full flex-shrink-0 border-l-4 ${accent}`} />

        {/* Icon */}
        {icon && (
          <span className="text-gray-400 group-hover:text-gray-600 transition-colors flex-shrink-0">
            {icon}
          </span>
        )}

        {/* Title */}
        <span className="flex-1 text-[11px] font-bold uppercase tracking-widest text-gray-700 truncate">
          {title}
        </span>

        {/* Count badge */}
        {count !== undefined && (
          <span className="text-[9px] font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0">
            {count}
          </span>
        )}

        {/* Meta label */}
        {meta && (
          <span className="text-[10px] font-bold text-gray-600 font-mono flex-shrink-0">
            {meta}
          </span>
        )}

        {/* Chevron */}
        <span className="text-gray-400 flex-shrink-0 transition-transform duration-200">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {/* Body — animated collapse */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-100">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
