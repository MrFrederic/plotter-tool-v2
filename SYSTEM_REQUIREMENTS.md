# Plotter-Tool V2: System Requirements & Implementation Plan

## 1. Project Overview
Plotter-Tool V2 is a node-based, interactive web application for generating and optimizing plotter paths (G-code) from various inputs (raster images, vectors, text). The system provides a fully modular, plugin-based Directed Acyclic Graph (DAG) architecture where users can visually construct processing pipelines, tweak parameters in real-time, and preview intermediate representations seamlessly.

**Crucial Note:** This system is built entirely from scratch. Do not reference or rely on any legacy code. It will be publicly hosted on a remote server running in a Docker stack behind a reverse proxy. While it is a niche tool and high traffic is not expected, the backend must support multiple concurrent user sessions, isolating their projects, caches, and WebSocket connections safely.

## 2. Technology Stack
*   **Backend:** Python 3, FastAPI
*   **Database:** PostgreSQL (for storing user configurations, pipeline schemas, graph layouts, and metadata)
*   **Caching/Storage:** File System Object Storage (mounted via Docker volume `/cache`, used for storing intermediate caching data like large image arrays and paths)
*   **Frontend:** React (Vite, TypeScript), Zustand (state management)
*   **Node Graph UI:** React Flow (highly customized)
*   **Communication:** REST (for static assets/CRUD) + WebSockets (for real-time pipeline telemetry and execution state)
*   **Deployment:** Docker + Docker Compose (creating services for API, Frontend, PostgreSQL)

## 3. UI / UX Guidelines (Diegetic Terminal UI)
The frontend MUST match the highly stylized, interactive terminal aesthetic. 

**CRITICAL DESIGN RULE - "Unaware Cyberpunk":** The design must be diegetic (in-universe). The UI exists in a world where this aesthetic is just normal, functional software. **DO NOT** use words like "cyber", "synth", "neon", or "hacker" in the UI text, component names, or labels. It should feel like serious, industrial, over-engineered, tactical equipment software that just happens to be what we consider "cyberpunk".

*   **Visuals:** Dark backgrounds, sharp geometric borders, and monospace fonts. Accent colors (cyan, magenta, amber) against deep grays/blacks. Subtle CRT scanlines and glowing text/borders.
*   **Animations:** The UI must feature continuous, thematic micro-animations, including:
    *   Subtle CRT screen flicker, phosphor ghosting, and occasional micro-jitters.
    *   Text-scrambling (decoding) or typewriter effects when loading new panels or data.
    *   Pulsing/flowing data animations along the React Flow edges/connections.
    *   Intentional glitch artifacts or chromatic aberration on error states.
    *   Zoom in and out animations for opening tabs or selecting objects when possible.
*   **Thematic Elements:** Functional terminal-style prompts, decorative (UI-only) telemetry streams, blinking block cursors, and technical decal overlays (e.g., barcode fragments, hex grids, faux serial numbers, coordinate readouts).
*   **Nodes:** React Flow nodes must be completely custom-styled to fit the industrial terminal theme. Handles/ports should look like hardware electrical/data connections. 
*   **Layout:** Modular panels (e.g., a left sidebar for Node Inventory, center canvas for Node Editor, right sidebar for Config, bottom panel for Telemetry, and a floating/dockable Preview window).

## 4. Core Architecture

### 4.1. Plugin System (Backend)
Every processing step is an independent "Plugin" (Node).
*   **Plugin Discovery:** The backend should dynamically load plugins from a `backend/plugins/` directory using Python's `importlib` or a simple registry class.
*   **Base Plugin Interface:** Defines `inputs` (types like Image, Path, Text), `outputs`, and `parameters` (configurable options like thresholds, speeds).
*   **Auto-Schema Generation:** Plugins must self-report their configuration schema (using Pydantic). The backend exposes these schemas so the frontend can dynamically render UI forms (sliders, toggles) for any given node.
*   **Processing Libraries:** Use `opencv-python` for raster manipulations, `shapely` and `vpype` (or similar) for vector math.

