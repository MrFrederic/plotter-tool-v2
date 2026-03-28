# Visual QA Checklist — FictionUI Terminal Overhaul

## 1. Accent Use
Verify the amber/cyan/color hierarchy is applied correctly:
- [ ] Primary accent (amber `#e8960a`) used for: panel titles, toolbar label, active button borders, running-state indicators
- [ ] Secondary accent (cyan `#00ccdd`) used for: edge paths, CACHED status, selected node borders (check CustomNode selected state uses amber, not cyan — this was changed)
- [ ] Magenta restricted to EndNode identity only
- [ ] Green (`#2ea86e`) used only for StartNode identity and DONE status
- [ ] Red (`#cc2244`) used only for ERROR status
- [ ] No accent colors appear on data content surfaces (preview image area, text content, gcode canvas)

## 2. Exclusion Zones (No-Distortion Surfaces)
Verify these surfaces are clean and free from CRT, glitch, or distortion effects:
- [ ] RasterViewer: image renders without any filter or overlay
- [ ] SvgViewer: SVG renders without any filter or overlay
- [ ] VectorViewer: vector content renders clean
- [ ] GCodeViewer: gcode renders clean
- [ ] TextViewer: text content renders without text-shadow or distortion
- [ ] OtherViewer: fallback content renders clean
- [ ] PreviewWindow content area (`.preview-window__content`): no animation or filter effects
- [ ] Graph canvas (`.node-editor` background): dots/grid pattern only, no scanline overlay
- [ ] ConfigPanel form fields: no decorative effects on inputs or labels
- [ ] TelemetryPanel log entries: plain legible text, no distortion

## 3. Motion Policy
Verify motion is restricted to chrome-only areas and respects reduced-motion preference:
- [ ] ScanlineOverlay animation is off under `prefers-reduced-motion: reduce`
- [ ] GlitchText scramble effect skipped under `prefers-reduced-motion: reduce`
- [ ] `pulseGlow` / `bracketPulse` animations (running indicator, toolbar active) stop under reduced-motion
- [ ] CustomNode running/waiting border pulse stops under reduced-motion
- [ ] CustomEdge animated stripe hidden under reduced-motion
- [ ] PreviewWindow zoom-in entry animation off under reduced-motion (from base CSS)
- [ ] No animation whatsoever on: form fields, log text, port labels, image/SVG viewers

## 4. Easter Egg Density and Placement
Verify decorative lore marks are within policy limits:
- [ ] `PLT/DAG/v2` stamp visible on graph canvas at ~4% opacity (barely perceptible)
- [ ] `OUT/0x00` stamp appears in PreviewWindow titlebar at ~15% opacity (faint)
- [ ] `CFG` stamp visible in ConfigPanel header at ~8% opacity (very faint)
- [ ] Barcode stripe visible in Toolbar left group (dense variant, ≤12% opacity)
- [ ] Barcode stripe visible in TelemetryPanel header (standard variant, ≤12% opacity)
- [ ] All easter-egg elements have `aria-hidden="true"` — confirmed by inspecting DOM
- [ ] No easter-egg element covers any interactive control or label
- [ ] No easter-egg element is required to understand or operate any feature

## 5. Accessibility Checks
- [ ] Text contrast: all primary labels (`--text-primary: #b8b8c4` on `--bg-panel: #0c0c14`) — check WCAG AA (should pass ~7:1)
- [ ] Amber accent text (`--accent-amber: #e8960a` on dark bg) — acceptable for non-body text (UI labels ≥11px)
- [ ] Focus states visible on: buttons, inputs, select, textarea (amber border + no box-shadow removed)
- [ ] All status states use shape+color encoding (not color alone): IDLE=○, WAITING=◌, RUNNING=▶, DONE=■, ERROR=✕, CACHED=◈
- [ ] All decal/barcode elements reported as aria-hidden — do not appear in accessibility tree
- [ ] Keyboard navigation works: Tab through toolbar buttons, config panel inputs, sidebar items

## 6. Functional Regression Checks
Verify no functional behavior was changed:
- [ ] Graph drag/drop: dragging nodes from NodeInventory to canvas works
- [ ] Graph connect: clicking and dragging a handle creates an edge
- [ ] Graph select: clicking a node selects it (amber border appearance is now expected)
- [ ] Graph delete: selecting and pressing Delete/Backspace removes nodes/edges
- [ ] Context menu: right-click on node/edge shows context menu
- [ ] Execute pipeline: clicking Execute button triggers execution, toolbar shows amber active state
- [ ] TelemetryPanel: live log updates appear during execution with correct symbols (▶ RUNNING, ■ DONE, ✕ ERROR, ◈ CACHED)
- [ ] ConfigPanel: opening a node config shows form fields, inputs accept changes
- [ ] Preview window: clicking an output port or edge opens preview, close button works
- [ ] WebSocket: status updates propagate correctly (check node border colors change during execution)

## Token Quick Reference

| Token | Value | Usage |
|-------|-------|-------|
| `--accent-amber` | `#e8960a` | Primary chrome accent, titles, active states |
| `--accent-cyan` | `#00ccdd` | Data flow edges, cached status, selection (secondary) |
| `--accent-magenta` | `#cc0088` | EndNode identity only |
| `--status-done` | `#2ea86e` | Done state, StartNode identity |
| `--status-error` | `#cc2244` | Error state |
| `--status-running` | `#e8960a` | Running/waiting state (= amber) |
| `--status-cached` | `#00ccdd` | Cached state (= cyan) |
| `--text-primary` | `#b8b8c4` | Body text |
| `--bg-panel` | `#0c0c14` | Default panel surface |
| `--border-glow` | `rgba(232,150,10,0.18)` | Amber-tinted ambient border glow |
| Max barcode opacity | `0.18` | Hard cap on all `.fui-barcode` elements |
| Max easter egg opacity | `0.15` | Hard cap on all `::after` lore stamps |
