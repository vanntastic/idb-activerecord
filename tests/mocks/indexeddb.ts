// Mock IndexedDB for testing

export class MockIDBRequest implements IDBRequest {
  result: any;
  error: DOMException | null = null;
  readyState: IDBRequestReadyState = 'pending';
  onsuccess: ((this: IDBRequest, ev: Event) => any) | null = null;
  onerror: ((this: IDBRequest, ev: Event) => any) | null = null;
  transaction: IDBTransaction | null = null;
  source: any = null;

  constructor(result: any = null, error: DOMException | null = null) {
    this.result = result;
    this.error = error;
    setTimeout(() => {
      this.readyState = 'done';
      if (error) {
        this.onerror?.call(this, new Event('error'));
      } else {
        this.onsuccess?.call(this, new Event('success'));
      }
    }, 0);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {}
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {}
  dispatchEvent(event: Event): boolean { return true; }
}

export class MockIDBObjectStore implements IDBObjectStore {
  name: string;
  keyPath: string | string[];
  autoIncrement: boolean;
  indexNames: DOMStringList;
  transaction: IDBTransaction;

  private data: Map<any, any> = new Map();
  private nextId: number = 1;
  private indexes: Map<string, Map<any, Set<any>>> = new Map();

  constructor(name: string, keyPath: string | string[], autoIncrement: boolean, transaction: IDBTransaction) {
    this.name = name;
    this.keyPath = keyPath;
    this.autoIncrement = autoIncrement;
    this.transaction = transaction;
    this.indexNames = {
      contains: (name: string) => this.indexes.has(name),
      item: (index: number) => Array.from(this.indexes.keys())[index],
      length: 0,
      [Symbol.iterator]: function* () {
        yield* [];
      }
    } as any;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {}
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {}
  dispatchEvent(event: Event): boolean { return true; }

  add(value: any, key?: any): IDBRequest {
    try {
      let id = key;
      if (this.autoIncrement && !id) {
        id = this.nextId++;
        // Persist nextId back to database-level store info
        const db = (this.transaction as any).db;
        if (db && db.stores) {
          const info = db.stores.get(this.name);
          if (info) info.nextId = this.nextId;
        }
      }
      // If no explicit key and not auto-incrementing, extract from value
      if (!id && typeof this.keyPath === 'string') {
        id = value[this.keyPath];
      }

      const record = { ...value };
      if (typeof this.keyPath === 'string' && id !== undefined) {
        record[this.keyPath] = id;
      }
      
      this.data.set(id, record);
      
      // Update indexes
      this.indexes.forEach((indexMap, indexName) => {
        const indexValue = record[indexName];
        if (indexValue !== undefined) {
          if (!indexMap.has(indexValue)) {
            indexMap.set(indexValue, new Set());
          }
          indexMap.get(indexValue)!.add(id);
        }
      });
      
      return new MockIDBRequest(id);
    } catch (error: any) {
      return new MockIDBRequest(null, error);
    }
  }

  put(value: any, key?: any): IDBRequest {
    try {
      let id = key;
      if (typeof this.keyPath === 'string') {
        id = value[this.keyPath] || id;
      }
      
      if (!id && this.autoIncrement) {
        id = this.nextId++;
        const db = (this.transaction as any).db;
        if (db && db.stores) {
          const info = db.stores.get(this.name);
          if (info) info.nextId = this.nextId;
        }
      }
      
      const record = { ...value };
      if (typeof this.keyPath === 'string') {
        record[this.keyPath] = id;
      }
      
      this.data.set(id, record);
      return new MockIDBRequest(id);
    } catch (error: any) {
      return new MockIDBRequest(null, error);
    }
  }

  get(key: any): IDBRequest {
    const result = this.data.get(key);
    return new MockIDBRequest(result || undefined);
  }

  delete(key: any): IDBRequest {
    this.data.delete(key);
    return new MockIDBRequest(undefined);
  }

  getAll(query?: IDBValidKey | IDBKeyRange, count?: number): IDBRequest {
    const results = Array.from(this.data.values());
    return new MockIDBRequest(results);
  }

  createIndex(name: string, keyPath: string | string[], options?: IDBIndexParameters): IDBIndex {
    if (!this.indexes.has(name)) {
      this.indexes.set(name, new Map());
    }
    const self = this;
    return {
      name,
      keyPath,
      objectStore: this,
      unique: options?.unique || false,
      multiEntry: options?.multiEntry || false,
      openCursor: () => new MockIDBRequest(null),
      getAll: (query?: any) => {
        const results: any[] = [];
        self.data.forEach((record) => {
          const val = (record as any)[keyPath as string];
          if (val !== undefined) {
            if (!query || val === query) {
              results.push(record);
            }
          }
        });
        return new MockIDBRequest(results);
      }
    } as any;
  }

  index(name: string): IDBIndex {
    const idx = this.indexes.get(name);
    if (!idx) {
      throw new DOMException(`Index ${name} not found`, 'NotFoundError');
    }
    // Return existing index without recreating
    const self = this;
    const keyPath = name; // simplified
    return {
      name,
      keyPath,
      objectStore: this,
      unique: false,
      multiEntry: false,
      openCursor: () => new MockIDBRequest(null),
      getAll: (query?: any) => {
        const results: any[] = [];
        self.data.forEach((record) => {
          const val = (record as any)[keyPath as string];
          if (val !== undefined) {
            if (!query || val === query) {
              results.push(record);
            }
          }
        });
        return new MockIDBRequest(results);
      }
    } as any;
  }

  deleteIndex(indexName: string): void {
    this.indexes.delete(indexName);
  }

  clear(): IDBRequest {
    this.data.clear();
    this.nextId = 1;
    return new MockIDBRequest(undefined);
  }

  count(query?: IDBValidKey | IDBKeyRange): IDBRequest {
    return new MockIDBRequest(this.data.size);
  }

  openCursor(query?: IDBValidKey | IDBKeyRange, direction?: IDBCursorDirection): IDBRequest {
    return new MockIDBRequest(null);
  }

  openKeyCursor(query?: IDBValidKey | IDBKeyRange, direction?: IDBCursorDirection): IDBRequest {
    return new MockIDBRequest(null);
  }

  getAllKeys(query?: IDBValidKey | IDBKeyRange, count?: number): IDBRequest {
    return new MockIDBRequest(Array.from(this.data.keys()));
  }

  getKey(key: any): IDBRequest {
    return new MockIDBRequest(key);
  }
}

export class MockIDBTransaction implements IDBTransaction {
  db: IDBDatabase;
  mode: IDBTransactionMode;
  objectStoreNames: DOMStringList;
  onabort: ((this: IDBTransaction, ev: Event) => any) | null = null;
  oncomplete: ((this: IDBTransaction, ev: Event) => any) | null = null;
  onerror: ((this: IDBTransaction, ev: Event) => any) | null = null;
  durability: IDBTransactionDurability = 'default';
  error: DOMException | null = null;

