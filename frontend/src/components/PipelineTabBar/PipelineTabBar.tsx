import { useState, useRef, useEffect, useCallback } from 'react';
import usePipelineManager from '../../store/usePipelineManager';
import './PipelineTabBar.css';

export default function PipelineTabBar() {
  const pipelines = usePipelineManager((s) => s.pipelines);
  const activePipelineId = usePipelineManager((s) => s.activePipelineId);
  const switchPipeline = usePipelineManager((s) => s.switchPipeline);
  const createPipeline = usePipelineManager((s) => s.createPipeline);
  const deletePipeline = usePipelineManager((s) => s.deletePipeline);
  const renamePipeline = usePipelineManager((s) => s.renamePipeline);
  const exportPipeline = usePipelineManager((s) => s.exportPipeline);
  const exportAllPipelines = usePipelineManager((s) => s.exportAllPipelines);
  const importPipelines = usePipelineManager((s) => s.importPipelines);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const editInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  // Focus rename input when editing starts
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportOpen) return;

    const handleClick = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [exportOpen]);

  // Auto-clear confirm close after timeout
  useEffect(() => {
    if (!confirmCloseId) return;
    const timer = setTimeout(() => setConfirmCloseId(null), 3000);
    return () => clearTimeout(timer);
  }, [confirmCloseId]);

  const startRename = useCallback((id: string, currentName: string) => {
    setEditingId(id);
    setEditValue(currentName);
  }, []);

  const commitRename = useCallback(() => {
    if (editingId && editValue.trim()) {
      renamePipeline(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue('');
  }, [editingId, editValue, renamePipeline]);

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setEditValue('');
  }, []);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string);
          importPipelines(data);
        } catch {
          // invalid JSON — silently ignore
        }
      };
      reader.readAsText(file);

      // Reset so re-importing the same file triggers change event
      e.target.value = '';
    },
    [importPipelines],
  );

  const truncateName = (name: string, max = 20) =>
    name.length > max ? name.slice(0, max - 1) + '…' : name;

  return (
    <div className="pipeline-tab-bar">
      <div className="pipeline-tab-bar__tabs">
        {pipelines.map((p) => {
          const isActive = p.id === activePipelineId;
          const isConfirming = confirmCloseId === p.id;
          const isEditing = editingId === p.id;

          return (
            <button
              key={p.id}
              className={`pipeline-tab-bar__tab${isActive ? ' pipeline-tab-bar__tab--active' : ''}`}
              onClick={() => switchPipeline(p.id)}
              title={p.name}
              type="button"
            >
              {isEditing ? (
                <input
                  ref={editInputRef}
                  className="pipeline-tab-bar__rename-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') cancelRename();
                    e.stopPropagation();
                  }}
                  onBlur={commitRename}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : isConfirming ? (
                <span className="pipeline-tab-bar__confirm">
                  <span>CLOSE?</span>
                  <button
                    type="button"
                    className="pipeline-tab-bar__confirm-btn pipeline-tab-bar__confirm-btn--yes"
                    onClick={(e) => {
                      e.stopPropagation();
                      deletePipeline(p.id);
                      setConfirmCloseId(null);
                    }}
                    title="Confirm close"
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className="pipeline-tab-bar__confirm-btn pipeline-tab-bar__confirm-btn--no"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmCloseId(null);
                    }}
                    title="Cancel"
                  >
                    ✕
                  </button>
                </span>
              ) : (
                <>
                  <span
                    className="pipeline-tab-bar__name"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startRename(p.id, p.name);
                    }}
                  >
                    {truncateName(p.name)}
                  </span>
                  {pipelines.length > 1 && (
                    <span
                      role="button"
                      tabIndex={-1}
                      className="pipeline-tab-bar__close"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmCloseId(p.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.stopPropagation();
                          setConfirmCloseId(p.id);
                        }
                      }}
                      title="Close pipeline"
                    >
                      ×
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}

        <button
          type="button"
          className="pipeline-tab-bar__new"
          onClick={() => createPipeline()}
          title="New pipeline"
        >
          +
        </button>
      </div>

      <div className="pipeline-tab-bar__utils">
        <div ref={exportRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className="pipeline-tab-bar__util-btn"
            onClick={() => setExportOpen((prev) => !prev)}
          >
            EXPORT
          </button>

          {exportOpen && (
            <div className="pipeline-tab-bar__dropdown">
              <button
                type="button"
                className="pipeline-tab-bar__dropdown-item"
                onClick={() => {
                  exportPipeline(activePipelineId);
                  setExportOpen(false);
                }}
              >
                Export Current
              </button>
              <button
                type="button"
                className="pipeline-tab-bar__dropdown-item"
                onClick={() => {
                  exportAllPipelines();
                  setExportOpen(false);
                }}
              >
                Export All
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          className="pipeline-tab-bar__util-btn"
          onClick={handleImportClick}
        >
          IMPORT
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>
    </div>
  );
}
