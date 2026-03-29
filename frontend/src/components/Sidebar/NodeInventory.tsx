import { useEffect, useState, type DragEvent } from 'react';
import './NodeInventory.css';
import type { PluginSchema } from '../../types';
import useFlowStore from '../../store/useFlowStore';
import MarkdownContent from '../common/MarkdownContent';

export default function NodeInventory() {
  const pluginSchemas = useFlowStore((s) => s.pluginSchemas);
  const pluginLoadError = useFlowStore((s) => s.pluginLoadError);
  const loadPluginSchemas = useFlowStore((s) => s.loadPluginSchemas);
  const clearPluginError = useFlowStore((s) => s.clearPluginError);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    loadPluginSchemas();
  }, [loadPluginSchemas]);

  const handleReload = async () => {
    clearPluginError();
    await loadPluginSchemas();
  };

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
        {pluginLoadError && (
          <div className="node-inventory__error">
            <div className="node-inventory__error-message">
              ⚠ {pluginLoadError}
            </div>
            <button
              type="button"
              className="node-inventory__error-button"
              onClick={handleReload}
            >
              Reload
            </button>
          </div>
        )}
        {!pluginLoadError && Object.keys(filtered).length === 0 && (
          <div className="node-inventory__empty">
            No modules found
          </div>
        )}
        {!pluginLoadError && Object.entries(filtered).map(([category, items]) => (
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
              >
                <span className="node-inventory__item-name">{plugin.name}</span>
                <div className="node-inventory__item-meta">
                  <span className="node-inventory__item-ports">
                    {plugin.inputs.length}→{plugin.outputs.length}
                  </span>
                  <div className="node-inventory__info">
                    <button
                      type="button"
                      className="node-inventory__info-button"
                      aria-label={`Show module details for ${plugin.name}`}
                      draggable={false}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.preventDefault()}
                    >
                      i
                    </button>
                    <div className="node-inventory__info-panel" role="tooltip">
                      <div className="node-inventory__info-header">
                        <span className="node-inventory__info-title">{plugin.name}</span>
                        <span className="node-inventory__info-category">{plugin.category}</span>
                      </div>
                      <MarkdownContent
                        markdown={plugin.description}
                        pluginName={plugin.name}
                        compact
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
