import { useMemo } from 'react';
import './OtherViewer.css';

interface OtherViewerProps {
  data: unknown;
}

function getDataType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function getDataSize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return `${value.length} chars`;
  if (Array.isArray(value)) return `${value.length} items`;
  if (typeof value === 'object') return `${Object.keys(value as object).length} keys`;
  return null;
}

export default function OtherViewer({ data }: OtherViewerProps) {
  const dataType = getDataType(data);
  const dataSize = getDataSize(data);

  const preview = useMemo(() => {
    if (data === null || data === undefined) return 'null';
    if (typeof data === 'object') return JSON.stringify(data, null, 2);
    return String(data);
  }, [data]);

  return (
    <div className="other-viewer">
      <div className="other-viewer__meta">
        <span className="other-viewer__label">TYPE</span>
        <span className="other-viewer__value">{dataType}</span>
        {dataSize !== null && (
          <>
            <span className="other-viewer__sep">·</span>
            <span className="other-viewer__label">SIZE</span>
            <span className="other-viewer__value">{dataSize}</span>
          </>
        )}
      </div>
      <div className="other-viewer__content">
        <pre className="other-viewer__pre">{preview}</pre>
      </div>
    </div>
  );
}
