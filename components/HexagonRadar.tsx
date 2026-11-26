'use client';

import React, { useState } from 'react';
import type { HexagonAxes } from '@/types/gundam';

export const HEXAGON_AXIS_META: {
  key: keyof HexagonAxes;
  label: string;
  shortLabel: string;
}[] = [
  { key: 'aggro', label: 'Aggro / Pressure', shortLabel: 'Aggro' },
  { key: 'attack', label: 'Attack / Ping', shortLabel: 'Attack' },
  { key: 'liquidity', label: 'Card Liquidity', shortLabel: 'Liquidity' },
  { key: 'synergy', label: 'Synergy / Link', shortLabel: 'Synergy' },
  { key: 'control', label: 'Control / Disruption', shortLabel: 'Control' },
  { key: 'defense', label: 'Defense / Durability', shortLabel: 'Defense' },
];

interface HexagonRadarProps {
  primary: HexagonAxes;
  primaryLabel?: string;
  secondary?: HexagonAxes | null;
  secondaryLabel?: string;
  secondaryColor?: string;
  size?: number;
  onSelectAxis?: (axis: keyof HexagonAxes) => void;
  selectedAxis?: keyof HexagonAxes | null;
}

export function HexagonRadar({
  primary,
  primaryLabel = 'Current Deck',
  secondary = null,
  secondaryLabel = 'Comparison',
  secondaryColor = '#F59E0B',
  size = 340,
  onSelectAxis,
  selectedAxis = null,
}: HexagonRadarProps) {
  const [hovered, setHovered] = useState<keyof HexagonAxes | null>(null);

  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.33;
  const levels = [20, 40, 60, 80, 100];

  const getPoint = (index: number, value: number) => {
    const angle = (-Math.PI / 2) + (index * (2 * Math.PI)) / 6;
    const r = (Math.max(0, Math.min(100, value)) / 100) * radius;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  };

  const getPolygonPoints = (axes: HexagonAxes) =>
    HEXAGON_AXIS_META.map((ax, idx) => {
      const pt = getPoint(idx, axes[ax.key]);
      return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    }).join(' ');

  const activeAxis = hovered ?? selectedAxis;

  return (
    <div className="flex flex-col items-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="overflow-visible select-none"
        role="img"
        aria-label="6-Axis Deck Analysis Hexagon"
      >
        {/* Concentric grid rings */}
        {levels.map((lvl) => {
          const pts = HEXAGON_AXIS_META.map((_, idx) => {
            const p = getPoint(idx, lvl);
            return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
          }).join(' ');
          return (
            <polygon
              key={lvl}
              points={pts}
              fill={lvl === 100 ? 'rgba(255,255,255,0.015)' : 'none'}
              stroke="rgba(255,255,255,0.09)"
              strokeWidth={lvl === 100 ? 1.2 : 0.8}
            />
          );
        })}

        {/* Radial spokes */}
        {HEXAGON_AXIS_META.map((ax, idx) => {
          const outer = getPoint(idx, 100);
          const isActive = activeAxis === ax.key;
          return (
            <line
              key={ax.key}
              x1={cx}
              y1={cy}
              x2={outer.x}
              y2={outer.y}
              stroke={isActive ? 'rgba(59,130,246,0.55)' : 'rgba(255,255,255,0.09)'}
              strokeWidth={isActive ? 1.5 : 1}
            />
          );
        })}

        {/* Ring numeric markers along top spoke */}
        {[40, 80, 100].map((lvl) => {
          const pt = getPoint(0, lvl);
          return (
            <text
              key={lvl}
              x={pt.x + 6}
              y={pt.y + 3}
              fill="rgba(148,163,184,0.55)"
              fontSize="9"
              className="font-mono tabular-nums"
            >
              {lvl}
            </text>
          );
        })}

        {/* Secondary polygon (Target Blueprint or Opponent Deck) */}
        {secondary && (
          <polygon
            points={getPolygonPoints(secondary)}
            fill={`${secondaryColor}22`}
            stroke={secondaryColor}
            strokeWidth={2}
            strokeDasharray="5 4"
          />
        )}

        {/* Primary polygon */}
        <polygon
          points={getPolygonPoints(primary)}
          fill="rgba(59, 130, 246, 0.24)"
          stroke="#3B82F6"
          strokeWidth={2.2}
        />

        {/* Vertex dots + Labels */}
        {HEXAGON_AXIS_META.map((ax, idx) => {
          const val = primary[ax.key];
          const secVal = secondary ? secondary[ax.key] : null;
          const pt = getPoint(idx, val);
          const labelPt = getPoint(idx, 123);
          const isActive = activeAxis === ax.key;

          let textAnchor: 'middle' | 'start' | 'end' = 'middle';
          if (idx === 1 || idx === 2) textAnchor = 'start';
          if (idx === 4 || idx === 5) textAnchor = 'end';

          return (
            <g
              key={ax.key}
              className="cursor-pointer"
              onMouseEnter={() => setHovered(ax.key)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSelectAxis?.(ax.key)}
            >
              {secondary && secVal !== null && (
                <circle
                  cx={getPoint(idx, secVal).x}
                  cy={getPoint(idx, secVal).y}
                  r={3.5}
                  fill={secondaryColor}
                />
              )}
              <circle
                cx={pt.x}
                cy={pt.y}
                r={isActive ? 5.5 : 4}
                fill={isActive ? '#93C5FD' : '#3B82F6'}
                stroke="#0B0E14"
                strokeWidth={1.5}
              />
              <text
                x={labelPt.x}
                y={labelPt.y - 4}
                textAnchor={textAnchor}
                fill={isActive ? '#F8FAFC' : '#CBD5E1'}
                fontSize="11.5"
                fontWeight={isActive ? 600 : 500}
              >
                {ax.shortLabel}
              </text>
              <text
                x={labelPt.x}
                y={labelPt.y + 11}
                textAnchor={textAnchor}
                fill="#93C5FD"
                fontSize="11"
                className="font-mono tabular-nums"
              >
                {val}
                {secVal !== null ? ` / ${secVal}` : ''}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-5 text-xs text-slate-300">
        <span className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-500" />
          <span>{primaryLabel}</span>
        </span>
        {secondary && (
          <span className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed"
              style={{ borderColor: secondaryColor, backgroundColor: `${secondaryColor}33` }}
            />
            <span>{secondaryLabel}</span>
          </span>
        )}
      </div>
    </div>
  );
}
