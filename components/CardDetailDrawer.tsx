'use client';

import React, { useMemo, useState } from 'react';
import { X, Plus, Minus, ExternalLink, Layers, Link2, HelpCircle } from 'lucide-react';
import type { CollectionMap, GundamCardGroup, GundamCardPrint } from '@/types/gundam';
import {
  CARD_COLOR_META,
  doesPilotLinkUnit,
  extractCardKeywords,
} from '@/lib/gundam-keywords';
import { CardArtwork } from '@/components/CardArtwork';

interface CardDetailDrawerProps {
  group: GundamCardGroup;
  initialPrintId?: string;
  allCards: GundamCardPrint[];
  collection: CollectionMap;
  onUpdateCollection: (printId: string, delta: number) => void;
  onAddToDeck?: (card: GundamCardPrint) => void;
  activeDeckName?: string;
  onSelectCardNo: (cardNo: string) => void;
  onClose: () => void;
}

export function CardDetailDrawer({
  group,
  initialPrintId,
  allCards,
  collection,
  onUpdateCollection,
  onAddToDeck,
  activeDeckName,
  onSelectCardNo,
  onClose,
}: CardDetailDrawerProps) {
  const [selectedPrintId, setSelectedPrintId] = useState<string>(
    initialPrintId || group.primary.printId
  );

  const activeCard =
    group.variants.find((v) => v.printId === selectedPrintId) ?? group.primary;

  const colorMeta = CARD_COLOR_META[activeCard.color] ?? CARD_COLOR_META.Colorless;
  const keywords = useMemo(() => extractCardKeywords(activeCard.effect), [activeCard.effect]);

  // Find cross-linked Pilot / Unit partners
  const linkPartners = useMemo(() => {
    const baseByNo = new Map<string, GundamCardPrint>();
    for (const c of allCards) {
      const prev = baseByNo.get(c.cardNo);
      if (!prev || (prev.isParallel && !c.isParallel)) {
        baseByNo.set(c.cardNo, c);
      }
    }
    const list = [...baseByNo.values()];
    if (activeCard.type === 'UNIT' && activeCard.link) {
      return list.filter((p) => p.type === 'PILOT' && doesPilotLinkUnit(p, activeCard)).slice(0, 8);
    }
    if (activeCard.type === 'PILOT') {
      return list.filter((u) => u.type === 'UNIT' && doesPilotLinkUnit(activeCard, u)).slice(0, 8);
    }
    return [];
  }, [activeCard, allCards]);

  const totalOwnedForCardNo = group.variants.reduce(
    (sum, v) => sum + (collection[v.printId] ?? 0),
    0
  );
  const currentPrintOwned = collection[activeCard.printId] ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${activeCard.name} Details`}
    >
      <div
        className="relative flex h-full w-full max-w-3xl flex-col overflow-y-auto border-l border-white/10 bg-[#0F141E] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.08] bg-[#0F141E]/95 px-6 py-4 backdrop-blur-sm">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono tabular-nums">
              <span className="text-slate-200 font-semibold">{activeCard.cardNo}</span>
              <span aria-hidden="true">·</span>
              <span>{activeCard.rarity}</span>
              <span aria-hidden="true">·</span>
              <span>Block {activeCard.blockIcon}</span>
              {activeCard.sourceTitle && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="truncate font-sans">{activeCard.sourceTitle}</span>
                </>
              )}
            </div>
            <h2 className="mt-0.5 font-display text-2xl font-bold tracking-wide text-white truncate">
              {activeCard.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Close card inspector"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-8 p-6 md:grid-cols-12">
          {/* Left: High-res Card Art & Variant Switcher */}
          <div className="md:col-span-5 space-y-4">
            <div className="aspect-[5/7] w-full overflow-hidden rounded-xl border border-white/10 bg-[#0B0E14] shadow-lg">
              <CardArtwork key={activeCard.printId} card={activeCard} className="h-full w-full" />
            </div>

            {/* Parallel / Alternate Art Switcher */}
            {group.variants.length > 1 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                  <Layers className="h-3.5 w-3.5" />
                  <span>Prints & Alternate Arts ({group.variants.length})</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {group.variants.map((variant, idx) => {
                    const isSelected = variant.printId === activeCard.printId;
                    const qty = collection[variant.printId] ?? 0;
                    const label = variant.isParallel
                      ? `Alt Art ${idx} (${variant.rarity})`
                      : `Standard (${variant.rarity})`;
                    return (
                      <button
                        key={variant.printId}
                        type="button"
                        onClick={() => setSelectedPrintId(variant.printId)}
                        className={`flex items-center justify-between rounded-md border px-2.5 py-2 text-left text-xs transition-colors whitespace-nowrap ${
                          isSelected
                            ? 'border-blue-500/70 bg-blue-500/15 text-white'
                            : 'border-white/[0.08] bg-white/[0.02] text-slate-300 hover:bg-white/[0.06]'
                        }`}
                      >
                        <span className="truncate">{label}</span>
                        {qty > 0 && (
                          <span className="ml-1.5 font-mono tabular-nums text-emerald-400">
                            ×{qty}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Collection + Deck Actions */}
            <div className="space-y-3 border-t border-white/[0.08] pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-slate-300">Owned (This Print)</div>
                  <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                    Total across prints: {totalOwnedForCardNo}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onUpdateCollection(activeCard.printId, -1)}
                    disabled={currentPrintOwned === 0}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10 disabled:opacity-40"
                    aria-label="Decrease owned count"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-8 text-center font-mono text-sm font-semibold tabular-nums text-white">
                    {currentPrintOwned}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdateCollection(activeCard.printId, 1)}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10"
                    aria-label="Increase owned count"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {onAddToDeck && (
                <button
                  type="button"
                  onClick={() => onAddToDeck(activeCard)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>
                    Add to {activeDeckName ? `"${activeDeckName}"` : 'Active Deck'}
                  </span>
                </button>
              )}

              <a
                href={`https://www.gundam-gcg.com/asia-en/cards/detail.php?detailSearch=${encodeURIComponent(
                  activeCard.printId
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-2 text-xs font-medium text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors"
              >
                <span>View on Official Gundam GCG</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          {/* Right: Structured Stats, Effect, Keywords, Link Partners, FAQ */}
          <div className="md:col-span-7 space-y-6">
            {/* Core Parameter Grid */}
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.06] sm:grid-cols-6">
              <div className="bg-[#131822] p-3">
                <div className="text-[11px] text-slate-400">Lv.</div>
                <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-white">
                  {activeCard.lv ?? '-'}
                </div>
              </div>
              <div className="bg-[#131822] p-3">
                <div className="text-[11px] text-slate-400">Cost</div>
                <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-white">
                  {activeCard.cost ?? '-'}
                </div>
              </div>
              <div className="bg-[#131822] p-3">
                <div className="text-[11px] text-slate-400">Color</div>
                <div className={`mt-0.5 text-sm font-semibold ${colorMeta.text}`}>
                  {activeCard.color}
                </div>
              </div>
              <div className="bg-[#131822] p-3">
                <div className="text-[11px] text-slate-400">Type</div>
                <div className="mt-0.5 text-xs font-semibold text-slate-100">{activeCard.type}</div>
              </div>
              <div className="bg-[#131822] p-3">
                <div className="text-[11px] text-slate-400">AP</div>
                <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-amber-300">
                  {activeCard.apRaw}
                </div>
              </div>
              <div className="bg-[#131822] p-3">
                <div className="text-[11px] text-slate-400">HP</div>
                <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-emerald-300">
                  {activeCard.hpRaw}
                </div>
              </div>
            </div>

            {/* Card Effect */}
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Card Text & Abilities
              </h3>
              <div className="rounded-lg border border-white/[0.08] bg-[#131822] p-4 text-sm leading-relaxed text-slate-100 whitespace-pre-line">
                {activeCard.effect || 'No card text (Vanilla / Resource card).'}
              </div>
            </div>

            {/* Secondary Details Table */}
            <dl className="divide-y divide-white/[0.06] rounded-lg border border-white/[0.08] bg-[#131822] text-sm">
              <div className="flex items-start justify-between gap-4 px-4 py-2.5">
                <dt className="text-slate-400 shrink-0">Zone</dt>
                <dd className="text-right text-slate-100">
                  {activeCard.zones.length > 0 ? activeCard.zones.join(' · ') : '—'}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4 px-4 py-2.5">
                <dt className="text-slate-400 shrink-0">Trait</dt>
                <dd className="text-right text-slate-100">
                  {activeCard.traits.length > 0 ? activeCard.traits.join(' · ') : '—'}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4 px-4 py-2.5">
                <dt className="text-slate-400 shrink-0">Link Condition</dt>
                <dd className="text-right font-medium text-blue-300">
                  {activeCard.link || '—'}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4 px-4 py-2.5">
                <dt className="text-slate-400 shrink-0">Where to Get</dt>
                <dd className="text-right text-slate-200">
                  {activeCard.packageNames.length > 0
                    ? activeCard.packageNames.join(' · ')
                    : activeCard.whereToGet || '—'}
                </dd>
              </div>
            </dl>

            {/* Keyword Explanations */}
            {keywords.length > 0 && (
              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Mechanics & Keyword Glossary
                </h3>
                <div className="space-y-2">
                  {keywords.map((kw) => (
                    <div
                      key={kw.tag}
                      className="rounded-lg border border-white/[0.06] bg-[#131822] px-3.5 py-2.5"
                    >
                      <div className="text-xs font-semibold text-blue-300">{kw.label}</div>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-300">{kw.summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Cross-linked Pilot / Unit Synergies */}
            {linkPartners.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <Link2 className="h-3.5 w-3.5 text-blue-400" />
                  <span>
                    Compatible {activeCard.type === 'UNIT' ? 'Link Pilots' : 'Link Units'} (
                    {linkPartners.length})
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {linkPartners.map((partner) => (
                    <button
                      key={partner.printId}
                      type="button"
                      onClick={() => onSelectCardNo(partner.cardNo)}
                      className="group flex flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-[#131822] p-1.5 text-left hover:border-blue-500/50 transition-colors"
                    >
                      <div className="aspect-[5/7] w-full overflow-hidden rounded">
                        <CardArtwork card={partner} className="h-full w-full" />
                      </div>
                      <div className="mt-1.5 truncate text-xs font-medium text-slate-200 group-hover:text-white">
                        {partner.name}
                      </div>
                      <div className="font-mono text-[10px] text-slate-400 tabular-nums">
                        {partner.cardNo} · {partner.apRaw}/{partner.hpRaw}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Official FAQ */}
            {activeCard.faqs.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <HelpCircle className="h-3.5 w-3.5" />
                  <span>Official Card Rulings ({activeCard.faqs.length})</span>
                </div>
                <div className="space-y-2">
                  {activeCard.faqs.map((faq, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-white/[0.06] bg-[#131822] p-3 text-xs space-y-1.5"
                    >
                      <div className="font-medium text-slate-100">{faq.q}</div>
                      <div className="text-slate-300 leading-relaxed">{faq.a}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
