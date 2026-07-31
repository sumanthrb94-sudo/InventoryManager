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
import { X, Plus, Trash2, CheckCircle2, PackagePlus, AlertCircle, Truck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useInventoryStore } from '../lib/inventoryStore';
import { logInventoryEvent } from '../lib/inventoryEvents';
import { dbService } from '../lib/dbService';
import { auth, isAdmin } from '../lib/firebase';
import type { ModelSeed } from '../lib/deviceCatalog';
import {
  isValidImei,
  isAppleDevice,
  IMEI_REQUIRED_MESSAGE,
  IMEI_OR_APPLE_SERIAL_MESSAGE,
} from '../lib/imeiValidation';
import { SimTypeSelectCompact } from './FormSelects';
import { parseBrandModelStorage } from '../lib/modelStorage';
import { GRADE_OPTIONS, STORAGE_OPTIONS } from '../lib/unitConstants';
import { addUnitManual, ensureSupplier, upsertAccessoryStock } from '../services';
import AccessoryComboBox from './AccessoryComboBox';
import { buildAccessoryCatalog, accessoryEntryFor } from '../lib/accessoryCatalog';
import { normaliseCatalogEntry } from '../lib/migrations/normaliseModelCatalog';
import type { InventoryUnit, ListingSite, AccessoryStock } from '../types';
import DeviceComboBox from './DeviceComboBox';

type Mode = 'office' | 'shs' | 'accessory';

/** One line in the Accessories tab. Unlike device rows there is no
 *  model/IMEI/grade/storage/colour — an accessory is a SKU + quantity pool,
 *  never an individually-identified unit (see AccessoryStock in types.ts). */
interface AccessoryRow {
  id: string;
  sku: string;
  name: string;
  supplierName: string;
  quantity: string;
  buyPrice: string;
  notes: string;
  /** True once an ADMIN has explicitly approved this line as a genuinely
   *  new accessory SKU via the picker's "+ Add" pill. Employees can never
   *  set it — the pill isn't rendered for them — so a non-admin can only
   *  ever top up a pool that already exists. Mirrors how the device picker
   *  gates creating a new model. */
  isNew?: boolean;
}

function emptyAccessoryRow(supplierName = ''): AccessoryRow {
  return { id: Math.random().toString(36).slice(2, 9), sku: '', name: '', supplierName, quantity: '', buyPrice: '', notes: '' };
}

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
  simType: string;       // Physical SIM / eSIM / Dual SIM / Not Applicable
  colour: string;
  supplierName: string;
  buyPrice: string;
  notes: string;
  /** When true the operator has manually edited Storage; we stop auto-syncing
   *  it from Model so their override sticks. */
  storageTouched?: boolean;
  /** When true, the Colour dropdown is on "Other" and a freeform input is
   *  rendered alongside it. Carried as form state so a pasted non-preset
   *  colour (or a manually-typed one) survives a re-render without us
   *  having to re-derive it from row.colour every time. */
  colourOther?: boolean;
}

/** Closed set of colour presets shown in the Add Stock dropdown. Anything
 *  outside this list lands the row on "Other" with a freeform input — same
 *  pattern the operator uses on paper. Comparison is case-insensitive on
 *  read; values written back to the row preserve the canonical casing
 *  here (so two paste sources can't fork into "BLACK" vs "Black" buckets). */
const COLOUR_PRESETS = ['Black', 'White', 'Grey', 'Blue'] as const;
type ColourPreset = typeof COLOUR_PRESETS[number];

/** True when `s` matches one of COLOUR_PRESETS case-insensitively. */
function isPresetColour(s: string): boolean {
  const lower = s.trim().toLowerCase();
  return COLOUR_PRESETS.some(p => p.toLowerCase() === lower);
}

/** Return the canonical-cased preset that matches `s`, or undefined. */
function canonicalColour(s: string): ColourPreset | undefined {
  const lower = s.trim().toLowerCase();
  return COLOUR_PRESETS.find(p => p.toLowerCase() === lower);
}

const uid = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().split('T')[0];

