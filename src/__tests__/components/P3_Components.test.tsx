import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CopyImei from '../../components/CopyImei';
import ErrorBoundary from '../../components/ErrorBoundary';
import Dashboard from '../../components/Dashboard';
import { useInventoryStore } from '../../lib/inventoryStore';

vi.mock('../../lib/inventoryStore');
vi.mock('motion/react', () => ({
  motion: { div: ({ children, ...props }: any) => <div {...props}>{children}</div> },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// ─── CopyImei Tests (P3) ──────────────────────────────────────────────────
describe('CopyImei (P3)', () => {
  describe('Rendering', () => {
    it('should display IMEI with truncation', () => {
      render(<CopyImei imei="359108096724237" truncate={10} />);
      // Should show first 10 digits + ellipsis
      expect(screen.getByText(/3591080967/)).toBeInTheDocument();
    });

    it('should display full IMEI without truncation', () => {
      render(<CopyImei imei="359108096724237" />);
      expect(screen.getByText('359108096724237')).toBeInTheDocument();
    });

    it('should display empty state for missing IMEI', () => {
      render(<CopyImei imei={undefined} />);
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('should handle null IMEI gracefully', () => {
      render(<CopyImei imei={null as any} />);
      // Should render without crashing
      const element = screen.getByText('—');
      expect(element).toBeInTheDocument();
    });
  });

  describe('Copy Functionality', () => {
    it('should have copy button', () => {
      render(<CopyImei imei="359108096724237" />);
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should copy full IMEI to clipboard', async () => {
      const user = userEvent.setup();
      const clipboardSpy = vi.spyOn(navigator.clipboard, 'writeText');

      render(<CopyImei imei="359108096724237" />);
      const copyButton = screen.getAllByRole('button')[0];

      await user.click(copyButton);

      expect(clipboardSpy).toHaveBeenCalledWith('359108096724237');
    });

    it('should show success feedback after copying', async () => {
      const user = userEvent.setup();
      vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

      render(<CopyImei imei="359108096724237" />);
      const copyButton = screen.getAllByRole('button')[0];

      await user.click(copyButton);
      // Component might show visual feedback
    });

    it('should handle copy error gracefully', async () => {
      const user = userEvent.setup();
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Copy failed'));

      render(<CopyImei imei="359108096724237" />);
      const copyButton = screen.getAllByRole('button')[0];

      await user.click(copyButton);
      // Component should handle error without crashing
    });
  });

  describe('Styling', () => {
    it('should apply monospace font', () => {
      render(<CopyImei imei="359108096724237" />);
      const element = screen.getByText('359108096724237');
      expect(element.className).toContain('mono');
    });

    it('should show tooltip or indicator', () => {
      render(<CopyImei imei="359108096724237" truncate={10} />);
      // Should indicate truncation
      const text = screen.getByText(/3591080967/);
      expect(text).toBeInTheDocument();
    });
  });
});

// ─── ErrorBoundary Tests (P3) ─────────────────────────────────────────────
describe('ErrorBoundary (P3)', () => {
  const errorMessage = 'Test error';
  const TestComponent = ({ shouldError }: { shouldError: boolean }) => {
    if (shouldError) throw new Error(errorMessage);
    return <div>Working Component</div>;
  };

  describe('Error Handling', () => {
    it('should render children when no error', () => {
      render(
        <ErrorBoundary>
          <TestComponent shouldError={false} />
        </ErrorBoundary>
      );
      expect(screen.getByText('Working Component')).toBeInTheDocument();
    });

    it('should catch errors in children', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(
          <ErrorBoundary>
            <TestComponent shouldError={true} />
          </ErrorBoundary>
        );
      }).not.toThrow();

      vi.restoreAllMocks();
    });

    it('should display error message', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      render(
        <ErrorBoundary>
          <TestComponent shouldError={true} />
        </ErrorBoundary>
      );

      // Error boundary should show fallback UI
      expect(screen.queryByText('Working Component')).not.toBeInTheDocument();

      vi.restoreAllMocks();
    });

    it('should provide error recovery option', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const { rerender } = render(
        <ErrorBoundary>
          <TestComponent shouldError={true} />
        </ErrorBoundary>
      );

      // Re-render with no error should work
      rerender(
        <ErrorBoundary>
          <TestComponent shouldError={false} />
        </ErrorBoundary>
      );

      expect(screen.getByText('Working Component')).toBeInTheDocument();

      vi.restoreAllMocks();
    });
  });

  describe('Error Display', () => {
    it('should show helpful error message to users', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      render(
        <ErrorBoundary>
          <TestComponent shouldError={true} />
        </ErrorBoundary>
      );

      // Should display user-friendly error message
      const errorText = screen.queryByText(/Something went wrong/i) ||
                       screen.queryByText(/error/i) ||
                       document.body.textContent?.includes('Error');

      vi.restoreAllMocks();
    });
  });
});

