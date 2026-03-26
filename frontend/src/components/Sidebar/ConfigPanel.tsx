import { useCallback, useEffect, useRef, useState } from 'react';
import './ConfigPanel.css';
import useFlowStore from '../../store/useFlowStore';

export default function ConfigPanel() {
  const nodes = useFlowStore((s) => s.nodes);
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const updateNodeParams = useFlowStore((s) => s.updateNodeParams);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode) return null;

  const { label, category, parameters, params, status } = selectedNode.data;

  return (
    <div className="config-panel">
      <div className="config-panel__header">
        <span className="config-panel__title">PARAMETERS</span>
        <span className="config-panel__status" data-status={status}>
          {status}
        </span>
      </div>

      <div className="config-panel__node-info">
        <div className="config-panel__node-name">{label}</div>
        <div className="config-panel__node-category">{category}</div>
        <div className="config-panel__node-id">{selectedNodeId}</div>
      </div>

      <div className="config-panel__fields">
        {parameters.map((param) => (
          <ParameterField
            key={param.name}
            name={param.name}
            type={param.type}
            value={params[param.name] ?? param.default}
            min={param.min}
            max={param.max}
            step={param.step}
            options={param.options}
            description={param.description}
            onChange={(val) => updateNodeParams(selectedNodeId!, { [param.name]: val })}
          />
        ))}
        {parameters.length === 0 && (
          <div className="config-panel__empty">No configurable parameters</div>
        )}
      </div>
    </div>
  );
}

interface ParameterFieldProps {
  name: string;
  type: string;
  value: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  description?: string;
  onChange: (value: unknown) => void;
}

function ParameterField({
  name,
  type,
  value,
  min,
  max,
  step,
  options,
  description,
  onChange,
}: ParameterFieldProps) {
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const debouncedChange = useCallback(
    (val: unknown) => {
      setLocalValue(val);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onChange(val), 300);
    },
    [onChange],
  );

  return (
    <div className="config-panel__field">
      <label className="config-panel__field-label">
        {name}
        {description && (
          <span className="config-panel__field-desc" title={description}>
            ?
          </span>
        )}
      </label>

      {type === 'number' && (
        <div className="config-panel__field-number">
          <input
            type="range"
            min={min ?? 0}
            max={max ?? 100}
            step={step ?? 1}
            value={Number(localValue)}
            onChange={(e) => debouncedChange(Number(e.target.value))}
            className="config-panel__slider"
          />
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={Number(localValue)}
            onChange={(e) => debouncedChange(Number(e.target.value))}
            className="config-panel__number-input"
          />
        </div>
      )}

      {type === 'string' && (
        <input
          type="text"
          value={String(localValue ?? '')}
          onChange={(e) => debouncedChange(e.target.value)}
          className="config-panel__text-input"
        />
      )}

      {type === 'boolean' && (
        <label className="config-panel__toggle">
          <input
            type="checkbox"
            checked={Boolean(localValue)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="config-panel__toggle-track">
            <span className="config-panel__toggle-thumb" />
          </span>
          <span className="config-panel__toggle-label">
            {localValue ? 'ON' : 'OFF'}
          </span>
        </label>
      )}

      {type === 'select' && options && (
        <select
          value={String(localValue ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="config-panel__select"
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}

      {type === 'color' && (
        <div className="config-panel__field-color">
          <input
            type="color"
            value={String(localValue ?? '#ffffff')}
            onChange={(e) => onChange(e.target.value)}
            className="config-panel__color-input"
          />
          <span className="config-panel__color-value">{String(localValue)}</span>
        </div>
      )}
    </div>
  );
}