  private stores: Map<string, MockIDBObjectStore> = new Map();
  private aborted: boolean = false;

  constructor(db: IDBDatabase, storeNames: string[], mode: IDBTransactionMode) {
    this.db = db;
    this.mode = mode;
    this.objectStoreNames = {
      contains: (name: string) => storeNames.includes(name),
      item: (index: number) => storeNames[index],
      length: storeNames.length,
      [Symbol.iterator]: function* () {
        yield* storeNames;
      }
    } as any;

    // Initialize stores from database, sharing the same data map
    storeNames.forEach(name => {
      const storeInfo = (db as any).stores.get(name);
      if (storeInfo) {
        const store = new MockIDBObjectStore(name, storeInfo.keyPath, storeInfo.autoIncrement, this);
        // Share database-level data for persistence across transactions
        (store as any).data = storeInfo.data || new Map();
        (store as any).indexes = storeInfo.indexes || new Map();
        (store as any).nextId = storeInfo.nextId || 1;
        this.stores.set(name, store);
      }
    });

    // Auto-fire oncomplete on the next macrotask, after request callbacks
    // (which are scheduled with setTimeout(0)) have had a chance to run.
    setTimeout(() => {
      if (!this.aborted) {
        this.oncomplete?.call(this, new Event('complete'));
      }
    }, 5);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {}
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {}
  dispatchEvent(event: Event): boolean { return true; }

  objectStore(name: string): IDBObjectStore {
    const store = this.stores.get(name);
    if (!store) {
      throw new DOMException('Object store not found', 'NotFoundError');
    }
    return store;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.call(this, new Event('abort'));
  }

  commit(): void {
    if (!this.aborted) {
      this.oncomplete?.call(this, new Event('complete'));
    }
  }
}

export class MockIDBDatabase implements IDBDatabase {
  name: string;
  version: number;
  objectStoreNames: DOMStringList;
  onabort: ((this: IDBDatabase, ev: Event) => any) | null = null;
  onclose: ((this: IDBDatabase, ev: Event) => any) | null = null;
  onerror: ((this: IDBDatabase, ev: Event) => any) | null = null;
  onversionchange: ((this: IDBDatabase, ev: Event) => any) | null = null;

