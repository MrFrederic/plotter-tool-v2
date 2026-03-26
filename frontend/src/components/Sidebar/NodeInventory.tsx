import { useEffect, useState, type DragEvent } from 'react';
import './NodeInventory.css';
import type { PluginSchema } from '../../types';
import { fetchPlugins } from '../../api/rest';

const FALLBACK_PLUGINS: PluginSchema[] = [
  {
    name: 'Image Loader',
    category: 'Input',
    description: 'Load an image file from disk',
    inputs: [],
    outputs: [{ name: 'image', type: 'image' }],
    parameters: [{ name: 'file_path', type: 'string', default: '' }],
  },
  {
    name: 'SVG Trace',
    category: 'Processing',
    description: 'Convert raster image to vector paths',
    inputs: [{ name: 'image', type: 'image' }],
    outputs: [{ name: 'paths', type: 'path' }],
    parameters: [
      { name: 'threshold', type: 'number', default: 128, min: 0, max: 255, step: 1 },
      { name: 'smoothing', type: 'number', default: 1.0, min: 0, max: 5, step: 0.1 },
    ],
  },
  {
    name: 'G-code Generator',
    category: 'Output',
    description: 'Generate G-code from vector paths',
    inputs: [{ name: 'paths', type: 'path' }],
    outputs: [{ name: 'gcode', type: 'gcode' }],
    parameters: [
      { name: 'feed_rate', type: 'number', default: 1000, min: 100, max: 5000, step: 50 },
      { name: 'pen_up_height', type: 'number', default: 5, min: 1, max: 20, step: 0.5 },
    ],
  },
  {
    name: 'Threshold Filter',
    category: 'Processing',
    description: 'Apply binary threshold to image',
    inputs: [{ name: 'image', type: 'image' }],
    outputs: [{ name: 'image', type: 'image' }],
    parameters: [
      { name: 'value', type: 'number', default: 128, min: 0, max: 255, step: 1 },
      { name: 'invert', type: 'boolean', default: false },
    ],
  },
  {
    name: 'Path Optimizer',
    category: 'Processing',
    description: 'Optimize path ordering for plotting',
    inputs: [{ name: 'paths', type: 'path' }],
    outputs: [{ name: 'paths', type: 'path' }],
    parameters: [
      { name: 'method', type: 'select', default: 'greedy', options: ['greedy', 'two-opt', 'nearest'] },
    ],
  },
  {
    name: 'Preview Render',
    category: 'Output',
    description: 'Render paths to preview image',
    inputs: [{ name: 'paths', type: 'path' }],
    outputs: [{ name: 'image', type: 'image' }],
    parameters: [
      { name: 'width', type: 'number', default: 800, min: 100, max: 4096, step: 1 },
      { name: 'height', type: 'number', default: 600, min: 100, max: 4096, step: 1 },
      { name: 'line_color', type: 'color', default: '#00f0ff' },
    ],
  },
];

export default function NodeInventory() {
  const [plugins, setPlugins] = useState<PluginSchema[]>(FALLBACK_PLUGINS);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    fetchPlugins()
      .then(setPlugins)
      .catch(() => {
        /* use fallback */
      });
  }, []);

  const categories = plugins.reduce<Record<string, PluginSchema[]>>((acc, p) => {
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
    event.dataTransfer.setData('application/plotter-plugin', JSON.stringify(plugin));
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="node-inventory">
      <div className="node-inventory__header">
        <span className="node-inventory__title">MODULE INVENTORY</span>
        <span className="node-inventory__count">[{plugins.length}]</span>
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
