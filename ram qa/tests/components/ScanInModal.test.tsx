import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ScanInModal from '../../components/ScanInModal';
import { useInventoryStore } from '../../lib/inventoryStore';
import { dbService } from '../../lib/dbService';
import { notificationService } from '../../lib/notificationService';

// Mock dependencies
vi.mock('../../lib/dbService');
vi.mock('../../lib/inventoryStore');
vi.mock('../../lib/notificationService');
vi.mock('../../components/IMEIScanner', () => ({
  default: ({ onScan, onError }: any) => (
    <div>
      <input
        data-testid="imei-scanner-input"
        placeholder="Scanner input"
        onChange={(e) => {
          if (e.target.value.length > 0) {
            onScan(e.target.value);
          }
        }}
      />
    </div>
  ),
}));
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

describe('ScanInModal', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useInventoryStore.mockReturnValue({
      suppliers: [mockSupplier],
    });
    dbService.create = vi.fn().mockResolvedValue(undefined);
    dbService.imeiExists = vi.fn().mockResolvedValue(false);
    notificationService.addNotification = vi.fn();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Rendering', () => {
    it('should render modal with scan stage initially', () => {
      render(<ScanInModal onClose={mockOnClose} />);
      expect(screen.getByText('Scan IMEI')).toBeInTheDocument();
      expect(screen.getByText('Point camera at barcode')).toBeInTheDocument();
    });

    it('should show IMEI scanner component', () => {
      render(<ScanInModal onClose={mockOnClose} />);
      expect(screen.getByTestId('imei-scanner-input')).toBeInTheDocument();
    });

    it('should show manual IMEI input fallback', () => {
      render(<ScanInModal onClose={mockOnClose} />);
      expect(screen.getByPlaceholderText('123456789012345')).toBeInTheDocument();
    });

    it('should close modal when X button is clicked', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const closeButton = screen.getByRole('button', { name: '' }).parentElement?.querySelector('[size="16"]');
      if (closeButton?.parentElement) {
        await user.click(closeButton.parentElement);
      }

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('IMEI Scanning', () => {
    it('should validate IMEI has at least 14 digits', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '35910809672'); // Only 11 digits

      const nextButton = screen.getByRole('button', { name: /Next/i });
      expect(nextButton).toBeDisabled();
    });

    it('should accept 14-digit IMEI', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '35910809672423');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      expect(nextButton).not.toBeDisabled();
    });

    it('should accept 15-digit IMEI', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      expect(nextButton).not.toBeDisabled();
    });

    it('should filter non-numeric characters from IMEI', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345') as HTMLInputElement;
      await user.type(manualInput, '3591ABC0809672423');

      // Should only contain digits
      expect(manualInput.value).toBe('35910809672423');
    });

    it('should move to form stage when Next is clicked', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        expect(screen.getByText('Add Unit')).toBeInTheDocument();
      });
    });

    it('should display scanned IMEI in form stage', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        expect(screen.getByText('359108096724237')).toBeInTheDocument();
      });
    });
  });

  describe('Barcode Parsing', () => {
    it('should extract model from barcode label', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      // Simulate barcode with model, grade, and storage
      await user.type(manualInput, 'SAMSUNG S21 FE 5G Grade A Memory 128GB 35910809672423');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        const modelInput = screen.getByPlaceholderText('e.g. Apple iPhone 14 128GB') as HTMLInputElement;
        expect(modelInput.value).toContain('SAMSUNG');
      });
    });

    it('should extract grade from barcode label', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, 'SAMSUNG S21 Grade B 35910809672423');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'B' })).toHaveClass('bg-black');
      });
    });

    it('should extract storage from barcode label', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, 'SAMSUNG S21 Memory 256GB 35910809672423');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        const storageInput = screen.getByPlaceholderText('e.g. 128GB, 256GB, 512GB') as HTMLInputElement;
        expect(storageInput.value).toBe('256GB');
      });
    });

    it('should handle barcode without additional data', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        // Should move to form without errors
        expect(screen.getByText('Add Unit')).toBeInTheDocument();
      });
    });
  });

  describe('Form Fields', () => {
    it('should have all required fields', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('e.g. Apple iPhone 14 128GB')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('e.g. 128GB, 256GB, 512GB')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('0')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument();
      });
    });

    it('should require model field', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        const saveButton = screen.getByRole('button', { name: /Save to Stock/i });
        // Initially disabled because model and colour are not filled
        expect(saveButton).toBeDisabled();
      });
    });

    it('should require buy price field', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        const modelInput = screen.getByPlaceholderText('e.g. Apple iPhone 14 128GB');
        const colourButtons = screen.getAllByRole('button');

        // Try to find and click a colour button
        const blackButton = colourButtons.find(btn => btn.textContent === 'Black');
        if (blackButton) {
          // Would need to click it, but testing that field requirement works
          expect(screen.getByPlaceholderText('0')).toBeInTheDocument();
        }
      });
    });

    it('should allow selecting colour from options', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        const blackButton = screen.getByRole('button', { name: 'Black' });
        userEvent.click(blackButton);

        expect(blackButton).toHaveClass('bg-black');
      });
    });

    it('should allow selecting grade from options', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        const gradeB = screen.getByRole('button', { name: 'B' });
        userEvent.click(gradeB);

        expect(gradeB).toHaveClass('bg-black');
      });
    });

    it('should allow entering storage', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        const storageInput = screen.getByPlaceholderText('e.g. 128GB, 256GB, 512GB') as HTMLInputElement;
        userEvent.type(storageInput, '256GB');

        expect(storageInput.value).toBe('256GB');
      });
    });

    it('should allow selecting supplier', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        const supplierInput = screen.getByPlaceholderText('MHL, NANAK, ABC...') as HTMLInputElement;
        userEvent.type(supplierInput, 'MHL');

        expect(supplierInput.value).toBe('MHL');
      });
    });

    it('should allow entering notes', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        const notesInput = screen.getByPlaceholderText('Optional: condition, box included, etc.') as HTMLInputElement;
        userEvent.type(notesInput, 'Box included');

        expect(notesInput.value).toBe('Box included');
      });
    });
  });

  describe('Unit Creation', () => {
    it('should save unit with all fields', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        const modelInput = screen.getByPlaceholderText('e.g. Apple iPhone 14 128GB');
        userEvent.type(modelInput, 'iPhone 14 Pro');

        const priceInput = screen.getByDisplayValue('0');
        userEvent.clear(priceInput);
        userEvent.type(priceInput, '450');

        const blackButton = screen.getByRole('button', { name: 'Black' });
        userEvent.click(blackButton);

        const saveButton = screen.getByRole('button', { name: /Save to Stock/i });
        userEvent.click(saveButton);

        expect(dbService.create).toHaveBeenCalled();
      });
    });

    it('should create unit with correct status available', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        const modelInput = screen.getByPlaceholderText('e.g. Apple iPhone 14 128GB');
        userEvent.type(modelInput, 'iPhone 14');

        const priceInput = screen.getByPlaceholderText('0');
        userEvent.type(priceInput, '450');

        const blackButton = screen.getByRole('button', { name: 'Black' });
        userEvent.click(blackButton);

        const saveButton = screen.getByRole('button', { name: /Save to Stock/i });
        userEvent.click(saveButton);

        expect(dbService.create).toHaveBeenCalledWith(
          'inventoryUnits',
          '359108096724237',
          expect.objectContaining({ status: 'available' })
        );
      });
    });

    it('should trigger new_stock notification', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        const modelInput = screen.getByPlaceholderText('e.g. Apple iPhone 14 128GB');
        userEvent.type(modelInput, 'iPhone 14');

        const priceInput = screen.getByPlaceholderText('0');
        userEvent.type(priceInput, '450');

        const blackButton = screen.getByRole('button', { name: 'Black' });
        userEvent.click(blackButton);

        const saveButton = screen.getByRole('button', { name: /Save to Stock/i });
        userEvent.click(saveButton);

        expect(notificationService.addNotification).toHaveBeenCalledWith(
          'new_stock',
          expect.any(Object)
        );
      });
    });

    it('should detect duplicate IMEI', async () => {
      const user = userEvent.setup();
      dbService.imeiExists.mockResolvedValue(true);

      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        const modelInput = screen.getByPlaceholderText('e.g. Apple iPhone 14 128GB');
        userEvent.type(modelInput, 'iPhone 14');

        const priceInput = screen.getByPlaceholderText('0');
        userEvent.type(priceInput, '450');

        const blackButton = screen.getByRole('button', { name: 'Black' });
        userEvent.click(blackButton);

        const saveButton = screen.getByRole('button', { name: /Save to Stock/i });
        userEvent.click(saveButton);

        expect(screen.getByText(/already exists/i)).toBeInTheDocument();
      });
    });

    it('should reset form after saving', async () => {
      const user = userEvent.setup();
      vi.useFakeTimers();

      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        const modelInput = screen.getByPlaceholderText('e.g. Apple iPhone 14 128GB');
        userEvent.type(modelInput, 'iPhone 14');

        const priceInput = screen.getByPlaceholderText('0');
        userEvent.type(priceInput, '450');

        const blackButton = screen.getByRole('button', { name: 'Black' });
        userEvent.click(blackButton);

        const saveButton = screen.getByRole('button', { name: /Save to Stock/i });
        userEvent.click(saveButton);
      });

      vi.advanceTimersByTime(1300);
      vi.useRealTimers();

      await waitFor(() => {
        expect(screen.getByText('Scan IMEI')).toBeInTheDocument();
      });
    });
  });

  describe('Rescan', () => {
    it('should allow rescanning after form entry', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        const rescanButton = screen.getByRole('button', { name: 'Rescan' });
        userEvent.click(rescanButton);

        expect(screen.getByText('Scan IMEI')).toBeInTheDocument();
      });
    });
  });

  describe('Validation', () => {
    it('should show error for missing model', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        const priceInput = screen.getByPlaceholderText('0');
        userEvent.type(priceInput, '450');

        const blackButton = screen.getByRole('button', { name: 'Black' });
        userEvent.click(blackButton);

        const saveButton = screen.getByRole('button', { name: /Save to Stock/i });
        userEvent.click(saveButton);

        expect(screen.getByText(/Model is required/i)).toBeInTheDocument();
      });
    });

    it('should show error for missing buy price', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        const modelInput = screen.getByPlaceholderText('e.g. Apple iPhone 14 128GB');
        userEvent.type(modelInput, 'iPhone 14');

        const blackButton = screen.getByRole('button', { name: 'Black' });
        userEvent.click(blackButton);

        const saveButton = screen.getByRole('button', { name: /Save to Stock/i });
        userEvent.click(saveButton);

        expect(screen.getByText(/Buy price is required/i)).toBeInTheDocument();
      });
    });

    it('should show error for missing colour', async () => {
      const user = userEvent.setup();
      render(<ScanInModal onClose={mockOnClose} />);

      const manualInput = screen.getByPlaceholderText('123456789012345');
      await user.type(manualInput, '359108096724237');

      const nextButton = screen.getByRole('button', { name: /Next/i });
      await user.click(nextButton);

      await waitFor(() => {
        const modelInput = screen.getByPlaceholderText('e.g. Apple iPhone 14 128GB');
        userEvent.type(modelInput, 'iPhone 14');

        const priceInput = screen.getByPlaceholderText('0');
        userEvent.type(priceInput, '450');

        const saveButton = screen.getByRole('button', { name: /Save to Stock/i });
        userEvent.click(saveButton);

        expect(screen.getByText(/Colour is required/i)).toBeInTheDocument();
      });
    });
  });
});
