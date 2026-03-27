function generateSerial(): string {
  const hex = () =>
    Math.floor(Math.random() * 0xffff)
      .toString(16)
      .toUpperCase()
      .padStart(4, '0');
  return `${hex()}-${hex()}-${hex()}`;
}

// Generated once at module load — stable across re-renders without any hook
const OVERLAY_SERIAL = generateSerial();
const OVERLAY_BUILD_ID = `BUILD ${Math.floor(Math.random() * 9000 + 1000)}.${Math.floor(Math.random() * 100)}`;

export default function DecorativeOverlay() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9998,
        overflow: 'hidden',
      }}
    >
      {/* Top-left corner markers */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          color: 'var(--text-dim)',
          fontSize: 9,
          fontFamily: 'var(--font-mono)',
          opacity: 0.4,
          lineHeight: 1.6,
        }}
      >
        <div>┌ SYS.PLOTTER.v2</div>
        <div>│ {OVERLAY_BUILD_ID}</div>
        <div>│ S/N {OVERLAY_SERIAL}</div>
      </div>

      {/* Bottom-right corner markers */}
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          right: 8,
          color: 'var(--text-dim)',
          fontSize: 9,
          fontFamily: 'var(--font-mono)',
          opacity: 0.4,
          textAlign: 'right',
          lineHeight: 1.6,
        }}
      >
        <div>COORD 00.000 / 00.000 │</div>
        <div>RES 1920x1080 │</div>
        <div>MEM ████░░░░ 48% ┘</div>
      </div>

      {/* Top-right registration mark */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          color: 'var(--text-dim)',
          fontSize: 9,
          fontFamily: 'var(--font-mono)',
          opacity: 0.3,
        }}
      >
        ┐
      </div>

      {/* Bottom-left registration mark */}
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          color: 'var(--text-dim)',
          fontSize: 9,
          fontFamily: 'var(--font-mono)',
          opacity: 0.3,
        }}
      >
        └
      </div>
    </div>
  );
}
