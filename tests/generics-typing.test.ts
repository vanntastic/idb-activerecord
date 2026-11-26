import { describe, it, expect, beforeEach } from 'vitest';
import { ActiveRecord, QueryBuilder } from '../src/index.js';
import { MockIDBDatabase } from './mocks/indexeddb.js';

describe('Strict TypeScript Static Generics & Polymorphic This Typing', () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = new MockIDBDatabase('test-db', 1);
    mockDb.createObjectStore('typed_users', { keyPath: 'id' });
    mockDb.createObjectStore('untyped_posts', { keyPath: 'id' });
    ActiveRecord.defaults = {};
  });

  it('supports strongly typed subclasses with polymorphic this types', async () => {
    class TypedUser extends ActiveRecord<TypedUser> {
      static tableName = 'typed_users';
      name!: string;
      email!: string;
    }

    TypedUser.setDatabase(mockDb);

    // Create returns InstanceType<M> -> TypedUser
    const user: TypedUser = await TypedUser.create({
      name: 'Alice',
      email: 'alice@example.com'
    });
    expect(user).toBeInstanceOf(TypedUser);
    expect(user.name).toBe('Alice');

    // Find returns Promise<TypedUser | null>
    const found: TypedUser | null = await TypedUser.find(user.id!);
    expect(found).toBeInstanceOf(TypedUser);
    expect(found!.email).toBe('alice@example.com');

    // All returns Promise<TypedUser[]>
    const allUsers: TypedUser[] = await TypedUser.all();
    expect(allUsers).toHaveLength(1);
    expect(allUsers[0]).toBeInstanceOf(TypedUser);

    // Where returns QueryBuilder<TypedUser>
    const qb: QueryBuilder<TypedUser> = TypedUser.where('name', 'Alice');
    const firstUser: TypedUser | null = await qb.first();
    expect(firstUser).toBeInstanceOf(TypedUser);

    const queryResults: TypedUser[] = await qb.all();
    expect(queryResults).toHaveLength(1);
    expect(queryResults[0]).toBeInstanceOf(TypedUser);
  });

  it('supports untyped JavaScript/TypeScript subclasses without errors', async () => {
    class UntypedPost extends ActiveRecord {
      static tableName = 'untyped_posts';
    }

    UntypedPost.setDatabase(mockDb);

    const post = await UntypedPost.create({ title: 'Untyped Post' });
    expect(post).toBeInstanceOf(UntypedPost);
    expect(post.title).toBe('Untyped Post');

    const posts = await UntypedPost.where('title', 'like', '%Post%').all();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toBeInstanceOf(UntypedPost);
  });
});
