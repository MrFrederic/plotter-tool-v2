**SVG to G-Code** compiles an SVG document into a machine-ready G-code program in a single operation, delegating conversion to the external `svg2gcode` CLI. The node emits both the finished program and a reconstructed PATH preview, enabling toolpath inspection before transmission to hardware.

# SVG to G-Code

This node routes your SVG document through the external `svg2gcode` CLI binary and emits a ready-to-deploy G-code program. It is a single-step converter — no intermediate geometry stage. **Requires `svg2gcode` installed at runtime; this is not pure-Python.** A PATH preview is reconstructed from the emitted motion so you can inspect the toolpath before transmitting to hardware.

## How It Works

1. Verifies the `svg2gcode` binary is accessible in the runtime environment.
2. Encodes node parameters into a temporary settings JSON and passes it to the CLI.
3. Executes the external module, piping your SVG in via stdin.
4. Captures the compiled G-code program from stdout.
5. Parses emitted `G0`/`G1`/`G2`/`G3` motion back into internal PATH segments for preview.

## Output Ports

- **`gcode`** — The compiled machine program. Transmit this to your plotter or CNC controller.
- **`path`** — Preview geometry reconstructed from the emitted motion. Lets you inspect the toolpath visually before executing the job on hardware.

## Key Parameters

### Conversion Quality

- **`tolerance`** — Curve approximation precision in mm. Lower values produce smoother curves with more segments; higher values reduce segment count at the cost of curve fidelity.
- **`feedrate`** — Linear move speed in mm/min for all drawing/cutting moves.
- **`dpi`** — SVG unit-to-physical scale. Match this to the DPI your SVG was authored at to preserve real-world dimensions.
- **`circular_interpolation`** — Emit native arc commands (`G2`/`G3`) when your controller supports them. Disabled: arcs are linearized to `G1` segments.

### Origin & Dimensions

- **`origin_x_enabled` / `origin_x`**, **`origin_y_enabled` / `origin_y`** — Override the conversion origin in mm. Use to align the job to your machine zero or fixture reference point.
- **`dimension_width_enabled` / `dimension_width` / `dimension_width_unit`** — Force a specific physical output width, rescaling the design during conversion.
- **`dimension_height_enabled` / `dimension_height` / `dimension_height_unit`** — Force a specific physical output height.

### Custom Sequences

- **`begin_sequence`** — Raw G-code injected at program start (init, units, mode).
- **`end_sequence`** — Raw G-code injected at program end (park, shutdown).
- **`tool_on_sequence`** — Raw G-code inserted each time the tool activates before a move.
- **`tool_off_sequence`** — Raw G-code inserted each time the tool deactivates after a move.

### Formatting

- **`line_numbers`** — Prefix each output line with a sequential block number.
- **`checksums`** — Append transmission checksums for firmware that validates each line on receipt.
- **`newline_before_comment`** — Route comments to their own preceding line for cleaner output formatting.
- **`settings_version`** — Settings schema version tag passed to the CLI. Must match your installed `svg2gcode` CLI version.

### Advanced

- **`extra_attribute_name`** — SVG attribute name for advanced per-element metadata overrides. Leave empty unless your SVG embeds custom processing directives.

## vs Path to G-Code

Use this node when your source is SVG and you want a direct one-step conversion through the `svg2gcode` protocol — motion preview included. Use **PathToGCode** when your pipeline works with internal PATH geometry first and you want G-code emitted from that normalized stage instead of directly from raw SVG.

## Tips

- Verify `svg2gcode` is installed and on your PATH before deploying a pipeline with this node.
- Start with default parameters, then tune `tolerance` and `dpi` independently.
- Use the `path` output port to visually validate the toolpath before transmitting `gcode` to hardware.
- Keep custom sequence fields empty until basic conversion is confirmed working, then layer in machine-specific init/shutdown commands.

## Limitations

- **External binary required.** This node will fail at execution time if `svg2gcode` is not installed.
- Output fidelity depends on the installed CLI version — behavior may shift across `svg2gcode` releases.
- The `path` preview is reconstructed from emitted motion, not from original SVG topology — structural detail may differ from source.
- Controller compatibility for arc commands, line numbers, and checksums still depends on your machine firmware.

## Credits

- Conversion engine: `svg2gcode` Rust crate (v0.3.4)
	- https://crates.io/crates/svg2gcode
	- https://docs.rs/svg2gcode/0.3.4
- CLI wrapper used by this plugin runtime: `svg2gcode-cli` (v0.0.18)
	- https://crates.io/crates/svg2gcode-cli

This node is an integration layer; all conversion logic is provided by the upstream `svg2gcode` project.
