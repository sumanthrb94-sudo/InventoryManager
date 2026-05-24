/**
 * AddStockManualModal — manual stock-in entry, follows the client's spec:
 *
 *   Office Stock: IMEI mandatory · status=available · counts as office stock
 *   SHS Supplier Stock: IMEI optional · status=incoming · NOT in office stock
 *
 * Both tabs use the same schema (per client whiteboard, 17-May):
 *   1. Stock In Date    (batch-level — top of modal)
 *   2. Model            (per row)
 *   3. IMEI / Serial    (per row — required for Office, optional for SHS)
 *   4. Grade            (per row — A / B / C / Refurbished)
 *   5. Storage          (per row — auto-parsed from Model, overridable)
 *   6. Colour           (per row)
 *   7. Supplier         (per row — autocomplete from existing suppliers)
 *   8. Buying Price     (per row — must be > 0)
 *   9. Notes            (per row — optional)
 *
 * Priority-1 rule: IMEI duplication is rejected. The service layer
 * (addUnitManual) checks the live inventoryUnits collection; the UI
 * also runs an in-batch dedupe for instant feedback. Apple devices accept
 * a 10–12 char alphanumeric serial in place of the 15-digit IMEI.
 */
import React, { useState, useMemo, useCallback } from 'react';
import { X, Plus, Trash2, CheckCircle2, PackagePlus, AlertCircle, Truck, ClipboardPaste } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useInventoryStore } from '../lib/inventoryStore';
import { notificationService } from '../lib/notificationService';
import { logInventoryEvent } from '../lib/inventoryEvents';
import { dbService } from '../lib/dbService';
import {
  isValidImei,
  isAppleDevice,
  IMEI_REQUIRED_MESSAGE,
  IMEI_OR_APPLE_SERIAL_MESSAGE,
} from '../lib/imeiValidation';
import { parseBrandModelStorage } from '../lib/modelStorage';
import { addUnitManual, ensureSupplier } from '../services';
import type { InventoryUnit, ListingSite } from '../types';
import DeviceComboBox from './DeviceComboBox';

type Mode = 'office' | 'shs';

interface Props {
  onClose: () => void;
  /** Initial tab. 'office' = default. The 'SHS Order' button on Buy passes 'shs'. */
  initialMode?: Mode;
}

interface StockRow {
  id: string;
  model: string;
  imei: string;          // required for Office; optional for SHS
  grade: string;         // A / B / C / Refurbished
  storage: string;       // auto-parsed but editable
  colour: string;
  supplierName: string;
  buyPrice: string;
  notes: string;
  /** When true the operator has manually edited Storage; we stop auto-syncing
   *  it from Model so their override sticks. */
  storageTouched?: boolean;
}

const uid = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().split('T')[0];

function emptyRow(supplierName = ''): StockRow {
  return {
    id: uid(),
    model: '', imei: '', grade: '', storage: '', colour: '',
    supplierName, buyPrice: '', notes: '',
  };
}

/** Parse a single tab-separated row pasted from Excel / Google Sheets.
 *  Schema is the canonical Inventory Report buy block — same column
 *  order the "Inventory Report" button exports, the InventoryReportImport
 *  consumes, and the clientReport.ts ALL sheet header row uses, so the
 *  operator can copy any row out of any one of those surfaces and paste
 *  it back here without re-arranging columns:
 *
 *    Stock In Date · Model · IMEI · Grade · Storage · Colour · Supplier · BP · Notes
 *
 *  Three accepted shapes — anything outside falls through to the input's
 *  default paste so the operator doesn't get fields scrambled by a stray
 *  copy of a different schema.
 *
 *    9 fields — full row (date + notes)
 *    8 fields — date OR notes (disambiguated by whether parts[0] parses
 *               as a date)
 *    7 fields — neither date nor notes
 */
