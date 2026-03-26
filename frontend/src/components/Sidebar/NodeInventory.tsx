import { useEffect, useState, type DragEvent } from 'react';
import './NodeInventory.css';
import type { PluginSchema } from '../../types';
import useFlowStore from '../../store/useFlowStore';

export default function NodeInventory() {
  const pluginSchemas = useFlowStore((s) => s.pluginSchemas);
  const loadPluginSchemas = useFlowStore((s) => s.loadPluginSchemas);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    loadPluginSchemas();
  }, [loadPluginSchemas]);

  const categories = pluginSchemas.reduce<Record<string, PluginSchema[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});

  const filtered = filter
    ? Object.fromEntries(
        Object.entries(categories)
          .map(([cat, items]) => [
            cat,
            items.filter((p) =>
              p.name.toLowerCase().includes(filter.toLowerCase()),
            ),
          ])
          .filter(([, items]) => (items as PluginSchema[]).length > 0),
      )
    : categories;

  const onDragStart = (event: DragEvent, plugin: PluginSchema) => {
    event.dataTransfer.setData('application/plotter-plugin', plugin.name);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="node-inventory">
      <div className="node-inventory__header">
        <span className="node-inventory__title">MODULE INVENTORY</span>
        <span className="node-inventory__count">[{pluginSchemas.length}]</span>
      </div>

      <div className="node-inventory__search">
        <input
          type="text"
          placeholder="filter modules..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="node-inventory__search-input"
        />
      </div>

      <div className="node-inventory__list">
        {Object.keys(filtered).length === 0 && (
          <div className="node-inventory__empty">
            No modules found
          </div>
        )}
        {Object.entries(filtered).map(([category, items]) => (
          <div key={category} className="node-inventory__category">
            <div className="node-inventory__category-header">
              ▸ {category.toUpperCase()}
            </div>
            {(items as PluginSchema[]).map((plugin) => (
              <div
                key={plugin.name}
                className="node-inventory__item"
                draggable
                onDragStart={(e) => onDragStart(e, plugin)}
                title={plugin.description}
              >
                <span className="node-inventory__item-name">{plugin.name}</span>
                <span className="node-inventory__item-ports">
                  {plugin.inputs.length}→{plugin.outputs.length}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
