import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { buildApiUrl } from '../../api/rest';
import './MarkdownContent.css';

interface MarkdownContentProps {
  markdown: string;
  pluginName?: string;
  compact?: boolean;
}

const PASSTHROUGH_URL_RE = /^(?:[a-z]+:|\/\/|#)/i;

function encodePluginAssetPath(assetPath: string): string {
  return assetPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function resolveMarkdownUrl(pluginName: string | undefined, url: string): string {
  if (!url || PASSTHROUGH_URL_RE.test(url)) {
    return url;
  }

  if (!pluginName) {
    return url;
  }

  const normalized = url.replace(/^\.\//, '');
  return buildApiUrl(`/plugins/${encodeURIComponent(pluginName)}/assets/${encodePluginAssetPath(normalized)}`);
}

export default function MarkdownContent({ markdown, pluginName, compact = false }: MarkdownContentProps) {
  return (
    <div className={`markdown-content ${compact ? 'markdown-content--compact' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => resolveMarkdownUrl(pluginName, url)}
        components={{
          a: ({ node, ...props }) => {
            void node;
            return <a {...props} target="_blank" rel="noreferrer" />;
          },
          img: ({ node, ...props }) => {
            void node;
            return <img {...props} loading="lazy" alt={props.alt || ''} />;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
      {compact && <span className="markdown-content__fade" aria-hidden="true" />}
    </div>
  );
}