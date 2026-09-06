# Vendored Lenis

Smooth scrolling. Downloaded and served from our own origin so the page keeps
`script-src 'self'` and still works with no internet on the serving machine.

**Do not edit these files.** To change version, re-download both and update the version
and hashes below.

- Version: **1.3.26**
- Source: `https://cdn.jsdelivr.net/npm/lenis@1.3.26/dist/<name>`
- Retrieved: 2026-09-05
- Upstream: <https://github.com/darkroomengineering/lenis>
- Licence: MIT

| File | Bytes | SHA-256 |
|---|---:|---|
| lenis.min.js | 18,722 | `53195c9797e7ce7bf9d7fa9242b08209e57f46de4c9dac126a6494fa780e3346` |
| lenis.css | 513 | `2f668ae84a668327f246faf8a770383a2bf69196d214290fbc4d5548910606c5` |

## Why this library and not a CSS one-liner

`scroll-behavior: smooth` only smooths *programmatic* jumps — anchor links and
`scrollIntoView`. It does nothing for the wheel or a trackpad, which is the thing being
asked for. Lenis interpolates the actual scroll position frame by frame.

## Accessibility

Lenis honours `prefers-reduced-motion` **by default**: smoothing is disabled, programmatic
scrolls jump instantly, and the preference is picked up live without a reload. `app.js`
additionally refuses to start it on coarse-pointer devices, because native momentum
scrolling on a phone is better than anything a library can fake.

Verify with:

    sha256sum public/vendor/lenis/*
