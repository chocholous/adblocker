import { defineConfig } from 'wxt';

// WXT generates manifest.json from this config + the entrypoints/ folder.
// Docs: https://wxt.dev/guide/essentials/config/manifest.html
export default defineConfig({
  manifest: {
    name: 'Stealth Content Hider',
    description:
      'Cosmetic content filtering: let pages load, then suppress unwanted elements in your own view.',
    version: '0.1.0',
    // Icons live in public/icon/. WXT auto-detects the top-level `icons` map
    // (shown in chrome://extensions); we also set action.default_icon so the
    // generated icons render in the browser toolbar.
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: {
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    permissions: ['storage', 'scripting', 'declarativeNetRequest', 'activeTab'],
    host_permissions: ['<all_urls>'],
    // Static network-level rules (trackers/telemetry). Cosmetic hiding is done
    // in the content scripts, NOT here — see docs/architecture.md.
    declarative_net_rules: {
      rule_resources: [
        {
          id: 'ruleset_trackers',
          enabled: true,
          path: 'rules.json',
        },
      ],
    },
  },
});
