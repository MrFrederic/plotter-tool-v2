# VPype Processor

Runs a constrained `vpype` command chain on incoming SVG data.

## What it does

- Reads SVG from the `vector` input.
- Applies selected operations (merge/sort/reloop/simplify/filter, transforms, layout).
- Writes and returns processed SVG on the `vector` output.

## Safety model

- No free-form command text is accepted.
- Only fixed, whitelisted vpype commands are used.
- Numeric/select parameters are strictly validated.
- Execution is bounded by a timeout.

## Typical usage

1. Connect **Pipeline Input (vector)** → **VPype Processor (vector)**.
2. Keep default optimization toggles for basic travel reduction.
3. Optionally add transforms/layout settings.
4. Connect output to downstream vector/path/gcode nodes or preview.
