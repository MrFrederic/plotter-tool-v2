import { useMemo } from 'react';
import './TextViewer.css';

interface TextViewerProps {
  data: unknown;
}

export default function TextViewer({ data }: TextViewerProps) {
  const text = typeof data === 'string' ? data : String(data ?? '');

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
