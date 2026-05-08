// Migration class for database schema changes

export class Migration {
  protected db: IDBDatabase | null = null;

  constructor(db: IDBDatabase) {
    this.db = db;
  }

  up(): void {
    throw new Error('up() method must be implemented');
  }

  down(): void {
    throw new Error('down() method must be implemented');
  }

  protected createTable(name: string, callback: (table: TableBuilder) => void): void {
    if (!this.db) throw new Error('Database not connected');
    
    if (!this.db.objectStoreNames.contains(name)) {
      const store = this.db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
      const builder = new TableBuilder(store);
      callback(builder);
    }
  }

  protected dropTable(name: string): void {
    if (!this.db) throw new Error('Database not connected');
    
    if (this.db.objectStoreNames.contains(name)) {
      this.db.deleteObjectStore(name);
    }
  }
}

export class TableBuilder {
  constructor(private store: IDBObjectStore) {}

  autoIncrement(name: string): TableBuilder {
    // Key path is already set in createTable
    return this;
  }

  primaryKey(): TableBuilder {
    // Key path is already set in createTable
    return this;
  }

  string(name: string): TableBuilder {
    return this;
  }

  integer(name: string): TableBuilder {
    return this;
  }

  boolean(name: string): TableBuilder {
    return this;
  }

  unique(): TableBuilder {
    // This would need to be called after a field definition
    return this;
  }

  timestamps(): TableBuilder {
    this.createIndex('createdAt', 'createdAt');
    this.createIndex('updatedAt', 'updatedAt');
    return this;
  }

  private createIndex(name: string, keyPath: string, options?: IDBIndexParameters): void {
    this.store.createIndex(name, keyPath, options);
  }
}
