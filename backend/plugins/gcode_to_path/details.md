**G-Code to Path** parses an incoming G-code program and reconstructs its XY motion as internal PATH objects, the pipeline's canonical geometry format. Use this node to route legacy machine files into the pipeline for geometry inspection, path-based editing, or round-trip conversion workflows.

# G-Code to Path

This node ingests a raw G-code program and reconstructs its XY motion as PATH objects — the pipeline's canonical geometry format. Feed it legacy machine files to inspect geometry, route segments through path-based filters, or prepare a round-trip edit before re-exporting. Non-motion commands are silently ignored; only XY drawing moves are processed.

## Supported Commands

| Command | G-code Meaning | PATH Effect |
|---|---|---|
| `G0` | Rapid move (pen up / travel) | Ends current path; begins a new boundary |
| `G1` | Linear move (pen down) | Appends a line segment to the active path |
| `G2` | Clockwise arc | Appends a CW arc segment (falls back to line if geometry is invalid) |
| `G3` | Counter-clockwise arc | Appends a CCW arc segment (falls back to line if geometry is invalid) |
| `G20` | Units: inches | Switches unit interpretation for all subsequent coordinates |
| `G21` | Units: millimeters | Switches unit interpretation for all subsequent coordinates |
| `G90` | Absolute coordinates | Positions decoded as absolute XY points |
| `G91` | Relative coordinates | Positions decoded as offsets from current position |
| `I` / `J` | Arc center offsets | Used to resolve the arc center for G2/G3 |
| `R` | Arc radius | Alternate arc resolution parameter for G2/G3 |

## How Paths Are Built

The node models G-code as a pen-up / pen-down system:

- **`G0`** — pen up. The active path is sealed and a new path boundary begins.
- **`G1` / `G2` / `G3`** — pen down. Each move appends a segment to the active path.
- Arcs are preserved as arc segments when the geometry resolves cleanly. If parameters are inconsistent, the system falls back to a straight line — no hard failures.
- Non-motion commands (spindle, tool changes, comments) are silently discarded. Only XY motion is decoded.

## Typical Workflows

- **Preview** — Import a G-code file and connect to a renderer to verify scale and geometry before sending to hardware.
- **Edit and re-export** — Decode G-code into paths, apply path-level filters (scale, offset, clip), then route to a path-to-G-code export node.
- **Inspection** — Analyze segment counts, arc geometry, or coordinate ranges in an existing machine program.

## Tips

- Preview the PATH output first — confirm scale and orientation match your hardware's work area.
- Watch for `G20`/`G21` switches mid-file; unit mismatches are the most common source of unexpected sizing.
- Check the mode (`G90` vs `G91`) — absolute and relative programs produce very different geometry if misread.
- If arcs render as straight lines, inspect the source `I`, `J`, or `R` values in the original file for consistency.

## Limitations

- Only XY motion is captured. Z-axis, feed rates, and spindle state are not represented in PATH output.
- Full machine simulation is out of scope — this node reconstructs geometry, not machine behavior.
- Heavily malformed G-code may produce incomplete paths without explicit error messages.
