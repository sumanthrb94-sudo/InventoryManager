import React, { useState, useEffect, useMemo } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, signInWithEmail, signOut, isAdmin, userRegion, canBuy, canSell } from './lib/firebase';
import {
  PackagePlus, Package, RefreshCw,
  LogOut, Plus, FileSpreadsheet, LayoutDashboard,
  TrendingUp, FileText, Users, Settings, Database,
  ClipboardList, Menu, X, Megaphone, SlidersHorizontal, Tag, Receipt,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Dashboard, { NavAction } from './components/Dashboard';
import NewBatchModal from './components/NewBatchModal';
import InventoryReportImport from './components/InventoryReportImport';
import SalesReportImport from './components/SalesReportImport';
import BuySheet from './components/BuySheet';
import SellSheet from './components/SellSheet';
import ReturnsPage from './components/ReturnsPage';
import NoticeBoard from './components/NoticeBoard';
import SkuReconciliation from './components/SkuReconciliation';
import ConfigurationPanel from './components/ConfigurationPanel';
import VatCentre from './components/VatCentre';
import { useUnseenNoticesCount } from './hooks/useUnseenNoticesCount';
import ReportingPage from './components/ReportingPage';
import AnalyticsPage from './components/AnalyticsPage';
import Sales from './components/Sales';
import { useRealTimeNotifications } from './hooks/useRealTimeNotifications';
import NotificationToast from './components/NotificationToast';
import NotificationBell from './components/NotificationBell';
import { notificationService } from './lib/notificationService';
import { subscribeToSyncStatus } from './lib/dbService';
import { InventoryStoreProvider, useInventoryStore } from './lib/inventoryStore';
import DataSeedPage from './components/DataSeedPage';
import LoadMockDataModal from './components/LoadMockDataModal';
import ErrorBoundary from './components/ErrorBoundary';
import { useBuildVersionCheck } from './lib/useBuildVersionCheck';
import type { SupplierWhatsappUpdate } from './types';

type Tab      = 'notices' | 'buy' | 'sell' | 'returns' | 'admin';
type AdminSub = 'overview' | 'salesHistory' | 'vat' | 'insights' | 'reports' | 'configuration' | 'skus';

interface NavTab {
  id: Tab;
  label: string;
  icon: React.ReactNode;
}

/**
 * Build the sidebar/bottom-nav tabs visible to the given user, gated by their
 * region. Returns is shared by both UK and India ops; admin gets everything.
 * Used by both the sidebar render and the redirect-on-mount fallback so they
 * stay in sync.
 */
function buildNavTabs(user: User): NavTab[] {
  const tabs: NavTab[] = [];
  // Notices comes first — admin-authored team board read by every
  // signed-in employee. Placed above Stock Intake per operator
  // request (2026-06-20) so the day's note is the first thing the
  // team sees when they open the app.
  tabs.push({           id: 'notices', label: 'Notices', icon: <Megaphone size={20} /> });
  if (canBuy(user))   tabs.push({ id: 'buy',     label: 'Stock Intake', icon: <PackagePlus size={20} /> });
  if (canSell(user))  tabs.push({ id: 'sell',    label: 'Inventory',   icon: <Package size={20} /> });
  tabs.push({           id: 'returns', label: 'Returns', icon: <RefreshCw size={20} /> });
  if (isAdmin(user))  tabs.push({ id: 'admin',   label: 'Admin',   icon: <Settings size={20} /> });
  return tabs;
}

/** Human-facing label for the sidebar region badge ('' = hide). */
function regionBadgeLabel(region: ReturnType<typeof userRegion>): string {
  switch (region) {
    case 'uk':    return 'UK ops';
    case 'india': return 'India ops';
    case 'admin': return 'Admin';
    default:      return '';
  }
}

const APP_NAME    = 'MOBILEPHONEMARKET';
const APP_TAGLINE = 'Inventory Manager';

export default function App() {
  if (new URLSearchParams(window.location.search).get('seed') === '1') return <DataSeedPage />;
  return <AppWithAuth />;
}

function AppWithAuth() {
  const [user, setUser]       = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => onAuthStateChanged(auth, u => { setUser(u); setLoading(false); }), []);

  if (loading) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        className="w-8 h-8 border-2 border-black border-t-transparent rounded-full" />
    </div>
  );
  if (!user) return <LoginPage />;

  return (
    <ErrorBoundary>
      <InventoryStoreProvider>
        <AppShell user={user} />
      </InventoryStoreProvider>
    </ErrorBoundary>
  );
}

