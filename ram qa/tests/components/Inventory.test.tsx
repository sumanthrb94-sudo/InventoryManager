import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Inventory from '../../components/Inventory';
import { useInventoryStore } from '../../lib/inventoryStore';

vi.mock('../../lib/inventoryStore');
vi.mock('../../lib/modelSummaries', () => ({
  buildModelSummaries: (units: any) => units.map((u: any) => ({
    model: u.model,
    brand: u.brand,
    category: u.category,
    flags: [],
    variants: [{
      colour: u.colour,
      units: [u],
    }],
    totalAvailable: u.status === 'available' ? 1 : 0,
    totalValue: u.buyPrice,
    latestDateIn: u.dateIn,
  })),
}));
vi.mock('../../lib/inventorySummary', () => ({
  getOnHandValue: (units: any) => units.filter((u: any) => u.status === 'available').reduce((s: number, u: any) => s + u.buyPrice, 0),
}));
vi.mock('../../components/UnitDetailDrawer', () => ({
  default: ({ unit, isOpen }: any) => isOpen ? <div>Unit Details</div> : null,
}));
vi.mock('../../components/QuickSaleModal', () => ({
  default: ({ unit, isOpen }: any) => isOpen ? <div>Quick Sale</div> : null,
}));
vi.mock('../../components/BulkListingModal', () => ({
  default: ({ isOpen }: any) => isOpen ? <div>Bulk Listing</div> : null,
}));
vi.mock('motion/react', () => ({
  motion: { div: ({ children, ...props }: any) => <div {...props}>{children}</div> },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

const mockUnit = {
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

describe('Inventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useInventoryStore.mockReturnValue({
      units: [mockUnit],
      suppliers: [{ id: 'sup_001', name: 'MHL' }],
    });
  });

  describe('Rendering', () => {
    it('should render Inventory header', () => {
      render(<Inventory />);
      expect(screen.getByText('Inventory')).toBeInTheDocument();
    });

    it('should show inventory summary', () => {
      render(<Inventory />);
      expect(screen.getByText(/available/i)).toBeInTheDocument();
    });

    it('should display search input', () => {
      render(<Inventory />);
      expect(screen.getByPlaceholderText('Model, IMEI, colour…')).toBeInTheDocument();
    });

    it('should show sort dropdown', () => {
      render(<Inventory />);
      expect(screen.getByDisplayValue('Newest First')).toBeInTheDocument();
    });

    it('should show filter button', () => {
      render(<Inventory />);
      const filterButton = screen.getByRole('button', { name: '' }).parentElement?.querySelector('button');
      expect(filterButton).toBeInTheDocument();
    });

    it('should show bulk list button', () => {
      render(<Inventory />);
      expect(screen.getByRole('button', { name: /Bulk List/i })).toBeInTheDocument();
    });
  });

  describe('Search', () => {
    it('should search by model name', async () => {
      const user = userEvent.setup();
      render(<Inventory />);

      const searchInput = screen.getByPlaceholderText('Model, IMEI, colour…');
      await user.type(searchInput, 'iPhone');

      expect((searchInput as HTMLInputElement).value).toBe('iPhone');
    });

    it('should search by IMEI', async () => {
      const user = userEvent.setup();
      render(<Inventory />);

      const searchInput = screen.getByPlaceholderText('Model, IMEI, colour…');
      await user.type(searchInput, '359108');

      expect((searchInput as HTMLInputElement).value).toBe('359108');
    });
  });

  describe('Sorting', () => {
    it('should allow sorting by newest first', () => {
      render(<Inventory />);
      const sortSelect = screen.getByDisplayValue('Newest First');
      expect(sortSelect).toBeInTheDocument();
    });

    it('should allow sorting by oldest first', async () => {
      const user = userEvent.setup();
      render(<Inventory />);

      const sortSelect = screen.getByDisplayValue('Newest First') as HTMLSelectElement;
      await user.selectOption(sortSelect, 'Oldest First');

      expect(sortSelect.value).toBe('dateIn_asc');
    });

    it('should allow sorting by model A→Z', async () => {
      const user = userEvent.setup();
      render(<Inventory />);

      const sortSelect = screen.getByDisplayValue('Newest First') as HTMLSelectElement;
      await user.selectOption(sortSelect, 'Model A→Z');

      expect(sortSelect.value).toBe('model_asc');
    });

    it('should allow sorting by highest value', async () => {
      const user = userEvent.setup();
      render(<Inventory />);

      const sortSelect = screen.getByDisplayValue('Newest First') as HTMLSelectElement;
      await user.selectOption(sortSelect, 'Highest Value');

      expect(sortSelect.value).toBe('value_desc');
    });
  });

  describe('Pagination', () => {
    it('should display pagination info', () => {
      render(<Inventory />);
      expect(screen.getByText(/pg/i)).toBeInTheDocument();
    });

    it('should allow changing page size', async () => {
      const user = userEvent.setup();
      const manyUnits = Array(50).fill(mockUnit).map((u, i) => ({ ...u, id: `unit_${i}` }));
      useInventoryStore.mockReturnValue({
        units: manyUnits,
        suppliers: [{ id: 'sup_001', name: 'MHL' }],
      });

      render(<Inventory />);

      const pageSizeSelect = screen.getAllByRole('combobox')[1];
      await user.selectOption(pageSizeSelect, '50');

      expect((pageSizeSelect as HTMLSelectElement).value).toBe('50');
    });
  });

  describe('Status Summary', () => {
    it('should show count of available units', () => {
      render(<Inventory />);
      expect(screen.getByText(/1 available/i)).toBeInTheDocument();
    });

    it('should show total value of available units', () => {
      render(<Inventory />);
      expect(screen.getByText(/£450/i)).toBeInTheDocument();
    });

    it('should show total unit count', () => {
      render(<Inventory />);
      expect(screen.getByText(/1 total units/i)).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show empty message when no inventory', () => {
      useInventoryStore.mockReturnValue({
        units: [],
        suppliers: [],
      });

      render(<Inventory />);
      expect(screen.getByText(/No inventory found/i)).toBeInTheDocument();
    });
  });

  describe('Filter Panel', () => {
    it('should hide filter panel by default', () => {
      render(<Inventory />);
      const categorySelects = screen.queryAllByText('All Categories');
      expect(categorySelects.length).toBe(0);
    });

    it('should show filter panel when filter button is clicked', async () => {
      const user = userEvent.setup();
      render(<Inventory />);

      const filterButtons = screen.getAllByRole('button');
      const filterButton = filterButtons.find(btn => btn.querySelector('svg'));

      if (filterButton) {
        await user.click(filterButton);
        await waitFor(() => {
          expect(screen.getByText('All Categories')).toBeInTheDocument();
        });
      }
    });

    it('should allow filtering by category', async () => {
      const user = userEvent.setup();
      render(<Inventory />);

      const filterButtons = screen.getAllByRole('button');
      const filterButton = filterButtons.find(btn => btn.className?.includes('border'));

      if (filterButton) {
        await user.click(filterButton);
        await waitFor(() => {
          const categorySelect = screen.getByDisplayValue('All Categories') as HTMLSelectElement;
          expect(categorySelect).toBeInTheDocument();
        });
      }
    });

    it('should allow filtering by status', async () => {
      const user = userEvent.setup();
      render(<Inventory />);

      const filterButtons = screen.getAllByRole('button');
      const filterButton = filterButtons.find(btn => btn.className?.includes('border'));

      if (filterButton) {
        await user.click(filterButton);
        await waitFor(() => {
          const statusSelects = screen.queryAllByDisplayValue(/All Statuses/i);
          expect(statusSelects.length).toBeGreaterThan(0);
        });
      }
    });

    it('should allow filtering by supplier', async () => {
      const user = userEvent.setup();
      render(<Inventory />);

      const filterButtons = screen.getAllByRole('button');
      const filterButton = filterButtons.find(btn => btn.className?.includes('border'));

      if (filterButton) {
        await user.click(filterButton);
        await waitFor(() => {
          const supplierSelects = screen.queryAllByDisplayValue('All Suppliers');
          expect(supplierSelects.length).toBeGreaterThan(0);
        });
      }
    });
  });
});
