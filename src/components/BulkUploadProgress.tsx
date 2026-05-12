import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, AlertCircle, Loader } from 'lucide-react';
import type { BulkUploadProgress } from '../lib/bulkImageUploadService';

interface Props {
  progress: BulkUploadProgress;
  isProcessing: boolean;
}

export default function BulkUploadProgressComponent({ progress, isProcessing }: Props) {
  const [displayedProgress, setDisplayedProgress] = useState(0);

  useEffect(() => {
    setDisplayedProgress(progress.percentage);
  }, [progress.percentage]);

  const formatTime = (ms: number) => {
    if (ms < 1000) return '<1s';
    const secs = Math.round(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.round(secs / 60);
    return `${mins}m`;
  };

  const failureRate = progress.total > 0 ? (progress.failed / progress.total) * 100 : 0;
  const successRate = progress.total > 0 ? ((progress.total - progress.failed) / progress.total) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-4 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isProcessing ? (
            <Loader size={18} className="text-blue-600 animate-spin" />
          ) : (
            <CheckCircle2 size={18} className={progress.failed > 0 ? 'text-amber-600' : 'text-emerald-600'} />
          )}
          <p className="text-sm font-semibold text-gray-900">
            {isProcessing ? 'Uploading images...' : 'Upload complete'}
          </p>
        </div>
        <p className="text-xs font-mono text-gray-600">
          {progress.processed}/{progress.total}
        </p>
      </div>

      {/* Current file */}
      {progress.currentFile && (
        <p className="text-xs text-gray-600 truncate">
          📷 {progress.currentFile}
        </p>
      )}

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-900">Progress</p>
          <p className="text-xs text-gray-600">{displayedProgress}%</p>
        </div>
        <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${displayedProgress}%` }}
            transition={{ duration: 0.4 }}
            className="h-full bg-gradient-to-r from-blue-500 to-blue-600"
          />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="p-2 bg-white rounded-lg border border-emerald-200">
          <p className="text-[10px] font-bold text-emerald-700">Success</p>
          <p className="text-sm font-bold text-emerald-900">{progress.total - progress.failed}</p>
          <p className="text-[9px] text-emerald-600">{Math.round(successRate)}%</p>
        </div>
        {progress.failed > 0 && (
          <div className="p-2 bg-white rounded-lg border border-red-200">
            <p className="text-[10px] font-bold text-red-700">Failed</p>
            <p className="text-sm font-bold text-red-900">{progress.failed}</p>
            <p className="text-[9px] text-red-600">{Math.round(failureRate)}%</p>
          </div>
        )}
        <div className="p-2 bg-white rounded-lg border border-gray-200">
          <p className="text-[10px] font-bold text-gray-700">Time</p>
          <p className="text-sm font-bold text-gray-900">{formatTime(progress.elapsedMs)}</p>
          {isProcessing && progress.estimatedRemainingMs > 0 && (
            <p className="text-[9px] text-gray-600">~{formatTime(progress.estimatedRemainingMs)} left</p>
          )}
        </div>
      </div>

      {/* Speed indicator */}
      {isProcessing && progress.processed > 0 && (
        <p className="text-[9px] text-gray-600 text-center">
          {Math.round((progress.processed / (progress.elapsedMs / 1000)) * 10) / 10} images/sec
        </p>
      )}
    </motion.div>
  );
}
