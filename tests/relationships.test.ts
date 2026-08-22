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

    it('should resolve hasOne relationship from a string reference', async () => {
      class Profile extends ActiveRecord<any> {
        static tableName = 'profiles';
      }

      class User extends ActiveRecord<any> {
        static tableName = 'users';
        static hasOne = {
          profile: 'profiles'
        };
      }

      const registry = new Map<string, any>();
      registry.set('users', User);
      registry.set('profiles', Profile);
      User.setModelRegistry(registry);
      Profile.setModelRegistry(registry);

      const profile = Object.create(Profile.prototype);
      Object.assign(profile, { id: 'profile-1', usersId: 'user-1' });
      vi.spyOn(Profile, 'where').mockReturnValue({ first: vi.fn().mockResolvedValue(profile) } as any);

      const user = Object.create(User.prototype);
      Object.assign(user, { id: 'user-1' });
      (ActiveRecord as any)._defineRelationshipAccessors(user);

      const result = await user.profile;
      expect(Profile.where).toHaveBeenCalledWith('usersId', 'user-1');
      expect(result).toBe(profile);
    });

    it('should throw error for undefined hasOne relationship', async () => {
      class User extends ActiveRecord<any> {
        static tableName = 'users';
        static hasOne = {};
      }

      const user = Object.create(User.prototype);
      Object.assign(user, { id: 'user-1' });

      await expect(user.hasOne('nonexistent')).rejects.toThrow(
        'Relationship nonexistent not defined in hasOne'
      );
    });

    it('should throw error for unregistered string reference in hasOne', async () => {
      class User extends ActiveRecord<any> {
        static tableName = 'users';
        static hasOne = {
          profile: 'profiles'
        };
      }

      User.setModelRegistry(new Map());

      const user = Object.create(User.prototype);
      Object.assign(user, { id: 'user-1' });

      await expect(user.hasOne('profile')).rejects.toThrow(
        'Relationship profile references unknown table "profiles"'
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

    it('should resolve hasMany relationship from a string reference', async () => {
      class Post extends ActiveRecord<any> {
        static tableName = 'posts';
      }

      class User extends ActiveRecord<any> {
        static tableName = 'users';
        static hasMany = {
          posts: 'posts'
        };
      }

      const registry = new Map<string, any>();
      registry.set('users', User);
      registry.set('posts', Post);
      User.setModelRegistry(registry);
      Post.setModelRegistry(registry);

      const posts = [
        Object.assign(Object.create(Post.prototype), { id: 'post-1', usersId: 'user-1' })
      ];
      vi.spyOn(Post, 'where').mockReturnValue({ all: vi.fn().mockResolvedValue(posts) } as any);

      const user = Object.create(User.prototype);
      Object.assign(user, { id: 'user-1' });

      const result = await user.hasMany('posts');
      expect(Post.where).toHaveBeenCalledWith('usersId', 'user-1');
      expect(result).toBe(posts);
    });

    it('should throw error for undefined hasMany relationship', async () => {
      class User extends ActiveRecord<any> {
        static tableName = 'users';
        static hasMany = {};
      }

      const user = Object.create(User.prototype);
      Object.assign(user, { id: 'user-1' });

      await expect(user.hasMany('nonexistent')).rejects.toThrow(
        'Relationship nonexistent not defined in hasMany'
      );
    });

    it('should throw error for unregistered string reference in hasMany', async () => {
      class User extends ActiveRecord<any> {
        static tableName = 'users';
        static hasMany = {
          posts: 'posts'
        };
      }

      User.setModelRegistry(new Map());

      const user = Object.create(User.prototype);
      Object.assign(user, { id: 'user-1' });

      await expect(user.hasMany('posts')).rejects.toThrow(
        'Relationship posts references unknown table "posts"'
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
      Object.assign(post, { id: 'post-1' });

      await expect(post.belongsTo('nonexistent')).rejects.toThrow(
        'Relationship nonexistent not defined in belongsTo'
      );
    });

    it('should resolve belongsTo relationship from a string reference', async () => {
      class User extends ActiveRecord<any> {
        static tableName = 'users';
      }

      class Post extends ActiveRecord<any> {
        static tableName = 'posts';
        static belongsTo = {
          author: 'users'
        };
      }

      const registry = new Map<string, any>();
      registry.set('users', User);
      registry.set('posts', Post);
      User.setModelRegistry(registry);
      Post.setModelRegistry(registry);

      const author = Object.assign(Object.create(User.prototype), { id: 'user-1' });
      vi.spyOn(User, 'find').mockResolvedValue(author);

      const post = Object.create(Post.prototype);
      Object.assign(post, { id: 'post-1', authorId: 'user-1' });

      const result = await post.belongsTo('author');
      expect(User.find).toHaveBeenCalledWith('user-1');
      expect(result).toBe(author);
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
      Object.assign(post, { id: 'post-1', authorId: undefined });

      const result = await post.belongsTo('author');
      expect(result).toBeNull();
    });

    it('should throw error for unregistered string reference in belongsTo', async () => {
      class Post extends ActiveRecord<any> {
        static tableName = 'posts';
        static belongsTo = {
          author: 'users'
        };
      }

      Post.setModelRegistry(new Map());

      const post = Object.create(Post.prototype);
      Object.assign(post, { id: 'post-1', authorId: 'user-1' });

      await expect(post.belongsTo('author')).rejects.toThrow(
        'Relationship author references unknown table "users"'
      );
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
      Object.assign(user, { id: 'user-1' });
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
      Object.assign(user, { id: 'user-1' });
      (ActiveRecord as any)._defineRelationshipAccessors(user);

      const spy = vi.spyOn(user, 'hasOne').mockResolvedValue({ id: 'profile-1' });
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
      Object.assign(user, { id: 'user-1' });
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
      Object.assign(user, { id: 'user-1' });
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
      Object.assign(post, { id: 'post-1', authorId: 'author-1' });
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
      Object.assign(post, { id: 'post-1', authorId: 'author-1' });
      (ActiveRecord as any)._defineRelationshipAccessors(post);

      const spy = vi.spyOn(post, 'belongsTo').mockResolvedValue({ id: 'author-1' });
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
      Object.assign(user, { id: 'user-1', posts: 'already-set' });
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
      Object.assign(post, { id: 'post-1', authorId: undefined });
      (ActiveRecord as any)._defineRelationshipAccessors(post);

      const result = await post.belongsTo('author');
      expect(result).toBeNull();
    });
  });
});
