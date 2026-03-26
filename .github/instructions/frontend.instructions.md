---
applyTo: "frontend/src/**/*.ts,frontend/src/**/*.tsx,frontend/src/**/*.css"
---

# Frontend path-specific instructions

## Design language (required)
- Follow the **"unaware cyberpunk"** convention:
	- The interface should feel like serious, functional industrial software in-world, not a stylized parody of futuristic UI.
	- Keep a dark, high-contrast terminal aesthetic with sharp geometry, dense technical framing, and restrained accent usage.
	- Maintain subtle diegetic behaviors (status flicker, signal/telemetry feel, functional overlays) only when already consistent with existing components.
	- Favor utility-first language and operational wording in labels, help text, and status messages.
- Treat the UI as normal in-universe industrial software; do not use words like "cyber", "neon", "hacker", or similar self-referential aesthetic labels in user-facing text.
- Keep the existing diegetic terminal look and component structure; do not introduce a new visual theme unless explicitly requested.

## Scope and UX
- Make minimal, task-focused UI changes.
- Preserve existing layout model: sidebar(s), canvas, telemetry, preview behavior.
- Do not add extra pages, modals, or feature flows unless requested.

## Frontend implementation rules
- Keep TypeScript types aligned with backend schemas and API contracts.
- Reuse existing API/store patterns in `frontend/src/api/` and `frontend/src/store/`.
- Preserve existing component organization under `frontend/src/components/`.
- Prefer small, localized edits over broad refactors.

## Validation
- Run `npm run lint` and `npm run build` in `frontend/` after non-trivial frontend changes.
- If changes affect backend integration, also smoke-test with Docker Compose from repo root.