function LoadingScreen() {
  return (
    <motion.div initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}
      className="fixed inset-0 z-[300] bg-white flex flex-col items-center justify-center gap-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tighter uppercase font-display">{APP_NAME}</h1>
        <p className="text-[9px] text-gray-400 font-mono uppercase tracking-[0.4em] mt-1">{APP_TAGLINE}</p>
      </div>
      <div className="flex flex-col items-center gap-3">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-6 h-6 border-2 border-black border-t-transparent rounded-full" />
        <span className="text-[10px] font-mono uppercase tracking-widest text-gray-400">Loading inventory…</span>
      </div>
    </motion.div>
  );
}

const ADMIN_SUBS: { id: AdminSub; label: string; icon: React.ReactNode }[] = [
  { id: 'overview',      label: 'Overview',           icon: <LayoutDashboard size={14} /> },
  { id: 'salesHistory',  label: 'Sales History',      icon: <ClipboardList size={14} /> },
  // VAT sits above Insights on purpose: it is the figure with a filing
  // deadline attached, and it was the one number the app computed per sale
  // but never totalled.
  { id: 'vat',           label: 'VAT',                icon: <Receipt size={14} /> },
  { id: 'insights',      label: 'Insights',           icon: <TrendingUp size={14} /> },
  { id: 'reports',       label: 'Reports',            icon: <FileText size={14} /> },
  // Configuration is the single home for editable admin data —
  // models catalog (what employees can pick in Add Stock + Bulk
  // Order) and suppliers (with the WhatsApp feed). Stand-alone
  // Suppliers sub-tab merged into here so admin edits one screen.
  { id: 'configuration', label: 'Configuration',      icon: <SlidersHorizontal size={14} /> },
  // 'Reconcile Models' removed 2026-07: model names are decided once in
  // Configuration and applied automatically at import
  // (canonicaliseModel), so there is no cleanup left for an admin to do
  // by hand. The clustering logic survives in lib/modelReconciliation —
  // it is what the importer uses — only the manual screen is gone.
  // 'SKUs' surfaces inventory units whose persisted model is still a raw
  // operator SKU code so an admin can clean them up manually or auto-fix.
  { id: 'skus',          label: 'Reconcile SKUs',     icon: <Tag size={14} /> },
];

