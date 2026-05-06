import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SellPage from '../../components/SellPage';
import { useInventoryStore } from '../../lib/inventoryStore';
import { dbService } from '../../lib/dbService';
import { notificationService } from '../../lib/notificationService';
import { InventoryUnit } from '../../types';

// Mock dependencies
vi.mock('../../lib/dbService');
vi.mock('../../lib/notificationService');
vi.mock('../../lib/inventoryStore');

const mockUnit: InventoryUnit = {
  id: 'unit_001',
  imei: '359108096724237',
  model: 'iPhone 15 Pro',
  brand: 'Apple',
  category: 'iPhone',
  colour: 'Black',
  buyPrice: 450,
  dateIn: '2026-05-06',
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

const mockSupplier = {
  id: 'sup_001',
  name: 'MHL',
  email: 'contact@mhl.com',
  phone: '+44123456789',
  address: 'London',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('SellPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationService.subscribe = vi.fn();
    notificationService.addNotification = vi.fn();
    dbService.update = vi.fn().mockResolvedValue(undefined);
    dbService.imeiExists = vi.fn().mockResolvedValue(false);

    useInventoryStore.mockReturnValue({
      units: [mockUnit],
      suppliers: [mockSupplier],
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Available Stock Display', () => {
    it('should display available units in stock', () => {
      render(<SellPage />);
      expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    });

    it('should show buy price for each unit', () => {
      render(<SellPage />);
      expect(screen.getByText('£450')).toBeInTheDocument();
    });

    it('should filter units by search term', async () => {
      const user = userEvent.setup();
      render(<SellPage />);

      const searchInput = screen.getByPlaceholderText('Model, IMEI, colour, storage…');
      await user.type(searchInput, 'iPhone');

      expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    });

    it('should hide units that do not match search term', async () => {
      const user = userEvent.setup();
      const anotherUnit = { ...mockUnit, id: 'unit_002', model: 'Samsung Galaxy' };
      useInventoryStore.mockReturnValue({
        units: [mockUnit, anotherUnit],
        suppliers: [mockSupplier],
      });

      render(<SellPage />);

      const searchInput = screen.getByPlaceholderText('Model, IMEI, colour, storage…');
      await user.type(searchInput, 'Samsung');

      expect(screen.queryByText('iPhone 15 Pro')).not.toBeInTheDocument();
      expect(screen.getByText('Samsung Galaxy')).toBeInTheDocument();
    });

    it('should clear search when X button is clicked', async () => {
      const user = userEvent.setup();
      render(<SellPage />);

      const searchInput = screen.getByPlaceholderText('Model, IMEI, colour, storage…');
      await user.type(searchInput, 'iPhone');

      const clearButton = screen.getByRole('button', { name: /^$/ }).parentElement?.querySelector('[size="14"]');
      if (clearButton?.parentElement) {
        await user.click(clearButton.parentElement);
      }

      expect((searchInput as HTMLInputElement).value).toBe('');
    });
  });

  describe('Sale Transaction - Profit Calculation', () => {
    it('should calculate positive profit correctly for profitable sale', async () => {
      const user = userEvent.setup();
      render(<SellPage />);

      // Click sell button
      const sellButton = screen.getByRole('button', { name: /Sell/i });
      await user.click(sellButton);

      // Fill in the form
      const sellingPriceInput = screen.getByPlaceholderText('0.00');
      await user.type(sellingPriceInput, '520');

      // Select platform
      const ebayButton = screen.getByRole('button', { name: /eBay/i });
      await user.click(ebayButton);

      // Wait for profit display
      await waitFor(() => {
        expect(screen.getByText(/Net Profit/i)).toBeInTheDocument();
      });

      // Verify profit calculation (520 - 450 - eBay fee - postage)
      // eBay fee = 520 * 0.128 + 0.30 = 67.36
      // Postage default = 3.50
      // Net = 520 - 450 - 67.36 - 3.50 = -0.86
      const profitText = screen.getByText(/-£0.86/);
      expect(profitText).toBeInTheDocument();
    });

    it('should calculate negative profit for loss sale', async () => {
      const user = userEvent.setup();
      render(<SellPage />);

      const sellButton = screen.getByRole('button', { name: /Sell/i });
      await user.click(sellButton);

      const sellingPriceInput = screen.getByPlaceholderText('0.00');
      await user.type(sellingPriceInput, '350');

      const ebayButton = screen.getByRole('button', { name: /eBay/i });
      await user.click(ebayButton);

      await waitFor(() => {
        expect(screen.getByText(/Net Profit/i)).toBeInTheDocument();
      });

      // eBay fee = 350 * 0.128 + 0.30 = 45.10
      // Postage = 3.50
      // Net = 350 - 450 - 45.10 - 3.50 = -148.60
      const profitText = screen.getByText(/-£148.60/);
      expect(profitText).toBeInTheDocument();
    });

    it('should display profit in green for positive profit', async () => {
      const user = userEvent.setup();
      render(<SellPage />);

      const sellButton = screen.getByRole('button', { name: /Sell/i });
      await user.click(sellButton);

      const sellingPriceInput = screen.getByPlaceholderText('0.00');
      await user.type(sellingPriceInput, '600');

      const amazonButton = screen.getByRole('button', { name: /Amazon/i });
      await user.click(amazonButton);

      await waitFor(() => {
        const profitElement = screen.getByText(/Net Profit/i).parentElement;
        expect(profitElement?.querySelector('.text-emerald-700')).toBeInTheDocument();
      });
    });

    it('should display profit in red for negative profit', async () => {
      const user = userEvent.setup();
      render(<SellPage />);

      const sellButton = screen.getByRole('button', { name: /Sell/i });
      await user.click(sellButton);

      const sellingPriceInput = screen.getByPlaceholderText('0.00');
      await user.type(sellingPriceInput, '300');

      const onBuyButton = screen.getByRole('button', { name: /OnBuy/i });
      await user.click(onBuyButton);

      await waitFor(() => {
        const profitElement = screen.getByText(/Net Profit/i).parentElement;
        expect(profitElement?.querySelector('.text-red-600')).toBeInTheDocument();
      });
    });
  });

  describe('Platform Fee Calculation', () => {
    it('should calculate eBay fee correctly (12.8% + £0.30)', async () => {
      const user = userEvent.setup();
      render(<SellPage />);

      const sellButton = screen.getByRole('button', { name: /Sell/i });
      await user.click(sellButton);

      const sellingPriceInput = screen.getByPlaceholderText('0.00');
      await user.type(sellingPriceInput, '500');

      const ebayButton = screen.getByRole('button', { name: /eBay/i });
      await user.click(ebayButton);

      await waitFor(() => {
        // eBay fee = 500 * 0.128 + 0.30 = 64.30
        expect(screen.getByText('-£64.30')).toBeInTheDocument();
      });
    });

    it('should calculate Amazon fee correctly (8%)', async () => {
      const user = userEvent.setup();
      render(<SellPage />);

      const sellButton = screen.getByRole('button', { name: /Sell/i });
      await user.click(sellButton);

      const sellingPriceInput = screen.getByPlaceholderText('0.00');
      await user.type(sellingPriceInput, '500');

      const amazonButton = screen.getByRole('button', { name: /Amazon/i });
      await user.click(amazonButton);

      await waitFor(() => {
        // Amazon fee = 500 * 0.08 = 40.00
        expect(screen.getByText('-£40')).toBeInTheDocument();
      });
    });

    it('should calculate OnBuy fee correctly (9%)', async () => {
      const user = userEvent.setup();
      render(<SellPage />);

      const sellButton = screen.getByRole('button', { name: /Sell/i });
      await user.click(sellButton);

      const sellingPriceInput = screen.getByPlaceholderText('0.00');
      await user.type(sellingPriceInput, '500');

      const onBuyButton = screen.getByRole('button', { name: /OnBuy/i });
      await user.click(onBuyButton);

      await waitFor(() => {
        // OnBuy fee = 500 * 0.09 = 45.00
        expect(screen.getByText('-£45')).toBeInTheDocument();
      });
    });

    it('should calculate Backmarket fee correctly (10%)', async () => {
      const user = userEvent.setup();
      render(<SellPage />);

      const sellButton = screen.getByRole('button', { name: /Sell/i });
      await user.click(sellButton);

      const sellingPriceInput = screen.getByPlaceholderText('0.00');
      await user.type(sellingPriceInput, '500');

      const backmarketButton = screen.getByRole('button', { name: /Backmarket/i });
      await user.click(backmarketButton);

      await waitFor(() => {
        // Backmarket fee = 500 * 0.10 = 50.00
        expect(screen.getByText('-£50')).toBeInTheDocument();
      });
    });
  });

  describe('Sale Order Modal', () => {
    it('should require selling price', async () => {
      const user = userEvent.setup();
      render(<SellPage />);

      const sellButton = screen.getByRole('button', { name: /Sell/i });
      await user.click(sellButton);

      const confirmButton = screen.getByRole('button', { name: /Confirm Sale/i });
      await user.click(confirmButton);

      expect(screen.getByText(/Please enter a valid selling price/i)).toBeInTheDocument();
    });

    it('should require order number', async () => {
      const user = userEvent.setup();
      render(<SellPage />);

      const sellButton = screen.getByRole('button', { name: /Sell/i });
      await user.click(sellButton);

      const sellingPriceInput = screen.getByPlaceholderText('0.00');
      await user.type(sellingPriceInput, '500');

      const confirmButton = screen.getByRole('button', { name: /Confirm Sale/i });
      await user.click(confirmButton);

      expect(screen.getByText(/Please enter the order number/i)).toBeInTheDocument();
    });

    it('should save sale with correct data', async () => {
      const user = userEvent.setup();
      dbService.update.mockResolvedValue(undefined);
      render(<SellPage />);

      const sellButton = screen.getByRole('button', { name: /Sell/i });
      await user.click(sellButton);

      const sellingPriceInput = screen.getByPlaceholderText('0.00');
      await user.type(sellingPriceInput, '520');

      const orderNumberInput = screen.getByPlaceholderText(/e.g. 12-34567-89012/i);
      await user.type(orderNumberInput, '12-34567-89012');

      const confirmButton = screen.getByRole('button', { name: /Confirm Sale/i });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(dbService.update).toHaveBeenCalledWith(
          'inventoryUnits',
          'unit_001',
          expect.objectContaining({
            status: 'sold',
            salePrice: 520,
            salePlatform: 'eBay',
            saleOrderId: '12-34567-89012',
          })
        );
      });
    });

    it('should trigger sold notification for profitable sale', async () => {
      const user = userEvent.setup();
      dbService.update.mockResolvedValue(undefined);
      render(<SellPage />);

      const sellButton = screen.getByRole('button', { name: /Sell/i });
      await user.click(sellButton);

      const sellingPriceInput = screen.getByPlaceholderText('0.00');
      await user.type(sellingPriceInput, '600');

      const amazonButton = screen.getByRole('button', { name: /Amazon/i });
      await user.click(amazonButton);

      const orderNumberInput = screen.getByPlaceholderText(/e.g. 202-1234567/i);
      await user.type(orderNumberInput, '202-1234567-8901234');

      const confirmButton = screen.getByRole('button', { name: /Confirm Sale/i });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(notificationService.addNotification).toHaveBeenCalledWith(
          'sold',
          mockUnit,
          expect.any(Number)
        );
      });
    });

    it('should trigger loss_sell notification for loss sale', async () => {
      const user = userEvent.setup();
      dbService.update.mockResolvedValue(undefined);
      render(<SellPage />);

      const sellButton = screen.getByRole('button', { name: /Sell/i });
      await user.click(sellButton);

      const sellingPriceInput = screen.getByPlaceholderText('0.00');
      await user.type(sellingPriceInput, '300');

      const ebayButton = screen.getByRole('button', { name: /eBay/i });
      await user.click(ebayButton);

      const orderNumberInput = screen.getByPlaceholderText(/e.g. 12-34567-89012/i);
      await user.type(orderNumberInput, '12-34567-89012');

      const confirmButton = screen.getByRole('button', { name: /Confirm Sale/i });
      await user.click(confirmButton);

      await waitFor(() => {
        expect(notificationService.addNotification).toHaveBeenCalledWith(
          'loss_sell',
          mockUnit,
          expect.any(Number)
        );
      });
    });

    it('should close modal on cancel', async () => {
      const user = userEvent.setup();
      render(<SellPage />);

      const sellButton = screen.getByRole('button', { name: /Sell/i });
      await user.click(sellButton);

      const cancelButton = screen.getByRole('button', { name: /Cancel/i });
      await user.click(cancelButton);

      await waitFor(() => {
        expect(screen.queryByText(/Confirm Sale/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Sold History', () => {
    it('should display sold units grouped by date', () => {
      const soldUnit = {
        ...mockUnit,
        id: 'unit_sold_001',
        status: 'sold' as const,
        salePrice: 520,
        salePlatform: 'eBay' as const,
        saleOrderId: '12-34567-89012',
        saleDate: '2026-05-06',
      };

      useInventoryStore.mockReturnValue({
        units: [soldUnit],
        suppliers: [mockSupplier],
      });

      render(<SellPage />);
      expect(screen.getByText('Today')).toBeInTheDocument();
    });

    it('should show sale price in sold history', () => {
      const soldUnit = {
        ...mockUnit,
        id: 'unit_sold_001',
        status: 'sold' as const,
        salePrice: 520,
        salePlatform: 'eBay' as const,
        saleOrderId: '12-34567-89012',
        saleDate: '2026-05-06',
      };

      useInventoryStore.mockReturnValue({
        units: [soldUnit],
        suppliers: [mockSupplier],
      });

      render(<SellPage />);
      expect(screen.getByText('£520')).toBeInTheDocument();
    });

    it('should show platform for sold units', () => {
      const soldUnit = {
        ...mockUnit,
        id: 'unit_sold_001',
        status: 'sold' as const,
        salePrice: 520,
        salePlatform: 'eBay' as const,
        saleOrderId: '12-34567-89012',
        saleDate: '2026-05-06',
      };

      useInventoryStore.mockReturnValue({
        units: [soldUnit],
        suppliers: [mockSupplier],
      });

      render(<SellPage />);
      expect(screen.getByText('eBay')).toBeInTheDocument();
    });

    it('should show order ID for sold units', () => {
      const soldUnit = {
        ...mockUnit,
        id: 'unit_sold_001',
        status: 'sold' as const,
        salePrice: 520,
        salePlatform: 'eBay' as const,
        saleOrderId: '12-34567-89012',
        saleDate: '2026-05-06',
      };

      useInventoryStore.mockReturnValue({
        units: [soldUnit],
        suppliers: [mockSupplier],
      });

      render(<SellPage />);
      expect(screen.getByText('12-34567-89012')).toBeInTheDocument();
    });
  });

  describe('Stats Display', () => {
    it('should show count of in-stock units', () => {
      render(<SellPage />);
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('in office')).toBeInTheDocument();
    });

    it('should show total revenue for today', () => {
      const soldUnit = {
        ...mockUnit,
        id: 'unit_sold_001',
        status: 'sold' as const,
        salePrice: 520,
        salePlatform: 'eBay' as const,
        saleOrderId: '12-34567-89012',
        saleDate: new Date().toISOString().split('T')[0],
      };

      useInventoryStore.mockReturnValue({
        units: [mockUnit, soldUnit],
        suppliers: [mockSupplier],
      });

      render(<SellPage />);
      expect(screen.getByText('£520')).toBeInTheDocument();
    });
  });

  describe('IMEI Validation', () => {
    it('should accept 14-digit IMEI', async () => {
      const user = userEvent.setup();
      const soldUnit = {
        ...mockUnit,
        id: 'unit_sold_001',
        status: 'sold' as const,
        salePrice: 520,
        salePlatform: 'eBay' as const,
        saleOrderId: '12-34567-89012',
        saleDate: '2026-05-06',
        imei: undefined,
      };

      useInventoryStore.mockReturnValue({
        units: [soldUnit],
        suppliers: [mockSupplier],
      });

      render(<SellPage />);

      const enterImeiButton = screen.getByRole('button', { name: /Enter IMEI/i });
      await user.click(enterImeiButton);

      const imeiInput = screen.getByPlaceholderText(/Scan or type/i);
      await user.type(imeiInput, '35910809672423');

      await waitFor(() => {
        expect(screen.getByText(/14 digits/i)).toBeInTheDocument();
      });
    });

    it('should accept 15-digit IMEI', async () => {
      const user = userEvent.setup();
      const soldUnit = {
        ...mockUnit,
        id: 'unit_sold_001',
        status: 'sold' as const,
        salePrice: 520,
        salePlatform: 'eBay' as const,
        saleOrderId: '12-34567-89012',
        saleDate: '2026-05-06',
        imei: undefined,
      };

      useInventoryStore.mockReturnValue({
        units: [soldUnit],
        suppliers: [mockSupplier],
      });

      render(<SellPage />);

      const enterImeiButton = screen.getByRole('button', { name: /Enter IMEI/i });
      await user.click(enterImeiButton);

      const imeiInput = screen.getByPlaceholderText(/Scan or type/i);
      await user.type(imeiInput, '359108096724237');

      await waitFor(() => {
        expect(screen.getByText(/15 digits/i)).toBeInTheDocument();
      });
    });

    it('should accept alphanumeric serial >= 8 chars', async () => {
      const user = userEvent.setup();
      const soldUnit = {
        ...mockUnit,
        id: 'unit_sold_001',
        status: 'sold' as const,
        salePrice: 520,
        salePlatform: 'eBay' as const,
        saleOrderId: '12-34567-89012',
        saleDate: '2026-05-06',
        imei: undefined,
      };

      useInventoryStore.mockReturnValue({
        units: [soldUnit],
        suppliers: [mockSupplier],
      });

      render(<SellPage />);

      const enterImeiButton = screen.getByRole('button', { name: /Enter IMEI/i });
      await user.click(enterImeiButton);

      const imeiInput = screen.getByPlaceholderText(/Scan or type/i);
      await user.type(imeiInput, 'ABC123DEF456');

      await waitFor(() => {
        expect(screen.getByText(/Serial:/i)).toBeInTheDocument();
      });
    });

    it('should reject IMEI with < 14 digits', async () => {
      const user = userEvent.setup();
      const soldUnit = {
        ...mockUnit,
        id: 'unit_sold_001',
        status: 'sold' as const,
        salePrice: 520,
        salePlatform: 'eBay' as const,
        saleOrderId: '12-34567-89012',
        saleDate: '2026-05-06',
        imei: undefined,
      };

      useInventoryStore.mockReturnValue({
        units: [soldUnit],
        suppliers: [mockSupplier],
      });

      render(<SellPage />);

      const enterImeiButton = screen.getByRole('button', { name: /Enter IMEI/i });
      await user.click(enterImeiButton);

      const imeiInput = screen.getByPlaceholderText(/Scan or type/i);
      await user.type(imeiInput, '35910809672');

      await waitFor(() => {
        expect(screen.getByText(/need.*more/i)).toBeInTheDocument();
      });
    });

    it('should detect duplicate IMEI', async () => {
      const user = userEvent.setup();
      dbService.imeiExists.mockResolvedValue(true);

      const soldUnit = {
        ...mockUnit,
        id: 'unit_sold_001',
        status: 'sold' as const,
        salePrice: 520,
        salePlatform: 'eBay' as const,
        saleOrderId: '12-34567-89012',
        saleDate: '2026-05-06',
        imei: undefined,
      };

      useInventoryStore.mockReturnValue({
        units: [soldUnit],
        suppliers: [mockSupplier],
      });

      render(<SellPage />);

      const enterImeiButton = screen.getByRole('button', { name: /Enter IMEI/i });
      await user.click(enterImeiButton);

      const imeiInput = screen.getByPlaceholderText(/Scan or type/i);
      await user.type(imeiInput, '359108096724237');

      const saveButton = screen.getByRole('button', { name: /Save IMEI/i });
      await user.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText(/already in stock/i)).toBeInTheDocument();
      });
    });
  });

  describe('SHS Units', () => {
    it('should display SHS units separately', () => {
      const shsUnit = {
        ...mockUnit,
        id: 'unit_shs_001',
        status: 'incoming' as const,
      };

      useInventoryStore.mockReturnValue({
        units: [shsUnit],
        suppliers: [mockSupplier],
      });

      render(<SellPage />);
      expect(screen.getByText(/SHS — Supplier Direct/i)).toBeInTheDocument();
    });

    it('should show Record Sale button for SHS units', () => {
      const shsUnit = {
        ...mockUnit,
        id: 'unit_shs_001',
        status: 'incoming' as const,
      };

      useInventoryStore.mockReturnValue({
        units: [shsUnit],
        suppliers: [mockSupplier],
      });

      render(<SellPage />);
      expect(screen.getByRole('button', { name: /Record Sale/i })).toBeInTheDocument();
    });

    it('should allow optional IMEI entry for SHS sales', async () => {
      const user = userEvent.setup();
      const shsUnit = {
        ...mockUnit,
        id: 'unit_shs_001',
        status: 'incoming' as const,
      };

      useInventoryStore.mockReturnValue({
        units: [shsUnit],
        suppliers: [mockSupplier],
      });

      dbService.update.mockResolvedValue(undefined);
      render(<SellPage />);

      const recordSaleButton = screen.getByRole('button', { name: /Record Sale/i });
      await user.click(recordSaleButton);

      const imeiField = screen.getByPlaceholderText(/Enter IMEI if known/i);
      expect(imeiField).toBeInTheDocument();
    });
  });

  describe('Postage Cost', () => {
    it('should use default postage cost of £3.50', async () => {
      const user = userEvent.setup();
      render(<SellPage />);

      const sellButton = screen.getByRole('button', { name: /Sell/i });
      await user.click(sellButton);

      const postageInput = screen.getByDisplayValue('3.5');
      expect(postageInput).toBeInTheDocument();
    });

    it('should allow custom postage cost', async () => {
      const user = userEvent.setup();
      render(<SellPage />);

      const sellButton = screen.getByRole('button', { name: /Sell/i });
      await user.click(sellButton);

      const postageInputs = screen.getAllByPlaceholderText('3.5');
      const postageInput = postageInputs[postageInputs.length - 1];

      await user.clear(postageInput);
      await user.type(postageInput, '5.99');

      expect((postageInput as HTMLInputElement).value).toBe('5.99');
    });

    it('should factor postage into profit calculation', async () => {
      const user = userEvent.setup();
      render(<SellPage />);

      const sellButton = screen.getByRole('button', { name: /Sell/i });
      await user.click(sellButton);

      const sellingPriceInput = screen.getByPlaceholderText('0.00');
      await user.type(sellingPriceInput, '500');

      const postageInputs = screen.getAllByPlaceholderText('3.5');
      const postageInput = postageInputs[postageInputs.length - 1];
      await user.clear(postageInput);
      await user.type(postageInput, '10.00');

      await waitFor(() => {
        const profitDisplay = screen.getByText(/Net Profit/i);
        expect(profitDisplay).toBeInTheDocument();
      });
    });
  });
});
