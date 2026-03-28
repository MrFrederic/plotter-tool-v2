import './ScanlineOverlay.css';

export default function ScanlineOverlay() {
  return (
    <div
      className="scanline-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        background:
          'repeating-linear-gradient(0deg, rgba(0,0,0,0.03) 0px, rgba(0,0,0,0.03) 1px, transparent 1px, transparent 2px)',
      }}
    />
  );
}
