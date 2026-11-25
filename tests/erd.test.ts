import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Database, ActiveRecord } from '../src/index.js';
import {
  generateERD,
  exportToMermaid,
  exportToPlantUML,
  exportToSQL,
  parseMermaid,
  generateModels,
  writeModelsToDisk
} from '../src/erd.js';

describe('Bidirectional ERD Tooling (src/erd.ts -> idb-activerecord/erd)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'idb-erd-test-'));
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Model -> ERD (generateERD)', () => {
    class Post extends ActiveRecord {
      static tableName = 'posts';
      static enableSync = true;
      static softDelete = true;
      static columns = {
        title: { type: 'string', nullable: false },
        content: { type: 'text' },
        authorId: { type: 'string' }
      };
      static indexes = [
        { name: 'idx_posts_author', columns: ['authorId'] }
      ];
      static belongsTo = {
        author: 'users'
      };
    }

    class User extends ActiveRecord {
      static tableName = 'users';
      static columns = {
        name: { type: 'string', nullable: false },
        email: { type: 'string' }
      };
      static indexes = [
        { name: 'idx_users_email', columns: ['email'], unique: true }
      ];
      static hasMany = {
        posts: Post
      };
      static hasOne = {
        profile: 'profiles'
      };
    }

    it('introspects models into structured ERDDocument', () => {
      const erd = generateERD([User, Post]);
      expect(erd.entities).toHaveLength(2);

      const userEnt = erd.entities.find(e => e.name === 'users')!;
      expect(userEnt).toBeDefined();
      expect(userEnt.className).toBe('User');
      expect(userEnt.columns.some(c => c.name === 'id' && c.primaryKey)).toBe(true);
      expect(userEnt.columns.some(c => c.name === 'email' && c.unique)).toBe(true);

      const postEnt = erd.entities.find(e => e.name === 'posts')!;
      expect(postEnt).toBeDefined();
      expect(postEnt.enableSync).toBe(true);
      expect(postEnt.softDelete).toBe(true);
      expect(postEnt.columns.some(c => c.name === '_deletedAt')).toBe(true);

      // Relationships
      expect(erd.relationships.length).toBeGreaterThanOrEqual(2);
      const userPostsRel = erd.relationships.find(
        r => r.from === 'users' && r.to === 'posts' && r.type === '1:N'
      );
      expect(userPostsRel).toBeDefined();
      expect(userPostsRel?.via).toBe('userId');

      const userProfileRel = erd.relationships.find(
        r => r.from === 'users' && r.to === 'profiles' && r.type === '1:1'
      );
      expect(userProfileRel).toBeDefined();
    });

    it('introspects from Database instance', () => {
      const db = new Database('test-db');
      db.registerModel(User);
      db.registerModel(Post);

      const erd = generateERD(db);
      expect(erd.entities).toHaveLength(2);
      expect(erd.entities.map(e => e.name)).toEqual(['posts', 'users']);
    });
  });

  describe('Diagram Exporters', () => {
    const sampleErd = {
      entities: [
        {
          name: 'users',
          className: 'User',
          columns: [
            { name: 'id', type: 'string', primaryKey: true, nullable: false },
            { name: 'name', type: 'string', nullable: false },
            { name: 'email', type: 'string', unique: true }
          ]
        },
        {
          name: 'posts',
          className: 'Post',
          columns: [
            { name: 'id', type: 'string', primaryKey: true, nullable: false },
            { name: 'userId', type: 'string', foreignKey: true },
            { name: 'title', type: 'string', nullable: false }
          ]
        }
      ],
      relationships: [
        { from: 'users', to: 'posts', type: '1:N' as const, via: 'userId', label: 'has many' }
      ]
    };

    it('exportToMermaid produces valid erDiagram syntax', () => {
      const mermaid = exportToMermaid(sampleErd);
      expect(mermaid).toContain('erDiagram');
      expect(mermaid).toContain('users {');
      expect(mermaid).toContain('string id PK');
      expect(mermaid).toContain('string email UK');
      expect(mermaid).toContain('posts {');
      expect(mermaid).toContain('string userId FK');
      expect(mermaid).toContain('users ||--o{ posts : "userId"');
    });

    it('exportToPlantUML produces valid @startuml syntax', () => {
      const plantUml = exportToPlantUML(sampleErd);
      expect(plantUml).toContain('@startuml');
      expect(plantUml).toContain('entity "users" as users {');
      expect(plantUml).toContain('* id : string <<PK>>');
      expect(plantUml).toContain('entity "posts" as posts {');
      expect(plantUml).toContain('userId : string <<FK>>');
      expect(plantUml).toContain('users ||--o{ posts : "userId"');
      expect(plantUml).toContain('@enduml');
    });

    it('exportToSQL produces valid SQLite DDL statements', () => {
      const sql = exportToSQL(sampleErd);
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "users" (');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS "posts" (');
      expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_email" ON "users" ("email");');
    });
  });

  describe('ERD -> Model (parseMermaid & generateModels)', () => {
    const mermaidText = `
erDiagram
    users {
        string id PK
        string name
        string email UK
        datetime createdAt
    }
    posts {
        string id PK
        string userId FK
        string title
        text content
    }
    categories {
        string id PK
        string name UK
    }
    users ||--o{ posts : "userId"
    users ||--|| profiles : "has one"
`;

    it('parseMermaid parses entities, columns, flags, and relationships in linear time', () => {
      const erd = parseMermaid(mermaidText);
      expect(erd.entities).toHaveLength(4); // users, posts, categories, profiles (auto-registered from rel)

      const users = erd.entities.find(e => e.name === 'users')!;
      expect(users).toBeDefined();
      expect(users.columns.find(c => c.name === 'id')?.primaryKey).toBe(true);
      expect(users.columns.find(c => c.name === 'email')?.unique).toBe(true);

      const posts = erd.entities.find(e => e.name === 'posts')!;
      expect(posts).toBeDefined();
      expect(posts.columns.find(c => c.name === 'userId')?.foreignKey).toBe(true);

      const rel1 = erd.relationships.find(r => r.from === 'users' && r.to === 'posts')!;
      expect(rel1).toBeDefined();
      expect(rel1.type).toBe('1:N');
      expect(rel1.via).toBe('userId');

      const rel2 = erd.relationships.find(r => r.from === 'users' && r.to === 'profiles')!;
      expect(rel2).toBeDefined();
      expect(rel2.type).toBe('1:1');
    });

    it('generateModels produces clean idiomatic TypeScript models', () => {
      const erd = parseMermaid(mermaidText);
      const models = generateModels(erd, { language: 'typescript', includeSync: true });

      expect(models.has('user.ts')).toBe(true);
      expect(models.has('post.ts')).toBe(true);

      const userSource = models.get('user.ts')!;
      expect(userSource).toContain("import { ActiveRecord } from 'idb-activerecord';");
      expect(userSource).toContain('export interface UserAttributes {');
      expect(userSource).toContain('export class User extends ActiveRecord<User> {');
      expect(userSource).toContain("static tableName = 'users';");
      expect(userSource).toContain('static enableSync = true;');
      expect(userSource).toContain("posts: 'posts'");
      expect(userSource).toContain('declare id: string;');
      expect(userSource).toContain('declare email?: string;');

      const postSource = models.get('post.ts')!;
      expect(postSource).toContain('export class Post extends ActiveRecord<Post> {');
      expect(postSource).toContain("user: 'users'");
    });

    it('generateModels produces clean JavaScript models when language is javascript', () => {
      const erd = parseMermaid(mermaidText);
      const models = generateModels(erd, { language: 'javascript' });

      expect(models.has('user.js')).toBe(true);
      const userJs = models.get('user.js')!;
      expect(userJs).toContain('export class User extends ActiveRecord {');
      expect(userJs).not.toContain('export interface');
      expect(userJs).not.toContain('declare id');
    });
  });

  describe('Full Round-Trip: Models -> ERD -> Mermaid -> parseMermaid -> generateModels', () => {
    it('preserves tables, columns, indexes, and relationships end-to-end', () => {
      class Author extends ActiveRecord {
        static tableName = 'authors';
        static columns = {
          name: { type: 'string', nullable: false },
          pseudonym: { type: 'string' }
        };
        static indexes = [
          { name: 'idx_authors_pseudonym', columns: ['pseudonym'], unique: true }
        ];
        static hasMany = {
          articles: 'articles'
        };
      }

      class Article extends ActiveRecord {
        static tableName = 'articles';
        static columns = {
          title: { type: 'string', nullable: false },
          body: { type: 'text' },
          authorId: { type: 'string' }
        };
        static belongsTo = {
          author: 'authors'
        };
      }

      // Step 1: Introspect models
      const erd1 = generateERD([Author, Article]);

      // Step 2: Export to Mermaid
      const mermaid1 = exportToMermaid(erd1);
      expect(mermaid1).toContain('authors ||--o{ articles');

      // Step 3: Parse Mermaid
      const erd2 = parseMermaid(mermaid1);
      expect(erd2.entities.map(e => e.name)).toEqual(['articles', 'authors']);

      // Step 4: Generate models
      const generated = generateModels(erd2, { language: 'typescript' });
      expect(generated.has('author.ts')).toBe(true);
      expect(generated.has('article.ts')).toBe(true);

      const authorCode = generated.get('author.ts')!;
      expect(authorCode).toContain("static tableName = 'authors';");
      expect(authorCode).toContain("articles: 'articles'");

      const articleCode = generated.get('article.ts')!;
      expect(articleCode).toContain("static tableName = 'articles';");
      expect(articleCode).toContain("author: 'authors'");
    });
  });

  describe('writeModelsToDisk & path traversal security (CodeQL)', () => {
    it('writes generated models to disk successfully', async () => {
      const erd: ERDDocument = {
        entities: [
          {
            name: 'todos',
            className: 'Todo',
            columns: [
              { name: 'id', type: 'string', primaryKey: true },
              { name: 'title', type: 'string', nullable: false }
            ]
          }
        ],
        relationships: []
      };

      const written = await writeModelsToDisk(erd, { outputDir: tempDir, language: 'typescript' });
      expect(written).toHaveLength(1);
      expect(fs.existsSync(written[0])).toBe(true);
      const content = await fs.promises.readFile(written[0], 'utf-8');
      expect(content).toContain('class Todo extends ActiveRecord<Todo>');
    });

    it('rejects path traversal attempts with invalid filenames or directory escapes', async () => {
      const maliciousErd: ERDDocument = {
        entities: [
          {
            name: '../../../evil_table',
            columns: [{ name: 'id', type: 'string', primaryKey: true }]
          }
        ],
        relationships: []
      };

      await expect(
        writeModelsToDisk(maliciousErd, { outputDir: tempDir })
      ).rejects.toThrow(/Invalid model filename|Path traversal/);
    });
  });
});
