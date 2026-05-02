import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface Props {
  imei: string;
  /** show the full IMEI text alongside the icon (default: true) */
  showText?: boolean;
  /** extra class names on the wrapper */
  className?: string;
  /** truncate the displayed IMEI to N chars (only if showText) */
  truncate?: number;
}

export default function CopyImei({ imei, showText = true, className = '', truncate }: Props) {
  const [copied, setCopied] = useState(false);

  if (!imei) return null;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(imei);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // fallback for non-https / older browsers
      const el = document.createElement('textarea');
      el.value = imei;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const displayImei = truncate ? imei.slice(0, truncate) + (imei.length > truncate ? '…' : '') : imei;

  return (
    <button
      onClick={handleCopy}
      title={`Copy IMEI: ${imei}`}
      className={`inline-flex items-center gap-1 font-mono group transition-colors ${className}`}
    >
      {showText && (
        <span className="text-[9px] text-gray-400 group-hover:text-gray-700 transition-colors leading-none">
          {displayImei}
        </span>
      )}
      <span
        className={`flex-shrink-0 w-4 h-4 flex items-center justify-center rounded transition-all ${
          copied
            ? 'text-emerald-600 bg-emerald-100'
            : 'text-gray-300 group-hover:text-gray-600 group-hover:bg-gray-100'
        }`}
      >
        {copied ? <Check size={10} strokeWidth={3} /> : <Copy size={10} />}
      </span>
    </button>
  );
}
