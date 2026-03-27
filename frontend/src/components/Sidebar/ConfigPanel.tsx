import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import './ConfigPanel.css';
import useFlowStore, { START_NODE_ID, END_NODE_ID } from '../../store/useFlowStore';
import usePipelineStore from '../../store/usePipelineStore';
import { fetchNodeResult, uploadFile } from '../../api/rest';
import type { FileCategory, UploadedFile } from '../../types';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'bmp', 'tiff', 'tif', 'webp', 'gif']);
const VECTOR_EXTS = new Set(['svg', 'dxf', 'ai', 'eps']);
const GCODE_EXTS = new Set(['gcode', 'nc', 'ngc', 'tap', 'cnc']);
const TEXT_EXTS = new Set(['txt', 'md', 'log', 'csv', 'tsv', 'xml', 'json', 'yaml', 'yml']);

function sanitizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'output';
}

function decodeBase64ToBlob(data: string, mimeType: string): Blob {
  const rawData = data.includes(',') ? data.split(',')[1] : data;
  const binary = atob(rawData);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function buildDownloadAsset(
  type: FileCategory,
  value: unknown,
): { blob: Blob; extension: string } {
  if (type === 'image') {
    if (typeof value !== 'string') {
      throw new Error('Image output is missing or malformed.');
    }
    return { blob: decodeBase64ToBlob(value, 'image/png'), extension: 'png' };
  }

  if (type === 'vector') {
    const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return { blob: new Blob([content], { type: 'image/svg+xml' }), extension: 'svg' };
  }

  if (type === 'gcode') {
    const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return { blob: new Blob([content], { type: 'text/plain;charset=utf-8' }), extension: 'gcode' };
  }

  if (type === 'text') {
    const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return { blob: new Blob([content], { type: 'text/plain;charset=utf-8' }), extension: 'txt' };
  }

  if (type === 'path') {
    const content = JSON.stringify(value, null, 2);
    return { blob: new Blob([content], { type: 'application/json' }), extension: 'json' };
  }

  if (typeof value === 'string') {
    return { blob: new Blob([value], { type: 'text/plain;charset=utf-8' }), extension: 'txt' };
  }

  return {
    blob: new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    extension: 'json',
  };
}

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
  const sessionId = usePipelineStore((s) => s.sessionId);
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
          <OutputDownloadArea sessionId={sessionId} />
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

interface OutputDownloadAreaProps {
  sessionId: string;
}

function OutputDownloadArea({ sessionId }: OutputDownloadAreaProps) {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const incomingEdges = edges.filter((edge) => edge.target === END_NODE_ID);
  const selectedEdge = incomingEdges.find((edge) => {
    const candidateNode = nodes.find((node) => node.id === edge.source);
    const candidateStatus = candidateNode?.data.status;
    return candidateStatus === 'DONE' || candidateStatus === 'CACHED';
  }) ?? incomingEdges[0] ?? null;
  const sourceNode = selectedEdge
    ? nodes.find((node) => node.id === selectedEdge.source)
    : undefined;

  const targetType = selectedEdge?.targetHandle ?? 'other';
  const sourceStatus = sourceNode?.data.status ?? 'IDLE';
  const isSourceReady = sourceStatus === 'DONE' || sourceStatus === 'CACHED';
  const canDownload = Boolean(sourceNode && selectedEdge?.sourceHandle && isSourceReady && !isDownloading);

  const handleDownload = useCallback(async () => {
    if (!sourceNode || !selectedEdge?.sourceHandle) return;

    setError(null);
    setIsDownloading(true);

    try {
      const result = await fetchNodeResult(sessionId, sourceNode.id);
      const value = result.data[selectedEdge.sourceHandle];
      if (value === undefined || value === null) {
        throw new Error(`Output port "${selectedEdge.sourceHandle}" is empty.`);
      }

      const outputType = (targetType as FileCategory) || 'other';
      const { blob, extension } = buildDownloadAsset(outputType, value);
      const baseName = sanitizeName(sourceNode.data.label);
      const fileName = `${baseName}_${selectedEdge.sourceHandle}.${extension}`;

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      const message = downloadError instanceof Error
        ? downloadError.message
        : 'Failed to download output.';
      setError(message);
    } finally {
      setIsDownloading(false);
    }
  }, [sessionId, selectedEdge, sourceNode, targetType]);

  return (
    <div className="config-panel__download-section">
      <div className="config-panel__download-icon">↓</div>

      {!selectedEdge && (
        <div className="config-panel__download-label">
          Connect any node output to this output node to enable download.
        </div>
      )}

      {selectedEdge && sourceNode && (
        <>
          <div className="config-panel__download-meta">
            <div>
              SOURCE: <span>{sourceNode.data.label}</span>
            </div>
            <div>
              PORT: <span>{selectedEdge.sourceHandle}</span>
            </div>
            <div>
              STATUS: <span>{sourceStatus}</span>
            </div>
          </div>

          <button
            className="config-panel__download-button"
            onClick={() => void handleDownload()}
            disabled={!canDownload}
          >
            {isDownloading ? 'PREPARING…' : 'DOWNLOAD OUTPUT'}
          </button>

          {!isSourceReady && (
            <div className="config-panel__download-label">
              Execute pipeline first. Source node must be DONE or CACHED.
            </div>
          )}
        </>
      )}

      {error && <div className="config-panel__download-error">{error}</div>}
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
  const updateNodeParams = useFlowStore((s) => s.updateNodeParams);
  const sessionId = usePipelineStore((s) => s.sessionId);

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

      // Upload to backend and store path in Start node params
      const category = categorizeFile(file);
      uploadFile(file, sessionId)
        .then((data) => {
          updateNodeParams(START_NODE_ID, {
            file_path: data.path,
            file_category: category,
          });
        })
        .catch((err) => {
          console.debug(`Backend upload failed for "${file.name}":`, err);
        });
    },
    [onUpload, updateNodeParams, sessionId],
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
