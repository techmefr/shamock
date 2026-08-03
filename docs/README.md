# chaff docs

Documentation site for [`chaff`](..) — built with [Astro](https://astro.build) + [Starlight](https://starlight.astro.build).

## Develop

```bash
pnpm --filter docs dev
```

## Build

```bash
pnpm --filter docs build
```

Static output goes to `docs/dist`.

## Deploy

Pushes to `main` that touch `docs/**` are built and deployed to GitHub Pages automatically by [`.github/workflows/docs.yml`](../.github/workflows/docs.yml). Live at `https://techmefr.github.io/chaff/` (base path `/chaff`, set in `astro.config.mjs`).
