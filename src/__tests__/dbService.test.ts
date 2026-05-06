import { describe, it, expect } from 'vitest';
import { toSnake, toCamel, dbToApp, appToDb } from '../lib/dbService';

describe('toSnake', () => {
  it('converts camelCase to snake_case', () => {
    expect(toSnake('buyPrice')).toBe('buy_price');
    expect(toSnake('dateIn')).toBe('date_in');
    expect(toSnake('supplierId')).toBe('supplier_id');
    expect(toSnake('saleDate')).toBe('sale_date');
  });

  it('leaves already-snake strings unchanged', () => {
    expect(toSnake('model')).toBe('model');
    expect(toSnake('id')).toBe('id');
  });

  it('handles consecutive capitals', () => {
    expect(toSnake('imeiIMEI')).toBe('imei_i_m_e_i');
  });
});

describe('toCamel', () => {
  it('converts snake_case to camelCase', () => {
    expect(toCamel('buy_price')).toBe('buyPrice');
    expect(toCamel('date_in')).toBe('dateIn');
    expect(toCamel('supplier_id')).toBe('supplierId');
    expect(toCamel('sale_date')).toBe('saleDate');
    expect(toCamel('listing_sites')).toBe('listingSites');
  });

  it('leaves already-camel strings unchanged', () => {
    expect(toCamel('model')).toBe('model');
    expect(toCamel('id')).toBe('id');
  });
});

describe('dbToApp', () => {
  it('converts all snake_case keys to camelCase', () => {
    const row = { buy_price: 150, date_in: '2024-01-01', supplier_id: 'abc' };
    const result = dbToApp(row);
    expect(result).toMatchObject({ buyPrice: 150, dateIn: '2024-01-01', supplierId: 'abc' });
  });

  it('sets flags to [] when field is null', () => {
    const result = dbToApp({ flags: null, listing_sites: null });
    expect(result.flags).toEqual([]);
    expect(result.listingSites).toEqual([]);
  });

  it('sets flags to [] when field is undefined', () => {
    const result = dbToApp({});
    expect(result.flags).toEqual([]);
    expect(result.listingSites).toEqual([]);
  });

  it('preserves existing array values in flags', () => {
    const result = dbToApp({ flags: ['top10'], listing_sites: ['eBay'] });
    expect(result.flags).toEqual(['top10']);
    expect(result.listingSites).toEqual(['eBay']);
  });

  it('does not crash on empty object', () => {
    expect(() => dbToApp({})).not.toThrow();
  });
});

describe('appToDb', () => {
  it('converts all camelCase keys to snake_case', () => {
    const obj = { buyPrice: 150, dateIn: '2024-01-01', supplierId: 'abc' };
    const result = appToDb(obj);
    expect(result).toMatchObject({ buy_price: 150, date_in: '2024-01-01', supplier_id: 'abc' });
  });

  it('strips supplierName from output', () => {
    const result = appToDb({ model: 'iPhone', supplierName: 'TestCo' });
    expect(result).not.toHaveProperty('supplier_name');
    expect(result).toHaveProperty('model', 'iPhone');
  });

  it('strips undefined values', () => {
    const result = appToDb({ model: 'iPhone', storage: undefined });
    expect(result).not.toHaveProperty('storage');
    expect(result).toHaveProperty('model');
  });

  it('preserves null values (explicit null = clear the field)', () => {
    const result = appToDb({ imei: null, model: 'iPhone' });
    expect(result).toHaveProperty('imei', null);
  });

  it('round-trips through snake and camel correctly', () => {
    const original = { buyPrice: 200, dateIn: '2024-06-01', model: 'Samsung Galaxy S24' };
    const asDb  = appToDb(original);
    const asApp = Object.fromEntries(
      Object.entries(asDb).map(([k, v]) => [toCamel(k), v])
    );
    expect(asApp.buyPrice).toBe(200);
    expect(asApp.dateIn).toBe('2024-06-01');
    expect(asApp.model).toBe('Samsung Galaxy S24');
  });
});
