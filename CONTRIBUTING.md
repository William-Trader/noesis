# Contributing

Thanks for considering a contribution. Noesis aims to stay **small, dependency-free and boring**.

## Ground rules

- **No runtime dependencies.** Everything must run on plain Node ESM (`>=18`). Dev-only tooling is fine if optional.
- **Keep the format stable or version it.** If you change the index bytes, bump `VERSION` in `src/index.mjs` and update `docs/SPEC.md`.
- **Tests first.** `node --test` must pass; add cases for new behaviour.
- **Measure, don't claim.** Performance statements must be reproducible with `node bench/benchmark.mjs N`.

## Workflow

```bash
git checkout -b feat/short-name
# make changes
node --test
node bench/benchmark.mjs 2000
git commit -m "feat: ..."
```

## Code style

- 2-space indent, LF, UTF-8 (see `.editorconfig`).
- ESM only; named exports; no default exports in `src/`.
- Prefer clarity over cleverness; keep functions small and pure where possible.

## Reporting bugs

Include your Node version, the command you ran, the expected vs actual result, and (if relevant) a minimal vault that reproduces it. Do not paste secrets.
