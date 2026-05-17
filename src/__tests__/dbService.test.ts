import { describe, it, expect } from 'vitest';
import { toSnake, toCamel, dbToApp, appToDb } from '../lib/dbService';

// ── toSnake ───────────────────────────────────────────────────────────────────
describe('toSnake', () => {
  it('converts camelCase to snake_case', () => {
    expect(toSnake('buyPrice')).toBe('buy_price');
    expect(toSnake('dateIn')).toBe('date_in');
    expect(toSnake('supplierId')).toBe('supplier_id');
    expect(toSnake('saleDate')).toBe('sale_date');
    expect(toSnake('returnType')).toBe('return_type');
    expect(toSnake('returnDate')).toBe('return_date');
    expect(toSnake('returnReason')).toBe('return_reason');
  });

  it('leaves already-snake strings unchanged', () => {
    expect(toSnake('model')).toBe('model');
    expect(toSnake('id')).toBe('id');
    expect(toSnake('imei')).toBe('imei');
  });

  it('handles listing-related fields', () => {
    expect(toSnake('listingSites')).toBe('listing_sites');
    expect(toSnake('platformListed')).toBe('platform_listed');
    expect(toSnake('saleOrderId')).toBe('sale_order_id');
  });
});

// ── toCamel ───────────────────────────────────────────────────────────────────
describe('toCamel', () => {
  it('converts snake_case to camelCase', () => {
    expect(toCamel('buy_price')).toBe('buyPrice');
    expect(toCamel('date_in')).toBe('dateIn');
    expect(toCamel('supplier_id')).toBe('supplierId');
    expect(toCamel('sale_date')).toBe('saleDate');
    expect(toCamel('listing_sites')).toBe('listingSites');
    expect(toCamel('return_type')).toBe('returnType');
    expect(toCamel('return_reason')).toBe('returnReason');
  });

  it('leaves already-camel strings unchanged', () => {
    expect(toCamel('model')).toBe('model');
    expect(toCamel('id')).toBe('id');
    expect(toCamel('imei')).toBe('imei');
  });
});

// ── dbToApp ───────────────────────────────────────────────────────────────────
describe('dbToApp', () => {
  it('converts all snake_case keys to camelCase', () => {
    const row = { buy_price: 150, date_in: '2024-01-01', supplier_id: 'abc' };
    expect(dbToApp(row)).toMatchObject({ buyPrice: 150, dateIn: '2024-01-01', supplierId: 'abc' });
  });

  it('converts return-related fields', () => {
    const row = { return_type: 'repair', return_date: '2024-06-10', return_reason: 'Faulty screen' };
    const result = dbToApp(row);
    expect(result.returnType).toBe('repair');
    expect(result.returnDate).toBe('2024-06-10');
    expect(result.returnReason).toBe('Faulty screen');
  });

  it('sets flags to [] when field is null', () => {
    const result = dbToApp({ flags: null, listing_sites: null });
    expect(result.flags).toEqual([]);
    expect(result.listingSites).toEqual([]);
  });

  it('sets flags to [] when field is undefined (missing from DB row)', () => {
    const result = dbToApp({});
    expect(result.flags).toEqual([]);
    expect(result.listingSites).toEqual([]);
  });

  it('preserves existing array values', () => {
    const result = dbToApp({ flags: ['top10'], listing_sites: ['eBay'] });
    expect(result.flags).toEqual(['top10']);
    expect(result.listingSites).toEqual(['eBay']);
  });

  it('passes null imei through unchanged (SHS units have null imei in DB)', () => {
    const result = dbToApp({ imei: null, model: 'iPhone 15', status: 'incoming' });
    expect(result.imei).toBeNull();
  });

  it('passes empty-string imei through unchanged', () => {
    const result = dbToApp({ imei: '', status: 'incoming' });
    expect(result.imei).toBe('');
  });

  it('does not crash on empty object', () => {
    expect(() => dbToApp({})).not.toThrow();
  });
});

// ── appToDb ───────────────────────────────────────────────────────────────────
describe('appToDb', () => {
  it('converts all camelCase keys to snake_case', () => {
    const obj = { buyPrice: 150, dateIn: '2024-01-01', supplierId: 'abc' };
    expect(appToDb(obj)).toMatchObject({ buy_price: 150, date_in: '2024-01-01', supplier_id: 'abc' });
  });

  it('converts return-related fields', () => {
    const obj = { returnType: 'returned_to_inventory', returnDate: '2024-06-10', returnReason: 'Changed mind' };
    const result = appToDb(obj);
    expect(result.return_type).toBe('returned_to_inventory');
    expect(result.return_date).toBe('2024-06-10');
    expect(result.return_reason).toBe('Changed mind');
  });

  it('strips supplierName from output (derived field, not a DB column)', () => {
    const result = appToDb({ model: 'iPhone', supplierName: 'TestCo' });
    expect(result).not.toHaveProperty('supplier_name');
    expect(result).toHaveProperty('model', 'iPhone');
  });

  it('strips undefined values', () => {
    const result = appToDb({ model: 'iPhone', storage: undefined });
    expect(result).not.toHaveProperty('storage');
    expect(result).toHaveProperty('model');
  });

  it('preserves null values (explicit null = clear the field in Firestore)', () => {
    const result = appToDb({ imei: null, model: 'iPhone' });
    expect(result).toHaveProperty('imei', null);
  });

  it('preserves null sale fields (clearing sale data on return)', () => {
    const result = appToDb({
      salePrice: null,
      saleDate: null,
      salePlatform: null,
      saleOrderId: null,
      postageCost: null,
    });
    expect(result.sale_price).toBeNull();
    expect(result.sale_date).toBeNull();
    expect(result.sale_platform).toBeNull();
    expect(result.sale_order_id).toBeNull();
    expect(result.postage_cost).toBeNull();
  });

  it('round-trips through snake and camel correctly', () => {
    const original = { buyPrice: 200, dateIn: '2024-06-01', model: 'Samsung Galaxy S24' };
    const asDb  = appToDb(original);
    const asApp = Object.fromEntries(Object.entries(asDb).map(([k, v]) => [toCamel(k), v]));
    expect(asApp.buyPrice).toBe(200);
    expect(asApp.dateIn).toBe('2024-06-01');
    expect(asApp.model).toBe('Samsung Galaxy S24');
  });
});