### 4.2. DAG Execution Engine (Backend)
*   **Graph Processing:** Handles a Full Directed Acyclic Graph (branching pipelines, e.g., splitting a path to two different processing nodes).
*   **Topological Sort:** Resolves dependencies and executes nodes in the correct order.
*   **Smart Caching (File System):** 
    *   Every execution node generates a deterministic hash based on its Input Data + Parameters.
    *   Output files (binaries, JSON, SVG paths) are stored on disk (Docker volume) using this hash as the filename.
    *   If a user updates a parameter deeply down the graph, the engine looks at the hash. Upstream nodes will match existing hashes, bypassing execution and instantly loading from the FS cache.
*   **Real-time Telemetry:** Uses WebSockets to broadcast execution states (`WAITING`, `RUNNING`, `CACHED`, `DONE`, `ERROR`) and progress % to the frontend in real time.

### 4.3. Database Schema (PostgreSQL)
The database will store persistent information using SQLAlchemy or SQLModel. It must support multiple users securely:
*   `User` or `Session`: Identity container to group a visitor's projects.
*   `Project`: High-level container for a user's work.
*   `Pipeline`: A saved sequence/DAG configuration.
*   `NodeInstance`: Individual nodes within a pipeline, including their X/Y canvas positions (for React Flow) and saved parameter values.
*   `Edge`: Connections between `NodeInstance` outputs and inputs.

### 4.4. Data Visualization Engine (Frontend)
The frontend must efficiently render intermediate outputs when a user clicks a node.
*   **State Synchronization:** The frontend DAG state syncs to the backend via a debounced WebSocket message whenever a node is added/removed/connected or a parameter is changed.
*   **Raster Viewer:** Fast canvas/image rendering for intermediate raster processing.
*   **Vector/Path Viewer:** Renders SVG or internal path formats for vector stages. Avoid DOM overload by rendering paths into a Canvas if necessary.
*   **G-code Viewer (Large Data Handling):** 
    1.  Text view: Must use a virtualized list (e.g., `react-window` or `react-virtuoso`) to prevent browser crashes on 100k+ line files.
    2.  2D Toolpath view: Simulates the physical plotter movements using a highly efficient WebGL library (e.g., PixiJS) or heavily batched HTML5 Canvas.

## 5. Implementation Phases (Order of Operations)

### Phase 1: Infrastructure & Boilerplate
1.  Setup Docker Compose structure: `db` (Postgres), `api` (FastAPI), `ui` (React+Vite).
2.  Setup PostgreSQL schemas using an ORM (SQLAlchemy or SQLModel) for Projects, Pipelines, Nodes, Edges.
3.  Implement basic FastAPI structure with WebSocket routing, CORS, and Plugin Discovery mechanism.
4.  Scaffold React frontend with Vite, TypeScript, and basic Cyberpunk CSS variables.

### Phase 2: Plugin Engine & DAG Backend
1.  Implement `BasePlugin` and Pydantic schema generation.
2.  Implement the File System Object Cache mapped to `/cache` volume and Hashing mechanics.
3.  Implement the DAG Execution Engine to topological sort and chain dummy plugins.
4.  Wire the execution engine to WebSocket outputs to broadcast node statuses.

### Phase 3: Node Editor & Frontend State
1.  Integrate React Flow and theme it strictly to the Cyberpunk aesthetic.
2.  Implement Node Drag & Drop from a plugin inventory (populated seamlessly from the backend schema API).
3.  Implement Zustand store to keep track of Node connections and parameter values.
4.  Implement dynamic parameter forms: when clicking a node, auto-generate sliders/inputs based on the node's schema.

### Phase 4: Integration & Execution Loop
1.  Connect frontend parameters and edge connections to the backend WebSocket execution dispatcher (with debounce to prevent spamming execution).
2.  Ensure visual feedback accurately reflects WebSocket statuses (nodes glowing yellow when RUNNING, green when DONE, etc.).

### Phase 5: Visualizers & documentation
1.  Implement the Preview module to fetch and display the cached File System intermediate results.
2.  Build the Raster, Vector, and G-Code virtualized visualizer components.
3.  Prepare various "example" dummy plugins and complete documentation on plugin development.