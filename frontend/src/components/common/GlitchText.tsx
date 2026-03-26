import { useEffect, useState, useRef } from 'react';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+=<>';

interface GlitchTextProps {
  text: string;
  duration?: number;
  className?: string;
}

export default function GlitchText({ text, duration = 600, className }: GlitchTextProps) {
  const [display, setDisplay] = useState(text);
  const frameRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    let iteration = 0;
    const totalSteps = Math.ceil(duration / 30);

    if (frameRef.current) clearInterval(frameRef.current);

    frameRef.current = setInterval(() => {
      setDisplay(
        text
          .split('')
          .map((char, i) => {
            if (char === ' ') return ' ';
            if (i < (iteration / totalSteps) * text.length) return text[i];
            return CHARS[Math.floor(Math.random() * CHARS.length)];
          })
          .join(''),
      );

      iteration++;
      if (iteration > totalSteps) {
        clearInterval(frameRef.current);
        setDisplay(text);
      }
    }, 30);

    return () => {
      if (frameRef.current) clearInterval(frameRef.current);
    };
  }, [text, duration]);

  return <span className={className}>{display}</span>;
}
