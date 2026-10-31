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
    version: '0.3.0',
    permissions: ['storage', 'activeTab'],
    // The upstream is whatever the user configures (BYOK), so host access is
    // requested at runtime from the options page via optional_host_permissions.
    optional_host_permissions: ['https://*/*'],
    host_permissions: [
      // Built-in endpoint presets work with no extra prompt; `custom` base URLs
      // go through optional_host_permissions + a runtime request.
      'https://api.typesafe.ai/*',
      'https://api.openai.com/*',
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
