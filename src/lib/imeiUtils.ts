// Backward-compat shim. Real implementation lives in `./deviceId.ts`.
// New code should import from `./deviceId` directly to access the full
// classifier API (classifyDeviceId, validateAppleSerial, etc.).
export {
  validateIMEI,
  formatIMEI,
  maskIMEI,
  getTAC,
} from './deviceId';
