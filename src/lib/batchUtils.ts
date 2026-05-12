/**
 * Batch ID generation system
 * Format: SUPPLIER_CODE-YYYYMMDD-HHMMSS
 * Example: MHE-20260511-115423
 */

export function generateBatchId(supplierName: string): string {
  // Extract supplier code (first 3 characters, uppercase)
  const supplierCode = (supplierName || 'UNK')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .substring(0, 3)
    .padEnd(3, 'X'); // Pad with X if shorter than 3 chars

  // Get current date and time
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  const dateStr = `${year}${month}${day}`;
  const timeStr = `${hours}${minutes}${seconds}`;

  return `${supplierCode}-${dateStr}-${timeStr}`;
}

export function formatBatchId(batchId: string): string {
  if (!batchId) return '—';
  // Format for display: "MHE-2026/05/11 11:54:23"
  const match = batchId.match(/^([A-Z0-9]{3})-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!match) return batchId;
  const [, code, year, month, day, hours, mins, secs] = match;
  return `${code}-${year}/${month}/${day} ${hours}:${mins}:${secs}`;
}

export function extractSupplierCodeFromBatch(batchId: string): string {
  if (!batchId) return '—';
  return batchId.substring(0, 3);
}

export function extractDateFromBatch(batchId: string): string {
  if (!batchId) return '—';
  const match = batchId.match(/^[A-Z0-9]{3}-(\d{4})(\d{2})(\d{2})/);
  if (!match) return '—';
  return `${match[1]}-${match[2]}-${match[3]}`;
}
