import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Loader } from 'lucide-react';

interface Props {
  progress: { done: number; total: number };
}

export default function ProcessingState({ progress }: Props) {
  const [estimatedTime, setEstimatedTime] = useState('');
  const percentage = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  useEffect(() => {
    // Simple time estimation
    if (progress.done > 0 && progress.done < progress.total) {
      const itemsPerSecond = progress.done / 2; // Rough estimate
      const remaining = progress.total - progress.done;
      const secondsLeft = remaining / itemsPerSecond;
      if (secondsLeft > 1) {
        setEstimatedTime(`~${Math.ceil(secondsLeft)}s remaining`);
      } else {
        setEstimatedTime('Almost done...');
      }
    }
  }, [progress]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-16 space-y-8"
    >
      {/* Animated loading icon */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
      >
        <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-blue-500 to-emerald-500 flex items-center justify-center">
          <Loader size={32} className="text-white" />
        </div>
      </motion.div>

      {/* Status text */}
      <div className="text-center space-y-2">
        <h3 className="text-xl font-bold text-gray-900">Adding Stock to Inventory</h3>
        <p className="text-sm text-gray-500">
          Processing {progress.done} of {progress.total} units
        </p>
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-xs space-y-2">
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            className="h-full bg-gradient-to-r from-blue-500 to-emerald-500"
            transition={{ type: 'spring', stiffness: 100, damping: 20 }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-700">{percentage}%</span>
          {estimatedTime && (
            <span className="text-xs text-gray-500">{estimatedTime}</span>
          )}
        </div>
      </div>

      {/* Subtle animation dots */}
      <div className="flex gap-1">
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              delay: i * 0.3,
            }}
            className="w-2 h-2 bg-blue-500 rounded-full"
          />
        ))}
      </div>
    </motion.div>
  );
}
