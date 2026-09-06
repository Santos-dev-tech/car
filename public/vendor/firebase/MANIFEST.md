# Vendored Firebase SDK

Downloaded from Google's official CDN and served from our own origin, so the page keeps
`script-src 'self'` and still works with no internet on the machine serving it.

**Do not edit these files.** To change version, re-download all four together and update
both the version and every hash below — a mixed-version set fails at runtime in ways that
are hard to read.

- Version: **11.6.0**
- Source: `https://www.gstatic.com/firebasejs/11.6.0/<name>.js`
- Retrieved: 2026-09-05
- Build: `-compat` (UMD). The modular ESM build needs a bundler or an import map;
  MotoKE is plain `<script>` tags, so compat is the one that actually loads.

| File | Bytes | SHA-256 |
|---|---:|---|
| firebase-app-compat.js | 31,771 | `902b2c80b0faa840a65b5dc6563ff126e464c22c6abe1242c50e53bc545da1bf` |
| firebase-auth-compat.js | 141,089 | `cc2744032ac1c56f7a0f6db0bec2488772cf62eb87f5367dbe3ed6271a6454a7` |
| firebase-firestore-compat.js | 339,109 | `41cd9763c07883170b463fe4bbcd0b75477a36252fb840ad350f81927212c584` |
| firebase-storage-compat.js | 39,749 | `1b4221957b4ba90d221940636f1ea3f2c05cba01d2232ef4bf752312a83fda29` |

Verify with:

    sha256sum public/vendor/firebase/*.js

`tools/audit.js` checks these hashes on every run. If one changes and the manifest does
not, the audit fails — that is the point.
