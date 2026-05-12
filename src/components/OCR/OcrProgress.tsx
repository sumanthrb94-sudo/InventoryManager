import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';

interface Props {
  progress: number; // 0-100
  isProcessing: boolean;
  estimatedTimeRemaining?: number; // in seconds
}

export default function OcrProgress({ progress, isProcessing, estimatedTimeRemaining }: Props) {
  const [displayedProgress, setDisplayedProgress] = useState(0);

  useEffect(() => {
    setDisplayedProgress(progress);
  }, [progress]);

  const formatTime = (seconds?: number) => {
    if (!seconds) return '';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    return `${Math.round(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-3"
    >
      {/* Progress label */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">
          {isProcessing ? 'Processing image...' : 'Processing complete'}
        </p>
        <p className="text-xs text-gray-500">{displayedProgress}%</p>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${displayedProgress}%` }}
          transition={{ duration: 0.3 }}
          className="h-full bg-gradient-to-r from-blue-500 to-blue-600"
        />
      </div>

      {/* Estimated time */}
      {isProcessing && estimatedTimeRemaining && (
        <p className="text-xs text-gray-500 text-center">
          Estimated time remaining: {formatTime(estimatedTimeRemaining)}
        </p>
      )}

      {/* Loading spinner */}
      {isProcessing && (
        <div className="flex justify-center py-2">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full"
          />
        </div>
      )}
    </motion.div>
  );
}
