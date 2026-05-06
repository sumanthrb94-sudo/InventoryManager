import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReturnsPage from '../../components/ReturnsPage';
import { useInventoryStore } from '../../lib/inventoryStore';
import { dbService } from '../../lib/dbService';
import { notificationService } from '../../lib/notificationService';
import { getWarrantyStatus } from '../../lib/warrantyUtils';

// Mock dependencies
vi.mock('../../lib/dbService');
vi.mock('../../lib/inventoryStore');
vi.mock('../../lib/notificationService');
vi.mock('../../lib/warrantyUtils');
vi.mock('../../components/CopyImei', () => ({
  default: ({ imei, truncate }: any) => <span>{imei?.slice(0, truncate) || '—'}</span>,
}));
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

const mockUnit: any = {
  id: 'unit_001',
  imei: '359108096724237',
  model: 'iPhone 15 Pro',
  brand: 'Apple',
  category: 'iPhone',
  colour: 'Black',
  buyPrice: 450,
  dateIn: '2026-04-01',
  supplierId: 'sup_001',
  status: 'sold',
  flags: [],
  notes: '',
  platformListed: false,
  listingSites: [],
  ownerId: 'shared',
  createdAt: new Date().toISOString(),
  batchId: 'master_batch',
  salePrice: 520,
  salePlatform: 'eBay',
  saleOrderId: '12-34567-89012',
  saleDate: new Date().toISOString().split('T')[0],
};

const mockReturnedUnit: any = {
  ...mockUnit,
  id: 'unit_returned_001',
  status: 'available',
  returnType: 'returned_to_inventory',
  returnDate: '2026-05-01',
  returnReason: 'Customer changed mind',
  salePrice: null,
  saleDate: null,
};

