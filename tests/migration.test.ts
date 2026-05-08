import { describe, it, expect, beforeEach } from 'vitest';
import { Migration, TableBuilder } from '../src/migration';

describe('Migration', () => {
  describe('TableBuilder', () => {
    it('should create a TableBuilder instance', () => {
      const mockStore = {
        createIndex: () => {}
      } as any;
      const builder = new TableBuilder(mockStore);
      expect(builder).toBeDefined();
    });

    it('should support chaining string field definition', () => {
      const mockStore = {
        createIndex: () => {}
      } as any;
      const builder = new TableBuilder(mockStore);
      const result = builder.string('name');
      expect(result).toBe(builder);
    });

    it('should support chaining integer field definition', () => {
      const mockStore = {
        createIndex: () => {}
      } as any;
      const builder = new TableBuilder(mockStore);
      const result = builder.integer('age');
      expect(result).toBe(builder);
    });

    it('should support chaining boolean field definition', () => {
      const mockStore = {
        createIndex: () => {}
      } as any;
      const builder = new TableBuilder(mockStore);
      const result = builder.boolean('active');
      expect(result).toBe(builder);
    });

    it('should create unique index', () => {
      let createdIndexName = '';
      let createdKeyPath = '';
      let createdOptions: any = {};

      const mockStore = {
        createIndex: (name: string, keyPath: string, options?: any) => {
          createdIndexName = name;
          createdKeyPath = keyPath;
          createdOptions = options;
        }
      } as any;

      const builder = new TableBuilder(mockStore);
      builder.string('email').unique();

      expect(createdIndexName).toBe('email_unique');
      expect(createdKeyPath).toBe('email');
      expect(createdOptions.unique).toBe(true);
    });

    it('should create timestamps with indexes', () => {
      let indexesCreated: string[] = [];

      const mockStore = {
        createIndex: (name: string) => {
          indexesCreated.push(name);
        }
      } as any;

      const builder = new TableBuilder(mockStore);
      builder.timestamps();

      expect(indexesCreated).toContain('createdAt');
      expect(indexesCreated).toContain('updatedAt');
    });

    it('should create custom index', () => {
      let createdIndexName = '';
      let createdKeyPath = '';

      const mockStore = {
        createIndex: (name: string, keyPath: string) => {
          createdIndexName = name;
          createdKeyPath = keyPath;
        }
      } as any;

      const builder = new TableBuilder(mockStore);
      builder.string('name').index('name_index');

      expect(createdIndexName).toBe('name_index');
      expect(createdKeyPath).toBe('name');
    });

    it('should support chaining multiple methods', () => {
      const mockStore = {
        createIndex: () => {}
      } as any;
      const builder = new TableBuilder(mockStore);
      const result = builder.string('name').integer('age').boolean('active');
      expect(result).toBe(builder);
    });
  });
});
