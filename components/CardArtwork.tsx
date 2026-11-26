'use client';

import React, { useState } from 'react';
import { getCardImageUrl, CARD_COLOR_META } from '@/lib/gundam-keywords';
import type { GundamCardPrint } from '@/types/gundam';

interface CardArtworkProps {
  card: GundamCardPrint;
  className?: string;
  sizes?: string;
  priority?: boolean;
}

export function CardArtwork({ card, className = '' }: CardArtworkProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const colorMeta = CARD_COLOR_META[card.color] ?? CARD_COLOR_META.Colorless;

  if (failed) {
    return (
      <div
        className={`relative flex flex-col justify-between overflow-hidden rounded-lg border border-white/10 bg-[#121722] p-3 select-none ${className}`}
      >
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
          <span>{card.cardNo}</span>
          <span style={{ color: colorMeta.hex }}>{card.rarity}</span>
        </div>
        <div className="my-auto text-center">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
            {card.type}
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-200 line-clamp-2">{card.name}</div>
        </div>
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
          <span>Lv.{card.lv ?? '-'}</span>
          <span>
            {card.apRaw !== '-' ? `${card.apRaw}/${card.hpRaw}` : `C:${card.cost ?? '-'}`}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-lg bg-[#121722] ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 bg-[#161C28] animate-pulse" aria-hidden="true" />
      )}
      {/* Plain <img>: card art is proxied through /api/card-image, so next/image optimization adds nothing. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={getCardImageUrl(card.imagePath)}
        alt={`${card.name} (${card.cardNo})`}
        referrerPolicy="no-referrer"
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`h-full w-full object-cover transition-opacity duration-200 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
}
