# Copilot repository instructions

## Purpose
This repository is a full-stack plotter pipeline tool:
- Frontend: React 19 + TypeScript + Vite (`frontend/`)
- Backend: FastAPI + async SQLAlchemy + plugin-based DAG execution (`backend/`)
- Database: PostgreSQL 16 (Docker service `db`)
- Runtime topology: Docker Compose with `db`, `api`, `ui`

Primary user flow: build DAG pipelines in the UI, execute them in the backend, stream execution status over WebSocket, and preview cached outputs.

## Source of truth and priorities
- Prefer the implementation and commands in `README.md` and `docker-compose.yml`.
- Keep changes minimal and task-focused.
- Do not redesign UI/theme unless explicitly requested.
- Preserve plugin contracts and API shapes used by the frontend.

## Recommended workflow (always follow this order)
1. Read `README.md` and the relevant package/module files before editing.
2. Make the smallest possible change in the appropriate layer (`frontend/` or `backend/`).
3. Run targeted validation for the changed layer first.
4. If behavior crosses layers, run compose-based smoke validation.

## Build, run, and validation commands
Use these exact commands unless the task requires otherwise.

### Full stack (preferred integration path)
From repository root:
- `docker compose up -d --build`
- UI is served at `http://localhost:3000`
- API is served at `http://localhost:8000` (`/docs` for OpenAPI)

Useful checks:
- `docker compose ps`
- `docker compose logs -f api`
- `docker compose logs -f ui`
- `docker compose logs -f db`

### Frontend only
From `frontend/`:
- Install: `npm ci` (preferred) or `npm install`
- Dev: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`

### Backend only
From `backend/`:
- Create env: `python -m venv venv && source venv/bin/activate`
- Install deps: `pip install -r requirements.txt`
- Run API: `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`

Notes:
- Backend Docker image uses Python 3.11 (`backend/Dockerfile`).
- Frontend Docker image uses Node 20 (`frontend/Dockerfile`).

### Tests and CI expectations
- There is currently no meaningful automated test suite (`backend/tests/` only has `__init__.py`).
- For most tasks, validation means successful build/lint/run plus manual API/UI smoke checks.
- If adding tests, keep them adjacent to changed logic and avoid broad framework setup unless requested.

## Project layout for fast navigation
- Backend entrypoint: `backend/app/main.py`
- API routers: `backend/app/routers/`
- DAG engine: `backend/app/dag_engine.py`
- Plugin base contract: `backend/app/plugin_base.py`
- Built-in plugins: `backend/plugins/*.py`
- Frontend app shell: `frontend/src/App.tsx`
- API clients: `frontend/src/api/rest.ts`, `frontend/src/api/websocket.ts`
- State stores: `frontend/src/store/`
- Graph editor: `frontend/src/components/NodeEditor/`
- Preview renderers: `frontend/src/components/Preview/`

## Change guidance by area
### Backend
- Keep plugin interfaces stable (`schema()`, `process()`, and module-level `Plugin = ClassName`).
- Maintain async behavior in FastAPI and DB code.
- Avoid blocking operations in request/WebSocket paths.
- Respect cache semantics (`CACHE_DIR`, content-addressed artifacts).

### Frontend
- Keep TypeScript types aligned with backend schemas.
- Preserve existing component structure and styling approach.
- Avoid introducing new UI frameworks or major state architecture changes.

## Safety checks before handing off
For any non-trivial change, verify:
- Changed files compile/lint in their layer.
- If API contract changed, frontend usage is updated accordingly.
- Docker compose stack still starts cleanly.
- No secrets or environment-specific constants are hard-coded.

## Agent behavior
- Trust this instruction file first; search the repository only when information here is missing or appears outdated.
- Prefer targeted file reads over broad scans.
- When multiple approaches are possible, choose the simplest one that fits existing architecture and tooling.