export function parsePastedStockRow(text: string):
  | { batchDate?: string; patch: Partial<StockRow> }
  | null {
  if (!text) return null;
  // First non-empty line only — multi-row paste goes through
  // parsePastedStockRows below.
  const firstLine = text.replace(/\r/g, '').split('\n').find(l => l.trim().length > 0);
  if (!firstLine) return null;
  const parts = firstLine.split('\t').map(s => s.trim());
  // Drop trailing empties (Excel pads short rows with extra tabs).
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  if (parts.length < 7 || parts.length > 9) return null;

  let batchDate: string | undefined;
  let model = '', imei = '', grade = '', storage = '', colour = '', supplier = '', bp = '', notes = '';

  if (parts.length === 9) {
    [, model, imei, grade, storage, colour, supplier, bp, notes] = parts;
    batchDate = parseRowDate(parts[0]);
  } else if (parts.length === 8) {
    // 8 fields → either {date + 7 cols, no notes} or {7 cols + notes, no date}.
    // Disambiguate by parsing parts[0] as a date.
    const maybeDate = parseRowDate(parts[0]);
    if (maybeDate) {
      [, model, imei, grade, storage, colour, supplier, bp] = parts;
      batchDate = maybeDate;
    } else {
      [model, imei, grade, storage, colour, supplier, bp, notes] = parts;
    }
  } else {
    // 7 fields — no date, no notes.
    [model, imei, grade, storage, colour, supplier, bp] = parts;
  }

  const patch: Partial<StockRow> = {};
  if (model)    patch.model        = model;
  if (imei)     patch.imei         = imei;
  if (grade)    patch.grade        = grade;
  if (colour)   patch.colour       = colour;
  if (supplier) patch.supplierName = supplier;
  if (bp)       patch.buyPrice     = bp;
  if (notes)    patch.notes        = notes;
  if (storage) {
    patch.storage = storage.toUpperCase().replace(/\s+/g, '');
    // Mark storage as operator-touched so a later Model edit doesn't
    // silently overwrite the explicit storage from the paste.
    patch.storageTouched = true;
  }
  return { batchDate, patch };
}

/** Multi-row variant — split on newlines, parse each line via
 *  parsePastedStockRow, return the collected patches plus the first
 *  batch date encountered (so a multi-row paste only lifts the date
 *  once, from whichever row had it). */
export function parsePastedStockRows(text: string): {
  batchDate?: string;
  rows: Partial<StockRow>[];
} {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  const rows: Partial<StockRow>[] = [];
  let batchDate: string | undefined;
  for (const line of lines) {
    const parsed = parsePastedStockRow(line);
    if (parsed) {
      if (!batchDate && parsed.batchDate) batchDate = parsed.batchDate;
      rows.push(parsed.patch);
    }
  }
  return { batchDate, rows };
}

/** Convert an operator-typed date string into the YYYY-MM-DD form the
 *  <input type="date"> expects. Accepts "23-May-2026", "23/05/2026",
 *  "2026-05-23", or anything `new Date()` can parse. Returns undefined
 *  when none of those work. */
function parseRowDate(raw: string): string | undefined {
  const s = (raw || '').trim();
  if (!s) return undefined;
  // DD-MMM-YYYY (e.g. "23-May-2026")
  const m1 = s.match(/^(\d{1,2})[\-\/\s]([A-Za-z]{3,})[\-\/\s](\d{4})$/);
  if (m1) {
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const mm = months[m1[2].slice(0, 3).toLowerCase()];
    if (mm) return `${m1[3]}-${mm}-${m1[1].padStart(2, '0')}`;
  }
  // ISO already
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return undefined;
}

const GRADES = ['A', 'B', 'C', 'ONU', 'Brand new'];

// Standard storage capacities. The model auto-parser returns values in this
// exact format (e.g. "128GB", "1TB"), so the dropdown's selected value will
// pre-populate cleanly after Model is typed. Anything outside this set keeps
// whatever the parser returned and surfaces as an extra option at the top
// of the list so the operator can see it and re-pick if they want.
const STORAGE_OPTIONS = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB'];

interface RowValidation {
  modelOk: boolean;
  imeiOk: boolean;        // true when IMEI is valid OR mode=shs and IMEI is empty
  isApple: boolean;
  imeiRequired: boolean;
  imeiEmpty: boolean;
  dupeInBatch: boolean;
  dupeInDb: boolean;
  /** When dupeInDb fires, capture identifying details of the matching unit
   *  so the operator can see what's collided — model / dateIn / status /
   *  supplier. Lets them rule out a stale import or a sold/returned unit
   *  without leaving the modal. */
  dupeInDbMatch?: {
    id: string;
    model: string;
    dateIn: string;
    status: string;
    supplierName?: string;
  };
  bpOk: boolean;
  supplierOk: boolean;
  /** Storage is required so units don't split into separate buckets in the
   *  grouped overlay (e.g. "iPhone SE 3 1TB" × 2 and "iPhone SE 3" × 1
   *  rendering as two rows because one row's storage was left blank). */
  storageOk: boolean;
  /** Whole-row green-light: all required fields satisfied. */
  complete: boolean;
}