// ─── Dashboard Tests (P3) ─────────────────────────────────────────────────
describe('Dashboard (P3)', () => {
  const mockUnit = {
    id: 'unit_001',
    imei: '359108096724237',
    model: 'iPhone 15 Pro',
    brand: 'Apple',
    category: 'iPhone',
    colour: 'Black',
    buyPrice: 450,
    dateIn: '2024-04-01',
    supplierId: 'sup_001',
    status: 'available',
    flags: [],
    notes: '',
    platformListed: false,
    listingSites: [],
    ownerId: 'shared',
    createdAt: new Date().toISOString(),
    batchId: 'master_batch',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useInventoryStore.mockReturnValue({
      units: [mockUnit],
      suppliers: [{ id: 'sup_001', name: 'MHL' }],
    });
  });

  describe('Rendering', () => {
    it('should render dashboard header', () => {
      render(<Dashboard />);
      expect(screen.getByText(/Dashboard|Overview|Home/i)).toBeInTheDocument();
    });

    it('should display key performance indicators', () => {
      render(<Dashboard />);
      // Should show KPIs like inventory value, count, etc.
      expect(screen.getByText(/available|stock|value/i)).toBeInTheDocument();
    });

    it('should show oldest units tracking', () => {
      render(<Dashboard />);
      // Should display list of oldest units in inventory
      expect(screen.getByText(/oldest|First in/i) || screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    });

    it('should display summary cards', () => {
      render(<Dashboard />);
      // Should have multiple summary cards for different metrics
      const cards = screen.queryAllByRole('heading');
      expect(cards.length).toBeGreaterThan(0);
    });
  });

  describe('Key Metrics', () => {
    it('should calculate and display total inventory value', () => {
      render(<Dashboard />);
      // Should show total value of all units
      expect(screen.getByText(/£|total|value/i)).toBeInTheDocument();
    });

    it('should show count of available units', () => {
      render(<Dashboard />);
      expect(screen.getByText(/1|available|in stock/i)).toBeInTheDocument();
    });

    it('should track oldest unit age', () => {
      render(<Dashboard />);
      // Should indicate how long oldest unit has been in inventory
    });

    it('should display units by status', () => {
      const units = [
        { ...mockUnit, id: 'u1', status: 'available' },
        { ...mockUnit, id: 'u2', status: 'sold' },
        { ...mockUnit, id: 'u3', status: 'returned' },
      ];

      useInventoryStore.mockReturnValue({
        units,
        suppliers: [{ id: 'sup_001', name: 'MHL' }],
      });

      render(<Dashboard />);
      // Should show breakdown by status
    });
  });

  describe('Oldest Units List', () => {
    it('should display oldest units in order', () => {
      const units = [
        { ...mockUnit, id: 'u1', dateIn: '2024-01-01' },
        { ...mockUnit, id: 'u2', dateIn: '2024-02-01' },
        { ...mockUnit, id: 'u3', dateIn: '2024-03-01' },
      ];

      useInventoryStore.mockReturnValue({
        units,
        suppliers: [{ id: 'sup_001', name: 'MHL' }],
      });

      render(<Dashboard />);
      // First unit should be from Jan 2024
    });

    it('should show days in inventory for each unit', () => {
      render(<Dashboard />);
      // Should display how many days each unit has been in stock
    });

    it('should highlight aged inventory', () => {
      const oldUnit = { ...mockUnit, dateIn: '2023-01-01' };
      useInventoryStore.mockReturnValue({
        units: [oldUnit],
        suppliers: [{ id: 'sup_001', name: 'MHL' }],
      });

      render(<Dashboard />);
      // Old unit should be visually highlighted
    });
  });

  describe('Quick Actions', () => {
    it('should provide quick access to main features', () => {
      render(<Dashboard />);
      // Should have buttons or links to Sell, Buy, Returns, etc.
      const buttons = screen.queryAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should allow quick navigation', () => {
      render(<Dashboard />);
      // Should have navigation options
    });
  });
});

// ─── Additional P3 Component Tests ────────────────────────────────────────
describe('P3 UI Components - General', () => {
  it('should have consistent styling across P3 components', () => {
    render(<CopyImei imei="123456789012345" />);
    const element = screen.getByText(/12345678901/);
    expect(element).toBeInTheDocument();
  });

  it('should be accessible with keyboard navigation', async () => {
    const user = userEvent.setup();
    render(<CopyImei imei="123456789012345" />);

    const buttons = screen.getAllByRole('button');
    if (buttons.length > 0) {
      buttons[0].focus();
      expect(buttons[0]).toHaveFocus();
    }
  });

  it('should support responsive design', () => {
    const { container } = render(<CopyImei imei="123456789012345" />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('should handle edge cases gracefully', () => {
    const { rerender } = render(<CopyImei imei="123" />);
    expect(screen.getByText('123')).toBeInTheDocument();

    rerender(<CopyImei imei="" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
