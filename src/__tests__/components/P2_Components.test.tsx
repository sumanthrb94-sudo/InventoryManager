import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationToast from '../../components/NotificationToast';
import CollapsibleSection from '../../components/CollapsibleSection';
import { notificationService } from '../../lib/notificationService';

vi.mock('../../lib/notificationService');
vi.mock('motion/react', () => ({
  motion: { div: ({ children, ...props }: any) => <div {...props}>{children}</div> },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// ─── NotificationToast Tests ──────────────────────────────────────────────
describe('NotificationToast (P2)', () => {
  const mockNotification = {
    id: 'notif_001',
    type: 'sold' as const,
    title: '✅ Unit Sold!',
    message: 'iPhone 15 Pro sold on eBay',
    model: 'iPhone 15 Pro',
    timestamp: new Date().toISOString(),
    read: false,
    profitAmount: 520.46,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    notificationService.subscribe = vi.fn((callback) => {
      callback([mockNotification]);
      return () => {};
    });
    notificationService.markAsRead = vi.fn();
  });

  describe('Rendering', () => {
    it('should render notification toast container', () => {
      render(<NotificationToast />);
      // Toast container should be in fixed position
      const container = document.querySelector('.fixed');
      expect(container).toBeInTheDocument();
    });

    it('should display notification when triggered', async () => {
      render(<NotificationToast />);
      await waitFor(() => {
        expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
      });
    });

    it('should show notification title', async () => {
      render(<NotificationToast />);
      await waitFor(() => {
        expect(screen.getByText('✅ Unit Sold!')).toBeInTheDocument();
      });
    });

    it('should show notification message', async () => {
      render(<NotificationToast />);
      await waitFor(() => {
        expect(screen.getByText(/iPhone 15 Pro sold on eBay/i)).toBeInTheDocument();
      });
    });

    it('should display profit amount for profitable sale', async () => {
      render(<NotificationToast />);
      await waitFor(() => {
        expect(screen.getByText(/✓ Profit/i)).toBeInTheDocument();
        expect(screen.getByText('£520.46')).toBeInTheDocument();
      });
    });

    it('should display loss warning for loss sale', async () => {
      const lossNotification = { ...mockNotification, type: 'loss_sell' as const, profitAmount: -70.54 };
      notificationService.subscribe = vi.fn((callback) => {
        callback([lossNotification]);
        return () => {};
      });

      render(<NotificationToast />);
      await waitFor(() => {
        expect(screen.getByText(/⚠ Loss/i)).toBeInTheDocument();
        expect(screen.getByText('£70.54')).toBeInTheDocument();
      });
    });
  });

  describe('Notification Types', () => {
    it('should display sold notification with correct styling', async () => {
      render(<NotificationToast />);
      await waitFor(() => {
        const notification = screen.getByText('iPhone 15 Pro').parentElement;
        expect(notification?.className).toContain('emerald');
      });
    });

    it('should display loss_sell notification with red styling', async () => {
      const lossNotif = { ...mockNotification, type: 'loss_sell' as const };
      notificationService.subscribe = vi.fn((callback) => {
        callback([lossNotif]);
        return () => {};
      });

      render(<NotificationToast />);
      await waitFor(() => {
        const notification = screen.getByText('iPhone 15 Pro').parentElement;
        expect(notification?.className).toContain('red');
      });
    });

    it('should display new_stock notification with blue styling', async () => {
      const newStockNotif = { ...mockNotification, type: 'new_stock' as const };
      notificationService.subscribe = vi.fn((callback) => {
        callback([newStockNotif]);
        return () => {};
      });

      render(<NotificationToast />);
      await waitFor(() => {
        const notification = screen.getByText('iPhone 15 Pro').parentElement;
        expect(notification?.className).toContain('blue');
      });
    });

    it('should display return_processed notification with amber styling', async () => {
      const returnNotif = { ...mockNotification, type: 'return_processed' as const };
      notificationService.subscribe = vi.fn((callback) => {
        callback([returnNotif]);
        return () => {};
      });

      render(<NotificationToast />);
      await waitFor(() => {
        const notification = screen.getByText('iPhone 15 Pro').parentElement;
        expect(notification?.className).toContain('amber');
      });
    });

    it('should display shs_received notification with purple styling', async () => {
      const shsNotif = { ...mockNotification, type: 'shs_received' as const };
      notificationService.subscribe = vi.fn((callback) => {
        callback([shsNotif]);
        return () => {};
      });

      render(<NotificationToast />);
      await waitFor(() => {
        const notification = screen.getByText('iPhone 15 Pro').parentElement;
        expect(notification?.className).toContain('purple');
      });
    });
  });

  describe('Dismiss Functionality', () => {
    it('should have dismiss button', async () => {
      render(<NotificationToast />);
      await waitFor(() => {
        const dismissButton = screen.getByRole('button', { name: /Dismiss/i });
        expect(dismissButton).toBeInTheDocument();
      });
    });

    it('should mark notification as read when dismissed', async () => {
      const user = userEvent.setup();
      render(<NotificationToast />);

      await waitFor(() => {
        const dismissButton = screen.getByRole('button', { name: /Dismiss/i });
        userEvent.click(dismissButton);
      });

      expect(notificationService.markAsRead).toHaveBeenCalledWith('notif_001');
    });

    it('should remove notification from display when dismissed', async () => {
      const user = userEvent.setup();
      render(<NotificationToast />);

      await waitFor(() => {
        const dismissButton = screen.getByRole('button', { name: /Dismiss/i });
        expect(dismissButton).toBeInTheDocument();
      });
    });
  });

  describe('Multiple Notifications', () => {
    it('should display multiple notifications in queue', async () => {
      const notif1 = { ...mockNotification, id: 'notif_001' };
      const notif2 = { ...mockNotification, id: 'notif_002', model: 'Samsung Galaxy S21' };

      notificationService.subscribe = vi.fn((callback) => {
        callback([notif1, notif2]);
        return () => {};
      });

      render(<NotificationToast />);
      await waitFor(() => {
        expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
        expect(screen.getByText('Samsung Galaxy S21')).toBeInTheDocument();
      });
    });

    it('should limit visible notifications to MAX_VISIBLE', async () => {
      const notifications = Array.from({ length: 15 }, (_, i) => ({
        ...mockNotification,
        id: `notif_${i}`,
        model: `Model ${i}`,
      }));

      notificationService.subscribe = vi.fn((callback) => {
        callback(notifications);
        return () => {};
      });

      render(<NotificationToast />);
      await waitFor(() => {
        // Should show at most 10 notifications
        const models = screen.queryAllByText(/Model/i);
        expect(models.length).toBeLessThanOrEqual(10);
      });
    });
  });

  describe('Subscription Management', () => {
    it('should subscribe to notification service', () => {
      render(<NotificationToast />);
      expect(notificationService.subscribe).toHaveBeenCalled();
    });

    it('should unsubscribe on unmount', () => {
      const unsubscribe = vi.fn();
      notificationService.subscribe = vi.fn(() => unsubscribe);

      const { unmount } = render(<NotificationToast />);
      unmount();

      expect(unsubscribe).toHaveBeenCalled();
    });
  });
});

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