export default function AddStockManualModal({ onClose, initialMode = 'office' }: Props) {
  const { suppliers, units } = useInventoryStore();
  const [mode, setMode]     = useState<Mode>(initialMode);
  const [date, setDate]     = useState(today());
  const [rows, setRows]     = useState<StockRow[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');
  // Transient feedback shown next to the paste textarea after a parse —
  // e.g. "Added 3 rows" / "No rows recognised". Cleared automatically.
  const [pasteFeedback, setPasteFeedback] = useState('');
  // Controlled textarea for the bulk-paste panel. We clear it explicitly
  // after every paste so the operator can re-paste without manually
  // selecting the previous content first.
  const [pasteText, setPasteText] = useState('');

  const supplierNames = useMemo(() => suppliers.map(s => s.name), [suppliers]);
  // Map (not Set) so we can surface the matching unit's details when a row
  // flags as duplicate — operator's reported false positives in production
  // where they swore the IMEI wasn't in DB; turned out to be a stale import
  // or a returned/sold unit still living in inventoryUnits. Showing the
  // existing row's model + dateIn + status + supplier makes that obvious.
  const existingByImei = useMemo(() => {
    const m = new Map<string, InventoryUnit>();
    for (const u of units) {
      if (!u.imei) continue;
      // Strip zero-width / non-breaking whitespace too — Excel + WhatsApp
      // copy/paste loves to embed those, and a single invisible character
      // makes the exact-match dupe check miss a real collision.
      const key = u.imei
        .replace(/[​-‍﻿ ]/g, '')
        .trim()
        .toUpperCase();
      if (key && !m.has(key)) m.set(key, u);
    }
    return m;
  }, [units]);

  // Carry the last typed supplier forward — saves re-typing across rows in
  // the same delivery from one source.
  const lastSupplier = rows.filter(r => r.supplierName).at(-1)?.supplierName ?? '';

  const updateRow = useCallback((id: string, patch: Partial<StockRow>) => {
    setRows(rs => rs.map(r => {
      if (r.id !== id) return r;
      const next: StockRow = { ...r, ...patch };
      // Auto-sync Storage from Model unless the operator has touched it.
      if ('model' in patch && !next.storageTouched) {
        const parsed = parseBrandModelStorage(next.model);
        next.storage = parsed.storage || '';
      }
      if ('storage' in patch) next.storageTouched = true;
      return next;
    }));
  }, []);

  const removeRow = (id: string) => setRows(rs => rs.length > 1 ? rs.filter(r => r.id !== id) : rs);
  const addRow    = () => setRows(rs => [...rs, emptyRow(lastSupplier)]);

  // ── Validation per row ─────────────────────────────────────────────────────
  const validation: RowValidation[] = useMemo(() => rows.map(r => {
    // Strip invisible whitespace from the operator-typed IMEI to match the
    // same normalisation done when we built existingByImei above. Without
    // this an Excel-pasted IMEI with a trailing zero-width space would
    // never match a clean DB record (or vice-versa).
    const imei = r.imei
      .replace(/[​-‍﻿ ]/g, '')
      .trim()
      .toUpperCase();
    const isApple = isAppleDevice(r.model);
    const imeiRequired = mode === 'office';
    const imeiEmpty = imei.length === 0;
    const imeiFormatOk = imei ? isValidImei(imei, { isAppleSerial: isApple }) : false;

    const dupeInBatch = !!imei && rows.filter(x => x.imei
      .replace(/[​-‍﻿ ]/g, '').trim().toUpperCase() === imei).length > 1;
    const existingUnit = imei ? existingByImei.get(imei) : undefined;
    const dupeInDb    = !!existingUnit;
    const dupeInDbMatch = existingUnit ? {
      id:           existingUnit.id,
      model:        (existingUnit.model || '').trim() || '?',
      dateIn:       (existingUnit.dateIn || '').trim() || '?',
      status:       existingUnit.status || '?',
      supplierName: existingUnit.supplierName,
    } : undefined;

    const modelOk    = r.model.trim().length > 0;
    const supplierOk = r.supplierName.trim().length > 0;
    const bp         = parseFloat(r.buyPrice);
    const bpOk       = Number.isFinite(bp) && bp > 0;
    // Storage may have arrived via the auto-sync from the Model field
    // (parseBrandModelStorage pulls "1TB" out of "iPhone SE 3 1TB") OR
    // via the dropdown. Either way the trimmed value must be non-empty.
    const storageOk  = r.storage.trim().length > 0;

    const imeiOk =
      imeiRequired
        ? imeiFormatOk && !dupeInBatch && !dupeInDb
        : (imeiEmpty || (imeiFormatOk && !dupeInBatch && !dupeInDb));

    return {
      modelOk, imeiOk, isApple, imeiRequired, imeiEmpty,
      dupeInBatch, dupeInDb, dupeInDbMatch, bpOk, supplierOk, storageOk,
      complete: modelOk && imeiOk && bpOk && supplierOk && storageOk,
    };
  }), [rows, mode, existingByImei]);

  // ── Totals strip ───────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let validUnits = 0, value = 0;
    rows.forEach((r, i) => {
      if (validation[i].complete) {
        validUnits++;
        value += parseFloat(r.buyPrice) || 0;
      }
    });
    return { validUnits, value };
  }, [rows, validation]);

  // Hard-block save when ANY row carries a duplicate-IMEI warning (either
  // already in inventory or repeated within this batch). Other validation
  // gaps — missing model / empty row / bad BP — keep the old silent-skip
  // behaviour so the operator can leave blank rows around without them
  // blocking the save. Duplicate IMEIs are the only thing the operator
  // could mistake for a soft warning and lose data over.
  const duplicateCount = useMemo(
    () => validation.filter(v => v.dupeInDb || v.dupeInBatch).length,
    [validation],
  );
  const hasDuplicates = duplicateCount > 0;

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    // Defence-in-depth: even if the button somehow fires (race with the
    // store listener, devtools, etc.) refuse to proceed when any row has
    // a duplicate IMEI. Silent-skipping these previously closed the modal
    // and made the operator think the dup row had been accepted.
    if (hasDuplicates) {
      setError(
        `Resolve ${duplicateCount} duplicate IMEI row${duplicateCount === 1 ? '' : 's'} before saving.`,
      );
      return;
    }
    const validIdxs: number[] = [];
    validation.forEach((v, i) => { if (v.complete) validIdxs.push(i); });
    if (!validIdxs.length) {
      setError('Add at least one row with all required fields filled in.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const batchId = mode === 'office'
        ? `manual_bat_${Date.now()}`
        : `shs_bat_${Date.now()}`;

      let total = 0;
      const failures: string[] = [];

      // SHS mode caches supplier ids by name so we only ensureSupplier once
      // per name per batch. Office mode uses the service-side ensureSupplier
      // via addUnitManual.
      const supplierIdCache: Record<string, string> = {};

      for (const i of validIdxs) {
        const r = rows[i];
        try {
          if (mode === 'office') {
            const res = await addUnitManual({
              imei: r.imei,
              model: r.model,
              buyPrice: parseFloat(r.buyPrice) || 0,
              supplierName: r.supplierName,
              colour: r.colour,
              storage: r.storage,
              grade: r.grade,
              notes: r.notes,
              dateIn: date,
              batchId,
            });
            if (!res.ok) {
              failures.push(`${r.imei.trim().toUpperCase() || '(no imei)'}: ${res.message ?? res.error}`);
              continue;
            }
            notificationService.addNotification('new_stock', {
              id: res.id!, imei: res.id!, model: r.model,
              colour: r.colour, buyPrice: parseFloat(r.buyPrice) || 0,
            } as any);
            total++;
          } else {
            // SHS path — IMEI optional. Create the unit directly with
            // status='incoming' so it shows up in the SHS section of BuySheet.
            const supplierName = r.supplierName.trim();
            const supKey = supplierName.toUpperCase();
            if (!supplierIdCache[supKey]) {
              supplierIdCache[supKey] = await ensureSupplier(supplierName);
            }
            const supplierId = supplierIdCache[supKey];
            const parsed = parseBrandModelStorage(r.model);
            const cleanModel = parsed.model || r.model.trim();
            const storage = r.storage.trim() || parsed.storage || '';
            const brand = parsed.brand !== 'Other' ? parsed.brand : 'Other';
            // Apple serials surface as IMEI too; uppercase + trim.
            const imei = r.imei.trim().toUpperCase();
            // id prefix is critical: isManualShsUnit() classifies anything
            // status='incoming' whose id starts with 'shs_' as a synthesised
            // placeholder (not a manual SHS), which would hide this row from
            // the SHS KPI. Prefix with 'manual_shs_' so it's counted.
            const id = imei || `manual_shs_${Date.now()}_${i}`;
            const newUnit: InventoryUnit = {
              id,
              imei,
              model: cleanModel,
              brand,
              category: detectCategory(r.model),
              colour: r.colour.trim() || 'Unknown',
              ...(storage ? { storage } : {}),
              ...(r.grade.trim() ? { grade: r.grade.trim() } : {}),
              buyPrice: parseFloat(r.buyPrice) || 0,
              dateIn: date,
              supplierId,
              supplierName,
              batchId,
              status: 'incoming',
              statusRaw: 'SHS — Manual',
              flags: [],
              notes: r.notes.trim() || 'SHS — Awaiting delivery',
              platformListed: false,
              listingSites: [] as ListingSite[],
              ownerId: 'shared',
              createdAt: new Date().toISOString(),
            };
            await dbService.create('inventoryUnits', id, newUnit);
            if (i === validIdxs[0]) {
              notificationService.addNotification('shs_received', newUnit);
            }
            total++;
          }
        } catch (err: any) {
          failures.push(`row ${i + 1}: ${err?.message || 'save failed'}`);
        }
      }

      if (total > 0) {
        await logInventoryEvent({
          type: 'batch_created',
          message: mode === 'office'
            ? `Manual add: ${total} unit${total === 1 ? '' : 's'} added (IMEI-tracked)`
            : `Manual SHS: ${total} unit${total === 1 ? '' : 's'} flagged supplier-held`,
          batchId,
        });
      }

      if (failures.length && total === 0) {
        setError(failures[0]);
        setSaving(false);
        return;
      }
      if (failures.length) {
        setError(`${total} saved · ${failures.length} rejected: ${failures[0]}`);
      }
      setSaved(true);
      setTimeout(onClose, 900);
    } catch (err: any) {
      setError(err?.message || 'Save failed. Check connection.');
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }} transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full md:max-w-4xl rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'calc(100dvh - 16px)' }}
      >
        {/* Header + mode tabs */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-white ${mode === 'shs' ? 'bg-amber-500' : 'bg-slate-900'}`}>
              {mode === 'shs' ? <Truck size={15} /> : <PackagePlus size={15} />}
            </div>
            <div>
              <h3 className="text-sm font-bold">Add Stock</h3>
              <p className="text-[9px] text-gray-400 font-mono">
                Stock-In Page · {mode === 'office' ? 'Office Stock' : 'SHS Supplier Stock'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400">
            <X size={15} />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="px-5 pt-3 pb-2 flex-shrink-0 flex items-center gap-2">
          <ModeTab
            label="Office Stock"
            sub="IMEI mandatory · counts as office stock"
            active={mode === 'office'}
            onClick={() => setMode('office')}
            tone="emerald"
          />
          <ModeTab
            label="SHS Supplier Stock"
            sub="IMEI optional · supplier-held, not office stock"
            active={mode === 'shs'}
            onClick={() => setMode('shs')}
            tone="amber"
          />
        </div>

        {/* Top-level Stock In Date */}
        <div className="px-5 pb-2 flex items-center gap-3 flex-shrink-0">
          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Stock In Date</label>
          <input
            type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-[12px] font-mono focus:outline-none focus:border-black"
          />
          <p className="text-[9px] font-mono text-gray-400 ml-auto">
            {rows.length} row{rows.length === 1 ? '' : 's'} · {totals.validUnits} ready · £{totals.value.toFixed(0)}
          </p>
        </div>

        {/* Paste panel — operator pastes a tab-separated slice of the
            Inventory Report export and each line becomes a row in the
            form. Schema is the same one the Inventory Report button
            exports, InventoryReportImport consumes, and clientReport's
            ALL sheet uses, so a row copied out of any of those surfaces
            round-trips through here without column re-ordering. */}
        <div className="px-5 pt-2 pb-3 border-b border-slate-100 bg-slate-50/40 flex-shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <ClipboardPaste size={11} className="text-slate-400" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
              Paste rows from sheet
            </p>
            {pasteFeedback && (
              <span className="text-[9px] font-mono text-emerald-600 ml-auto">
                {pasteFeedback}
              </span>
            )}
          </div>
          <p className="text-[9px] font-mono text-slate-400 mb-1.5">
            Schema · Stock In Date · Model · IMEI · Grade · Storage · Colour · Supplier · BP · Notes
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            onPaste={(e) => {
              // Reach into clipboardData synchronously — React's
              // onChange wouldn't fire until after preventDefault.
              const text = e.clipboardData.getData('text');
              e.preventDefault();
              const result = parsePastedStockRows(text);
              if (result.rows.length === 0) {
                setPasteText('');
                setPasteFeedback('No rows recognised — check column order');
                setTimeout(() => setPasteFeedback(''), 2200);
                return;
              }
              setRows(prev => {
                // Reuse rows that are completely empty so a fresh-open
                // modal with one blank row absorbs the first paste line
                // instead of leaving an empty row hanging above the paste.
                const filled = prev.filter(r =>
                  r.model.trim() || r.imei.trim() || r.buyPrice.trim() ||
                  r.colour.trim() || r.storage.trim() || r.supplierName.trim() ||
                  r.grade.trim() || r.notes.trim(),
                );
                const newRows = result.rows.map(patch =>
                  ({ ...emptyRow(), ...patch }) as StockRow,
                );
                return [...filled, ...newRows];
              });
              if (result.batchDate) setDate(result.batchDate);
              setPasteText('');
              setPasteFeedback(`Added ${result.rows.length} row${result.rows.length === 1 ? '' : 's'}`);
              setTimeout(() => setPasteFeedback(''), 2200);
            }}
            rows={2}
            placeholder={'Paste tab-separated rows here — e.g.\n23-May-2026\tIPHONE SE 3\t352094702235513\tB\t128GB\tBLACK\tIMAX\t100\t'}
            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[10px] font-mono focus:outline-none focus:border-slate-900 resize-none bg-white"
          />
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto px-5 pb-3">
          <div className="space-y-2">
            {rows.map((r, i) => (
              <Row
                key={r.id}
                row={r}
                index={i}
                validation={validation[i]}
                mode={mode}
                supplierNames={supplierNames}
                units={units}
                onChange={patch => updateRow(r.id, patch)}
                onRemove={() => removeRow(r.id)}
                onPasteRow={(text) => {
                  const parsed = parsePastedStockRow(text);
                  if (!parsed) return false;
                  updateRow(r.id, parsed.patch);
                  if (parsed.batchDate) setDate(parsed.batchDate);
                  return true;
                }}
                canRemove={rows.length > 1}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={addRow}
            className="mt-3 w-full flex items-center justify-center gap-2 py-2 border-2 border-dashed border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-all"
          >
            <Plus size={12} /> Add Row
          </button>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="text-[10px] font-mono text-gray-500 truncate">
            {error
              ? <span className="text-rose-600 inline-flex items-center gap-1"><AlertCircle size={11} />{error}</span>
              : hasDuplicates
                ? <span className="text-rose-600 inline-flex items-center gap-1">
                    <AlertCircle size={11} />
                    {duplicateCount} duplicate IMEI row{duplicateCount === 1 ? '' : 's'} — fix or remove to enable save
                  </span>
                : `${totals.validUnits} unit${totals.validUnits === 1 ? '' : 's'} ready · £${totals.value.toFixed(0)}`}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={onClose} type="button"
              className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-600 hover:bg-gray-100 rounded-lg transition-all">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!totals.validUnits || hasDuplicates || saving || saved}
              title={hasDuplicates
                ? `Resolve ${duplicateCount} duplicate IMEI row${duplicateCount === 1 ? '' : 's'} first`
                : undefined}
              className={`px-4 py-2.5 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-40 flex items-center gap-2
                ${mode === 'shs' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-slate-900 hover:bg-slate-800'}`}
            >
              {saved
                ? <><CheckCircle2 size={12} /> Saved!</>
                : saving
                  ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <>Save {totals.validUnits} {mode === 'shs' ? 'SHS' : ''} unit{totals.validUnits === 1 ? '' : 's'}</>}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Mode tab pill ────────────────────────────────────────────────────────────
function ModeTab({
  label, sub, active, onClick, tone,
}: {
  label: string;
  sub: string;
  active: boolean;
  onClick: () => void;
  tone: 'emerald' | 'amber';
}) {
  const activeCls = tone === 'amber'
    ? 'bg-amber-50 border-amber-300 text-amber-900'
    : 'bg-emerald-50 border-emerald-300 text-emerald-900';
  return (
    <button
      onClick={onClick}
      className={`flex-1 text-left rounded-xl border px-3 py-2 transition-all ${
        active ? activeCls : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400'
      }`}
    >
      <p className="text-[11px] font-bold uppercase tracking-widest leading-tight">{label}</p>
      <p className="text-[9px] font-mono opacity-70 mt-0.5">{sub}</p>
    </button>
  );
}

// ── One row in the entry grid ────────────────────────────────────────────────
function Row({
  row, index, validation, mode, supplierNames, units, onChange, onRemove, onPasteRow, canRemove,
}: {
  key?: React.Key;
  row: StockRow;
  index: number;
  validation: RowValidation;
  mode: Mode;
  supplierNames: string[];
  /** Live inventory — feeds the model autocomplete so the operator can
   *  scroll/select from existing models instead of retyping (which is
   *  how copy-paste-near-misses end up in different grouped rows). */
  units: InventoryUnit[];
  onChange: (patch: Partial<StockRow>) => void;
  onRemove: () => void;
  /** Paste handler — invoked when the operator pastes a tab-separated
   *  row from Excel into Model or IMEI. Returns true when the paste was
   *  consumed (the input should NOT receive the raw text), false when
   *  it didn't look like a row paste (default behaviour wins). */
  onPasteRow: (text: string) => boolean;
  canRemove: boolean;
}) {
  /** Paste anywhere inside the row: when the clipboard text is
   *  tab-separated AND parses as a row, fill every column at once and
   *  swallow the default paste. Falls through to the input's own paste
   *  handler when the text isn't a row (e.g. just an IMEI on its own). */
  const handleRowPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text || !text.includes('\t')) return;
    if (onPasteRow(text)) e.preventDefault();
  };
  // ── IMEI helper text — shows what's wrong (or empty when fine) ─────────────
  const imeiHelp = (() => {
    if (mode === 'shs' && validation.imeiEmpty) return 'Optional for SHS';
    if (validation.imeiEmpty && validation.imeiRequired) return 'Required';
    if (validation.dupeInBatch) return 'Duplicate in this batch';
    if (validation.dupeInDb) {
      // Surface the colliding unit's identifying fields so the operator can
      // see WHY the IMEI is flagged (a sold/returned unit still in
      // inventoryUnits, a stale import, etc) instead of having to leave the
      // modal and grep the inventory list themselves.
      const m = validation.dupeInDbMatch;
      if (m) return `Already in inventory · ${m.model} · ${m.dateIn} · status ${m.status}${m.supplierName ? ' · ' + m.supplierName : ''}`;
      return 'Already in inventory';
    }
    if (!validation.imeiOk && !validation.imeiEmpty) {
      return validation.isApple ? IMEI_OR_APPLE_SERIAL_MESSAGE : IMEI_REQUIRED_MESSAGE;
    }
    return '';
  })();

  return (
    <div
      onPaste={handleRowPaste}
      className={`border rounded-2xl p-3 transition-all ${
      validation.complete
        ? 'border-emerald-200 bg-emerald-50/30'
        : 'border-slate-200 bg-slate-50/40'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] font-mono text-gray-400 w-6 text-center">#{index + 1}</span>
        <div className="flex-1" />
        {validation.complete && <CheckCircle2 size={13} className="text-emerald-500" />}
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded transition-all"
            title="Remove row"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Grid: Model · IMEI · Grade */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
        <Cell label="Model *" colSpan={5}>
          {/* Autocomplete from existing inventory model strings — picking a
              suggestion guarantees this unit groups with its siblings in
              the All Office Stock view. Free text still wins for brand-new
              SKUs that don't exist in stock yet. */}
          <DeviceComboBox
            units={units}
            brand=""
            model={row.model}
            onModelChange={(m) => onChange({ model: m })}
            onPick={(entry) => {
              // Use the catalog's exact model string so this unit buckets
              // with siblings. Pre-fill storage / grade ONLY if those fields
              // are still empty — never overwrite operator input.
              const patch: Partial<StockRow> = { model: entry.model };
              if (!row.storage && entry.storages[0]) patch.storage = entry.storages[0];
              if (!row.grade && entry.topGrade)      patch.grade   = entry.topGrade;
              onChange(patch);
            }}
            placeholder="Search existing models or type new — e.g. iPhone 13 128GB"
            inputClassName="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black"
          />
        </Cell>
        <Cell
          label={mode === 'office' ? 'IMEI / Serial *' : 'IMEI / Serial'}
          colSpan={4}
          help={imeiHelp}
          helpTone={validation.imeiEmpty && !validation.imeiRequired ? 'muted' : 'error'}
        >
          <input
            value={row.imei}
            onChange={e => onChange({ imei: e.target.value })}
            placeholder={validation.isApple
              ? '15-digit IMEI or 10-12 char Apple serial'
              : '15-digit IMEI (digits only)'}
            inputMode={validation.isApple ? 'text' : 'numeric'}
            maxLength={validation.isApple ? 16 : 15}
            className={`w-full border rounded-lg px-2.5 py-1.5 text-[12px] font-mono focus:outline-none transition-all ${
              imeiHelp && !(validation.imeiEmpty && !validation.imeiRequired)
                ? 'border-rose-300 bg-rose-50 focus:border-rose-500'
                : row.imei.trim()
                  ? 'border-emerald-300 bg-emerald-50/50 focus:border-emerald-500'
                  : 'border-gray-200 focus:border-black bg-white'
            }`}
          />
        </Cell>
        <Cell label="Grade" colSpan={3}>
          <select
            value={row.grade}
            onChange={e => onChange({ grade: e.target.value })}
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black bg-white"
          >
            <option value="">—</option>
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </Cell>
      </div>

      {/* Grid: Storage · Colour · Supplier · BP */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 mt-2">
        <Cell
          label="Storage *"
          colSpan={2}
          help={!validation.storageOk ? 'Required' : ''}
          helpTone="error"
        >
          <select
            value={row.storage}
            onChange={e => onChange({ storage: e.target.value })}
            className={`w-full border rounded-lg px-2.5 py-1.5 text-[12px] font-mono focus:outline-none transition-all ${
              !validation.storageOk
                ? 'border-rose-300 bg-rose-50 focus:border-rose-500'
                : 'border-emerald-300 bg-emerald-50/50 focus:border-emerald-500'
            }`}
          >
            <option value="">—</option>
            {/* Surface any non-standard parsed value at the top so it's not lost. */}
            {row.storage && !STORAGE_OPTIONS.includes(row.storage) && (
              <option value={row.storage}>{row.storage}</option>
            )}
            {STORAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Cell>
        <Cell label="Colour" colSpan={3}>
          <input
            value={row.colour}
            onChange={e => onChange({ colour: e.target.value })}
            placeholder="e.g. Space Grey"
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black"
          />
        </Cell>
        <Cell label="Supplier *" colSpan={4}>
          <input
            list="add-stock-supplier-names"
            value={row.supplierName}
            onChange={e => onChange({ supplierName: e.target.value })}
            placeholder="Type or pick"
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black"
          />
          <datalist id="add-stock-supplier-names">
            {supplierNames.map(n => <option key={n} value={n} />)}
          </datalist>
        </Cell>
        <Cell label="BP (£) *" colSpan={3} help={!validation.bpOk && row.buyPrice ? 'Must be > 0' : ''} helpTone="error">
          <input
            type="number" min="0" step="0.01"
            value={row.buyPrice}
            onChange={e => onChange({ buyPrice: e.target.value })}
            placeholder="0.00"
            className={`w-full border rounded-lg px-2.5 py-1.5 text-[12px] font-mono focus:outline-none ${
              row.buyPrice && !validation.bpOk
                ? 'border-rose-300 bg-rose-50'
                : 'border-gray-200 focus:border-black'
            }`}
          />
        </Cell>
      </div>

      {/* Notes (full width) */}
      <Cell label="Notes" colSpan={12} className="mt-2">
        <input
          value={row.notes}
          onChange={e => onChange({ notes: e.target.value })}
          placeholder="Optional — condition, lock state, etc."
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black"
        />
      </Cell>
    </div>
  );
}

function Cell({
  label, children, colSpan, help, helpTone, className,
}: {
  label: string;
  children: React.ReactNode;
  colSpan: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  help?: string;
  helpTone?: 'muted' | 'error';
  className?: string;
}) {
  const spanCls = {
    1: 'md:col-span-1', 2: 'md:col-span-2', 3: 'md:col-span-3', 4: 'md:col-span-4',
    5: 'md:col-span-5', 6: 'md:col-span-6', 7: 'md:col-span-7', 8: 'md:col-span-8',
    9: 'md:col-span-9', 10: 'md:col-span-10', 11: 'md:col-span-11', 12: 'md:col-span-12',
  }[colSpan];
  const helpCls = helpTone === 'muted' ? 'text-slate-400' : 'text-rose-600';
  return (
    <div className={`${spanCls} ${className ?? ''}`}>
      <label className="text-[9px] font-bold uppercase tracking-widest text-gray-500 block mb-0.5">{label}</label>
      {children}
      {help && <p className={`text-[9px] font-mono mt-0.5 ${helpCls}`}>{help}</p>}
    </div>
  );
}

// ── Category helper (local — avoids importing the heavy detectCategory) ─────
// The service does the real categorisation on the office-stock path; for the
// SHS direct-create path we just need a sensible default.
function detectCategory(model: string): InventoryUnit['category'] {
  const s = String(model || '').toLowerCase();
  if (s.includes('iphone'))       return 'iPhone';
  if (s.includes('ipad'))         return 'iPad';
  if (s.includes('apple watch'))  return 'Apple Watch';
  if (s.includes('galaxy s'))     return 'Samsung S Series';
  if (s.includes('galaxy a'))     return 'Samsung A Series';
  if (s.includes('tab') || s.includes('tablet')) return 'Tablet';
  return 'Other';
}