  stores: Map<string, { keyPath: string | string[]; autoIncrement: boolean; nextId: number; data: Map<any, any>; indexes: Map<string, Map<any, Set<any>>> }> = new Map();

  constructor(name: string, version: number) {
    this.name = name;
    this.version = version;
    this.objectStoreNames = {
      contains: (name: string) => this.stores.has(name),
      item: (index: number) => Array.from(this.stores.keys())[index],
      length: 0,
      [Symbol.iterator]: function* () {
        yield* [];
      }
    } as any;
  }

  close(): void {}

  createObjectStore(name: string, options?: IDBObjectStoreParameters): IDBObjectStore {
    const keyPath = options?.keyPath || 'id';
    const store = new MockIDBObjectStore(
      name,
      keyPath,
      options?.autoIncrement || false,
      new MockIDBTransaction(this, [name], 'versionchange')
    );
    this.stores.set(name, {
      keyPath: keyPath,
      autoIncrement: options?.autoIncrement || false,
      nextId: (store as any).nextId,
      data: (store as any).data,
      indexes: (store as any).indexes
    });
    (this.objectStoreNames as any).length = this.stores.size;
    return store;
  }

  deleteObjectStore(name: string): void {
    this.stores.delete(name);
    (this.objectStoreNames as any).length = this.stores.size;
  }

  transaction(storeNames: string | string[], mode?: IDBTransactionMode): IDBTransaction {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    return new MockIDBTransaction(this, names, mode || 'readonly');
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {}
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {}
  dispatchEvent(event: Event): boolean {
    return true;
  }
}

export class MockIDBOpenDBRequest implements IDBOpenDBRequest {
  result: IDBDatabase;
  error: DOMException | null = null;
  readyState: IDBRequestReadyState = 'pending';
  onsuccess: ((this: IDBRequest<IDBDatabase>, ev: Event) => any) | null = null;
  onerror: ((this: IDBRequest<IDBDatabase>, ev: Event) => any) | null = null;
  onupgradeneeded: ((this: IDBOpenDBRequest, ev: IDBVersionChangeEvent) => any) | null = null;
  onblocked: ((this: IDBOpenDBRequest, ev: Event) => any) | null = null;
  transaction: IDBTransaction | null = null;
  source: any = null;

  constructor(private db: MockIDBDatabase) {
    this.result = db as any;
    setTimeout(() => {
      this.readyState = 'done';
      this.onsuccess?.call(this, new Event('success'));
    }, 0);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {}
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {}
  dispatchEvent(event: Event): boolean { return true; }
}

// Mock indexedDB global
export const mockIndexedDB = {
  databases: () => Promise.resolve([]),
  open: (name: string, version?: number): IDBOpenDBRequest => {
    const db = new MockIDBDatabase(name, version || 1);
    const request = new MockIDBOpenDBRequest(db);
    
    // Simulate upgradeneeded if needed
    setTimeout(() => {
      request.onupgradeneeded?.call(request, {
        target: request,
        type: 'upgradeneeded',
        oldVersion: 0,
        newVersion: version || 1
      } as any);
    }, 0);
    
    return request as any;
  },
  deleteDatabase: (name: string): IDBOpenDBRequest => {
    return new MockIDBOpenDBRequest(new MockIDBDatabase(name, 1)) as any;
  }
};

// Setup global mock
(globalThis as any).indexedDB = mockIndexedDB;
