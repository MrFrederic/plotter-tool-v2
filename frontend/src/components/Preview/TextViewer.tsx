import { useMemo } from 'react';
import './TextViewer.css';

interface TextViewerProps {
  data: unknown;
}

function toDisplayString(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data === null || data === undefined) return '';
  if (typeof data === 'object') return JSON.stringify(data, null, 2);
  return String(data);
}

export default function TextViewer({ data }: TextViewerProps) {
  const text = toDisplayString(data);

  const lines = useMemo(() => text.split('\n'), [text]);

  const charCount = text.length;
  const lineCount = lines.length;

  return (
    <div className="text-viewer">
      <div className="text-viewer__content">
        {lines.map((line, i) => (
          <div key={i} className="text-viewer__line">
            <span className="text-viewer__line-num">{i + 1}</span>
            <span className="text-viewer__line-text">{line}</span>
          </div>
        ))}
      </div>
      <div className="text-viewer__info">
        <span className="text-viewer__stat">{charCount.toLocaleString()} chars</span>
        <span className="text-viewer__stat">{lineCount.toLocaleString()} lines</span>
      </div>
    </div>
  );
}
