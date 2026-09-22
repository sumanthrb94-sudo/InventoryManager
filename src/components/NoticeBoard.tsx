/**
 * NoticeBoard — admin-authored team broadcast surface.
 *
 * Operator-facing page that reads `notices` from Firestore as a
 * chronological feed (newest first). Admin sees a compose box at the
 * top, a Post button, and per-row edit / delete affordances. Every
 * other signed-in user sees the same feed read-only — no compose box,
 * no edit buttons, just the message body, who posted it, and when.
 *
 * Why this exists: operator (2026-06-20) wants a single place to drop
 * day-by-day notes for the team (return-handling reminders, supplier
 * call-outs, holiday hours, etc.) instead of WhatsApp threads. Date
 * + day-of-week show on every entry so it reads like a chat history.
 *
 * Storage:
 *   - Collection `notices`, docs `{ id, content, createdAt, updatedAt,
 *     createdBy, ownerId: 'shared' }`. Firestore rules gate writes to
 *     the admin email; reads open to every signed-in user.
 *
 * Empty state mirrors the rest of the app's surfaces — a checked icon
 * and a quiet line so an empty board doesn't feel broken.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Megaphone, Send, Edit3, CheckCircle2, X, Trash2, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { useIsAdmin } from '../lib/useIsAdmin';
import { useInventoryStore, useLazyCollection } from '../lib/inventoryStore';
import { auth } from '../lib/firebase';
import type { Notice, DeletedUnitRecord } from '../types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Normalise a Firestore Timestamp or string to an ISO string. */
function timestampToIso(v: any): string {
  if (typeof v === 'string') return v;
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString();
  return String(v || '');
}

/** "Wed · 25 Jun 2026 · 14:32" — full date + day-of-week + time so the
 *  feed reads like a chat history without needing a tooltip to know
 *  which weekday a post landed on. */
