import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State { hasError: boolean; message: string }

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err?.message || 'Unknown error' };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', err, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4 text-center">
          <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center mx-auto">
            <AlertTriangle size={22} className="text-red-500" />
          </div>
          <div>
            <p className="text-sm font-bold">Something went wrong</p>
            <p className="text-[10px] text-gray-400 font-mono mt-1 break-all">{this.state.message}</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 mx-auto px-5 py-2.5 bg-black text-white rounded-xl text-[11px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all"
          >
            <RefreshCw size={13} /> Reload App
          </button>
        </div>
      </div>
    );
  }
}
