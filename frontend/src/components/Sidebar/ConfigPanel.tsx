import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import './ConfigPanel.css';
import useFlowStore, { START_NODE_ID, END_NODE_ID } from '../../store/useFlowStore';
import type { FileCategory, UploadedFile } from '../../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'bmp', 'tiff', 'tif', 'webp', 'gif']);
const VECTOR_EXTS = new Set(['svg', 'dxf', 'ai', 'eps']);
const GCODE_EXTS = new Set(['gcode', 'nc', 'ngc', 'tap', 'cnc']);
const TEXT_EXTS = new Set(['txt', 'md', 'log', 'csv', 'tsv', 'xml', 'json', 'yaml', 'yml']);

function categorizeFile(file: File): FileCategory {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VECTOR_EXTS.has(ext)) return 'vector';
  if (GCODE_EXTS.has(ext)) return 'gcode';
  if (TEXT_EXTS.has(ext)) return 'text';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('text/')) return 'text';
  return 'other';
}

export default function ConfigPanel() {
  const nodes = useFlowStore((s) => s.nodes);
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const updateNodeParams = useFlowStore((s) => s.updateNodeParams);
  const nodeErrors = useFlowStore((s) => s.nodeErrors);
  const uploadedFile = useFlowStore((s) => s.uploadedFile);
  const setUploadedFile = useFlowStore((s) => s.setUploadedFile);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode) return null;

  const isStart = selectedNodeId === START_NODE_ID;
  const isEnd = selectedNodeId === END_NODE_ID;
  const errorMsg = selectedNodeId ? nodeErrors[selectedNodeId] : undefined;
  const { label, category, parameters, params, status } = selectedNode.data;

  return (
    <div className="config-panel">
      <div className="config-panel__header">
        <span className="config-panel__title">
          {isStart ? 'FILE INPUT' : isEnd ? 'FILE OUTPUT' : 'PARAMETERS'}
        </span>
        <span className="config-panel__status" data-status={status}>
          {status}
        </span>
      </div>

      <div className="config-panel__node-info">
        <div className="config-panel__node-name">{label}</div>
        <div className="config-panel__node-category">{category}</div>
        <div className="config-panel__node-id">{selectedNodeId}</div>
      </div>

      {/* Error display */}
      {errorMsg && (
        <div className="config-panel__error-section">
          <div className="config-panel__error-header">⚠ EXECUTION ERROR</div>
          <div className="config-panel__error-body">{errorMsg}</div>
        </div>
      )}

      {/* Start node: file upload */}
      {isStart && (
        <div className="config-panel__fields">
          <FileUploadArea
            uploadedFile={uploadedFile}
            onUpload={setUploadedFile}
          />
        </div>
      )}

      {/* End node: download area */}
      {isEnd && (
        <div className="config-panel__fields">
          <div className="config-panel__download-section">
            <div className="config-panel__download-icon">↓</div>
            <div className="config-panel__download-label">
              Connect processing nodes to the input ports.
              Results will be available for download after execution.
            </div>
          </div>
        </div>
      )}

      {/* Regular nodes: parameters */}
      {!isStart && !isEnd && (
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
      )}
    </div>
  );
}

/* ──── File Upload Area ──── */

interface FileUploadAreaProps {
  uploadedFile: UploadedFile | null;
  onUpload: (file: UploadedFile | null) => void;
}

function FileUploadArea({ uploadedFile, onUpload }: FileUploadAreaProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const processFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const category = categorizeFile(file);
        onUpload({
          name: file.name,
          size: file.size,
          type: file.type,
          category,
          dataUrl: reader.result as string,
        });
      };
      reader.readAsDataURL(file);

      // Also upload to backend
      const formData = new FormData();
      formData.append('file', file);
      fetch(`${API_URL}/upload/`, {
        method: 'POST',
        body: formData,
      }).catch((err) => {
        console.debug('Backend upload failed:', err);
      });
    },
    [onUpload],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  return (
    <div className="config-panel__upload-section">
      <div
        className={`config-panel__dropzone ${dragOver ? 'config-panel__dropzone--active' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          className="config-panel__file-input"
          onChange={handleFileSelect}
        />
        <div className="config-panel__dropzone-icon">⇪</div>
        <div className="config-panel__dropzone-text">
          {dragOver ? 'Release to upload' : 'Drop file here or click to browse'}
        </div>
      </div>

      {uploadedFile && (
        <div className="config-panel__file-detail">
          <div className="config-panel__file-row">
            <span className="config-panel__file-label">FILE</span>
            <span className="config-panel__file-value">{uploadedFile.name}</span>
          </div>
          <div className="config-panel__file-row">
            <span className="config-panel__file-label">TYPE</span>
            <span className="config-panel__file-value">{uploadedFile.category.toUpperCase()}</span>
          </div>
          <div className="config-panel__file-row">
            <span className="config-panel__file-label">SIZE</span>
            <span className="config-panel__file-value">
              {(uploadedFile.size / 1024).toFixed(1)} KB
            </span>
          </div>
          <button
            className="config-panel__file-clear"
            onClick={() => onUpload(null)}
          >
            ✕ Remove file
          </button>
        </div>
      )}
    </div>
  );
}

/* ──── Parameter Field (unchanged logic) ──── */

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