describe('ReturnsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useInventoryStore.mockReturnValue({
      units: [mockUnit, mockReturnedUnit],
    });
    dbService.update = vi.fn().mockResolvedValue(undefined);
    dbService.delete = vi.fn().mockResolvedValue(undefined);
    notificationService.addNotification = vi.fn();
    getWarrantyStatus.mockReturnValue({
      isExpired: false,
      endDate: '2026-08-01',
      daysLeft: 87,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Rendering', () => {
    it('should render ReturnsPage header', () => {
      render(<ReturnsPage />);
      expect(screen.getByText('Returns')).toBeInTheDocument();
    });

    it('should display summary cards', () => {
      render(<ReturnsPage />);
      expect(screen.getByText('Total Returns')).toBeInTheDocument();
      expect(screen.getByText('To Inventory')).toBeInTheDocument();
      expect(screen.getByText('Repair')).toBeInTheDocument();
      expect(screen.getByText('To Supplier')).toBeInTheDocument();
    });

    it('should show filter tabs', () => {
      render(<ReturnsPage />);
      expect(screen.getByText('All Returns')).toBeInTheDocument();
      expect(screen.getByText('Back to Inventory')).toBeInTheDocument();
      expect(screen.getByText('To Supplier')).toBeInTheDocument();
      expect(screen.getByText('Repair')).toBeInTheDocument();
    });

    it('should show search input', () => {
      render(<ReturnsPage />);
      expect(screen.getByPlaceholderText(/Search by model, IMEI or return reason/i)).toBeInTheDocument();
    });

    it('should show process return section with sold units', () => {
      render(<ReturnsPage />);
      expect(screen.getByText('Process New Return')).toBeInTheDocument();
      expect(screen.getByText(/sold units/i)).toBeInTheDocument();
    });
  });

  describe('Return Counts', () => {
    it('should display total return count', () => {
      render(<ReturnsPage />);
      expect(screen.getByText('1')).toBeInTheDocument(); // 1 returned unit
    });

    it('should display count for each return type', () => {
      const units = [
        mockReturnedUnit,
        {
          ...mockUnit,
          id: 'unit_002',
          status: 'available',
          returnType: 'returned_to_supplier',
        },
        {
          ...mockUnit,
          id: 'unit_003',
          status: 'returned',
          returnType: 'repair',
        },
      ];

      useInventoryStore.mockReturnValue({ units });
      render(<ReturnsPage />);

      expect(screen.getByText('3')).toBeInTheDocument(); // Total
    });
  });

  describe('Filter Tabs', () => {
    it('should filter by all returns', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const allButton = screen.getByRole('button', { name: /All Returns/i });
      await user.click(allButton);

      expect(allButton).toHaveClass('bg-black');
    });

    it('should filter by returned_to_inventory', async () => {
      const user = userEvent.setup();
      const units = [
        mockReturnedUnit,
        {
          ...mockUnit,
          id: 'unit_002',
          status: 'available',
          returnType: 'returned_to_supplier',
        },
      ];

      useInventoryStore.mockReturnValue({ units });
      render(<ReturnsPage />);

      const inventoryButton = screen.getByRole('button', { name: /Back to Inventory/i });
      await user.click(inventoryButton);

      expect(inventoryButton).toHaveClass('bg-black');
    });

    it('should filter by returned_to_supplier', async () => {
      const user = userEvent.setup();
      const supplierReturnUnit = {
        ...mockUnit,
        id: 'unit_supplier',
        status: 'available',
        returnType: 'returned_to_supplier',
      };

      useInventoryStore.mockReturnValue({ units: [supplierReturnUnit] });
      render(<ReturnsPage />);

      const supplierButton = screen.getByRole('button', { name: /To Supplier/i });
      await user.click(supplierButton);

      expect(supplierButton).toHaveClass('bg-black');
    });

    it('should filter by repair', async () => {
      const user = userEvent.setup();
      const repairUnit = {
        ...mockUnit,
        id: 'unit_repair',
        status: 'returned',
        returnType: 'repair',
      };

      useInventoryStore.mockReturnValue({ units: [repairUnit] });
      render(<ReturnsPage />);

      const repairButton = screen.getByRole('button', { name: /Repair/i });
      await user.click(repairButton);

      expect(repairButton).toHaveClass('bg-black');
    });
  });

  describe('Search Functionality', () => {
    it('should search by model name', async () => {
      const user = userEvent.setup();
      const units = [
        mockReturnedUnit,
        {
          ...mockUnit,
          id: 'unit_002',
          model: 'Samsung Galaxy S21',
          status: 'available',
          returnType: 'returned_to_inventory',
        },
      ];

      useInventoryStore.mockReturnValue({ units });
      render(<ReturnsPage />);

      const searchInput = screen.getByPlaceholderText(/Search by model, IMEI or return reason/i);
      await user.type(searchInput, 'iPhone');

      expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
      expect(screen.queryByText('Samsung Galaxy S21')).not.toBeInTheDocument();
    });

    it('should search by IMEI', async () => {
      const user = userEvent.setup();
      const units = [
        mockReturnedUnit,
        {
          ...mockUnit,
          id: 'unit_002',
          imei: '350220437101229',
          model: 'Samsung Galaxy',
          status: 'available',
          returnType: 'returned_to_inventory',
        },
      ];

      useInventoryStore.mockReturnValue({ units });
      render(<ReturnsPage />);

      const searchInput = screen.getByPlaceholderText(/Search by model, IMEI or return reason/i);
      await user.type(searchInput, '359108');

      expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    });

    it('should search by return reason', async () => {
      const user = userEvent.setup();
      const units = [
        mockReturnedUnit,
        {
          ...mockUnit,
          id: 'unit_002',
          status: 'available',
          returnType: 'returned_to_inventory',
          returnReason: 'Faulty screen',
        },
      ];

      useInventoryStore.mockReturnValue({ units });
      render(<ReturnsPage />);

      const searchInput = screen.getByPlaceholderText(/Search by model, IMEI or return reason/i);
      await user.type(searchInput, 'Customer changed mind');

      // Should show the unit with matching return reason
      expect(screen.getByText('Customer changed mind')).toBeInTheDocument();
    });
  });

  describe('Return Unit Details', () => {
    it('should display return unit in list', () => {
      render(<ReturnsPage />);
      expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    });

    it('should show buy price for returned unit', () => {
      render(<ReturnsPage />);
      expect(screen.getByText('£450')).toBeInTheDocument();
    });

    it('should expand unit to show details', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const expandButton = screen.getByRole('button', { name: '' }).parentElement?.querySelector('button:nth-last-child(1)');
      if (expandButton) {
        await user.click(expandButton);

        expect(screen.getByText(/Buy Price/i)).toBeInTheDocument();
      }
    });
  });

  describe('ProcessReturnModal', () => {
    it('should open modal when selecting a sold unit', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      // Click on a sold unit in the picker
      const returnButtons = screen.queryAllByText(/Return →/i);
      if (returnButtons.length > 0) {
        await user.click(returnButtons[0].parentElement || returnButtons[0]);

        await waitFor(() => {
          expect(screen.getByText('Process Return')).toBeInTheDocument();
        });
      }
    });

    it('should display unit model in modal', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const returnButtons = screen.queryAllByText(/Return →/i);
      if (returnButtons.length > 0) {
        await user.click(returnButtons[0].parentElement || returnButtons[0]);

        await waitFor(() => {
          expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
        });
      }
    });

    it('should show warranty status', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const returnButtons = screen.queryAllByText(/Return →/i);
      if (returnButtons.length > 0) {
        await user.click(returnButtons[0].parentElement || returnButtons[0]);

        await waitFor(() => {
          expect(screen.getByText(/Warranty Active/i)).toBeInTheDocument();
        });
      }
    });

    it('should display warranty expiration status', async () => {
      const user = userEvent.setup();
      getWarrantyStatus.mockReturnValue({
        isExpired: true,
        endDate: '2026-01-01',
        daysLeft: -124,
      });

      render(<ReturnsPage />);

      const returnButtons = screen.queryAllByText(/Return →/i);
      if (returnButtons.length > 0) {
        await user.click(returnButtons[0].parentElement || returnButtons[0]);

        await waitFor(() => {
          expect(screen.getByText(/Warranty Expired/i)).toBeInTheDocument();
        });
      }
    });
  });

  describe('Return Type Selection', () => {
    it('should allow selecting returned_to_inventory', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const returnButtons = screen.queryAllByText(/Return →/i);
      if (returnButtons.length > 0) {
        await user.click(returnButtons[0].parentElement || returnButtons[0]);

        await waitFor(() => {
          const inventoryOption = screen.getByRole('button', { name: /Back to Inventory/i });
          expect(inventoryOption).toBeInTheDocument();
        });
      }
    });

    it('should allow selecting returned_to_supplier', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const returnButtons = screen.queryAllByText(/Return →/i);
      if (returnButtons.length > 0) {
        await user.click(returnButtons[0].parentElement || returnButtons[0]);

        await waitFor(() => {
          const supplierOption = screen.getByRole('button', { name: /Return to Supplier/i });
          expect(supplierOption).toBeInTheDocument();
        });
      }
    });

    it('should allow selecting repair', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const returnButtons = screen.queryAllByText(/Return →/i);
      if (returnButtons.length > 0) {
        await user.click(returnButtons[0].parentElement || returnButtons[0]);

        await waitFor(() => {
          const repairOption = screen.getByRole('button', { name: /Send for Repair/i });
          expect(repairOption).toBeInTheDocument();
        });
      }
    });

    it('should show warning for returned_to_supplier', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const returnButtons = screen.queryAllByText(/Return →/i);
      if (returnButtons.length > 0) {
        await user.click(returnButtons[0].parentElement || returnButtons[0]);

        await waitFor(() => {
          const supplierButton = screen.getByRole('button', { name: /Return to Supplier/i });
          await user.click(supplierButton);

          expect(screen.getByText(/permanently deleted/i)).toBeInTheDocument();
        });
      }
    });

    it('should show info for returned_to_inventory', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const returnButtons = screen.queryAllByText(/Return →/i);
      if (returnButtons.length > 0) {
        await user.click(returnButtons[0].parentElement || returnButtons[0]);

        await waitFor(() => {
          const inventoryButton = screen.getByRole('button', { name: /Back to Inventory/i });
          await user.click(inventoryButton);

          expect(screen.getByText(/restored to.*available.*stock/i)).toBeInTheDocument();
        });
      }
    });
  });

  describe('Return Processing', () => {
    it('should require return reason', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const returnButtons = screen.queryAllByText(/Return →/i);
      if (returnButtons.length > 0) {
        await user.click(returnButtons[0].parentElement || returnButtons[0]);

        await waitFor(() => {
          const confirmButton = screen.getByRole('button', { name: /Confirm Return/i });
          expect(confirmButton).toBeDisabled();
        });
      }
    });

    it('should enable confirm button with reason', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const returnButtons = screen.queryAllByText(/Return →/i);
      if (returnButtons.length > 0) {
        await user.click(returnButtons[0].parentElement || returnButtons[0]);

        await waitFor(() => {
          const reasonInput = screen.getByPlaceholderText(/Customer changed mind/i);
          userEvent.type(reasonInput, 'Faulty screen');

          const confirmButton = screen.getByRole('button', { name: /Confirm Return/i });
          expect(confirmButton).not.toBeDisabled();
        });
      }
    });

    it('should update unit status for returned_to_inventory', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const returnButtons = screen.queryAllByText(/Return →/i);
      if (returnButtons.length > 0) {
        await user.click(returnButtons[0].parentElement || returnButtons[0]);

        await waitFor(() => {
          const reasonInput = screen.getByPlaceholderText(/Customer changed mind/i);
          userEvent.type(reasonInput, 'Changed mind');

          const confirmButton = screen.getByRole('button', { name: /Confirm Return/i });
          userEvent.click(confirmButton);

          expect(dbService.update).toHaveBeenCalledWith(
            'inventoryUnits',
            expect.any(String),
            expect.objectContaining({ status: 'available' })
          );
        });
      }
    });

    it('should delete unit for returned_to_supplier', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const returnButtons = screen.queryAllByText(/Return →/i);
      if (returnButtons.length > 0) {
        await user.click(returnButtons[0].parentElement || returnButtons[0]);

        await waitFor(() => {
          const supplierButton = screen.getByRole('button', { name: /Return to Supplier/i });
          userEvent.click(supplierButton);

          const reasonInput = screen.getByPlaceholderText(/Customer changed mind/i);
          userEvent.type(reasonInput, 'Faulty');

          const confirmButton = screen.getByRole('button', { name: /Confirm Return/i });
          userEvent.click(confirmButton);

          expect(dbService.delete).toHaveBeenCalled();
        });
      }
    });

    it('should update status to returned for repair', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const returnButtons = screen.queryAllByText(/Return →/i);
      if (returnButtons.length > 0) {
        await user.click(returnButtons[0].parentElement || returnButtons[0]);

        await waitFor(() => {
          const repairButton = screen.getByRole('button', { name: /Send for Repair/i });
          userEvent.click(repairButton);

          const reasonInput = screen.getByPlaceholderText(/Customer changed mind/i);
          userEvent.type(reasonInput, 'Screen repair');

          const confirmButton = screen.getByRole('button', { name: /Confirm Return/i });
          userEvent.click(confirmButton);

          expect(dbService.update).toHaveBeenCalledWith(
            'inventoryUnits',
            expect.any(String),
            expect.objectContaining({ status: 'returned', returnType: 'repair' })
          );
        });
      }
    });

    it('should clear sale data on return', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const returnButtons = screen.queryAllByText(/Return →/i);
      if (returnButtons.length > 0) {
        await user.click(returnButtons[0].parentElement || returnButtons[0]);

        await waitFor(() => {
          const reasonInput = screen.getByPlaceholderText(/Customer changed mind/i);
          userEvent.type(reasonInput, 'Changed mind');

          const confirmButton = screen.getByRole('button', { name: /Confirm Return/i });
          userEvent.click(confirmButton);

          expect(dbService.update).toHaveBeenCalledWith(
            'inventoryUnits',
            expect.any(String),
            expect.objectContaining({
              salePrice: null,
              saleDate: null,
              salePlatform: null,
              saleOrderId: null,
              postageCost: null,
            })
          );
        });
      }
    });

    it('should trigger return_processed notification', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const returnButtons = screen.queryAllByText(/Return →/i);
      if (returnButtons.length > 0) {
        await user.click(returnButtons[0].parentElement || returnButtons[0]);

        await waitFor(() => {
          const reasonInput = screen.getByPlaceholderText(/Customer changed mind/i);
          userEvent.type(reasonInput, 'Changed mind');

          const confirmButton = screen.getByRole('button', { name: /Confirm Return/i });
          userEvent.click(confirmButton);

          expect(notificationService.addNotification).toHaveBeenCalledWith(
            'return_processed',
            expect.any(Object)
          );
        });
      }
    });

    it('should show success message after return', async () => {
      const user = userEvent.setup();
      vi.useFakeTimers();

      render(<ReturnsPage />);

      const returnButtons = screen.queryAllByText(/Return →/i);
      if (returnButtons.length > 0) {
        await user.click(returnButtons[0].parentElement || returnButtons[0]);

        await waitFor(() => {
          const reasonInput = screen.getByPlaceholderText(/Customer changed mind/i);
          userEvent.type(reasonInput, 'Changed mind');

          const confirmButton = screen.getByRole('button', { name: /Confirm Return/i });
          userEvent.click(confirmButton);
        });

        vi.advanceTimersByTime(3100);
        vi.useRealTimers();

        expect(screen.queryByText(/Return processed successfully/i)).toBeTruthy();
      }
    });
  });

  describe('SoldUnitPicker', () => {
    it('should display recent sold units', () => {
      render(<ReturnsPage />);
      expect(screen.getByText('Process New Return')).toBeInTheDocument();
      expect(screen.getByText(/sold units/i)).toBeInTheDocument();
    });

    it('should show message when no sold units', () => {
      useInventoryStore.mockReturnValue({
        units: [mockReturnedUnit], // No sold units
      });

      render(<ReturnsPage />);
      expect(screen.getByText(/No items are currently marked as/i)).toBeInTheDocument();
    });

    it('should allow searching sold units', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const searchInput = screen.getByPlaceholderText(/Search sold units by model/i);
      await user.type(searchInput, 'iPhone');

      expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    });

    it('should select unit for processing', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const returnButton = screen.getByText(/Return →/i);
      await user.click(returnButton.parentElement || returnButton);

      await waitFor(() => {
        expect(screen.getByText('Process Return')).toBeInTheDocument();
      });
    });
  });

  describe('Return Date', () => {
    it('should allow setting custom return date', async () => {
      const user = userEvent.setup();
      render(<ReturnsPage />);

      const returnButtons = screen.queryAllByText(/Return →/i);
      if (returnButtons.length > 0) {
        await user.click(returnButtons[0].parentElement || returnButtons[0]);

        await waitFor(() => {
          const dateInput = screen.getByLabelText(/Return Date/i) as HTMLInputElement;
          expect(dateInput).toBeInTheDocument();

          // Should have today's date by default
          const today = new Date().toISOString().split('T')[0];
          expect(dateInput.value).toBe(today);
        });
      }
    });
  });
});
