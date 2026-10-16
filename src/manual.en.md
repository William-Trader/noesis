
---

# Library manual (English)

**What it is** — a portable asset library: plain-text Markdown notes, a derived index (safe to delete, it rebuilds itself), numbered folders. Any agent can take over the whole folder, with no dependency on the machine it came from.

**Where it lives** — `{{ROOT}}` on volume `{{VOLUME}}` ({{FREE}}), host `{{HOST}}`.

**Open it** — double-click `_资产库检索.command` in the library root, or run `node {{NOESIS}}/bin/noesis.mjs ui "{{ROOT}}"`. The UI has a ZH/EN toggle.

**Back up / take it away** —

```bash
rsync -a --delete "{{ROOT}}/" "/Volumes/<drive>/openclaw资产库/"   # plain copy, source untouched
node {{NOESIS}}/bin/noesis.mjs library pack "{{ROOT}}"             # handover bundle, skips rebuildable weight
```

**Recover files** — every reorganisation writes `_重组映射表-<date>.csv`; reverse it with `noesis library undo "{{ROOT}}" <csv>` (add `--dry` first to preview).

**Traceability** — key actions are appended to `_库志.jsonl` (append-only): `noesis library log "{{ROOT}}" --tail 20`.

**Moving to another drive or machine** — copy the folder, run `library home` at the new path, then `ui`; the index rebuilds itself.

**For the next agent** — ask the user which drive the library should live on before touching anything (`library volumes` lists candidates), record it with `library home --set`, then hand the user this manual. Prefer the hot `ui` search and `library check` over full rescans.
