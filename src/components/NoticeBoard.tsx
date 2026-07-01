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
import { Megaphone, Send, Edit3, CheckCircle2, X, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { useIsAdmin } from '../lib/useIsAdmin';
import { auth } from '../lib/firebase';
import type { Notice } from '../types';

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

export default function NoticeBoard() {
  const isAdmin = useIsAdmin();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  /** id of the notice the admin is currently editing — null when not editing. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

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

  /** Newest first — the chat-history convention. */
  const sorted = useMemo(
    () => [...notices].sort((a, b) => timestampToIso(b.createdAt).localeCompare(timestampToIso(a.createdAt))),
    [notices],
  );

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

  const startEdit = (n: Notice) => {
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
    if (!window.confirm('Delete this notice permanently?')) return;
    await dbService.delete('notices', n.id);
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
              {isAdmin
                ? `Admin · ${sorted.length} ${sorted.length === 1 ? 'notice' : 'notices'}`
                : `Read-only · ${sorted.length} ${sorted.length === 1 ? 'notice' : 'notices'}`}
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
        ) : sorted.length === 0 ? (
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
              {sorted.map(n => {
                const editing = editingId === n.id;
                return (
                  <motion.li
                    key={n.id}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="px-5 py-4 hover:bg-slate-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                            {fmtTimestamp(timestampToIso(n.createdAt))}
                          </span>
                          {n.updatedAt && n.updatedAt !== n.createdAt && (
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
                          <span className="text-[9px] font-mono text-slate-400" title={n.createdBy || 'admin'}>
                            · Admin
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
                            {n.content}
                          </p>
                        )}
                      </div>
                      {isAdmin && (
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
