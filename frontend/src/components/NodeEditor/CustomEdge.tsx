import { type FC } from 'react';
import { getBezierPath, type EdgeProps } from '@xyflow/react';

const CustomEdge: FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
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
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        style={{
          ...style,
          stroke: '#00f0ff',
          strokeWidth: 1.5,
          fill: 'none',
          strokeOpacity: 0.4,
        }}
      />
      <path
        d={edgePath}
        style={{
          stroke: '#00f0ff',
          strokeWidth: 1.5,
          fill: 'none',
          strokeDasharray: '6 4',
          strokeDashoffset: 0,
          animation: 'edgeFlow 1.5s linear infinite',
          strokeOpacity: 0.8,
        }}
      />
    </>
  );
};

export default CustomEdge;
