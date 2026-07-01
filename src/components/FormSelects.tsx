import React from 'react';
import { GRADE_OPTIONS, STORAGE_OPTIONS, SIM_TYPE_OPTIONS } from '../lib/unitConstants';

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function GradeSelect({ value, onChange, className }: SelectProps) {
  return (
    <div>
      <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">
        Grade
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={className || "w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-black transition-all bg-white"}
      >
        <option value="">Select grade...</option>
        {GRADE_OPTIONS.map(g => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
    </div>
  );
}

export function GradeSelectCompact({ value, onChange, className }: SelectProps) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={className || "w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-mono focus:outline-none focus:border-black bg-white transition-all"}
    >
      <option value=""></option>
      {GRADE_OPTIONS.map(g => (
        <option key={g} value={g}>
          {g}
        </option>
      ))}
    </select>
  );
}

export function StorageSelect({ value, onChange, className }: SelectProps) {
  return (
    <div>
      <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">
        Storage
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={className || "w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-black transition-all bg-white"}
      >
        <option value="">Select storage...</option>
        {STORAGE_OPTIONS.map(s => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}

export function StorageSelectCompact({ value, onChange, className }: SelectProps) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={className || "w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-mono focus:outline-none focus:border-black bg-white transition-all"}
    >
      <option value=""></option>
      {STORAGE_OPTIONS.map(s => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

export function SimTypeSelect({ value, onChange, className }: SelectProps) {
  return (
    <div>
      <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">
        SIM Type
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={className || "w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-black transition-all bg-white"}
      >
        <option value="">Select SIM type...</option>
        {SIM_TYPE_OPTIONS.map(t => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SimTypeSelectCompact({ value, onChange, className }: SelectProps) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={className || "w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-mono focus:outline-none focus:border-black bg-white transition-all"}
    >
      <option value=""></option>
      {SIM_TYPE_OPTIONS.map(t => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}
