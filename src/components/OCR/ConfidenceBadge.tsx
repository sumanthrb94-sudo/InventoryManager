import React from 'react';
import { AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react';

interface Props {
  confidence: number;
  label?: string;
  showIcon?: boolean;
}

export default function ConfidenceBadge({ confidence, label, showIcon = true }: Props) {
  let bgColor = '';
  let textColor = '';
  let borderColor = '';
  let Icon = CheckCircle2;

  if (confidence >= 0.8) {
    bgColor = 'bg-emerald-50';
    textColor = 'text-emerald-700';
    borderColor = 'border-emerald-200';
    Icon = CheckCircle2;
  } else if (confidence >= 0.6) {
    bgColor = 'bg-amber-50';
    textColor = 'text-amber-700';
    borderColor = 'border-amber-200';
    Icon = AlertTriangle;
  } else {
    bgColor = 'bg-red-50';
    textColor = 'text-red-700';
    borderColor = 'border-red-200';
    Icon = AlertCircle;
  }

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-semibold ${bgColor} ${textColor} ${borderColor}`}>
      {showIcon && <Icon size={14} />}
      {label && <span>{label}:</span>}
      <span>{Math.round(confidence * 100)}%</span>
    </div>
  );
}