function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso);
  const day = DAY_NAMES[d.getDay()];
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} · ${date} · ${time}`;
}

/**
 * One row of the board, from either of the two sources behind it.
 *
 * A removal is recorded twice on purpose — an indelible `deletedUnits`
 * tombstone written BEFORE the unit goes, and a notice so the team can see
 * it without opening an admin page. Showing both would report every deletion
 * twice, so they are folded into one entry on the notice's `logRef`.
 */
interface FeedEntry {
  id: string;
  /** ISO, for sorting and display. */
  at: string;
  body: string;
  /** Permanent system record: no edit, no delete, enforced by firestore.rules
   *  and not merely by hiding the buttons. */
  isLog: boolean;
  /** The underlying notice doc, when this row came from one. Archive-only
   *  rows have none, and nothing on them is actionable anyway. */
  notice?: Notice;
}

/** Free text, so it may be blank or punctuation. Mirrors DeletedUnitsPage —
 *  the archive records what the operator typed, it does not improve it. */
function readableReason(reason: string | undefined): string {
  const r = (reason || '').trim();
  return /[a-z0-9]/i.test(r) ? r : '(no reason recorded)';
}

/**
 * Render a tombstone in the same shape as the notice its deletion would have
 * posted, so the feed reads consistently whether or not that notice landed.
 * A VOID record is one whose archive write succeeded but whose delete then
 * failed — the unit is still in stock and this must never read as a removal.
 */
function archiveLine(r: DeletedUnitRecord): string {
  const parts = [
    r.voided ? 'Deletion FAILED — unit still in stock' : 'Stock deleted',
    r.model,
    r.colour,
    r.storage,
    r.imei ? `IMEI ${r.imei}` : undefined,
    r.supplierName ? `supplier: ${r.supplierName}` : undefined,
    `— ${readableReason(r.reason)}`,
    `(by ${r.deletedBy || 'admin'} · ${String(r.deletedAt || '').slice(0, 10)})`,
  ].filter(Boolean);
  return parts.join(' · ');
}

export default function NoticeBoard() {
  const isAdmin = useIsAdmin();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  /** id of the notice the admin is currently editing — null when not editing. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  // The removal log's indelible source. Opened here so the board can show
  // deletions whose notice never landed, not just the ones that did.
  useLazyCollection('deletedUnits');
  const { deletedUnits } = useInventoryStore();

  useEffect(() => {
    // Belt-and-braces loaded flag: dbService.subscribeToCollection's
    // onSnapshot only fires `loaded` on a SUCCESSFUL read. When the
    // Firestore rule for `notices` hasn't been deployed yet (or any
    // permissions failure), the error handler just logs + bumps the
    // sync-status indicator to "offline" — the callback never runs and
    // the UI hangs in the loading skeleton forever. A 4-second timeout
    // flips `loaded` so the empty-state renders, the operator sees the
    // compose box (when admin), and the page is usable instead of
    // perpetually spinning.
    const timeout = window.setTimeout(() => setLoaded(true), 4000);
    const unsub = dbService.subscribeToCollection('notices', (data: Notice[]) => {
      setNotices(data);
      setLoaded(true);
      window.clearTimeout(timeout);
    });
    return () => {
      window.clearTimeout(timeout);
      unsub();
    };
  }, []);

  /**
   * Newest first — the chat-history convention — across BOTH sources.
   *
   * The archive is opened here as well as on the admin page because the
   * operator asked for the removal log to be visible on the board rather
   * than only somewhere an employee cannot reach. It costs a subscription on
   * a commonly-opened tab; the collection grows by one document per deletion
   * and was not back-filled, so it is small and stays small.
   */
  const feed = useMemo<FeedEntry[]>(() => {
    const fromNotices: FeedEntry[] = notices.map(n => ({
      id: n.id,
      at: timestampToIso(n.createdAt),
      body: n.content,
      isLog: n.kind === 'log',
      notice: n,
    }));

    // A tombstone already reported by a notice is the same event, not a
    // second one. Anything left over is a deletion whose notice never landed
    // (or predates the flag) and would otherwise be invisible here.
    const reported = new Set(notices.map(n => n.logRef).filter(Boolean) as string[]);
    const fromArchive: FeedEntry[] = deletedUnits
      .filter(r => !reported.has(r.id))
      .map(r => ({
        id: `archive_${r.id}`,
        at: String(r.deletedAt || ''),
        body: archiveLine(r),
        isLog: true,
      }));

    return [...fromNotices, ...fromArchive].sort((a, b) => b.at.localeCompare(a.at));
  }, [notices, deletedUnits]);

  const logCount = useMemo(() => feed.filter(e => e.isLog).length, [feed]);

  const post = async () => {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const now = new Date().toISOString();
      const id = `notice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await dbService.create('notices', id, {
        content: text,
        createdAt: now,
        createdBy: auth.currentUser?.email || 'admin',
        ownerId: 'shared',
      });
      setDraft('');
    } finally {
      setPosting(false);
    }
  };

  /** A log notice is not editable or removable by anyone. The rules are the
   *  real boundary; these two guards stop the UI from ever ASKING, which is
   *  what turns a refusal into a confusing error toast. */
  const isLocked = (n: Notice) => n.kind === 'log';

  const startEdit = (n: Notice) => {
    if (isLocked(n)) return;
    setEditingId(n.id);
    setEditDraft(n.content);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const text = editDraft.trim();
    if (!text) return;
    await dbService.update('notices', editingId, {
      content: text,
      updatedAt: new Date().toISOString(),
      ownerId: 'shared',
    });
    setEditingId(null);
    setEditDraft('');
  };

  const deleteNotice = async (n: Notice) => {
    if (isLocked(n)) return;
    if (!window.confirm('Delete this notice permanently?')) return;
    try {
      await dbService.delete('notices', n.id);
    } catch (e: any) {
      // The notice has already been put back on screen by dbService; say why.
      window.alert(`Could not delete the notice: ${e?.message || 'the database refused the delete'}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
            <Megaphone size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold tracking-tight">Notice Board</h2>
            <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400">
              {(isAdmin ? 'Admin' : 'Read-only')
                + ` · ${feed.length} ${feed.length === 1 ? 'entry' : 'entries'}`
                + (logCount > 0 ? ` · ${logCount} permanent log` : '')}
            </p>
          </div>
        </div>

        {/* Compose box — admin only. Plain textarea + Post button. Cmd/Ctrl
            + Enter is wired as a shortcut so the admin can drop a quick
            note without leaving the keyboard. */}
        {isAdmin && (
          <div className="mt-4 border border-slate-200 rounded-2xl bg-slate-50 focus-within:border-amber-400 focus-within:bg-white transition-colors">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void post(); }
              }}
              placeholder="Write a notice for the team… (Cmd/Ctrl + Enter to post)"
              rows={3}
              className="w-full bg-transparent px-4 py-3 text-[12px] focus:outline-none resize-none"
            />
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-slate-200 bg-white/60 rounded-b-2xl">
              <span className="text-[9px] font-mono uppercase tracking-widest text-slate-400">
                {draft.length > 0 ? `${draft.length} chars` : 'Posts are visible to every signed-in employee'}
              </span>
              <button
                type="button"
                onClick={post}
                disabled={posting || !draft.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send size={11} /> {posting ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Feed */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
        {!loaded ? (
          <div className="py-16 flex flex-col items-center gap-2 text-slate-400">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="w-5 h-5 border-2 border-slate-300 border-t-transparent rounded-full"
            />
            <p className="text-[11px] font-mono uppercase tracking-widest">Loading notices…</p>
          </div>
        ) : feed.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-2 text-slate-400">
            <CheckCircle2 size={28} className="text-emerald-500" />
            <p className="text-[11px] font-mono uppercase tracking-widest">No notices yet</p>
            {isAdmin && (
              <p className="text-[10px] font-mono text-slate-400">Drop the first message in the box above.</p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            <AnimatePresence initial={false}>
              {feed.map(entry => {
                const n = entry.notice;
                const editing = !!n && editingId === n.id;
                return (
                  <motion.li
                    key={entry.id}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className={entry.isLog ? 'px-5 py-4 bg-slate-50/60' : 'px-5 py-4 hover:bg-slate-50'}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                            {fmtTimestamp(entry.at)}
                          </span>
                          {/* Says the quiet part out loud: this row is a
                              record, not a message, and nobody — admin
                              included — can edit or remove it. */}
                          {entry.isLog && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest bg-slate-200 text-slate-700"
                              title="System log · permanent. Cannot be edited or deleted by anyone."
                            >
                              <Lock size={8} /> Log · permanent
                            </span>
                          )}
                          {n?.updatedAt && n.updatedAt !== n.createdAt && (
                            <span className="text-[8px] font-mono uppercase tracking-widest text-slate-400 italic" title={`Edited ${fmtTimestamp(timestampToIso(n.updatedAt))}`}>
                              edited
                            </span>
                          )}
                          {/* Author always reads as "Admin" — operator
                              decision (2026-06-21): the team should see
                              a single team-broadcast voice, not the
                              individual admin email. The createdBy field
                              is still persisted on the doc as audit
                              trail and shown in the tooltip. */}
                          <span className="text-[9px] font-mono text-slate-400" title={n?.createdBy || 'admin'}>
                            · {entry.isLog ? 'System' : 'Admin'}
                          </span>
                        </div>
                        {editing ? (
                          <textarea
                            autoFocus
                            value={editDraft}
                            onChange={e => setEditDraft(e.target.value)}
                            rows={3}
                            className="mt-2 w-full border border-amber-400 rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:border-black bg-white resize-none"
                          />
                        ) : (
                          <p className="mt-1 text-[13px] text-slate-900 whitespace-pre-wrap break-words">
                            {entry.body}
                          </p>
                        )}
                      </div>
                      {/* No controls on a log row. The rules refuse the write
                          regardless; hiding the buttons stops an admin being
                          offered an action the database will reject. */}
                      {isAdmin && !entry.isLog && n && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {editing ? (
                            <>
                              <button
                                type="button"
                                onClick={saveEdit}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                title="Save edit"
                              >
                                <CheckCircle2 size={10} /> Save
                              </button>
                              <button
                                type="button"
                                onClick={() => { setEditingId(null); setEditDraft(''); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                title="Discard edit"
                              >
                                <X size={10} /> Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => startEdit(n)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                title="Edit this notice"
                              >
                                <Edit3 size={10} /> Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteNotice(n)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100"
                                title="Delete this notice permanently"
                              >
                                <Trash2 size={10} /> Delete
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}
