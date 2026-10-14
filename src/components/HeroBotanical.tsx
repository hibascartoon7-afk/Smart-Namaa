import { useEffect, useRef, useState } from 'react';

interface Node {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  glow: number;
  depth: number;
}

const NODE_COUNT = 14;

export default function HeroBotanical({ className = '' }: { className?: string }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const seed: Node[] = Array.from({ length: NODE_COUNT }, (_, i) => ({
      id: i,
      x: 50 + (Math.random() - 0.5) * 60,
      y: 50 + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 0.08,
      vy: (Math.random() - 0.5) * 0.08,
      r: 2 + Math.random() * 4,
      glow: Math.random(),
      depth: 0.4 + Math.random() * 0.6,
    }));
    setNodes(seed);

    const tick = () => {
      setNodes((prev) =>
        prev.map((n) => {
          let { x, y, vx, vy } = n;
          x += vx;
          y += vy;
          const dx = x - 50;
          const dy = y - 50;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 42) {
            vx -= (dx / dist) * 0.02;
            vy -= (dy / dist) * 0.02;
          }
          if (dist < 12) {
            vx += (dx / dist) * 0.005;
            vy += (dy / dist) * 0.005;
          }
          return { ...n, x, y, vx, vy, glow: (n.glow + 0.005) % 1 };
        }),
      );
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setTilt({ x: ((e.clientY - rect.top - cy) / cy) * 8, y: ((e.clientX - rect.left - cx) / cx) * 8 });
  };

  const edges: [number, number][] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      if (Math.sqrt(dx * dx + dy * dy) < 26) edges.push([i, j]);
    }
  }

  return (
    <div className={`relative ${className}`}>
      <svg
        viewBox="0 0 100 100"
        className="w-full h-full"
        onMouseMove={handleMove}
        onMouseLeave={() => setTilt({ x: 0, y: 0 })}
        style={{ transform: `perspective(600px) rotateX(${tilt.x}deg) rotateY(${-tilt.y}deg)`, transition: 'transform 0.3s ease-out' }}
      >
        <defs>
          <radialGradient id="g-core" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#839958" stopOpacity="0.9" />
            <stop offset="60%" stopColor="#1F5C42" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#0A3323" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="g-node" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#FAF8F5" stopOpacity="1" />
            <stop offset="50%" stopColor="#839958" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#1F5C42" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="g-root" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#839958" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#1F5C42" stopOpacity="0.15" />
          </linearGradient>
          <filter id="blur-soft"><feGaussianBlur stdDeviation="1.2" /></filter>
        </defs>

        {/* Core glow */}
        <circle cx="50" cy="50" r="40" fill="url(#g-core)" className="animate-pulse-glow" />

        {/* Root network edges */}
        <g stroke="url(#g-root)" strokeWidth="0.35" fill="none" opacity="0.7">
          {edges.map(([i, j], k) => (
            <path
              key={k}
              d={`M ${nodes[i].x} ${nodes[i].y} Q ${(nodes[i].x + nodes[j].x) / 2 + 3} ${(nodes[i].y + nodes[j].y) / 2 - 3} ${nodes[j].x} ${nodes[j].y}`}
            />
          ))}
        </g>

        {/* Central stem */}
        <path
          d="M 50 88 Q 48 70 50 50 Q 52 30 50 12"
          stroke="#1F5C42"
          strokeWidth="0.8"
          fill="none"
          opacity="0.5"
        />

        {/* Leaves */}
        <g className="animate-sway" style={{ transformOrigin: '50px 35px' }}>
          <path d="M 50 35 Q 38 28 32 36 Q 38 42 50 38 Z" fill="#1F5C42" opacity="0.55" />
          <path d="M 50 35 Q 62 28 68 36 Q 62 42 50 38 Z" fill="#1F5C42" opacity="0.55" />
        </g>
        <g className="animate-sway animate-delay-1000" style={{ transformOrigin: '50px 22px' }}>
          <path d="M 50 22 Q 40 16 36 22 Q 40 27 50 24 Z" fill="#839958" opacity="0.6" />
          <path d="M 50 22 Q 60 16 64 22 Q 60 27 50 24 Z" fill="#839958" opacity="0.6" />
        </g>

        {/* Soil layers */}
        <g opacity="0.25">
          <rect x="6" y="78" width="88" height="6" rx="3" fill="#839958" opacity="0.3" />
          <rect x="6" y="84" width="88" height="6" rx="3" fill="#1F5C42" opacity="0.2" />
        </g>

        {/* Glowing nodes */}
        {nodes.map((n) => (
          <g key={n.id} style={{ transform: `translate(${n.x}px, ${n.y}px)`, transformOrigin: 'center' }}>
            <circle r={n.r * 2.5} fill="url(#g-node)" opacity={0.2 + n.glow * 0.3} filter="url(#blur-soft)" />
            <circle r={n.r * 0.6} fill="#FAF8F5" opacity={0.7 + n.glow * 0.3} />
          </g>
        ))}
      </svg>
    </div>
  );
}
