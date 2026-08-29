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

describe('the Internet check can never contradict its passing siblings', () => {
  /** Seen live: the first version pinged one Google URL on its own, an
   *  ad-blocker quietly blocked exactly that URL, and the operator saw
   *  "✗ cannot reach Google" printed above four green ticks — a fresh
   *  confusion from the tool built to end confusion. The verdict now
   *  derives from the checks that matter: if the sign-in service or the
   *  database ANSWERED, the internet self-evidently works, and the ping is
   *  only the tie-breaker when both are silent. */
  const PANEL = readFileSync('src/components/DiagnosticsPanel.tsx', 'utf8');

  it('judges internet by whether the real services answered', () => {
    expect(PANEL).toMatch(/const \[viaSignin, viaDb\] = await Promise\.all\(\[signinAnswered, dbAnswered\]\);/);
    expect(PANEL).toMatch(/if \(viaSignin \|\| viaDb\) \{/);
  });

  it('uses the bare ping only as the tie-breaker', () => {
    const pingAt = PANEL.indexOf('generate_204');
    const verdictAt = PANEL.indexOf('viaSignin || viaDb');
    expect(pingAt).toBeGreaterThan(verdictAt);
  });
});
