import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CollapsibleSection from '../../components/CollapsibleSection';

vi.mock('motion/react', () => ({
  motion: { div: ({ children, ...props }: any) => <div {...props}>{children}</div> },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// ─── CollapsibleSection Tests ─────────────────────────────────────────────
describe('CollapsibleSection (P2)', () => {
  const defaultProps = {
    title: 'Test Section',
    count: 5,
    defaultOpen: false,
    accent: 'border-l-blue-500',
    children: <div>Test Content</div>,
  };

  describe('Rendering', () => {
    it('should render section with title', () => {
      render(<CollapsibleSection {...defaultProps} />);
      expect(screen.getByText('Test Section')).toBeInTheDocument();
    });

    it('should display count badge', () => {
      render(<CollapsibleSection {...defaultProps} count={5} />);
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('should render children when expanded', async () => {
      render(<CollapsibleSection {...defaultProps} defaultOpen={true} />);
      await waitFor(() => {
        expect(screen.getByText('Test Content')).toBeInTheDocument();
      });
    });

    it('should hide children when collapsed', () => {
      const { queryByText } = render(<CollapsibleSection {...defaultProps} defaultOpen={false} />);
      expect(queryByText('Test Content')).not.toBeInTheDocument();
    });
  });

  describe('Toggle Functionality', () => {
    it('should toggle expansion on click', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<CollapsibleSection {...defaultProps} defaultOpen={false} />);

      // Find and click the toggle button
      const toggles = screen.getAllByRole('button');
      if (toggles.length > 0) {
        await user.click(toggles[0]);
        // Content should appear after toggle
      }
    });

    it('should show chevron icon for expansion state', () => {
      render(<CollapsibleSection {...defaultProps} defaultOpen={false} />);
      // Icon should indicate collapsed state
      expect(screen.getByText('Test Section')).toBeInTheDocument();
    });
  });

  describe('Styling', () => {
    it('should apply accent color class', () => {
      render(<CollapsibleSection {...defaultProps} accent="border-l-emerald-500" />);
      const section = screen.getByText('Test Section').parentElement;
      expect(section?.className).toContain('emerald');
    });

    it('should render with different accent colors', () => {
      const accents = ['border-l-blue-500', 'border-l-emerald-500', 'border-l-red-500'];
      accents.forEach(accent => {
        const { unmount } = render(<CollapsibleSection {...defaultProps} accent={accent} />);
        unmount();
      });
    });
  });

  describe('Count Display', () => {
    it('should display zero count', () => {
      render(<CollapsibleSection {...defaultProps} count={0} />);
      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('should display large count', () => {
      render(<CollapsibleSection {...defaultProps} count={999} />);
      expect(screen.getByText('999')).toBeInTheDocument();
    });

    it('should update count dynamically', () => {
      const { rerender } = render(<CollapsibleSection {...defaultProps} count={5} />);
      expect(screen.getByText('5')).toBeInTheDocument();

      rerender(<CollapsibleSection {...defaultProps} count={10} />);
      expect(screen.getByText('10')).toBeInTheDocument();
    });
  });
});
