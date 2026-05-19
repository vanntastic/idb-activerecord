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
  private currentField: string | null = null;
  private uniqueFields: Set<string> = new Set();

  constructor(private store: IDBObjectStore) {}

  autoIncrement(_name: string): TableBuilder {
    // Key path is already set in createTable
    return this;
  }

  primaryKey(): TableBuilder {
    // Key path is already set in createTable
    return this;
  }

  string(name: string): TableBuilder {
    this.currentField = name;
    return this;
  }

  integer(name: string): TableBuilder {
    this.currentField = name;
    return this;
  }

  boolean(name: string): TableBuilder {
    this.currentField = name;
    return this;
  }

  unique(): TableBuilder {
    if (this.currentField) {
      this.uniqueFields.add(this.currentField);
      this.createIndex(`${this.currentField}_unique`, this.currentField, { unique: true });
      this.currentField = null;
    }
    return this;
  }

  timestamps(): TableBuilder {
    this.string('createdAt');
    this.string('updatedAt');
    this.createIndex('createdAt', 'createdAt');
    this.createIndex('updatedAt', 'updatedAt');
    return this;
  }

  index(name: string, options?: IDBIndexParameters): TableBuilder {
    if (this.currentField) {
      this.createIndex(name, this.currentField, options);
      this.currentField = null;
    }
    return this;
  }

  private createIndex(name: string, keyPath: string, options?: IDBIndexParameters): void {
    try {
      this.store.createIndex(name, keyPath, options);
    } catch (e) {
      // Index might already exist
    }
  }
}
