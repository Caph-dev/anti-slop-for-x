import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: '.',
  entrypointsDir: 'entrypoints',
  publicDir: 'public',
  outDir: '.output',
  manifestVersion: 3,
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    version: '0.1.0',
    permissions: ['storage', 'activeTab'],
    host_permissions: [
      'https://x.com/*',
      'https://twitter.com/*',
      'http://127.0.0.1/*',
      'http://localhost/*',
    ],
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
    action: {
      default_title: '__MSG_extName__',
    },
    icons: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
  },
});
