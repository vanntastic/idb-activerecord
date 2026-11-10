import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'IDB ActiveRecord',
  description: 'An ActiveRecord-style API for IndexedDB',
  base: '/idb-activerecord/',
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Sync', link: '/sync/overview' },
      { text: 'Examples', link: '/examples' }
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Models and Relationships', link: '/guide/models' },
          { text: 'Querying', link: '/guide/querying' },
          { text: 'Migrations and Schema', link: '/guide/migrations' },
          { text: 'Validation', link: '/guide/validation' },
          { text: 'Callbacks', link: '/guide/callbacks' },
          { text: 'Transactions', link: '/guide/transactions' }
        ]
      },
      {
        text: 'Sync',
        items: [
          { text: 'Overview', link: '/sync/overview' },
          { text: 'Turso Adapter', link: '/sync/turso-adapter' },
          { text: 'SQLite Adapter', link: '/sync/sqlite-adapter' },
          { text: 'Sync Server', link: '/sync/sync-server' },
          { text: 'Conflict Resolution', link: '/sync/conflict-resolution' },
          { text: 'Custom Adapters', link: '/sync/custom-adapters' }
        ]
      },
      { text: 'Examples', link: '/examples' }
    ],
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/vanntastic/idb-activerecord' }
    ]
  }
});
