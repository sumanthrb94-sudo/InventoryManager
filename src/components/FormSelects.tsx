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
  const isPreset = !value || SIM_TYPE_OPTIONS.includes(value as any);
  const [isOther, setIsOther] = React.useState(!isPreset);

  React.useEffect(() => {
    setIsOther(!isPreset);
  }, [value, isPreset]);

  return (
    <div>
      <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">
        SIM Type
      </label>
      <select
        value={isOther ? '__other__' : value}
        onChange={e => {
          const v = e.target.value;
          if (v === '__other__') {
            setIsOther(true);
            onChange('');
          } else {
            setIsOther(false);
            onChange(v);
          }
        }}
        className={className || "w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-black transition-all bg-white"}
      >
        <option value="">Select SIM type...</option>
        {SIM_TYPE_OPTIONS.map(t => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
        <option value="__other__">Other</option>
      </select>
      {isOther && (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Type custom SIM type..."
          className="mt-1 w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-black bg-white"
        />
      )}
    </div>
  );
}

export function SimTypeSelectCompact({ value, onChange, className }: SelectProps) {
  const isPreset = !value || SIM_TYPE_OPTIONS.includes(value as any);
  const [isOther, setIsOther] = React.useState(!isPreset);

  React.useEffect(() => {
    setIsOther(!isPreset);
  }, [value, isPreset]);

  return (
    <div className="flex flex-col gap-1 w-full">
      <select
        value={isOther ? '__other__' : value}
        onChange={e => {
          const v = e.target.value;
          if (v === '__other__') {
            setIsOther(true);
            onChange('');
          } else {
            setIsOther(false);
            onChange(v);
          }
        }}
        className={className || "w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-mono focus:outline-none focus:border-black bg-white transition-all"}
      >
        <option value=""></option>
        {SIM_TYPE_OPTIONS.map(t => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
        <option value="__other__">Other</option>
      </select>
      {isOther && (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Custom..."
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1 text-[11px] focus:outline-none focus:border-black font-mono bg-white"
        />
      )}
    </div>
  );
}
