import { memo, type FC } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

const CustomEdge: FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerStart,
  markerEnd,
  interactionWidth = 24,
  style = {},
}) => {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth}
        style={{
          ...style,
          stroke: 'var(--accent-cyan)',
          strokeWidth: 1.5,
          fill: 'none',
          strokeOpacity: 0.4,
        }}
      />
      <path
        d={edgePath}
        style={{
          stroke: 'var(--accent-cyan)',
          strokeWidth: 1.5,
          fill: 'none',
          strokeDasharray: '6 4',
          strokeDashoffset: 0,
          animation: 'edgeFlow 1.5s linear infinite',
          strokeOpacity: 0.8,
          pointerEvents: 'none',
        }}
      />
    </>
  );
};

export default memo(CustomEdge);