function AppShell({ user }: { user: User }) {
  const { loaded, units, whatsappFeed } = useInventoryStore();
  const userIsAdmin                               = isAdmin(user);
  const buildVersion                              = useBuildVersionCheck();
  // Count of units in the Tech-QC → CRM hand-off limbo. Drives the
  // Returns-tab badge on both sidebar and mobile nav so the morning CRM
  // operator sees the backlog at a glance. Computed here (not in
  // ReturnsPage) because the badge needs to render on every page.
  // Unseen-notices badge — counts notices with createdAt newer than this
  // browser's last-seen timestamp. markAllSeen fires the moment the
  // operator opens the Notices tab so the badge clears on view.
  const { count: unseenNoticeCount, markAllSeen: markNoticesSeen } = useUnseenNoticesCount();
  const pendingCrmCount = useMemo(
    () => units.reduce((n, u) => n + (u.pendingCrmReview === true ? 1 : 0), 0),
    [units],
  );
  // Hide the "Sample Data" entrypoints once real master data is in the DB.
  // Devs can still reach the modal by loading the app with an empty DB.
  const showSampleDataButton                      = units.length <= 100;
  const [activeTab, setActiveTab]                 = useState<Tab>('buy');
  const [adminSub, setAdminSub]                   = useState<AdminSub>('overview');
  const [isBatchModalOpen, setIsBatchModalOpen]   = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSalesImportOpen, setIsSalesImportOpen] = useState(false);
  // Compact picker between "Import inventory" and "Import sales" — both are
  // bulk xlsx import flows and they share the same Import button on the
  // header. Anchored under the button with absolute positioning + outside-
  // click dismiss, so it doesn't pull in a popover library for one menu.
  const [importMenuOpen, setImportMenuOpen]       = useState(false);
  const [isLoadMockDataOpen, setIsLoadMockDataOpen] = useState(false);
  const [unreadCount, setUnreadCount]             = useState(0);
  const [syncConnected, setSyncConnected]         = useState(false);
  const [isAlertsExpanded, setIsAlertsExpanded]   = useState(false);
  /** Hamburger drawer for desktop nav. Mobile keeps its bottom-tab bar
   *  (better thumb reach), so this only controls the slide-out on md+. */
  const [sidebarOpen, setSidebarOpen]             = useState(false);

  // Esc closes the drawer; navigating to a new tab also closes it so
  // operators don't have to dismiss manually after picking.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  useRealTimeNotifications();
  useEffect(() => { notificationService.setUser(user.uid); }, [user.uid]);
  useEffect(() => notificationService.subscribe(() => setUnreadCount(notificationService.getUnreadCount())), []);
  useEffect(() => subscribeToSyncStatus(setSyncConnected), []);

  const handleNavigate = (action: NavAction) => {
    if (!userIsAdmin) return;
    if (action.tab === 'inventory' || action.tab === 'sales') {
      setActiveTab('admin');
      setAdminSub('overview');
    } else if (action.tab === 'suppliers') {
      // Suppliers is now under the unified Configuration sub-tab.
      setActiveTab('admin');
      setAdminSub('configuration');
    } else if (action.tab === 'calendar') {
      setActiveTab('admin');
      setAdminSub('insights');
    }
  };

  const NAV_TABS = React.useMemo(() => buildNavTabs(user), [user]);
  const region   = userRegion(user);
  const regionBadge = regionBadgeLabel(region);

  // Redirect-on-mount: if the user landed on a tab they're not allowed to
  // see (e.g. activeTab='buy' but they're India-only), fall back to the
  // first tab in their allowed set. Returns is in every region's list so
  // there's always at least one tab.
  // Clear the unseen-notices badge the moment the operator opens the
  // Notices tab. Runs as a side-effect of activeTab change so both nav
  // surfaces (sidebar + mobile bottom bar) trigger it without per-site
  // wiring. Uses the lastSeen timestamp persisted in localStorage.
  useEffect(() => {
    if (activeTab === 'notices') markNoticesSeen();
  }, [activeTab, markNoticesSeen]);

  useEffect(() => {
    if (!NAV_TABS.some(t => t.id === activeTab)) {
      setActiveTab(NAV_TABS[0].id);
    }
  }, [NAV_TABS, activeTab]);

  return (
    <div className="h-[100dvh] bg-slate-50 text-slate-900 flex overflow-hidden">

      <AnimatePresence>{!loaded && <LoadingScreen />}</AnimatePresence>

      {/* Stale-bundle banner — surfaces when this tab's compiled BUILD_ID
          stops matching the live /index.html. Clicking reloads to pick up
          the new bundle. Eliminates the "one user sees a different
          periodic table" class of stale-cache bug. */}
      {buildVersion.stale && (
        <div className="fixed top-0 inset-x-0 z-[100] flex items-center justify-center gap-3 bg-amber-500 text-black text-xs font-bold px-4 py-2 shadow-lg">
          <span className="uppercase tracking-widest">New version available</span>
          <button
            onClick={buildVersion.reload}
            className="px-3 py-1 bg-black text-amber-300 rounded-full text-[10px] uppercase tracking-widest hover:bg-gray-900"
          >
            Reload
          </button>
        </div>
      )}

      {/* ── Hamburger drawer (was the fixed desktop sidebar). Opens via the
              menu button in the header. Slides in from the left, dims the
              content with a backdrop, dismisses on outside-click or Esc.
              Mobile still uses the bottom tab bar — better thumb reach. ── */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            key="sidebar-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {sidebarOpen && (
      <motion.aside
        key="sidebar-drawer"
        initial={{ x: '-100%' }}
        animate={{ x: 0 }}
        exit={{ x: '-100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="fixed inset-y-0 left-0 z-50 flex w-64 bg-white border-r border-slate-200 flex-col overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}>

        {/* Brand strip — same height as header. The X button mirrors the
            hamburger in the page header so the open ↔ close gesture is
            symmetric. */}
        <div className="h-16 flex-shrink-0 flex items-center justify-between px-5 border-b border-slate-100">
          <button onClick={() => { setActiveTab('buy'); setSidebarOpen(false); }} className="text-left group active:scale-95 transition-transform min-w-0">
            <h1 className="text-[13px] font-black tracking-tighter uppercase font-display text-slate-900 leading-none">
              {APP_NAME}
            </h1>
            <p className="text-[7px] text-slate-400 font-mono uppercase tracking-[0.35em] mt-1">
              {APP_TAGLINE}
              {regionBadge && (
                <>
                  {' · '}
                  <span className="text-slate-600">{regionBadge.toUpperCase()}</span>
                </>
              )}
            </p>
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-900 transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Nav items */}
        <nav className="p-3 space-y-0.5">
          {NAV_TABS.map(t => (
            <button key={t.id}
              onClick={() => { setActiveTab(t.id); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all
                ${activeTab === t.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}`}>
              <span className="flex-shrink-0 relative">
                {t.icon}
                {t.id === 'returns' && pendingCrmCount > 0 && (
                  <span
                    title={`${pendingCrmCount} ${pendingCrmCount === 1 ? 'unit' : 'units'} pending CRM review`}
                    className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-violet-600 text-white text-[9px] font-bold flex items-center justify-center"
                  >
                    {pendingCrmCount > 99 ? '99+' : pendingCrmCount}
                  </span>
                )}
                {t.id === 'notices' && unseenNoticeCount > 0 && (
                  <span
                    title={`${unseenNoticeCount} new ${unseenNoticeCount === 1 ? 'notice' : 'notices'} since you last looked`}
                    className="absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-amber-500 text-black text-[9px] font-bold flex items-center justify-center"
                  >
                    {unseenNoticeCount > 99 ? '99+' : unseenNoticeCount}
                  </span>
                )}
              </span>
              <span className="text-[11px] font-bold uppercase tracking-widest">{t.label}</span>
            </button>
          ))}

          {/* Admin sub-nav (sidebar). Hidden entirely for non-admins because
              the Admin tab itself is hidden from NAV_TABS for them. */}
          {userIsAdmin && activeTab === 'admin' && (
            <div className="ml-3 mt-1 space-y-0.5 border-l-2 border-slate-100 pl-3">
              {ADMIN_SUBS.map(s => (
                <button key={s.id}
                  onClick={() => { setAdminSub(s.id); setSidebarOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all
                    ${adminSub === s.id
                      ? 'text-slate-900 bg-slate-100 font-bold'
                      : 'text-slate-400 hover:text-slate-900 hover:bg-slate-50'}`}>
                  {s.icon}
                  <span className="text-[10px] font-bold uppercase tracking-widest">{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </nav>

        {/* Stock Alerts Section - Collapsible */}
        <div className="flex-shrink-0 border-t border-slate-100">
          <button
            onClick={() => setIsAlertsExpanded(!isAlertsExpanded)}
            className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-slate-50 transition-colors"
          >
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-700">Stock Alerts</p>
            {(() => {
              const units = useInventoryStore().units;
              const seen = new Set<string>();
              let criticalCount = 0;

              const seriesStats: Record<string, { availableCount: number; returnedCount: number }> = {};
              const allSeries = new Set<string>();

              for (const u of units) {
                const series = u.model.split(' ').slice(0, 2).join(' ');
                allSeries.add(series);
                if (!seriesStats[series]) {
                  seriesStats[series] = { availableCount: 0, returnedCount: 0 };
                }
                if (u.status === 'available') {
                  seriesStats[series].availableCount++;
                } else if (u.status === 'returned') {
                  seriesStats[series].returnedCount++;
                }
              }

              for (const series of Array.from(allSeries)) {
                const stats = seriesStats[series];
                const totalUnitsInSeries = units.filter(u => u.model.split(' ').slice(0, 2).join(' ') === series).length;

                if (totalUnitsInSeries > 0 && stats.availableCount === 0) {
                  const alertId = `outofstock-${series}`;
                  if (!seen.has(alertId)) {
                    seen.add(alertId);
                    criticalCount++;
                  }
                }

                if (stats.availableCount > 0 && stats.availableCount <= 2) {
                  const alertId = `lowstock-${series}`;
                  if (!seen.has(alertId)) {
                    seen.add(alertId);
                    criticalCount++;
                  }
                }

                if (stats.returnedCount > 0) {
                  const alertId = `returned-${series}`;
                  if (!seen.has(alertId)) {
                    seen.add(alertId);
                    criticalCount++;
                  }
                }
              }

              return criticalCount > 0 ? (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold flex items-center justify-center border border-red-200">{criticalCount}</span>
              ) : null;
            })()}
          </button>

          {isAlertsExpanded && (
            <div className="max-h-64 overflow-y-auto border-t border-slate-100 px-2 py-2 space-y-0.5 bg-red-50/40">
              {useInventoryStore().units.length > 0 ? (
                (() => {
                  const units = useInventoryStore().units;
                  const seen = new Set<string>();
                  const alerts: Array<{ id: string; model: string; detail: string }> = [];

                  const seriesStats: Record<string, { availableCount: number; returnedCount: number }> = {};
                  const allSeries = new Set<string>();

                  for (const u of units) {
                    const series = u.model.split(' ').slice(0, 2).join(' ');
                    allSeries.add(series);
                    if (!seriesStats[series]) {
                      seriesStats[series] = { availableCount: 0, returnedCount: 0 };
                    }
                    if (u.status === 'available') {
                      seriesStats[series].availableCount++;
                    } else if (u.status === 'returned') {
                      seriesStats[series].returnedCount++;
                    }
                  }

                  for (const series of Array.from(allSeries).sort()) {
                    const stats = seriesStats[series];
                    const totalUnitsInSeries = units.filter(u => u.model.split(' ').slice(0, 2).join(' ') === series).length;

                    if (totalUnitsInSeries > 0 && stats.availableCount === 0) {
                      const alertId = `outofstock-${series}`;
                      if (!seen.has(alertId)) {
                        seen.add(alertId);
                        alerts.push({ id: alertId, model: series, detail: 'Out of Stock' });
                      }
                    }

                    if (stats.availableCount > 0 && stats.availableCount <= 2) {
                      const alertId = `lowstock-${series}`;
                      if (!seen.has(alertId)) {
                        seen.add(alertId);
                        alerts.push({ id: alertId, model: series, detail: `Only ${stats.availableCount} left` });
                      }
                    }

                    if (stats.returnedCount > 0) {
                      const alertId = `returned-${series}`;
                      if (!seen.has(alertId)) {
                        seen.add(alertId);
                        alerts.push({ id: alertId, model: series, detail: `${stats.returnedCount} returned` });
                      }
                    }
                  }

                  alerts.sort((a, b) => {
                    const orderA = a.detail.includes('Out of Stock') ? 0 : a.detail.includes('Only') ? 1 : 2;
                    const orderB = b.detail.includes('Out of Stock') ? 0 : b.detail.includes('Only') ? 1 : 2;
                    if (orderA !== orderB) return orderA - orderB;
                    return a.model.localeCompare(b.model);
                  });

                  return alerts.length > 0 ? alerts.map(alert => (
                    <div key={alert.id} className="px-2 py-1.5 border-l-2 border-red-300 bg-white/60 rounded-sm">
                      <p className="text-[11px] font-bold text-slate-900 truncate leading-tight">{alert.model}</p>
                      <p className="text-[10px] text-slate-700 mt-0.5 leading-tight">{alert.detail}</p>
                    </div>
                  )) : (
                    <p className="text-[10px] text-slate-500 text-center py-3">No critical alerts</p>
                  );
                })()
              ) : (
                <p className="text-[10px] text-slate-500 text-center py-3">No data</p>
              )}
            </div>
          )}
        </div>

        {/* User footer */}
        <div className="flex-shrink-0 p-3 border-t border-slate-100 space-y-1">
          {(() => {
            const displayName = user.displayName || user.email?.split('@')[0] || 'User';
            return (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-slate-50">
                <div className="w-7 h-7 rounded-lg bg-slate-900 flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
                  {displayName[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-slate-900 truncate leading-none">{displayName}</p>
                  <p className="text-[9px] text-slate-400 font-mono truncate mt-0.5">{user.email}</p>
                </div>
              </div>
            );
          })()}
          <button onClick={() => signOut()}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all">
            <LogOut size={12} strokeWidth={2.5} /> Sign Out
          </button>
          {showSampleDataButton && userIsAdmin && (
            <button onClick={() => setIsLoadMockDataOpen(true)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all">
              <Database size={12} strokeWidth={2} /> Sample Data
            </button>
          )}
        </div>
      </motion.aside>
        )}
      </AnimatePresence>

      {/* ── Right column (header + scrollable content) ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top header */}
        <header className="flex-shrink-0 h-14 md:h-16 bg-white border-b border-slate-200 flex items-center px-4 md:px-6 gap-3 z-20">

          {/* Hamburger — primary nav trigger across all viewports. The drawer
              holds the full sidebar (brand strip + nav tabs + Admin sub-nav +
              stock alerts + user footer). Mobile still has the bottom tab
              bar as a thumb-reach fallback for the 4 top-level tabs. */}
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="flex items-center justify-center w-10 h-10 rounded-xl hover:bg-slate-100 active:scale-95 transition-all text-slate-700"
          >
            <Menu size={20} strokeWidth={2.25} />
          </button>

          {/* Brand + region badge — always visible next to the hamburger. */}
          <button onClick={() => setActiveTab('buy')} className="active:scale-95 transition-transform min-w-0 mr-auto md:mr-0">
            <h1 className="text-sm md:text-base font-black tracking-tighter uppercase font-display text-slate-900 leading-none truncate">{APP_NAME}</h1>
            <p className="text-[7px] text-slate-400 font-mono uppercase tracking-[0.35em] mt-0.5 truncate">
              {APP_TAGLINE}
              {regionBadge && (
                <>
                  {' · '}
                  <span className="text-slate-600">{regionBadge.toUpperCase()}</span>
                </>
              )}
            </p>
          </button>

          {/* Desktop: section breadcrumb */}
          <div className="hidden md:flex items-center gap-2 min-w-0 ml-4">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400 truncate">
              {NAV_TABS.find(t => t.id === activeTab)?.label}
            </span>
            {activeTab === 'admin' && userIsAdmin && (
              <>
                <span className="text-slate-300 flex-shrink-0">/</span>
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-600 truncate">
                  {ADMIN_SUBS.find(s => s.id === adminSub)?.label}
                </span>
              </>
            )}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
            <div className="flex items-center gap-1.5" title={syncConnected ? 'Live sync' : 'Offline'}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${syncConnected ? 'bg-emerald-500' : 'bg-amber-400'}`} />
              <span className="hidden md:inline text-[9px] font-mono uppercase tracking-widest text-slate-400">
                {syncConnected ? 'Live' : 'Offline'}
              </span>
            </div>
            <NotificationBell unreadCount={unreadCount} />
            <button onClick={() => signOut()}
              className="md:hidden p-2 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all">
              <LogOut size={14} strokeWidth={2.5} />
            </button>
            {showSampleDataButton && userIsAdmin && (
              <button onClick={() => setIsLoadMockDataOpen(true)}
                title="Load sample data"
                className="p-2 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all">
                <Settings size={14} strokeWidth={2.5} />
              </button>
            )}
            {userIsAdmin && (
              <div className="relative">
                <button
                  onClick={() => setImportMenuOpen(o => !o)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-all"
                  aria-haspopup="menu"
                  aria-expanded={importMenuOpen}
                >
                  <FileSpreadsheet size={12} />
                  <span className="hidden md:inline">Import</span>
                </button>
                {importMenuOpen && (
                  <>
                    {/* Click-outside dismiss — sits below the menu in
                        z-order so the menu items still receive clicks. */}
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setImportMenuOpen(false)}
                    />
                    <div
                      role="menu"
                      className="absolute right-0 top-full mt-1.5 z-40 w-56 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setImportMenuOpen(false); setIsImportModalOpen(true); }}
                        className="w-full flex items-start gap-2.5 px-3 py-2.5 hover:bg-slate-50 text-left transition-colors"
                      >
                        <FileSpreadsheet size={14} className="text-slate-700 mt-0.5 flex-shrink-0" />
                        <span className="flex-1">
                          <span className="block text-[11px] font-bold text-slate-900">Inventory Report</span>
                          <span className="block text-[9px] font-mono text-slate-500 mt-0.5">Stock-in · 9-col schema · IMEI / model / supplier</span>
                        </span>
                      </button>
                      <div className="border-t border-slate-100" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setImportMenuOpen(false); setIsSalesImportOpen(true); }}
                        className="w-full flex items-start gap-2.5 px-3 py-2.5 hover:bg-slate-50 text-left transition-colors"
                      >
                        <FileSpreadsheet size={14} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                        <span className="flex-1">
                          <span className="block text-[11px] font-bold text-slate-900">Sales Report</span>
                          <span className="block text-[9px] font-mono text-slate-500 mt-0.5">Backfill historic sales · AMAZON / BM / EBAY / ONBUY sheets</span>
                        </span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Scrollable page content */}
        <main className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="p-4 md:p-8 pb-24 md:pb-8">

            {/* Admin sub-nav strip (mobile shows it inline; desktop also gets a
                horizontal pill row above the pane so the active section is
                obvious even with the sidebar visible). */}
            {activeTab === 'admin' && userIsAdmin && (
              <div className="flex gap-2 mb-5 overflow-x-auto pb-1 -mx-1 px-1">
                {ADMIN_SUBS.map(s => (
                  <button key={s.id} onClick={() => setAdminSub(s.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest flex-shrink-0 transition-all border
                      ${adminSub === s.id
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                    {s.icon}{s.label}
                  </button>
                ))}
              </div>
            )}

            <AnimatePresence mode="wait">
              <motion.div key={activeTab === 'admin' ? `admin-${adminSub}` : activeTab}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                {activeTab === 'notices' && <NoticeBoard />}
                {activeTab === 'buy'     && <BuySheet onOpenBatch={() => setIsBatchModalOpen(true)} onOpenImport={() => setIsImportModalOpen(true)} />}
                {activeTab === 'sell'    && <SellSheet />}
                {activeTab === 'returns' && <ReturnsPage />}
                {activeTab === 'admin' && userIsAdmin && adminSub === 'overview'     && (
                  <Dashboard
                    user={user}
                    onNavigate={handleNavigate}
                    onOpenImport={() => setIsImportModalOpen(true)}
                  />
                )}
                {activeTab === 'admin' && userIsAdmin && adminSub === 'salesHistory' && <Sales />}
                {activeTab === 'admin' && userIsAdmin && adminSub === 'vat'          && <VatCentre />}
                {activeTab === 'admin' && userIsAdmin && adminSub === 'insights'     && <AnalyticsPage />}
                {activeTab === 'admin' && userIsAdmin && adminSub === 'reports'      && <ReportingPage />}
                {activeTab === 'admin' && userIsAdmin && adminSub === 'configuration' && <ConfigurationPanel />}
                {activeTab === 'admin' && userIsAdmin && adminSub === 'skus'          && <SkuReconciliation />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* ── Mobile bottom nav ── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 safe-area-bottom flex items-stretch">
        {NAV_TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-all
              ${activeTab === t.id ? 'text-slate-900' : 'text-slate-400'}`}>
            <div className={`relative p-1.5 rounded-xl transition-all ${activeTab === t.id ? 'bg-slate-900 text-white' : ''}`}>
              {t.icon}
              {t.id === 'returns' && pendingCrmCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-violet-600 text-white text-[8px] font-bold flex items-center justify-center"
                >
                  {pendingCrmCount > 99 ? '99+' : pendingCrmCount}
                </span>
              )}
              {t.id === 'notices' && unseenNoticeCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-amber-500 text-black text-[8px] font-bold flex items-center justify-center"
                >
                  {unseenNoticeCount > 99 ? '99+' : unseenNoticeCount}
                </span>
              )}
            </div>
            <span className="text-[9px] font-bold uppercase tracking-wide">{t.label}</span>
          </button>
        ))}
      </nav>

      <AnimatePresence>
        {isBatchModalOpen  && <NewBatchModal  onClose={() => setIsBatchModalOpen(false)} />}
        {isImportModalOpen && <InventoryReportImport onClose={() => setIsImportModalOpen(false)} />}
        {isSalesImportOpen && <SalesReportImport onClose={() => setIsSalesImportOpen(false)} />}
        {isLoadMockDataOpen && <LoadMockDataModal onClose={() => setIsLoadMockDataOpen(false)} />}
      </AnimatePresence>
      <NotificationToast />
    </div>
  );
}


// ── Login Page ────────────────────────────────────────────────────────────────
//
// Plain Firebase email/password sign-in. The Firebase Console is the source
// of truth for who's allowed in — provision new teammates via Authentication →
// Add user. No client-side allowlist.
function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const canSubmit = email.trim().length > 0 && password.length > 0 && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setLoading(true);
    try {
      await signInWithEmail(email.trim(), password);
    } catch (err: any) {
      setError(err?.message || 'Sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-white flex">
      <div className="hidden lg:flex w-1/2 bg-black flex-col justify-between p-16">
        <div>
          <h1 className="text-5xl font-bold tracking-tighter uppercase text-white font-display">{APP_NAME}</h1>
          <p className="text-[9px] text-gray-500 font-mono uppercase tracking-[0.4em] mt-2">{APP_TAGLINE} · Admin Portal</p>
        </div>
        <div className="space-y-8">
          {[
            { label: 'Real-time Stock Tracking',  desc: 'IMEI-level visibility for every unit' },
            { label: 'Live Multi-device Sync',     desc: 'Any change is instant everywhere' },
            { label: 'Excel Import',               desc: 'One-click migration from your stock sheet' },
          ].map(f => (
            <div key={f.label} className="flex items-start gap-4">
              <div className="w-1 h-1 mt-2 bg-white rounded-full flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-white tracking-tight">{f.label}</p>
                <p className="text-[10px] text-gray-500 font-mono mt-0.5">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[9px] text-gray-600 font-mono uppercase tracking-widest">Team access only</p>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm space-y-6">
          <div className="lg:hidden text-center">
            <h1 className="text-4xl font-bold tracking-tighter uppercase font-display">{APP_NAME}</h1>
            <p className="text-[10px] text-gray-400 font-mono uppercase tracking-[0.4em] mt-1">{APP_TAGLINE}</p>
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Sign In</h2>
            <p className="text-sm text-gray-500 mt-1">Sign in with your email and password</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1.5">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-all"
              />
            </div>

            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="text-xs text-red-600 font-mono bg-red-50 border border-red-100 px-4 py-2.5 rounded-xl"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full flex items-center justify-center gap-3 bg-black text-white rounded-xl py-3.5 px-6 text-sm font-semibold hover:bg-gray-800 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading
                ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                    className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full" />
                : null}
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
          <p className="text-[9px] text-gray-400 font-mono text-center uppercase tracking-wide">
            Forgot password? Ask an admin to reset it.
          </p>
        </motion.div>
      </div>
    </div>
  );
}


// ── Admin → Suppliers → WhatsApp Updates ──────────────────────────────────────
// Small surface for the supplier WhatsApp feed pulled from the store. This was
// previously unsurfaced; Admin → Suppliers is the natural home for it.
function SupplierWhatsappPanel({ feed }: { feed: SupplierWhatsappUpdate[] }) {
  if (!feed || feed.length === 0) {
    return (
      <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm">
        <h3 className="text-sm font-bold tracking-tight">Supplier WhatsApp Updates</h3>
        <p className="text-[11px] text-slate-500 font-mono mt-1">No supplier messages captured yet.</p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold tracking-tight">Supplier WhatsApp Updates</h3>
        <span className="text-[9px] font-mono uppercase tracking-widest text-slate-400">{feed.length} msgs</span>
      </div>
      <div className="divide-y divide-slate-100 -mx-2">
        {feed.map(row => (
          <div key={row.id} className="flex items-start gap-3 px-2 py-2">
            <p className="flex-1 min-w-0 text-[11px] font-mono text-slate-800 whitespace-pre-wrap break-words leading-relaxed">
              {row.rawText}
            </p>
            <p className="flex-shrink-0 text-[12px] font-bold tracking-tight text-slate-900 text-right tabular-nums">
              {row.priceText ?? ''}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}


