# pi-ext-opencode-go-catalog

**繁體中文** | [English](README.en.md)

A **Pi extension** that takes over the `opencode-go` model catalog when Pi / Pi-Web builds its model
runtime, solving two problems:

1. **Show the model IDs upstream renamed to** (e.g. `space-bunny`, which replaces an ID still present in
   Pi's bundled static catalog).
2. **Hide retired IDs** (e.g. `space-bunny-free`) that Pi's bundled static catalog keeps listing and that
   users cannot remove on their own.

> Pi's model list has three layers: the **bundled static catalog** (`@earendil-works/pi-ai`) ∪ the
> **pi.dev overlay** (`models-store.json`) ∪ **`~/.pi/agent/models.json`**. The core overlay can only
> **add** entries, so without this extension both `space-bunny` and the retired `space-bunny-free` show up.
> **Only taking over the provider registration can trim the bundled leftovers.**

> Model **capabilities / cost / context** accuracy is owned by a separate component:
> [pi-opencode-go-models](https://github.com/terrydada-art/pi-opencode-go-models).
> Their versions are independent (this extension v1.1.0 ≠ that skill's v1.2.0).

---

## How it works

```text
getModels() = bundled static catalog (trimmed by the live subscription catalog)
            ∪ pi.dev overlay (every non-bundled ID from the store that is still live)
            ∪ gpt-*-luna additions templated from gpt-5.6-luna

refreshModels() = restore the full overlay from the store
                → if online and a key is available, query the live /v1/models
                → persist the merged list (keeping lastModified / etag so pi.dev can 304)
```

- Source: `https://opencode.ai/zen/go/v1/models`, using the `opencode-go` credential in `auth.json`.
- Live queries time out after 10 s and fall back to conservative behaviour (no trimming); Pi startup is
  never blocked.
- Only Pi's provider catalog store persist API writes `models-store.json`; **`models.json` and
  `auth.json` are never touched**.

---

## Installation

### A. Manual (recommended)

```bash
mkdir -p ~/.pi/agent/extensions/pi-ext-opencode-go-catalog
cp index.ts package.json ~/.pi/agent/extensions/pi-ext-opencode-go-catalog/
```

Restart Pi / Pi-Web afterwards.

### B. Versioned directory

```bash
mkdir -p ~/.pi/agent/extensions/pi-ext-opencode-go-catalog-1.1.0
cp index.ts package.json ~/.pi/agent/extensions/pi-ext-opencode-go-catalog-1.1.0/
```

> Pi scans direct `*.ts` / `*.js` files under `~/.pi/agent/extensions/` plus any subdirectory containing
> `index.ts` / `index.js`.

`package.json` declares `@earendil-works/pi-ai`; it normally resolves to the runtime's own copy, so you do
not need to vendor `node_modules` inside the extension directory.

---

## Verification

```bash
# Expect only space-bunny (no space-bunny-free)
pi --list-models opencode-go
```

Sample output (Pi 1.0.2):

```text
provider     model        context  max-out  thinking  images
opencode-go  space-bunny  1.0M     524.3K   yes       yes
```

You can also confirm the model is callable:

```bash
pi -p --model opencode-go/space-bunny "Reply exactly: OK"
```

---

## Measured comparison (2026-10-08, Pi 1.0.2)

| State | `space-bunny` | `space-bunny-free` |
| --- | --- | --- |
| No extension at all (core overlay only) | shown | **still shown** |
| Old v1.0.0 extension | **gone** | shown |
| **v1.1.0 (this version)** | shown | **hidden** |

---

## Important limitations

1. **Only one extension may register a given provider.** If another extension also calls
   `pi.registerProvider` for `opencode-go`, the two conflict, Pi falls back to its bundled static catalog,
   and it looks like "the extension does nothing and retired IDs are back". Keep this extension the only
   one registering that provider.
2. When offline, or when the live catalog query fails, the extension falls back to conservative
   behaviour (no trimming); retired IDs may reappear until connectivity returns.
3. A model being listed does **not** guarantee it is callable. Availability and capability evidence live in
   [pi-opencode-go-models](https://github.com/terrydada-art/pi-opencode-go-models).

---

## Disabling

```powershell
Rename-Item "$env:USERPROFILE\.pi\agent\extensions\pi-ext-opencode-go-catalog\index.ts" "index.ts.disabled"
```

After disabling, Pi falls back to its core overlay: `space-bunny` still appears, but the retired
`space-bunny-free` shows up again.

---

## Security design

- Never writes `auth.json` or `models.json`; the API key stays in memory and is never printed or logged.
- Remote overlay updates go exclusively through Pi's provider catalog store persist API.
- Upstream failures never block Pi startup (graceful degradation).

---

## Version history

| Version | Notes |
| --- | --- |
| **v1.1.0** (current) | Preserves the whole pi.dev overlay (not just `gpt-*-luna`) and trims bundled entries using the live catalog (hides retired IDs) |
| v1.0.0 | Initial release: only added `gpt-*-luna` models dynamically. **Archived** (it replaced the core overlay, making renamed IDs disappear) |

v1.0.0 is archived at <https://github.com/terrydada-art/pi-opencode-go-live-catalog> (read-only on GitHub).

---

## License

MIT — see [LICENSE](LICENSE).
