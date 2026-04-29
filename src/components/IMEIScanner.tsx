import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface Props {
  onScan: (value: string) => void;
  onError?: (error: string) => void;
}

const SCANNER_ID = 'nexus-qr-reader';

export default function IMEIScanner({ onScan, onError }: Props) {
  const [status, setStatus] = useState<'starting' | 'active' | 'error'>('starting');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScan   = useRef<string>('');

  useEffect(() => {
    const scanner = new Html5Qrcode(SCANNER_ID, {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.CODE_128,   // Most IMEI barcodes
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
      ],
      verbose: false,
    });
    scannerRef.current = scanner;

    scanner.start(
      { facingMode: 'environment' }, // rear camera
      {
        fps: 10,
        qrbox: { width: 280, height: 120 },
        aspectRatio: 1.6,
      },
      (decodedText) => {
        // Debounce: don't fire the same code twice in a row
        if (decodedText === lastScan.current) return;
        lastScan.current = decodedText;

        // Extract digits only (IMEI is 15 digits)
        const digits = decodedText.replace(/\D/g, '');
        const value  = digits.length >= 14 ? digits : decodedText;

        onScan(value);

        // Brief pause before allowing next scan
        setTimeout(() => { lastScan.current = ''; }, 3000);
      },
      () => { /* ignore frame errors */ }
    ).then(() => setStatus('active'))
     .catch((err) => {
        setStatus('error');
        onError?.(err?.message ?? 'Camera unavailable');
      });

    return () => {
      scanner.isScanning && scanner.stop().catch(() => {});
    };
  }, []);

  return (
    <div className="relative w-full overflow-hidden rounded-2xl bg-black">
      {/* The scanner mounts itself inside this div */}
      <div id={SCANNER_ID} className="w-full" />

      {/* Scan-line overlay */}
      {status === 'active' && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-72 h-28 border-2 border-white/60 rounded-xl relative">
            {/* Corner accents */}
            <span className="absolute top-0 left-0 w-5 h-5 border-t-4 border-l-4 border-white rounded-tl-lg" />
            <span className="absolute top-0 right-0 w-5 h-5 border-t-4 border-r-4 border-white rounded-tr-lg" />
            <span className="absolute bottom-0 left-0 w-5 h-5 border-b-4 border-l-4 border-white rounded-bl-lg" />
            <span className="absolute bottom-0 right-0 w-5 h-5 border-b-4 border-r-4 border-white rounded-br-lg" />
            {/* Animated scan line */}
            <div
              className="absolute left-1 right-1 h-0.5 bg-gradient-to-r from-transparent via-green-400 to-transparent"
              style={{
                animation: 'scanLine 2s ease-in-out infinite',
              }}
            />
          </div>
        </div>
      )}

      {/* Starting state */}
      {status === 'starting' && (
        <div className="absolute inset-0 bg-black flex items-center justify-center rounded-2xl">
          <div className="text-center text-white space-y-3">
            <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs font-mono uppercase tracking-widest text-white/60">Starting camera…</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {status === 'error' && (
        <div className="h-40 bg-gray-900 flex items-center justify-center rounded-2xl">
          <div className="text-center px-6">
            <p className="text-white text-sm font-bold">Camera unavailable</p>
            <p className="text-gray-400 text-xs font-mono mt-1">Grant camera permission and reload</p>
          </div>
        </div>
      )}

      <style>{`
        @keyframes scanLine {
          0%   { top: 8px;  opacity: 1; }
          50%  { top: calc(100% - 8px); opacity: 1; }
          100% { top: 8px;  opacity: 1; }
        }
      `}</style>
    </div>
  );
}
