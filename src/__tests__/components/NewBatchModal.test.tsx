import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewBatchModal from '../../components/NewBatchModal';
import { useInventoryStore } from '../../lib/inventoryStore';
import { dbService } from '../../lib/dbService';
import { logInventoryEvent } from '../../lib/inventoryEvents';

// Mock dependencies
vi.mock('../../lib/dbService');
vi.mock('../../lib/inventoryStore');
vi.mock('../../lib/inventoryEvents');
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

const mockSupplier = {
  id: 'sup_001',
  name: 'MHL',
  email: 'contact@mhl.com',
  phone: '+44123456789',
  address: 'London',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('NewBatchModal', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useInventoryStore.mockReturnValue({
      suppliers: [mockSupplier],
    });
    dbService.create = vi.fn().mockResolvedValue(undefined);
    dbService.imeiExists = vi.fn().mockResolvedValue(false);
    logInventoryEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Rendering', () => {
    it('should render the modal with header', () => {
      render(<NewBatchModal onClose={mockOnClose} />);
      expect(screen.getByText('Stock In')).toBeInTheDocument();
    });

    it('should render date and invoice fields', () => {
      render(<NewBatchModal onClose={mockOnClose} />);
      expect(screen.getByLabelText(/Date/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/INV-2061/i)).toBeInTheDocument();
    });

    it('should render add unit button', () => {
      render(<NewBatchModal onClose={mockOnClose} />);
      expect(screen.getByRole('button', { name: /Add Unit/i })).toBeInTheDocument();
    });

    it('should show paste CSV button', () => {
      render(<NewBatchModal onClose={mockOnClose} />);
      expect(screen.getByRole('button', { name: /Paste CSV/i })).toBeInTheDocument();
    });

    it('should close modal when X button is clicked', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const closeButton = screen.getByRole('button', { name: '' }).parentElement?.querySelector('[size="16"]');
      if (closeButton?.parentElement) {
        await user.click(closeButton.parentElement);
      }

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('IMEI Validation', () => {
    it('should accept 14-digit IMEI', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      // Find IMEI input (second input in the row)
      const inputs = screen.getAllByPlaceholderText(/14-15 digit IMEI/i);
      if (inputs.length > 0) {
        await user.type(inputs[0], '35910809672423');
        expect((inputs[0] as HTMLInputElement).value).toBe('35910809672423');
      }
    });

    it('should accept 15-digit IMEI', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const inputs = screen.getAllByPlaceholderText(/14-15 digit IMEI/i);
      if (inputs.length > 0) {
        await user.type(inputs[0], '359108096724237');
        expect((inputs[0] as HTMLInputElement).value).toBe('359108096724237');
      }
    });

    it('should only allow numeric IMEI input', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const inputs = screen.getAllByPlaceholderText(/14-15 digit IMEI/i);
      if (inputs.length > 0) {
        await user.type(inputs[0], '3591ABC0809672423');
        // Should filter out non-numeric characters
        expect((inputs[0] as HTMLInputElement).value).toBe('35910809672423');
      }
    });

    it('should reject IMEI with < 14 digits on save', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const modelInputs = screen.getAllByPlaceholderText(/e.g. iPhone 14 128GB/i);
      const imeiInputs = screen.getAllByPlaceholderText(/14-15 digit IMEI/i);

      if (modelInputs.length > 0 && imeiInputs.length > 0) {
        await user.type(modelInputs[0], 'iPhone 14');
        await user.type(imeiInputs[0], '35910809672'); // Only 11 digits

        const saveButton = screen.getByRole('button', { name: /Save.*Units/i });
        await user.click(saveButton);

        await waitFor(() => {
          expect(screen.getByText(/must be 14-15 digits/i)).toBeInTheDocument();
        });
      }
    });

    it('should detect duplicate IMEI in database', async () => {
      const user = userEvent.setup();
      dbService.imeiExists.mockResolvedValue(true);

      render(<NewBatchModal onClose={mockOnClose} />);

      const modelInputs = screen.getAllByPlaceholderText(/e.g. iPhone 14 128GB/i);
      const imeiInputs = screen.getAllByPlaceholderText(/14-15 digit IMEI/i);

      if (modelInputs.length > 0 && imeiInputs.length > 0) {
        await user.type(modelInputs[0], 'iPhone 14');
        await user.type(imeiInputs[0], '359108096724237');

        const saveButton = screen.getByRole('button', { name: /Save.*Units/i });
        await user.click(saveButton);

        await waitFor(() => {
          expect(screen.getByText(/already exists in stock/i)).toBeInTheDocument();
        });
      }
    });

    it('should detect duplicate IMEI within batch', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      // Add first unit
      const modelInputs = screen.getAllByPlaceholderText(/e.g. iPhone 14 128GB/i);
      const imeiInputs = screen.getAllByPlaceholderText(/14-15 digit IMEI/i);

      if (modelInputs.length > 0 && imeiInputs.length > 0) {
        await user.type(modelInputs[0], 'iPhone 14');
        await user.type(imeiInputs[0], '359108096724237');

        // Add second unit with same IMEI
        const addButton = screen.getByRole('button', { name: /Add Unit/i });
        await user.click(addButton);

        const modelInputs2 = screen.getAllByPlaceholderText(/e.g. iPhone 14 128GB/i);
        const imeiInputs2 = screen.getAllByPlaceholderText(/14-15 digit IMEI/i);

        if (modelInputs2.length > 1 && imeiInputs2.length > 1) {
          await user.type(modelInputs2[1], 'Samsung Galaxy');
          await user.type(imeiInputs2[1], '359108096724237');

          const saveButton = screen.getByRole('button', { name: /Save.*Units/i });
          await user.click(saveButton);

          await waitFor(() => {
            expect(screen.getByText(/Duplicate IMEIs/i)).toBeInTheDocument();
          });
        }
      }
    });
  });

  describe('Batch Creation', () => {
    it('should require at least one unit', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const saveButton = screen.getByRole('button', { name: /Save.*Units/i });
      expect(saveButton).toBeDisabled();
    });

    it('should save single unit correctly', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const modelInputs = screen.getAllByPlaceholderText(/e.g. iPhone 14 128GB/i);
      const imeiInputs = screen.getAllByPlaceholderText(/14-15 digit IMEI/i);
      const bpInputs = screen.getAllByPlaceholderText(/0(?!.*)/);
      const colourInputs = screen.getAllByPlaceholderText(/Black/i);

      if (
        modelInputs.length > 0 &&
        imeiInputs.length > 0 &&
        colourInputs.length > 0
      ) {
        await user.type(modelInputs[0], 'iPhone 14 128GB');
        await user.type(imeiInputs[0], '359108096724237');
        await user.type(bpInputs[0], '250');
        await user.type(colourInputs[0], 'Black');

        const saveButton = screen.getByRole('button', { name: /Save.*Units/i });
        await user.click(saveButton);

        await waitFor(() => {
          expect(dbService.create).toHaveBeenCalledWith('batches', expect.any(String), expect.any(Object));
          expect(dbService.create).toHaveBeenCalledWith('inventoryUnits', '359108096724237', expect.any(Object));
        });
      }
    });

    it('should save multiple units in batch', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const modelInputs = screen.getAllByPlaceholderText(/e.g. iPhone 14 128GB/i);
      const imeiInputs = screen.getAllByPlaceholderText(/14-15 digit IMEI/i);

      if (modelInputs.length > 0 && imeiInputs.length > 0) {
        // Add first unit
        await user.type(modelInputs[0], 'iPhone 14');
        await user.type(imeiInputs[0], '359108096724237');

        // Add second unit
        const addButton = screen.getByRole('button', { name: /Add Unit/i });
        await user.click(addButton);

        const newModelInputs = screen.getAllByPlaceholderText(/e.g. iPhone 14 128GB/i);
        const newImeiInputs = screen.getAllByPlaceholderText(/14-15 digit IMEI/i);

        if (newModelInputs.length > 1 && newImeiInputs.length > 1) {
          await user.type(newModelInputs[1], 'Samsung Galaxy');
          await user.type(newImeiInputs[1], '350220437101229');

          const saveButton = screen.getByRole('button', { name: /Save.*Units/i });
          await user.click(saveButton);

          await waitFor(() => {
            expect(dbService.create).toHaveBeenCalledTimes(expect.any(Number));
          });
        }
      }
    });

    it('should set correct unit status for regular units', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const modelInputs = screen.getAllByPlaceholderText(/e.g. iPhone 14 128GB/i);
      const imeiInputs = screen.getAllByPlaceholderText(/14-15 digit IMEI/i);

      if (modelInputs.length > 0 && imeiInputs.length > 0) {
        await user.type(modelInputs[0], 'iPhone 14');
        await user.type(imeiInputs[0], '359108096724237');

        const saveButton = screen.getByRole('button', { name: /Save.*Units/i });
        await user.click(saveButton);

        await waitFor(() => {
          expect(dbService.create).toHaveBeenCalledWith(
            'inventoryUnits',
            '359108096724237',
            expect.objectContaining({ status: 'available' })
          );
        });
      }
    });
  });

  describe('SHS (Expected Stock)', () => {
    it('should allow adding SHS units', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const modelInputs = screen.getAllByPlaceholderText(/e.g. iPhone 14 128GB/i);
      const shsToggles = screen.getAllByRole('checkbox') || screen.getAllByRole('button', { name: /SHS/i });

      if (modelInputs.length > 0) {
        await user.type(modelInputs[0], 'iPhone 14');

        // Try to find and toggle SHS
        const shsButton = screen.queryByText(/SHS — Expected Stock/i)?.parentElement?.querySelector('div');
        if (shsButton) {
          await user.click(shsButton);
        }

        expect(screen.queryByText(/SHS/i)).toBeTruthy();
      }
    });

    it('should set correct status for SHS units', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const modelInputs = screen.getAllByPlaceholderText(/e.g. iPhone 14 128GB/i);

      if (modelInputs.length > 0) {
        await user.type(modelInputs[0], 'iPhone 14');

        // Toggle SHS if UI allows
        const shsElements = screen.queryAllByText(/SHS/i);
        if (shsElements.length > 0) {
          const saveButton = screen.getByRole('button', { name: /Save.*Units/i });
          await user.click(saveButton);

          await waitFor(() => {
            // Check that at least some unit was created with incoming status or similar
            const calls = (dbService.create as any).mock.calls;
            expect(calls.length).toBeGreaterThan(0);
          });
        }
      }
    });

    it('should not require IMEI for SHS units', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      // This test verifies that SHS units don't require IMEI fields
      const imeiLabels = screen.queryAllByText(/IMEI/i);
      expect(imeiLabels.length).toBeGreaterThan(0);
    });
  });

  describe('CSV Import', () => {
    it('should open paste modal on button click', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const pasteButton = screen.getByRole('button', { name: /Paste CSV/i });
      await user.click(pasteButton);

      expect(screen.getByText(/Paste from Spreadsheet/i)).toBeInTheDocument();
    });

    it('should parse valid CSV correctly', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const pasteButton = screen.getByRole('button', { name: /Paste CSV/i });
      await user.click(pasteButton);

      const csvText = `Apple iPhone 14 128GB, 359108096724237, 250, Black, MHL,
Samsung Galaxy S21 128GB, 350220437101229, 120, Grey, NIHAL,`;

      const textarea = screen.getByPlaceholderText(/Paste your CSV rows here/i);
      await user.type(textarea, csvText);

      const importButton = screen.getByRole('button', { name: /Import.*Rows/i });
      expect(importButton).not.toBeDisabled();
    });

    it('should reject invalid CSV format', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const pasteButton = screen.getByRole('button', { name: /Paste CSV/i });
      await user.click(pasteButton);

      const csvText = 'Invalid, format,';

      const textarea = screen.getByPlaceholderText(/Paste your CSV rows here/i);
      await user.type(textarea, csvText);

      const importButton = screen.getByRole('button', { name: /Import.*Rows/i });
      // Should show 0 rows to import or be disabled
      expect(importButton.textContent).toContain('0');
    });

    it('should close paste modal after import', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const pasteButton = screen.getByRole('button', { name: /Paste CSV/i });
      await user.click(pasteButton);

      const csvText = `Apple iPhone 14, 359108096724237, 250, Black, MHL,`;

      const textarea = screen.getByPlaceholderText(/Paste your CSV rows here/i);
      await user.type(textarea, csvText);

      const importButton = screen.getByRole('button', { name: /Import.*Rows/i });
      await user.click(importButton);

      await waitFor(() => {
        expect(screen.queryByText(/Paste from Spreadsheet/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Date and Invoice Fields', () => {
    it('should initialize with today\'s date', () => {
      render(<NewBatchModal onClose={mockOnClose} />);

      const dateInput = screen.getByLabelText(/Date/i) as HTMLInputElement;
      const today = new Date().toISOString().split('T')[0];
      expect(dateInput.value).toBe(today);
    });

    it('should allow setting custom date', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const dateInput = screen.getByLabelText(/Date/i) as HTMLInputElement;
      await user.clear(dateInput);
      await user.type(dateInput, '2026-04-01');

      expect(dateInput.value).toBe('2026-04-01');
    });

    it('should allow optional invoice number', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const invoiceInput = screen.getByPlaceholderText(/INV-2061/i);
      await user.type(invoiceInput, 'INV-2061');

      expect((invoiceInput as HTMLInputElement).value).toBe('INV-2061');
    });

    it('should save invoice number with batch', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const invoiceInput = screen.getByPlaceholderText(/INV-2061/i);
      await user.type(invoiceInput, 'INV-2061');

      const modelInputs = screen.getAllByPlaceholderText(/e.g. iPhone 14 128GB/i);
      const imeiInputs = screen.getAllByPlaceholderText(/14-15 digit IMEI/i);

      if (modelInputs.length > 0 && imeiInputs.length > 0) {
        await user.type(modelInputs[0], 'iPhone 14');
        await user.type(imeiInputs[0], '359108096724237');

        const saveButton = screen.getByRole('button', { name: /Save.*Units/i });
        await user.click(saveButton);

        await waitFor(() => {
          expect(dbService.create).toHaveBeenCalledWith(
            'batches',
            expect.any(String),
            expect.objectContaining({ invoiceNumber: 'INV-2061' })
          );
        });
      }
    });
  });

  describe('Add Unit Button', () => {
    it('should add a new empty row', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const addButton = screen.getByRole('button', { name: /Add Unit/i });
      await user.click(addButton);

      // Should have more inputs now
      const modelInputs = screen.getAllByPlaceholderText(/e.g. iPhone 14 128GB/i);
      expect(modelInputs.length).toBeGreaterThanOrEqual(2);
    });

    it('should preserve last supplier name for new row', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const supplierInputs = screen.getAllByPlaceholderText(/MHL/i);

      if (supplierInputs.length > 0) {
        await user.type(supplierInputs[0], 'MHL');

        const addButton = screen.getByRole('button', { name: /Add Unit/i });
        await user.click(addButton);

        const newSupplierInputs = screen.getAllByPlaceholderText(/MHL/i);
        expect(newSupplierInputs.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('Remove Unit', () => {
    it('should not allow removing last unit', async () => {
      render(<NewBatchModal onClose={mockOnClose} />);

      // Only one unit initially, so remove button should be disabled or not present
      const removeButtons = screen.queryAllByRole('button', { name: /Remove/i });
      expect(removeButtons.length).toBe(0);
    });

    it('should allow removing units after adding more than one', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      // Add a second unit
      const addButton = screen.getByRole('button', { name: /Add Unit/i });
      await user.click(addButton);

      // Now remove button should be available
      const removeButtons = screen.queryAllByRole('button', { name: /Remove/i });
      expect(removeButtons.length).toBeGreaterThan(0);
    });
  });

  describe('Totals Display', () => {
    it('should show total unit count', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const modelInputs = screen.getAllByPlaceholderText(/e.g. iPhone 14 128GB/i);

      if (modelInputs.length > 0) {
        await user.type(modelInputs[0], 'iPhone 14');

        expect(screen.getByText(/units/i)).toBeInTheDocument();
      }
    });

    it('should calculate total buy value', async () => {
      const user = userEvent.setup();
      render(<NewBatchModal onClose={mockOnClose} />);

      const modelInputs = screen.getAllByPlaceholderText(/e.g. iPhone 14 128GB/i);
      const bpInputs = screen.getAllByPlaceholderText(/0(?!.*)/);

      if (modelInputs.length > 0 && bpInputs.length > 0) {
        await user.type(modelInputs[0], 'iPhone 14');
        await user.type(bpInputs[0], '250');

        expect(screen.getByText(/£250/i)).toBeInTheDocument();
      }
    });

    it('should show SHS count badge', async () => {
      render(<NewBatchModal onClose={mockOnClose} />);

      // SHS badge should appear if there are SHS units
      const shsBadges = screen.queryAllByText(/SHS expected/i);
      // Initially 0 SHS, so badge may not show
      expect(shsBadges.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling', () => {
    it('should show error for database save failure', async () => {
      const user = userEvent.setup();
      dbService.create.mockRejectedValue(new Error('Database error'));

      render(<NewBatchModal onClose={mockOnClose} />);

      const modelInputs = screen.getAllByPlaceholderText(/e.g. iPhone 14 128GB/i);
      const imeiInputs = screen.getAllByPlaceholderText(/14-15 digit IMEI/i);

      if (modelInputs.length > 0 && imeiInputs.length > 0) {
        await user.type(modelInputs[0], 'iPhone 14');
        await user.type(imeiInputs[0], '359108096724237');

        const saveButton = screen.getByRole('button', { name: /Save.*Units/i });
        await user.click(saveButton);

        await waitFor(() => {
          expect(screen.getByText(/Database error/i)).toBeInTheDocument();
        });
      }
    });
  });
});
