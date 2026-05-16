import { readFileSync } from 'node:fs';
import { parseSalesWorkbook } from '../src/lib/salesImport.ts';

const SALES_PATH = process.env.SALES_PATH ?? '/tmp/SALES_REPORT_2026.xlsx';

async function main() {
  const buf = readFileSync(SALES_PATH);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const parsed = await parseSalesWorkbook(ab as ArrayBuffer, 'SALES_REPORT_2026.xlsx');

  const groups: Record<string, { count: number; sumSP: number; sumBP: number; sumPost: number; sumCom: number; sumGP: number; zeroSP: number }> = {};
  for (const s of parsed.sales) {
    const g = groups[s.marketplace] ??= { count: 0, sumSP: 0, sumBP: 0, sumPost: 0, sumCom: 0, sumGP: 0, zeroSP: 0 };
    g.count++;
    g.sumSP += s.salePrice ?? 0;
    g.sumBP += s.buyPrice ?? 0;
    g.sumPost += (s as any).postage ?? 0;
    g.sumCom += (s as any).commission ?? 0;
    g.sumGP += (s as any).grossProfit ?? 0;
    if (!s.salePrice) g.zeroSP++;
  }

  console.log('marketplace | count | meanSP   | meanBP   | meanPost | meanCom  | meanGP   | zeroSP');
  console.log('------------|-------|----------|----------|----------|----------|----------|-------');
  for (const [m, g] of Object.entries(groups)) {
    const mean = (s: number) => (g.count ? (s / g.count).toFixed(2).padStart(8) : '       0');
    console.log(`${m.padEnd(11)} | ${String(g.count).padStart(5)} | ${mean(g.sumSP)} | ${mean(g.sumBP)} | ${mean(g.sumPost)} | ${mean(g.sumCom)} | ${mean(g.sumGP)} | ${g.zeroSP}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
