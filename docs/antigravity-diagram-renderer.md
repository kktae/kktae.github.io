# Antigravity diagram renderer compatibility

This project uses a clean-room renderer for Mermaid DSL input. It does not bundle or call Mermaid.js.

Compatibility target: **Antigravity 2.15.1**.

## Supported diagram families

- `flowchart` / `graph`
- `stateDiagram-v2` (and the renderer's `stateDiagram` alias)
- `sequenceDiagram`
- `classDiagram`
- `erDiagram`
- `xychart-beta` (and `xychart`)

The renderer owns parsing, text measurement, layout data, SVG geometry and SVG serialization. Flow/state/class/ER use the vendored ELK compatibility engine where Antigravity does; sequence and XY use project-owned coordinate/layout logic.

## Core renderer options

The Antigravity-compatible API accepts:

- palette: `bg`, `fg`, `line`, `accent`, `muted`, `surface`, `border`
- `font`
- `transparent`
- `interactive` for XY charts
- flow/state layout: `padding`, `nodeSpacing`, `layerSpacing`

Antigravity accepts `mergeEdges` and `thoroughness` in the options object but its current 2.15.1 implementation later reads fixed defaults for those two values. The compatibility renderer intentionally preserves that behavior.

## Module boundaries

- `renderer.mjs` is the facade and diagram-family dispatcher.
- `common.mjs` owns text measurement, escaping, palette/theme SVG helpers and style parsing.
- `geometry.mjs` owns reusable polyline geometry and SVG line serialization.
- Each diagram-family module owns its parser, layout adapter and family-specific SVG structures.
- `state.mjs` deliberately reuses the flowchart layout and SVG renderer instead of duplicating them.

`renderAntigravityDiagram()` is the strict compatibility API and always preserves Antigravity geometry. `renderDiagram()` is the site-facing presentation API. The site may opt into presentation-only features such as `edgeCornerRadius`; these do not change the compatibility API or its golden hashes.

## Verification

Compatibility is tested without checking proprietary Antigravity source or generated SVG files into this repository.

`tests/fixtures/antigravity-diagram-corpus.json` stores only:

- test Mermaid DSL
- renderer options
- expected SHA-256 of SVG output, or expected error text

The golden values were recorded from the installed Antigravity 2.15.1 renderer during clean-room differential testing.

The checked-in compatibility corpus contains 466 explicit syntax/options/error cases across every supported family. During the port, an additional fixed-seed 600-case mixed differential fuzz corpus also matched the Antigravity renderer 600/600 byte-for-byte. Runtime tests additionally render every Mermaid block currently published by this site.

The vendored `elkjs 0.9.3` file is byte-pinned by SHA-256 because its behavior matches the ELK option set and layout results used by the target renderer.
