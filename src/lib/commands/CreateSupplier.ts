import { Command } from './Command';
import { dbService } from '../dbService';
import type { Supplier } from '../../types';

export class CreateSupplier implements Command<void> {
  readonly type = 'CreateSupplier';
  constructor(public readonly supplier: Supplier) {}
  payload() {
    return {
      id:     this.supplier.id,
      name:   this.supplier.name,
      portal: this.supplier.portal,
    };
  }
  execute() {
    return dbService.create('suppliers', this.supplier.id, this.supplier);
  }
}
