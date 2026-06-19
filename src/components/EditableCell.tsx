/**
 * EditableCell — admin-only double-click-to-edit primitive.
 *
 *   <EditableCell
 *     value={u.buyPrice}
 *     display={`£${u.buyPrice}`}
 *     type="number"
 *     onSave={(v) => dbService.update('inventoryUnits', u.id, { buyPrice: Number(v) })}
 *   />
 *
 * Behaviour:
 *   - Renders `display` (or `value`) read-only.
 *   - Double-click → swaps to an <input> / <select> focused at cursor.
 *   - Enter or blur → persists via onSave; Esc → cancels.
 *   - Non-admin → render-only (double-click is a no-op).
 *
 * Saves go straight to Firestore via the caller's `onSave`. The component
 * holds no app state — Firestore's onSnapshot subscriptions in the
 * inventoryStore / sales store will re-render the parent the moment the
 * write lands.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useIsAdmin } from '../lib/useIsAdmin';

type Option = { value: string; label: string };

interface Props {
  value: string | number | null | undefined;
  /** What to render in read-only mode. Defaults to String(value). */
  display?: React.ReactNode;
  type?: 'text' | 'number';
  /** When present, render a <select> on edit instead of <input>. */
  options?: Option[];
  /** Persist callback. Receives the string from the input/select; coerce inside if numeric. */
  onSave: (next: string) => Promise<void> | void;
  /** Tailwind className applied to the read-only wrapper. */
  className?: string;
  /** Optional inline style on the wrapper (e.g. max-width). */
  style?: React.CSSProperties;
  /** Render-only — never editable. Use for system fields. */
  readOnly?: boolean;
  /** Tooltip on the read-only span. */
  title?: string;
}

export default function EditableCell({
  value,
  display,
  type = 'text',
  options,
  onSave,
  className = '',
  style,
  readOnly = false,
  title,
}: Props) {
  const isAdmin = useIsAdmin();
  const editable = isAdmin && !readOnly;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState<string>(value == null ? '' : String(value));
  const [saving, setSaving]   = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) inputRef.current.select();
    }
  }, [editing]);

  // Keep draft in sync if the underlying value changes while not editing
  useEffect(() => {
    if (!editing) setDraft(value == null ? '' : String(value));
  }, [value, editing]);

  const commit = async () => {
    const next = draft.trim();
    const original = value == null ? '' : String(value);
    if (next === original) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch (err) {
      console.error('EditableCell save failed', err);
      setDraft(original);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(value == null ? '' : String(value));
    setEditing(false);
  };

  if (!editing) {
    return (
      <span
        onDoubleClick={editable ? () => setEditing(true) : undefined}
        className={`${className} ${editable ? 'cursor-text hover:bg-amber-50/60 hover:ring-1 hover:ring-amber-200 rounded px-0.5' : ''}`}
        style={style}
        title={editable ? (title || 'Double-click to edit') : title}
      >
        {display ?? (value ?? '—')}
      </span>
    );
  }

  if (options) {
    return (
      <select
        ref={el => { inputRef.current = el; }}
        value={draft}
        disabled={saving}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        }}
        className="border border-amber-400 rounded px-1 py-0.5 text-[11px] font-mono bg-white focus:outline-none focus:border-black"
        style={style}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }

  return (
    <input
      ref={el => { inputRef.current = el; }}
      type={type}
      value={draft}
      disabled={saving}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      }}
      className="w-full border border-amber-400 rounded px-1 py-0.5 text-[11px] font-mono bg-white focus:outline-none focus:border-black"
      style={style}
    />
  );
}