function emptyRow(supplierName = ''): StockRow {
  return {
    id: uid(),
    model: '', imei: '', grade: '', storage: '', simType: '', colour: '',
    supplierName, buyPrice: '', notes: '',
  };
}

// Grades come from unitConstants so every intake path offers the same
// list — a private copy here drifted by casing and split the data.
const GRADES = GRADE_OPTIONS;

// Standard storage capacities sourced from unitConstants so this list
// stays in sync with StockIntakeFlow and the OCR pipeline automatically.

interface RowValidation {
  modelOk: boolean;
  imeiOk: boolean;        // true when IMEI is valid OR mode=shs and IMEI is empty
  isApple: boolean;
  imeiRequired: boolean;
  imeiEmpty: boolean;
  dupeInBatch: boolean;
  /** True only when the colliding DB unit is in *active* stock
   *  (status `available` or `incoming`). Sold / returned units carry
   *  the same IMEI as a historical record but no longer occupy the
   *  slot, so re-acquiring the same device (return-buyback, repurchase
   *  from customer) shouldn't block — they surface via
   *  `priorHistoryInDb` instead and the save proceeds. */
  dupeInDb: boolean;
  /** True when an IMEI matches a sold/returned unit. Informational —
   *  shown as a non-blocking hint so the operator confirms it really
   *  is a re-stock of the same physical device. */
  priorHistoryInDb: boolean;
  /** When dupeInDb OR priorHistoryInDb fires, capture identifying
   *  details of the matching unit so the operator can see what's
   *  collided — model / dateIn / status / supplier. */
  dupeInDbMatch?: {
    id: string;
    model: string;
    dateIn: string;
    status: string;
    returnType?: string;
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
  // Add Stock is open to all signed-in employees (operator decision
  // 2026-06-20). Firestore rules permit any signed-in user to create
  // an inventoryUnits doc with ownerId='shared', so no server-side gate
  // either. Wipe DB / delete paths remain admin-only.
  const { suppliers, units, models, accessoryStock } = useInventoryStore();
  // Admin gate for the model-picker "+ Add new" affordance — employees
  // can only PICK existing models, only admin can extend the catalog.
  const userIsAdmin = isAdmin(auth.currentUser);
  const [mode, setMode]     = useState<Mode>(initialMode);
  const [date, setDate]     = useState(today());
  const [rows, setRows]     = useState<StockRow[]>([emptyRow()]);
  const [accRows, setAccRows] = useState<AccessoryRow[]>([emptyAccessoryRow()]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');
  /** Normalised IMEIs we wrote during *this* modal session. The store
   *  is a live onSnapshot subscription, so the unit doc we just
   *  created arrives back in `units` within a second or two — long
   *  before the 900ms auto-close fires. Without this exclusion the
   *  validation re-runs against its own freshly-created docs and
   *  flags the still-rendered row as "Already in inventory · id <imei>",
   *  even though the operator just typed that exact IMEI for the
   *  first time. Naturally wiped on unmount. */
  const [writtenImeis, setWrittenImeis] = useState<Set<string>>(() => new Set());

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
      if (!key || m.has(key)) continue;
      // Don't let units we just created in this modal session count
      // as "already in inventory" — they're the post-save echo from
      // the live store listener, not a pre-existing conflict.
      if (writtenImeis.has(key)) continue;
      m.set(key, u);
    }
    return m;
  }, [units, writtenImeis]);

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

  // ── Accessories tab ─────────────────────────────────────────────────────────
  const lastAccSupplier = accRows.filter(r => r.supplierName).at(-1)?.supplierName ?? '';
  const updateAccRow = (id: string, patch: Partial<AccessoryRow>) =>
    setAccRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
  const removeAccRow = (id: string) => setAccRows(rs => rs.length > 1 ? rs.filter(r => r.id !== id) : rs);
  const addAccRow    = () => setAccRows(rs => [...rs, emptyAccessoryRow(lastAccSupplier)]);

  /** Accessory intake is gated the same way device intake is: an employee
   *  may only top up a pool that already exists, and only an admin can
   *  approve a brand-new SKU (which flips the row's `isNew`). Without this
   *  the same product entered as several pools under reordered names
   *  ("type c usb" vs "c type usb") — matching is order-insensitive so the
   *  existing pool is findable whichever way round it's typed. */
  const accessoryCatalog = useMemo(() => buildAccessoryCatalog(accessoryStock), [accessoryStock]);

  const accValidation = useMemo(() => accRows.map(r => {
    const skuOk = r.sku.trim().length > 0
      && (r.isNew === true || !!accessoryEntryFor(accessoryCatalog, r.sku));
    const nameOk = r.name.trim().length > 0;
    const qty = parseInt(r.quantity, 10);
    const quantityOk = Number.isFinite(qty) && qty > 0;
    const bp = parseFloat(r.buyPrice);
    const bpOk = Number.isFinite(bp) && bp >= 0;
    return { skuOk, nameOk, quantityOk, bpOk, complete: skuOk && nameOk && quantityOk && bpOk };
  }), [accRows, accessoryCatalog]);

  const accTotals = useMemo(() => {
    let validLines = 0, quantity = 0, value = 0;
    accRows.forEach((r, i) => {
      if (accValidation[i].complete) {
        validLines++;
        const qty = parseInt(r.quantity, 10) || 0;
        quantity += qty;
        value += qty * (parseFloat(r.buyPrice) || 0);
      }
    });
    return { validLines, quantity, value };
  }, [accRows, accValidation]);

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
    // An existing unit BLOCKS the save when it's still part of the
    // active footprint — either occupying a stock slot now or
    // expected to come back. That covers:
    //   - status 'available'         → in the office, sellable
    //   - status 'incoming'          → SHS arriving
    //   - status 'returned' + returnType 'returned_to_inventory'
    //                                → physically back in the office
    //                                  (status stuck on 'returned'
    //                                   from the return flow bug)
    //   - status 'returned' + returnType 'returned_to_supplier'
    //                                → at supplier awaiting credit /
    //                                  replacement — same device is
    //                                  expected back, can't re-stock
    //   - status 'returned' + returnType 'repair'
    //                                → out at repair shop, coming back
    // Only `status === 'sold'` falls through to `priorHistoryInDb`
    // (gone to a customer; legitimate re-stock when they bring it
    // back for buyback). Defensive: 'returned' with no returnType
    // also blocks — assume in-system until proven otherwise.
    const status     = existingUnit?.status;
    const returnType = existingUnit?.returnType;
    // The dupe gate now blocks ONLY the two unambiguous "still
    // tracked elsewhere, expected back" cases the operator confirmed
    // are worth a hard stop:
    //   - returned to supplier — at supplier awaiting credit /
    //                            replacement, same device coming back
    //   - repair               — out at repair shop, coming back
    // Every other match (available / incoming / sold /
    // returned-to-inventory / returned-with-no-type) falls through
    // to `priorHistoryInDb` so the operator sees the colliding doc
    // in an amber hint but is never silently blocked. A
    // genuinely-new IMEI (no existingUnit) saves with no UI noise.
    const blockedReturnType =
      returnType === 'returned_to_supplier' || returnType === 'repair';
    const dupeInDb         = !!existingUnit && status === 'returned' && blockedReturnType;
    const priorHistoryInDb = !!existingUnit && !dupeInDb;
    const dupeInDbMatch = existingUnit ? {
      id:           existingUnit.id,
      model:        (existingUnit.model || '').trim() || '?',
      dateIn:       (existingUnit.dateIn || '').trim() || '?',
      status:       existingUnit.status || '?',
      returnType:   existingUnit.returnType,
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
      dupeInBatch, dupeInDb, priorHistoryInDb, dupeInDbMatch,
      bpOk, supplierOk, storageOk,
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

  // ── Save (accessories) ──────────────────────────────────────────────────────
  async function handleSaveAccessories() {
    const validIdxs: number[] = [];
    accValidation.forEach((v, i) => { if (v.complete) validIdxs.push(i); });
    if (!validIdxs.length) {
      setError('Add at least one accessory line with SKU, name, quantity and BP filled in.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const failures: string[] = [];
      let total = 0;
      for (const i of validIdxs) {
        const r = accRows[i];
        const res = await upsertAccessoryStock({
          sku: r.sku,
          name: r.name,
          supplierName: r.supplierName.trim() || undefined,
          quantity: parseInt(r.quantity, 10) || 0,
          buyPrice: parseFloat(r.buyPrice) || 0,
          notes: r.notes.trim() || undefined,
        });
        if (!res.ok) { failures.push(`${r.sku}: ${res.error}`); continue; }
        total++;
      }
      if (failures.length && total === 0) {
        setError(failures[0]);
        setSaving(false);
        return;
      }
      if (failures.length) setError(`${total} saved · ${failures.length} rejected: ${failures[0]}`);
      setSaved(true);
      setTimeout(onClose, 900);
    } catch (err: any) {
      setError(err?.message || 'Save failed. Check connection.');
      setSaving(false);
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (mode === 'accessory') return handleSaveAccessories();
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
      // Normalised IMEIs we successfully wrote in this run. Pushed into
      // the writtenImeis set after the loop so the validation excludes
      // them when the live-store listener delivers them back.
      const justWritten: string[] = [];

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
              simType: r.simType,
              notes: r.notes.trim(),
              dateIn: date,
              batchId,
            });
            if (!res.ok) {
              failures.push(`${r.imei.trim().toUpperCase() || '(no imei)'}: ${res.message ?? res.error}`);
              continue;
            }
            const writtenKey = r.imei.replace(/[​-‍﻿ ]/g, '').trim().toUpperCase();
            if (writtenKey) justWritten.push(writtenKey);
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
              ...(r.simType.trim() ? { simType: r.simType.trim() } : {}),
              buyPrice: parseFloat(r.buyPrice) || 0,
              dateIn: date,
              supplierId,
              supplierName,
              batchId,
              status: 'incoming',
              stockSource: 'shs',
              statusRaw: 'SHS — Manual',
              flags: [],
              notes: r.notes.trim() || 'SHS — Awaiting delivery',
              platformListed: false,
              listingSites: [] as ListingSite[],
              ownerId: 'shared',
              createdAt: new Date().toISOString(),
            };
            await dbService.create('inventoryUnits', id, newUnit);
            if (imei) justWritten.push(imei);
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
      // Excluded from `existingByImei` until the modal unmounts.
      if (justWritten.length) {
        setWrittenImeis(prev => {
          const next = new Set(prev);
          for (const k of justWritten) next.add(k);
          return next;
        });
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
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-white ${mode === 'shs' ? 'bg-amber-500' : mode === 'accessory' ? 'bg-indigo-500' : 'bg-slate-900'}`}>
              {mode === 'shs' ? <Truck size={15} /> : <PackagePlus size={15} />}
            </div>
            <div>
              <h3 className="text-sm font-bold">Add Stock</h3>
              <p className="text-[9px] text-gray-400 font-mono">
                Stock-In Page · {mode === 'office' ? 'Office Stock' : mode === 'shs' ? 'SHS Supplier Stock' : 'Accessories'}
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
          <ModeTab
            label="Accessories"
            sub="No IMEI ever — chargers, SIM pins, cables"
            active={mode === 'accessory'}
            onClick={() => setMode('accessory')}
            tone="indigo"
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
            {mode === 'accessory'
              ? `${accRows.length} line${accRows.length === 1 ? '' : 's'} · ${accTotals.validLines} ready · ${accTotals.quantity} units · £${accTotals.value.toFixed(0)}`
              : `${rows.length} row${rows.length === 1 ? '' : 's'} · ${totals.validUnits} ready · £${totals.value.toFixed(0)}`}
          </p>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto px-5 pb-3">
          {mode === 'accessory' ? (
            <>
              <div className="space-y-2">
                {accRows.map((r, i) => (
                  <AccessoryRowInput
                    key={r.id}
                    row={r}
                    index={i}
                    validation={accValidation[i]}
                    supplierNames={supplierNames}
                    accessories={accessoryStock}
                    isAdmin={userIsAdmin}
                    onChange={patch => updateAccRow(r.id, patch)}
                    onRemove={() => removeAccRow(r.id)}
                    canRemove={accRows.length > 1}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={addAccRow}
                className="mt-3 w-full flex items-center justify-center gap-2 py-2 border-2 border-dashed border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-all"
              >
                <Plus size={12} /> Add Line
              </button>
            </>
          ) : (
            <>
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
                    models={models}
                    isAdmin={userIsAdmin}
                    onChange={patch => updateRow(r.id, patch)}
                    onRemove={() => removeRow(r.id)}
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
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="text-[10px] font-mono text-gray-500 truncate">
            {/* Once `saved` is true the modal is in its 900ms close-out
                window. Skip the dupe banner here in case the writtenImeis
                guard misses a row — operator should never see an error
                state while the success toast + SAVED! button are visible. */}
            {error
              ? <span className="text-rose-600 inline-flex items-center gap-1"><AlertCircle size={11} />{error}</span>
              : hasDuplicates && !saved && mode !== 'accessory'
                ? <span className="text-rose-600 inline-flex items-center gap-1">
                    <AlertCircle size={11} />
                    {duplicateCount} duplicate IMEI row{duplicateCount === 1 ? '' : 's'} — fix or remove to enable save
                  </span>
                : mode === 'accessory'
                  ? `${accTotals.validLines} line${accTotals.validLines === 1 ? '' : 's'} ready · ${accTotals.quantity} unit${accTotals.quantity === 1 ? '' : 's'} · £${accTotals.value.toFixed(0)}`
                  : `${totals.validUnits} unit${totals.validUnits === 1 ? '' : 's'} ready · £${totals.value.toFixed(0)}`}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={onClose} type="button"
              className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-600 hover:bg-gray-100 rounded-lg transition-all">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={mode === 'accessory' ? (!accTotals.validLines || saving || saved) : (!totals.validUnits || hasDuplicates || saving || saved)}
              title={hasDuplicates && mode !== 'accessory'
                ? `Resolve ${duplicateCount} duplicate IMEI row${duplicateCount === 1 ? '' : 's'} first`
                : undefined}
              className={`px-4 py-2.5 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-40 flex items-center gap-2
                ${mode === 'shs' ? 'bg-amber-500 hover:bg-amber-600' : mode === 'accessory' ? 'bg-indigo-500 hover:bg-indigo-600' : 'bg-slate-900 hover:bg-slate-800'}`}
            >
              {saved
                ? <><CheckCircle2 size={12} /> Saved!</>
                : saving
                  ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : mode === 'accessory'
                    ? <>Save {accTotals.validLines} accessory line{accTotals.validLines === 1 ? '' : 's'}</>
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
  tone: 'emerald' | 'amber' | 'indigo';
}) {
  const activeCls = tone === 'amber'
    ? 'bg-amber-50 border-amber-300 text-amber-900'
    : tone === 'indigo'
      ? 'bg-indigo-50 border-indigo-300 text-indigo-900'
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
  row, index, validation, mode, supplierNames, units, models, isAdmin, onChange, onRemove, canRemove,
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
  /** Admin-curated catalog seeds — surfaces new SKUs the admin has
   *  registered before any stock exists. */
  models: ModelSeed[];
  /** Admin gate for the picker's "+ Add new" affordance. */
  isAdmin: boolean;
  onChange: (patch: Partial<StockRow>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  // ── IMEI helper text — shows what's wrong (or empty when fine) ─────────────
  const imeiHelp = (() => {
    if (mode === 'shs' && validation.imeiEmpty) return 'Optional for SHS';
    if (validation.imeiEmpty && validation.imeiRequired) return 'Required';
    if (validation.dupeInBatch) return 'Duplicate in this batch';
    if (validation.dupeInDb) {
      // Hard block — only fires for returned-to-supplier / repair.
      // The device is tracked elsewhere and expected back, so a
      // second intake would corrupt the return / repair flow.
      const m = validation.dupeInDbMatch;
      if (m) {
        const rt = (m.returnType || '').replace(/_/g, ' ');
        return `Blocked · this IMEI is currently ${rt} · ${m.model} · ${m.dateIn}${m.supplierName ? ' · ' + m.supplierName : ''} · id ${m.id}`;
      }
      return 'Blocked · IMEI is currently out at supplier / repair';
    }
    if (validation.priorHistoryInDb) {
      // Soft amber hint — the IMEI matches an existing doc but in a
      // state the operator can legitimately re-stock from (sold,
      // available-but-stale, incoming, returned-to-inventory, etc).
      // Save proceeds; the hint exists purely for operator awareness.
      const m = validation.dupeInDbMatch;
      if (m) {
        const stateLabel = m.returnType
          ? `${m.status} → ${m.returnType.replace(/_/g, ' ')}`
          : m.status;
        return `Re-stocking · existing record was ${stateLabel} · ${m.model} · ${m.dateIn}${m.supplierName ? ' · ' + m.supplierName : ''}`;
      }
      return 'Re-stocking · matching record found';
    }
    if (!validation.imeiOk && !validation.imeiEmpty) {
      return validation.isApple ? IMEI_OR_APPLE_SERIAL_MESSAGE : IMEI_REQUIRED_MESSAGE;
    }
    return '';
  })();

  return (
    <div className={`border rounded-2xl p-3 transition-all ${
      validation.complete
        ? 'border-emerald-200 bg-emerald-50/30'
        : 'border-slate-200 bg-slate-50/40'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] font-mono text-gray-400 w-6 text-center flex-shrink-0">#{index + 1}</span>
        <div className="flex-1" />
        {validation.complete && <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />}
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded transition-all flex-shrink-0"
            title="Remove row"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Grid: Model · IMEI · Grade */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
        <Cell label="Model *" colSpan={5}>
          {/* Strict picker — employees can only PICK from the unified
              catalog (inventory + admin-curated seeds). Free-text adds
              were the source of "Galaxy S23" / "GALAXY S23" / "S23"
              fragmentation; the picker now collapses prefix variants
              and the strict gate keeps new typos out. Admin sees a
              "+ Add 'query'" pill that writes a doc to the models
              collection so the new SKU is immediately pickable. */}
          <DeviceComboBox
            units={units}
            seeds={models}
            strict
            isAdmin={isAdmin}
            brand=""
            model={row.model}
            onModelChange={(m) => onChange({ model: m })}
            onPick={(entry) => {
              const patch: Partial<StockRow> = { model: entry.model };
              if (!row.storage && entry.storages[0]) patch.storage = entry.storages[0];
              if (!row.grade && entry.topGrade)      patch.grade   = entry.topGrade;
              onChange(patch);
            }}
            onCreateModel={isAdmin ? async (draft) => {
              const id = `model_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
              // The picker's `brand` prop is always '' here (it scopes the
              // SEARCH, and operators type the whole name into one box), so
              // draft.brand is empty and draft.model carries the brand word.
              // Writing that verbatim is what produced a catalog full of
              // blank-brand "APPLE IPHONE 12" rows. Split it properly on the
              // way in, using the same helper that repairs the old rows.
              const entry = normaliseCatalogEntry({ brand: draft.brand, model: draft.model });
              await dbService.create('models', id, {
                brand: entry.brand,
                model: entry.model,
                ...(entry.series ? { series: entry.series } : {}),
                ownerId: 'shared',
                createdAt: new Date().toISOString(),
                createdBy: auth.currentUser?.email || 'admin',
              });
              // Return a catalog-shape entry the picker can auto-select.
              return {
                brand: entry.brand,
                model: entry.model,
                count: 0,
                latestDateIn: '',
                storages: [],
                colours: [],
                source: 'seed' as const,
              };
            } : undefined}
            placeholder="Search the catalog — e.g. iPhone 13 128GB"
            inputClassName="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black"
          />
        </Cell>
        <Cell
          label={mode === 'office' ? 'IMEI / Serial *' : 'IMEI / Serial'}
          colSpan={4}
          help={imeiHelp}
          helpTone={
            validation.imeiEmpty && !validation.imeiRequired ? 'muted' :
            // Soft amber hint when the IMEI matches a sold/returned
            // unit but is otherwise valid — re-stocking is allowed.
            validation.priorHistoryInDb && validation.imeiOk      ? 'info'  :
            'error'
          }
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
              validation.priorHistoryInDb && validation.imeiOk
                ? 'border-amber-300 bg-amber-50 focus:border-amber-500'
                : imeiHelp && !(validation.imeiEmpty && !validation.imeiRequired)
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
            {/* Surface any non-standard pasted grade at the top so it's not
                silently swallowed by the browser falling back to the
                placeholder when the value doesn't match an option. */}
            {row.grade && !(GRADES as readonly string[]).includes(row.grade) && (
              <option value={row.grade}>{row.grade}</option>
            )}
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </Cell>
      </div>

      {/* Grid: Storage · SIM Type · Colour · Supplier · BP */}
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
            {row.storage && !(STORAGE_OPTIONS as readonly string[]).includes(row.storage) && (
              <option value={row.storage}>{row.storage}</option>
            )}
            {STORAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Cell>
        <Cell label="SIM Type" colSpan={2}>
          <SimTypeSelectCompact value={row.simType} onChange={v => onChange({ simType: v })} />
        </Cell>
        <Cell label="Colour" colSpan={2}>
          {/* Dropdown of the four preset colours plus an "Other" escape
              hatch that reveals a freeform input directly below. Operator
              picks Black/White/Grey/Blue 95% of the time; the freeform
              row stays out of the way until they need it. The colourOther
              flag persists on the row so paste / re-render keeps the
              freeform mode if that's what the operator chose. */}
          <select
            value={row.colourOther ? '__other__' : (canonicalColour(row.colour) ?? '')}
            onChange={e => {
              const v = e.target.value;
              if (v === '__other__') {
                // Stay on Other; preserve whatever's already typed (could
                // be a non-preset value from paste or a stale preset that
                // the operator wants to refine).
                onChange({ colourOther: true });
              } else if (v === '') {
                onChange({ colour: '', colourOther: false });
              } else {
                onChange({ colour: v, colourOther: false });
              }
            }}
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black bg-white"
          >
            <option value="">—</option>
            {COLOUR_PRESETS.map(c => <option key={c} value={c}>{c}</option>)}
            <option value="__other__">Other</option>
          </select>
          {(row.colourOther || (row.colour !== '' && !isPresetColour(row.colour))) && (
            <input
              value={row.colour}
              onChange={e => onChange({ colour: e.target.value, colourOther: true })}
              placeholder="Type custom colour (e.g. Space Grey)"
              autoFocus={row.colourOther && row.colour === ''}
              className="mt-1 w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black"
            />
          )}
        </Cell>
        <Cell label="Supplier *" colSpan={3}>
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

// ── One line in the Accessories grid — SKU + quantity, no device fields ────
function AccessoryRowInput({
  row, index, validation, supplierNames, accessories, isAdmin, onChange, onRemove, canRemove,
}: {
  key?: React.Key;
  row: AccessoryRow;
  index: number;
  validation: { skuOk: boolean; nameOk: boolean; quantityOk: boolean; bpOk: boolean; complete: boolean };
  supplierNames: string[];
  accessories: AccessoryStock[];
  isAdmin: boolean;
  onChange: (patch: Partial<AccessoryRow>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div className={`border rounded-2xl p-3 transition-all ${
      validation.complete ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 bg-slate-50/40'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] font-mono text-gray-400 w-6 text-center flex-shrink-0">#{index + 1}</span>
        <div className="flex-1" />
        {validation.complete && <CheckCircle2 size={13} className="text-indigo-500 flex-shrink-0" />}
        {canRemove && (
          <button type="button" onClick={onRemove}
            className="p-1.5 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded transition-all flex-shrink-0"
            title="Remove line">
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
        {/* Strict picker over the existing accessory pools — employees can
            only top up something that already exists; only an admin sees
            the "+ Add" pill for a genuinely new SKU. Matching ignores word
            order, so the live "USB-C 20W" pool is found whether the
            operator types that or "20W USB-C". */}
        <Cell label="SKU *" colSpan={3}>
          <AccessoryComboBox
            accessories={accessories}
            value={row.sku}
            onValueChange={v => onChange({ sku: v })}
            // Copy the pool's OWN name across, and lock it: upsertAccessoryStock
            // refreshes the stored name from whatever is passed in, so letting
            // a top-up edit it would silently rename the existing pool.
            onPick={entry => onChange({ sku: entry.sku, name: entry.name, isNew: false })}
            onCreateNew={isAdmin ? typed => onChange({ sku: typed, name: '', isNew: true }) : undefined}
            isAdmin={isAdmin}
            // Already admin-approved as new — don't revert it on blur for
            // not being in the catalog it is precisely about to join.
            strict={!row.isNew}
            placeholder="Search — e.g. USB-C 20W"
            inputClassName="font-mono"
          />
        </Cell>
        <Cell
          label={row.isNew ? 'Name * (new)' : 'Name *'}
          colSpan={4}
          help={row.isNew ? 'New SKU — admin approved' : (row.sku ? 'From the existing pool' : '')}
          helpTone={row.isNew ? 'info' : 'muted'}
        >
          <input
            value={row.name}
            onChange={e => onChange({ name: e.target.value })}
            readOnly={!row.isNew}
            placeholder={row.isNew ? 'e.g. USB-C 20W Charger' : 'Pick a SKU first'}
            className={`w-full border rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none ${
              row.isNew
                ? 'border-emerald-300 bg-emerald-50/40 focus:border-emerald-500'
                : 'border-gray-200 bg-slate-50 text-slate-600 cursor-not-allowed'
            }`}
          />
        </Cell>
        <Cell label="Supplier" colSpan={5}>
          <input
            list="add-stock-supplier-names"
            value={row.supplierName}
            onChange={e => onChange({ supplierName: e.target.value })}
            placeholder="Type or pick (optional)"
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black"
          />
          <datalist id="add-stock-supplier-names">
            {supplierNames.map(n => <option key={n} value={n} />)}
          </datalist>
        </Cell>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 mt-2">
        <Cell label="Quantity *" colSpan={3} help={row.quantity && !validation.quantityOk ? 'Must be > 0' : ''} helpTone="error">
          <input
            type="number" min="1" step="1"
            value={row.quantity}
            onChange={e => onChange({ quantity: e.target.value })}
            placeholder="e.g. 50"
            className={`w-full border rounded-lg px-2.5 py-1.5 text-[12px] font-mono focus:outline-none ${
              row.quantity && !validation.quantityOk ? 'border-rose-300 bg-rose-50' : 'border-gray-200 focus:border-black'
            }`}
          />
        </Cell>
        <Cell label="BP (£) each *" colSpan={3} help={row.buyPrice && !validation.bpOk ? 'Must be ≥ 0' : ''} helpTone="error">
          <input
            type="number" min="0" step="0.01"
            value={row.buyPrice}
            onChange={e => onChange({ buyPrice: e.target.value })}
            placeholder="0.00"
            className={`w-full border rounded-lg px-2.5 py-1.5 text-[12px] font-mono focus:outline-none ${
              row.buyPrice && !validation.bpOk ? 'border-rose-300 bg-rose-50' : 'border-gray-200 focus:border-black'
            }`}
          />
        </Cell>
        <Cell label="Notes" colSpan={6}>
          <input
            value={row.notes}
            onChange={e => onChange({ notes: e.target.value })}
            placeholder="Optional"
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black"
          />
        </Cell>
      </div>
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
  helpTone?: 'muted' | 'error' | 'info';
  className?: string;
}) {
  const spanCls = {
    1: 'md:col-span-1', 2: 'md:col-span-2', 3: 'md:col-span-3', 4: 'md:col-span-4',
    5: 'md:col-span-5', 6: 'md:col-span-6', 7: 'md:col-span-7', 8: 'md:col-span-8',
    9: 'md:col-span-9', 10: 'md:col-span-10', 11: 'md:col-span-11', 12: 'md:col-span-12',
  }[colSpan];
  const helpCls =
    helpTone === 'muted' ? 'text-slate-400' :
    helpTone === 'info'  ? 'text-amber-700' :
    'text-rose-600';
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
