-- Soft-delete support for inventory units and suppliers.
-- Rows with a non-null deleted_at are hidden from default queries; the
-- application purges them automatically 48 hours after deletion.

ALTER TABLE inventory_units
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS inventory_units_deleted_at_idx
  ON inventory_units (deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS suppliers_deleted_at_idx
  ON suppliers (deleted_at)
  WHERE deleted_at IS NOT NULL;
