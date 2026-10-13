'use client';

import React, { useRef, useEffect, useCallback } from 'react';

interface ClickSparkProps {
  sparkColor?: string;
  sparkSize?: number;
  sparkRadius?: number;
  sparkCount?: number;
  duration?: number;
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
  extraScale?: number;
  children?: React.ReactNode;
}

interface Spark {
  x: number;
  y: number;
  angle: number;
  startTime: number;
}

const ClickSpark: React.FC<ClickSparkProps> = ({
  sparkColor = '#fff',
  sparkSize = 10,
  sparkRadius = 15,
  sparkCount = 8,
  duration = 400,
  easing = 'ease-out',
  extraScale = 1.0,
  children
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparksRef = useRef<Spark[]>([]);
  const startTimeRef = useRef<number | null>(null);

  // assign patch: one fixed, viewport-sized canvas (DPR aware) instead of one as tall as the page.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  const easeFunc = useCallback(
    (t: number) => {
      switch (easing) {
        case 'linear':
          return t;
        case 'ease-in':
          return t * t;
        case 'ease-in-out':
          return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        default:
          return t * (2 - t);
      }
    },
    [easing]
  );

  const loopRef = useRef<number | null>(null);
  const draw = useCallback((timestamp: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) { loopRef.current = null; return; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    sparksRef.current = sparksRef.current.filter((spark: Spark) => {
      const elapsed = timestamp - spark.startTime;
      if (elapsed >= duration) return false;
      const eased = easeFunc(Math.max(0, elapsed) / duration);
      const distance = eased * sparkRadius * extraScale;
      const lineLength = sparkSize * (1 - eased);
      ctx.strokeStyle = sparkColor;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(spark.x + distance * Math.cos(spark.angle), spark.y + distance * Math.sin(spark.angle));
      ctx.lineTo(spark.x + (distance + lineLength) * Math.cos(spark.angle), spark.y + (distance + lineLength) * Math.sin(spark.angle));
      ctx.stroke();
      return true;
    });
    loopRef.current = sparksRef.current.length ? requestAnimationFrame(draw) : null;
  }, [sparkColor, sparkSize, sparkRadius, duration, easeFunc, extraScale]);
  useEffect(() => () => { if (loopRef.current) cancelAnimationFrame(loopRef.current); }, []);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (e.detail === 0) return; // keyboard "clicks"
    const x = e.clientX;
    const y = e.clientY;

    const now = performance.now();
    const newSparks: Spark[] = Array.from({ length: sparkCount }, (_, i) => ({
      x,
      y,
      angle: (2 * Math.PI * i) / sparkCount,
      startTime: now
    }));

    sparksRef.current.push(...newSparks);
    if (!loopRef.current) loopRef.current = requestAnimationFrame(draw);
  };

  return (
    <div style={{ minHeight: '100%' }} onClickCapture={handleClick}>
      <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 1000 }} />
      {children}
    </div>
  );
};

export default ClickSpark;
