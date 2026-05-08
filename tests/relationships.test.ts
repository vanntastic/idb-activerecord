import { describe, it, expect } from 'vitest';
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
});
