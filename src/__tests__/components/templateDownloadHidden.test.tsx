/**
 * The "Build a new file from …" template block is OFF in the UI.
 *
 * Removed at the operator's request on 2026-08-15. This pins the removal at
 * the component, because that is the one place every call site passes through
 * — a future placement cannot reintroduce the block by rendering it somewhere
 * new.
 *
 * What is deliberately NOT asserted here: the template files. templates/ and
 * public/templates/ still exist and salesTemplateFormulas.test.ts still parses
 * them to check the schema against the report writer. Hiding a menu is not a
 * reason to delete a test of the columns.
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TemplateDownload from '../../components/TemplateDownload';
import { SHOW_TEMPLATE_DOWNLOADS } from '../../lib/featureFlags';

const TEMPLATES = [
  { file: 'SALES_AMAZON_TEMPLATE.xlsx', label: 'Amazon only', hint: '31 columns' },
  { file: 'SALES_BM_TEMPLATE.xlsx', label: 'BM only', hint: '30 columns' },
];

describe('the sales template downloads are gone from the UI', () => {
  it('the flag is off', () => {
    expect(SHOW_TEMPLATE_DOWNLOADS).toBe(false);
  });

  it('renders nothing at all, even handed a full list', () => {
    const { container } = render(<TemplateDownload templates={TEMPLATES} />);
    expect(container.innerHTML).toBe('');
  });

  it('no heading, no per-template row, no download link', () => {
    render(<TemplateDownload templates={TEMPLATES} />);
    expect(screen.queryByText(/Build a new file from/i)).toBeNull();
    expect(screen.queryByText(/Amazon only/i)).toBeNull();
    expect(screen.queryByText(/BM only/i)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('a custom heading does not get it back', () => {
    // The component takes a `heading` prop; the gate is above it.
    const { container } = render(
      <TemplateDownload templates={TEMPLATES} heading="Start from a template" />,
    );
    expect(container.innerHTML).toBe('');
  });
});
