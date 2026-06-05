import { describe, it, expect, vi } from 'vitest';
import { ActiveRecord } from '../src/activerecord';

describe('ActiveRecord Relationships', () => {
  describe('hasOne', () => {
    it('should define hasOne relationship', () => {
      class Profile extends ActiveRecord<any> {
        static tableName = 'profiles';
      }

      class User extends ActiveRecord<any> {
        static tableName = 'users';
        static hasOne = {
          profile: Profile
        };
      }

      expect((User as any).hasOne.profile).toBe(Profile);
    });

    it('should throw error for undefined hasOne relationship', async () => {
      class User extends ActiveRecord<any> {
        static tableName = 'users';
        static hasOne = {};
      }

      const user = Object.create(User.prototype);
      Object.assign(user, { id: 1 });

      await expect(user.hasOne('nonexistent')).rejects.toThrow(
        'Relationship nonexistent not defined in hasOne'
      );
    });
  });

  describe('hasMany', () => {
    it('should define hasMany relationship', () => {
      class Post extends ActiveRecord<any> {
        static tableName = 'posts';
      }

      class User extends ActiveRecord<any> {
        static tableName = 'users';
        static hasMany = {
          posts: Post
        };
      }

      expect((User as any).hasMany.posts).toBe(Post);
    });

    it('should throw error for undefined hasMany relationship', async () => {
      class User extends ActiveRecord<any> {
        static tableName = 'users';
        static hasMany = {};
      }

      const user = Object.create(User.prototype);
      Object.assign(user, { id: 1 });

      await expect(user.hasMany('nonexistent')).rejects.toThrow(
        'Relationship nonexistent not defined in hasMany'
      );
    });
  });

  describe('belongsTo', () => {
    it('should define belongsTo relationship', () => {
      class User extends ActiveRecord<any> {
        static tableName = 'users';
      }

      class Post extends ActiveRecord<any> {
        static tableName = 'posts';
        static belongsTo = {
          author: User
        };
      }

      expect((Post as any).belongsTo.author).toBe(User);
    });

    it('should throw error for undefined belongsTo relationship', async () => {
      class Post extends ActiveRecord<any> {
        static tableName = 'posts';
        static belongsTo = {};
      }

      const post = Object.create(Post.prototype);
      Object.assign(post, { id: 1 });

      await expect(post.belongsTo('nonexistent')).rejects.toThrow(
        'Relationship nonexistent not defined in belongsTo'
      );
    });

    it('should return null when foreign key is missing', async () => {
      class User extends ActiveRecord<any> {
        static tableName = 'users';
      }

      class Post extends ActiveRecord<any> {
        static tableName = 'posts';
        static belongsTo = {
          author: User
        };
      }

      const post = Object.create(Post.prototype);
      Object.assign(post, { id: 1, authorId: undefined });

      const result = await post.belongsTo('author');
      expect(result).toBeNull();
    });
  });

  describe('property accessor syntax (Rails-style)', () => {
    it('should define a getter for hasOne relationships', () => {
      class Profile extends ActiveRecord<any> {
        static tableName = 'profiles';
      }

      class User extends ActiveRecord<any> {
        static tableName = 'users';
        static hasOne = { profile: Profile };
      }

      const user = Object.create(User.prototype);
      Object.assign(user, { id: 1 });
      (ActiveRecord as any)._defineRelationshipAccessors(user);

      const descriptor = Object.getOwnPropertyDescriptor(user, 'profile');
      expect(descriptor).toBeDefined();
      expect(typeof descriptor!.get).toBe('function');
    });

    it('should proxy user.profile to hasOne("profile")', () => {
      class Profile extends ActiveRecord<any> {
        static tableName = 'profiles';
      }

      class User extends ActiveRecord<any> {
        static tableName = 'users';
        static hasOne = { profile: Profile };
      }

      const user = Object.create(User.prototype);
      Object.assign(user, { id: 1 });
      (ActiveRecord as any)._defineRelationshipAccessors(user);

      const spy = vi.spyOn(user, 'hasOne').mockResolvedValue({ id: 10 });
      void user.profile;
      expect(spy).toHaveBeenCalledWith('profile');
    });

    it('should define a getter for hasMany relationships', () => {
      class Post extends ActiveRecord<any> {
        static tableName = 'posts';
      }

      class User extends ActiveRecord<any> {
        static tableName = 'users';
        static hasMany = { posts: Post };
      }

      const user = Object.create(User.prototype);
      Object.assign(user, { id: 1 });
      (ActiveRecord as any)._defineRelationshipAccessors(user);

      const descriptor = Object.getOwnPropertyDescriptor(user, 'posts');
      expect(descriptor).toBeDefined();
      expect(typeof descriptor!.get).toBe('function');
    });

    it('should proxy user.posts to hasMany("posts")', () => {
      class Post extends ActiveRecord<any> {
        static tableName = 'posts';
      }

      class User extends ActiveRecord<any> {
        static tableName = 'users';
        static hasMany = { posts: Post };
      }

      const user = Object.create(User.prototype);
      Object.assign(user, { id: 1 });
      (ActiveRecord as any)._defineRelationshipAccessors(user);

      const spy = vi.spyOn(user, 'hasMany').mockResolvedValue([]);
      void user.posts;
      expect(spy).toHaveBeenCalledWith('posts');
    });

    it('should define a getter for belongsTo relationships', () => {
      class User extends ActiveRecord<any> {
        static tableName = 'users';
      }

      class Post extends ActiveRecord<any> {
        static tableName = 'posts';
        static belongsTo = { author: User };
      }

      const post = Object.create(Post.prototype);
      Object.assign(post, { id: 1, authorId: 2 });
      (ActiveRecord as any)._defineRelationshipAccessors(post);

      const descriptor = Object.getOwnPropertyDescriptor(post, 'author');
      expect(descriptor).toBeDefined();
      expect(typeof descriptor!.get).toBe('function');
    });

    it('should proxy post.author to belongsTo("author")', () => {
      class User extends ActiveRecord<any> {
        static tableName = 'users';
      }

      class Post extends ActiveRecord<any> {
        static tableName = 'posts';
        static belongsTo = { author: User };
      }

      const post = Object.create(Post.prototype);
      Object.assign(post, { id: 1, authorId: 2 });
      (ActiveRecord as any)._defineRelationshipAccessors(post);

      const spy = vi.spyOn(post, 'belongsTo').mockResolvedValue({ id: 2 });
      void post.author;
      expect(spy).toHaveBeenCalledWith('author');
    });

    it('should not override an existing own property on the instance', () => {
      class Post extends ActiveRecord<any> {
        static tableName = 'posts';
      }

      class User extends ActiveRecord<any> {
        static tableName = 'users';
        static hasMany = { posts: Post };
      }

      const user = Object.create(User.prototype);
      Object.assign(user, { id: 1, posts: 'already-set' });
      (ActiveRecord as any)._defineRelationshipAccessors(user);

      expect(user.posts).toBe('already-set');
    });

    it('backward compat: explicit method calls still work after accessors are defined', async () => {
      class User extends ActiveRecord<any> {
        static tableName = 'users';
      }

      class Post extends ActiveRecord<any> {
        static tableName = 'posts';
        static belongsTo = { author: User };
      }

      const post = Object.create(Post.prototype);
      Object.assign(post, { id: 1, authorId: undefined });
      (ActiveRecord as any)._defineRelationshipAccessors(post);

      const result = await post.belongsTo('author');
      expect(result).toBeNull();
    });
  });
});
