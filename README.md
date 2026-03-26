# Plotter-Tool V2

A node-based web application for generating and optimizing plotter paths (G-code) from various inputs. Users visually construct processing pipelines, tweak parameters in real-time, and preview intermediate results at every stage.

## Architecture Overview

```
┌──────────┐     REST / WS     ┌──────────┐     SQL      ┌────────────┐
│ Frontend │ ◄──────────────► │ Backend  │ ◄──────────► │ PostgreSQL │
│ (React)  │                   │ (FastAPI)│              │            │
└──────────┘                   └────┬─────┘              └────────────┘
                                    │
                                    ▼
                              ┌───────────┐
                              │  /cache   │  File System
                              │  volume   │  Object Store
                              └───────────┘
```

- **Frontend** – React 19, TypeScript, Vite, Zustand, React Flow
- **Backend** – Python 3, FastAPI, SQLAlchemy (async), plugin-based DAG engine
- **Database** – PostgreSQL for projects, pipelines, nodes, edges
- **Cache** – Docker volume (`/cache`) for content-addressed intermediate results

## Quick Start

```bash
# Clone the repository
git clone <repo-url> && cd plotter-tool-v2

# Start all services
docker-compose up --build

# Frontend: http://localhost:5173
# Backend API: http://localhost:8000
# API docs: http://localhost:8000/docs
```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend Framework | React 19 + TypeScript |
| Build Tool | Vite 8 |
| State Management | Zustand 5 |
| Node Graph | @xyflow/react 12 |
| Virtualized Lists | react-virtuoso |
| Backend Framework | FastAPI |
| ORM | SQLAlchemy (async) |
| Database | PostgreSQL |
| Image Processing | OpenCV (cv2), NumPy |
| Containerization | Docker + Docker Compose |

## Project Structure

```
plotter-tool-v2/
├── docker-compose.yml
├── README.md
├── SYSTEM_REQUIREMENTS.md
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py              # FastAPI app, WebSocket, plugin discovery
│   │   ├── config.py            # Settings (DB URL, cache dir, CORS)
│   │   ├── database.py          # SQLAlchemy async engine
│   │   ├── models.py            # ORM models
│   │   ├── schemas.py           # Pydantic request/response schemas
│   │   ├── plugin_base.py       # BasePlugin abstract class
│   │   ├── cache.py             # FileSystemCache (SHA256 content-addressed)
│   │   ├── dag_engine.py        # DAG execution engine
│   │   ├── websocket.py         # WebSocket connection manager
│   │   └── routers/
│   │       ├── plugins.py       # GET /plugins/
│   │       ├── projects.py      # CRUD /projects/
│   │       ├── pipelines.py     # CRUD /pipelines/
│   │       ├── execution.py     # POST /execute/, GET status
│   │       └── preview.py       # GET /preview/ (cached results)
│   │
│   └── plugins/                 # Drop-in plugin directory
│       ├── README.md            # Plugin development guide
│       ├── image_input.py
│       ├── threshold.py
│       ├── edge_detection.py
│       ├── contour_trace.py
│       └── gcode_output.py
│
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── App.tsx
│       ├── api/rest.ts          # REST API client
│       ├── store/useFlowStore.ts
│       ├── types/index.ts
│       ├── hooks/               # WebSocket bridge, pipeline sync
│       └── components/
│           ├── NodeEditor/      # React Flow canvas
│           ├── Sidebar/         # Node inventory + config panel
│           ├── Toolbar/         # Pipeline actions
│           ├── Telemetry/       # Real-time execution status
│           ├── Preview/         # Visualizer components
│           │   ├── PreviewWindow.tsx
│           │   ├── RasterViewer.tsx
│           │   ├── VectorViewer.tsx
│           │   └── GCodeViewer.tsx
│           └── common/          # Overlays and decorative elements
│
└── cache/                       # Docker volume mount
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/plugins/` | List all plugin schemas |
| GET | `/plugins/{name}` | Get a single plugin schema |
| POST | `/projects/` | Create a project |
| GET | `/projects/` | List projects |
| POST | `/pipelines/` | Create a pipeline |
| GET | `/pipelines/{id}` | Get a pipeline |
| PUT | `/pipelines/{id}` | Update a pipeline |
| POST | `/execute/{pipeline_id}` | Execute a pipeline |
| GET | `/execute/{pipeline_id}/status` | Get execution status |
| GET | `/preview/{pipeline_id}/{node_id}` | Get cached node result |
| GET | `/preview/cache/{hash}` | Get raw cached file |
| WS | `/ws/{session_id}` | Real-time telemetry |

## Plugin Development

See [`backend/plugins/README.md`](backend/plugins/README.md) for a detailed guide.

### Quick Overview

Every plugin extends `BasePlugin` and implements two methods:

```python
from app.plugin_base import BasePlugin, PluginSchema, PortDefinition, ParameterDefinition, PortType

class MyPlugin(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="MyPlugin",
            category="Processing",
            description="Does something useful",
            inputs=[PortDefinition(name="image", type=PortType.IMAGE)],
            outputs=[PortDefinition(name="image", type=PortType.IMAGE)],
            parameters=[
                ParameterDefinition(name="strength", type="number", default=50, min=0, max=100),
            ],
        )

    async def process(self, inputs, params):
        # Process data and return outputs
        return {"image": result}

Plugin = MyPlugin  # Required for auto-discovery
```

Drop the file into `backend/plugins/` and restart the server. It will be auto-discovered.

## Frontend Architecture

- **React Flow** – Fully custom-themed node graph editor
- **Zustand Store** – Single store manages nodes, edges, selections, statuses, and plugin schemas
- **WebSocket Bridge** – Real-time execution telemetry updates node statuses
- **Preview System** – When a node completes execution, clicking it opens a floating preview window that auto-detects the output type:
  - **Raster Viewer** – Canvas-based image rendering with zoom/pan
  - **Vector Viewer** – SVG path rendering with color-coded paths and toggle visibility
  - **G-Code Viewer** – Dual-mode: virtualized text view with syntax highlighting + 2D toolpath canvas with step-through animation

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql+asyncpg://plotter:plotter_dev@db:5432/plotter_tool` | Database connection |
| `CACHE_DIR` | `/cache` | File system cache directory |
| `CORS_ORIGINS` | `["*"]` | Allowed CORS origins |
| `VITE_API_URL` | `http://localhost:8000` | Frontend API base URL |

## Development Setup

```bash
# Backend (local, without Docker)
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend (local)
cd frontend
npm install
npm run dev

# Run the full stack with Docker
docker-compose up --build
```

## License

See [LICENSE](LICENSE).
