"""DAG-based execution engine for processing pipelines."""
from __future__ import annotations

import hashlib
import logging
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from app.cache import FileSystemCache
from app.plugin_base import BasePlugin

logger = logging.getLogger(__name__)


class NodeState(str, Enum):
    IDLE = "idle"
    WAITING = "waiting"
    RUNNING = "running"
    CACHED = "cached"
    DONE = "done"
    ERROR = "error"


@dataclass
class ExecutionNode:
    node_id: str
    plugin_name: str
    params: dict[str, Any]
    # Connections: mapping of input-port-name → (source_node_id, source_output_port)
    inputs: dict[str, tuple[str, str]] = field(default_factory=dict)
    status: NodeState = NodeState.IDLE
    result_hash: str | None = None
    error: str | None = None


class DAGEngine:
    """Build a DAG from pipeline nodes/edges, validate, and execute."""

    def __init__(
        self,
        nodes: list[ExecutionNode],
        plugin_registry: dict[str, type[BasePlugin]],
    ) -> None:
        self.nodes: dict[str, ExecutionNode] = {n.node_id: n for n in nodes}
        self.plugin_registry = plugin_registry
        # adjacency: node_id → set of downstream node_ids
        self._adj: dict[str, set[str]] = defaultdict(set)
        # reverse adjacency: node_id → set of upstream node_ids
        self._rev: dict[str, set[str]] = defaultdict(set)
        self._results: dict[str, dict[str, Any]] = {}
        self._result_hashes: dict[str, dict[str, str]] = {}
        self.run_id: str = str(uuid.uuid4())

        self.build_graph()

    # ── graph construction ────────────────────────────────────────────────

    def build_graph(self) -> None:
        """Populate adjacency lists from the node input connections."""
        for node in self.nodes.values():
            for _port, (src_node_id, _src_port) in node.inputs.items():
                self._adj[src_node_id].add(node.node_id)
                self._rev[node.node_id].add(src_node_id)

    # ── topological sort (Kahn's algorithm) ───────────────────────────────

    def topological_sort(self) -> list[str]:
        """Return node IDs in a valid execution order.

        Raises ``ValueError`` if the graph contains a cycle.
        """
        in_degree: dict[str, int] = {nid: 0 for nid in self.nodes}
        for nid in self.nodes:
            in_degree[nid] = len(self._rev.get(nid, set()))

        queue: deque[str] = deque(
            nid for nid, deg in in_degree.items() if deg == 0
        )
        order: list[str] = []

        while queue:
            nid = queue.popleft()
            order.append(nid)
            for downstream in self._adj.get(nid, set()):
                in_degree[downstream] -= 1
                if in_degree[downstream] == 0:
                    queue.append(downstream)

        if len(order) != len(self.nodes):
            raise ValueError("Pipeline contains a cycle")

        return order

    # ── validation ────────────────────────────────────────────────────────

    def validate(self) -> list[str]:
        """Check the DAG for common problems. Returns a list of error strings."""
        errors: list[str] = []

        # Check for unknown plugins
        for node in self.nodes.values():
            if node.plugin_name not in self.plugin_registry:
                errors.append(
                    f"Node '{node.node_id}' references unknown plugin "
                    f"'{node.plugin_name}'"
                )

        # Check for missing source nodes
        for node in self.nodes.values():
            for port, (src_id, _) in node.inputs.items():
                if src_id not in self.nodes:
                    errors.append(
                        f"Node '{node.node_id}' input '{port}' references "
                        f"missing node '{src_id}'"
                    )

        # Cycle detection
        try:
            self.topological_sort()
        except ValueError:
            errors.append("Pipeline contains a cycle")

        return errors

    # ── execution ─────────────────────────────────────────────────────────

    async def execute(
        self,
        session_id: str,
        ws_manager: Any,
        cache: FileSystemCache,
    ) -> dict[str, Any]:
        """Run the full pipeline in topological order.

        Returns a mapping of ``{node_id: output_dict}`` for every node.
        """
        order = self.topological_sort()
        failed_nodes: set[str] = set()

        for node_id in order:
            node = self.nodes[node_id]

            # Skip nodes whose upstream dependency has errored
            upstream_failures = failed_nodes & self._rev.get(node_id, set())
            if upstream_failures:
                failed_upstream = next(iter(upstream_failures))
                node.status = NodeState.ERROR
                node.error = f"Skipped: upstream node '{failed_upstream}' failed"
                failed_nodes.add(node_id)
                await self._broadcast(session_id, ws_manager, node)
                continue

            plugin_cls = self.plugin_registry.get(node.plugin_name)
            if plugin_cls is None:
                node.status = NodeState.ERROR
                node.error = f"Unknown plugin '{node.plugin_name}'"
                failed_nodes.add(node_id)
                await self._broadcast(session_id, ws_manager, node)
                continue

            # ── gather inputs coming from upstream nodes ──────────────
            node.status = NodeState.WAITING
            await self._broadcast(session_id, ws_manager, node)

            input_data: dict[str, Any] = {}
            input_hashes: dict[str, str] = {}
            try:
                for port, (src_id, src_port) in node.inputs.items():
                    upstream_results = self._results.get(src_id, {})
                    input_data[port] = upstream_results.get(src_port)
                    upstream_hashes = self._result_hashes.get(src_id, {})
                    input_hashes[port] = upstream_hashes.get(
                        src_port, _hash_value(upstream_results.get(src_port))
                    )
            except Exception as exc:
                node.status = NodeState.ERROR
                node.error = f"Input resolution failed: {exc}"
                failed_nodes.add(node_id)
                await self._broadcast(session_id, ws_manager, node)
                continue

            # ── compute cache hash ────────────────────────────────────
            exec_hash = plugin_cls.compute_hash(input_hashes, node.params)

            # ── check cache ───────────────────────────────────────────
            cached = await cache.retrieve_json(exec_hash)
            if cached is not None:
                node.status = NodeState.CACHED
                node.result_hash = exec_hash
                self._results[node_id] = cached
                self._result_hashes[node_id] = {
                    k: _hash_value(v) for k, v in cached.items()
                }
                await self._broadcast(session_id, ws_manager, node)
                continue

            # ── execute plugin ────────────────────────────────────────
            node.status = NodeState.RUNNING
            await self._broadcast(session_id, ws_manager, node)

            try:
                plugin_instance = plugin_cls()
                output = await plugin_instance.process(input_data, node.params)
            except Exception as exc:
                node.status = NodeState.ERROR
                node.error = str(exc)
                failed_nodes.add(node_id)
                await self._broadcast(session_id, ws_manager, node)
                continue

            # ── store results ─────────────────────────────────────────
            await cache.store_json(exec_hash, output)
            node.status = NodeState.DONE
            node.result_hash = exec_hash
            self._results[node_id] = output
            self._result_hashes[node_id] = {
                k: _hash_value(v) for k, v in output.items()
            }
            await self._broadcast(session_id, ws_manager, node)

        return dict(self._results)

    # ── helpers ───────────────────────────────────────────────────────────

    async def _broadcast(
        self, session_id: str, ws_manager: Any, node: ExecutionNode
    ) -> None:
        """Send a status update for *node* over the WebSocket manager."""
        try:
            await ws_manager.broadcast_to_session(
                session_id,
                {
                    "type": "node_status",
                    "run_id": self.run_id,
                    "node_id": node.node_id,
                    "status": node.status.value,
                    "error": node.error,
                },
            )
        except Exception:
            logger.debug("WS broadcast failed for node %s", node.node_id)

    def get_status(self) -> dict[str, Any]:
        """Return a snapshot of every node's execution state."""
        return {
            "run_id": self.run_id,
            "nodes": {
                nid: {
                    "status": n.status.value,
                    "result_hash": n.result_hash,
                    "error": n.error,
                }
                for nid, n in self.nodes.items()
            },
        }


def _hash_value(value: Any) -> str:
    """Produce a short hash for an arbitrary value (best-effort)."""
    h = hashlib.sha256()
    try:
        h.update(repr(value).encode())
    except Exception:
        h.update(b"<unhashable>")
    return h.hexdigest()
