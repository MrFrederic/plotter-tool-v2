/**
 * MmRuler — overlay rulers (horizontal + vertical) showing mm ticks.
 *
 * Props:
 *  - containerWidth / containerHeight: canvas or viewport size in CSS px
 *  - mmPerPx: how many mm one CSS pixel represents in the content
 *  - offsetX / offsetY: pan offset in CSS px (positive = content moved right/down)
 *  - scaleX / scaleY: current zoom scale (CSS px per content unit, i.e. contentUnitsToPx)
 *    At zoom 1 and offset 0 the content origin is at the center of the container.
 *    Rule: pixel_in_container = contentUnit * scale + containerSize/2 + offset
 */
import { useMemo, type FC } from 'react';
import './MmRuler.css';

interface MmRulerProps {
  containerWidth: number;
  containerHeight: number;
  /** how many mm equals 1 CSS px in the unzoomed rendering */
  mmPerPx: number;
  /** pan offset x (CSS px) */
  offsetX?: number;
  /** pan offset y (CSS px) */
  offsetY?: number;
  /** additional zoom multiplier (1 = unzoom) */
  zoom?: number;
}

const NICE_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
const TARGET_PX = 80; // desired px between labels
const TICK_MINOR_PX = 12;
const TICK_MAJOR_PX = 20;
const RULER_SIZE = 20; // px thickness of each ruler bar

function niceStep(mmPerPx: number, zoom: number): number {
  const pxPerMm = zoom / mmPerPx;
  for (const s of NICE_STEPS) {
    if (s * pxPerMm >= TARGET_PX) return s;
  }
  return NICE_STEPS[NICE_STEPS.length - 1];
}

function buildTicks(
  containerSize: number,
  mmPerPx: number,
  zoom: number,
  offset: number,
  /** center of content in container coords (px) */
  centerPx: number,
): { pos: number; mm: number; major: boolean }[] {
  const pxPerMm = zoom / mmPerPx;
  const step = niceStep(mmPerPx, zoom);
  const subStep = step / 5;

  // Invert: container px → mm
  // contentPx = containerPx - centerPx - offset   (centered + panned)
  // mm = contentPx / pxPerMm
  const toMm = (px: number) => (px - centerPx - offset) / pxPerMm;
  const toPx = (mm: number) => mm * pxPerMm + centerPx + offset;

  const minMm = toMm(0);
  const maxMm = toMm(containerSize);

  const startMm = Math.floor(minMm / subStep) * subStep;
  const ticks: { pos: number; mm: number; major: boolean }[] = [];

  for (let mm = startMm; mm <= maxMm + subStep; mm += subStep) {
    const pos = toPx(mm);
    if (pos < 0 || pos > containerSize) continue;
    const major = Math.abs(Math.round(mm / step) * step - mm) < subStep * 0.01;
    ticks.push({ pos: Math.round(pos), mm: Math.round(mm / subStep) * subStep, major });
  }
  return ticks;
}

const MmRuler: FC<MmRulerProps> = ({
  containerWidth,
  containerHeight,
  mmPerPx,
  offsetX = 0,
  offsetY = 0,
  zoom = 1,
}) => {
  if (!mmPerPx || !isFinite(mmPerPx) || mmPerPx <= 0) return null;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const hTicks = useMemo(
    () => buildTicks(containerWidth, mmPerPx, zoom, offsetX, containerWidth / 2),
    [containerWidth, mmPerPx, zoom, offsetX],
  );
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const vTicks = useMemo(
    () => buildTicks(containerHeight, mmPerPx, zoom, offsetY, containerHeight / 2),
    [containerHeight, mmPerPx, zoom, offsetY],
  );

  const step = niceStep(mmPerPx, zoom);

  return (
    <div className="mm-ruler" style={{ '--ruler-size': `${RULER_SIZE}px` } as React.CSSProperties}>
      {/* Horizontal ruler */}
      <div className="mm-ruler__h" style={{ width: containerWidth, height: RULER_SIZE }}>
        <svg width={containerWidth} height={RULER_SIZE}>
          {hTicks.map(({ pos, mm, major }) => (
            <g key={`h-${pos}`}>
              <line
                x1={pos} y1={RULER_SIZE - (major ? TICK_MAJOR_PX : TICK_MINOR_PX)}
                x2={pos} y2={RULER_SIZE}
                className={`mm-ruler__tick ${major ? 'mm-ruler__tick--major' : ''}`}
              />
              {major && (
                <text
                  x={pos + 2}
                  y={RULER_SIZE - TICK_MAJOR_PX - 2}
                  className="mm-ruler__label"
                >
                  {mm % 1 === 0 ? mm : mm.toFixed(1)}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>

      {/* Vertical ruler */}
      <div
        className="mm-ruler__v"
        style={{ width: RULER_SIZE, height: containerHeight, top: RULER_SIZE }}
      >
        <svg width={RULER_SIZE} height={containerHeight}>
          {vTicks.map(({ pos, mm, major }) => (
            <g key={`v-${pos}`}>
              <line
                x1={RULER_SIZE - (major ? TICK_MAJOR_PX : TICK_MINOR_PX)} y1={pos}
                x2={RULER_SIZE} y2={pos}
                className={`mm-ruler__tick ${major ? 'mm-ruler__tick--major' : ''}`}
              />
              {major && (
                <text
                  x={RULER_SIZE - TICK_MAJOR_PX - 2}
                  y={pos - 2}
                  className="mm-ruler__label mm-ruler__label--v"
                  transform={`rotate(-90, ${RULER_SIZE - TICK_MAJOR_PX - 2}, ${pos - 2})`}
                >
                  {mm % 1 === 0 ? mm : mm.toFixed(1)}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>

      {/* Step label */}
      <div className="mm-ruler__corner">
        <span className="mm-ruler__unit">mm</span>
        <span className="mm-ruler__step">{step >= 1 ? step.toFixed(0) : step.toFixed(1)}</span>
      </div>
    </div>
  );
};

export default MmRuler;
