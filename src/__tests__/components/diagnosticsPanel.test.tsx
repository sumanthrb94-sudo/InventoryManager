// @vitest-environment jsdom
/**
 * The diagnostics panel — the debugging session an operator can run alone.
 *
 * Two days of an outage were diagnosed over phone screenshots because
 * nothing in the app could say WHICH leg was failing on a given device.
 * These tests pin the panel's contract: five checks, plain-words verdicts,
 * a storage reset that touches only this device, and entry points that are
 * reachable from every broken-looking state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import React from 'react';
import DiagnosticsPanel from '../../components/DiagnosticsPanel';

beforeEach(() => {
  // Deterministic: every network probe fails fast — the panel must render
  // its failure wording, not hang or crash.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline test'))));
});
afterEach(() => { vi.unstubAllGlobals(); cleanup(); });

describe('DiagnosticsPanel', () => {
  it('renders all five checks and the reset button', async () => {
    render(<DiagnosticsPanel onClose={() => {}} />);
    expect(screen.getByText(/1 · Internet/)).toBeTruthy();
    expect(screen.getByText(/2 · Sign-in service/)).toBeTruthy();
    expect(screen.getByText(/3 · Database/)).toBeTruthy();
    expect(screen.getByText(/4 · Live sync/)).toBeTruthy();
    expect(screen.getByText(/5 · Local storage/)).toBeTruthy();
    expect(screen.getByText(/Reset app storage on this device/i)).toBeTruthy();
  });

  it('the reset copy promises the server is untouched — the one fear that stops the click', () => {
    render(<DiagnosticsPanel onClose={() => {}} />);
    expect(screen.getByText(/Nothing on the server is touched/i)).toBeTruthy();
  });

  it('a signed-out run says so instead of failing cryptically', async () => {
    render(<DiagnosticsPanel onClose={() => {}} />);
    expect(await screen.findByText(/not signed in — sign in and run diagnostics again/i)).toBeTruthy();
  });
});

describe('entry points — reachable from every broken-looking state', () => {
  const APP = readFileSync('src/App.tsx', 'utf8');

  it('?diag=1 opens it before sign-in, and both warning banners link to it', () => {
    expect(APP).toMatch(/get\('diag'\) === '1'/);
    // Login screen + rose banner + amber strip each dispatch the open event.
    const links = APP.match(/open-diagnostics/g) || [];
    expect(links.length).toBeGreaterThanOrEqual(4);   // 3 dispatchers + 1 listener
  });

  it('renders in the signed-OUT branch too — a user who cannot sign in needs it most', () => {
    expect(APP).toMatch(/if \(!user\) return <>\{diag\}<LoginPage \/><\/>/);
  });
});

describe('the persistence meltdown trap (the phone that cost two days)', () => {
  /** The real error, verbatim from the operator's screenshot:
   *  FIRESTORE (12.13.0) INTERNAL ASSERTION FAILED: Unexpected state
   *  (ID: b815) CONTEXT: {"Rc":"QuotaExceededError…}. A full browser
   *  storage breaks the persistent cache AFTER init succeeds, so the
   *  makeDb() try/catch can never see it — the trap has to listen at
   *  runtime, flag the device, and reload it into memory-cache mode. */
  const FB = readFileSync('src/lib/firebase.ts', 'utf8');

  it('detects both faces of the failure', () => {
    expect(FB).toMatch(/INTERNAL ASSERTION FAILED/);
    expect(FB).toMatch(/QuotaExceededError/);
  });

  it('degrades to memory cache instead of reloading forever', () => {
    // The flag is checked BEFORE reload (no loop) and read by makeDb.
    expect(FB).toMatch(/if \(localStorage\.getItem\(CACHE_MODE_KEY\) === 'memory'\) return;/);
    expect(FB).toMatch(/localStorage\.getItem\(CACHE_MODE_KEY\) === 'memory'\) \{\n      console\.warn/);
  });

  it('listens where the SDK actually reports: console.error and unhandledrejection', () => {
    expect(FB).toMatch(/addEventListener\('unhandledrejection'/);
    expect(FB).toMatch(/console\.error = /);
  });
});
