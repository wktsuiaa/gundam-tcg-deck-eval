'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Download, Upload, Plus, Minus, Search } from 'lucide-react';
import type { CollectionMap, GundamCardPrint, GundamPackage, SavedDeck } from '@/types/gundam';
import { CardArtwork } from '@/components/CardArtwork';
import { CARD_COLOR_META } from '@/lib/gundam-keywords';

interface CollectionWorkspaceProps {
  cards: GundamCardPrint[];
  packages: GundamPackage[];
  collection: CollectionMap;
  decks: SavedDeck[];
  onUpdateCollection: (printId: string, delta: number) => void;
  onImportBackup: (data: { collection?: CollectionMap; decks?: SavedDeck[] }) => void;
  onInspectCard: (cardNo: string, printId?: string) => void;
}

export function CollectionWorkspace({
  cards,
  packages,
  collection,
  decks,
  onUpdateCollection,
  onImportBackup,
  onInspectCard,
}: CollectionWorkspaceProps) {
  const [selectedPkg, setSelectedPkg] = useState<string>(packages[0]?.id ?? '');
  const [filterMode, setFilterMode] = useState<'all' | 'owned' | 'missing' | 'alt'>('all');
  const [search, setSearch] = useState('');
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Summary metrics
  const stats = useMemo(() => {
    const uniqueCardNos = new Set(cards.map((c) => c.cardNo));
    const ownedCardNos = new Set<string>();
    let totalOwnedPrints = 0;
    let altArtsOwned = 0;
    const playsetCounts = new Map<string, number>();

    for (const c of cards) {
      const qty = collection[c.printId] ?? 0;
      if (qty > 0) {
        ownedCardNos.add(c.cardNo);
        totalOwnedPrints += qty;
        if (c.isParallel) altArtsOwned += qty;
      }
      playsetCounts.set(c.cardNo, (playsetCounts.get(c.cardNo) ?? 0) + qty);
    }

    let playsetsComplete = 0;
    for (const total of playsetCounts.values()) {
      if (total >= 4) playsetsComplete += 1;
    }

    return {
      uniqueTotal: uniqueCardNos.size,
      uniqueOwned: ownedCardNos.size,
      totalOwnedPrints,
      altArtsOwned,
      playsetsComplete,
    };
  }, [cards, collection]);

  // Per-package completion
  const packageProgress = useMemo(() => {
    const pkgCardsMap = new Map<string, GundamCardPrint[]>();
    for (const c of cards) {
      for (const pid of c.packageIds) {
        const arr = pkgCardsMap.get(pid) ?? [];
        arr.push(c);
        pkgCardsMap.set(pid, arr);
      }
    }
    return packages.map((pkg) => {
      const list = pkgCardsMap.get(pkg.id) ?? [];
      const ownedPrints = list.filter((c) => (collection[c.printId] ?? 0) > 0).length;
      const pct = list.length > 0 ? Math.round((ownedPrints / list.length) * 100) : 0;
      return {
        pkg,
        total: list.length,
        ownedPrints,
        pct,
      };
    });
  }, [cards, packages, collection]);

  const displayedPrints = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (selectedPkg && !c.packageIds.includes(selectedPkg)) return false;
      const qty = collection[c.printId] ?? 0;
      if (filterMode === 'owned' && qty === 0) return false;
      if (filterMode === 'missing' && qty > 0) return false;
      if (filterMode === 'alt' && !c.isParallel) return false;
      if (q) {
        const hay = `${c.cardNo} ${c.name} ${c.rarity}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [cards, selectedPkg, filterMode, search, collection]);

  const handleExportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      collection,
      decks,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gundam-card-atlas-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      onImportBackup({
        collection: parsed.collection,
        decks: parsed.decks,
      });
      setImportMessage('Backup restored successfully.');
    } catch {
      setImportMessage('Invalid backup JSON file.');
    }
    e.target.value = '';
  };

  return (
    <div className="space-y-6">
      {/* Summary Metrics + Backup Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-[#131822] p-5">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <div>
            <div className="text-xs text-slate-400">Unique Cards Owned</div>
            <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-white">
              {stats.uniqueOwned}
              <span className="text-sm font-normal text-slate-500"> / {stats.uniqueTotal}</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Total Physical Copies</div>
            <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-blue-300">
              {stats.totalOwnedPrints}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Alternate Arts Owned</div>
            <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-amber-300">
              {stats.altArtsOwned}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Complete Playsets (4+)</div>
            <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-emerald-300">
              {stats.playsetsComplete}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportJson}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export Backup</span>
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors whitespace-nowrap"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Import Backup</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            onChange={handleFileImport}
            className="hidden"
          />
        </div>
      </div>

      {importMessage && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-xs text-blue-200">
          {importMessage}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Set Completion Bars */}
        <div className="lg:col-span-4 space-y-2 rounded-xl border border-white/[0.08] bg-[#131822] p-4 max-h-[72vh] overflow-y-auto">
          <div className="flex items-center justify-between pb-2">
            <h2 className="font-display text-lg font-bold tracking-wide text-white">
              Set Completion
            </h2>
            <button
              type="button"
              onClick={() => setSelectedPkg('')}
              className={`text-xs transition-colors ${
                selectedPkg === '' ? 'text-blue-400 font-medium' : 'text-slate-400 hover:text-white'
              }`}
            >
              Show All Sets
            </button>
          </div>
          {packageProgress.map(({ pkg, total, ownedPrints, pct }) => {
            const active = selectedPkg === pkg.id;
            return (
              <button
                key={pkg.id}
                type="button"
                onClick={() => setSelectedPkg(pkg.id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  active
                    ? 'border-blue-500/60 bg-blue-500/12'
                    : 'border-white/[0.06] bg-[#0F141E] hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-slate-100 truncate">{pkg.name}</span>
                  <span className="font-mono tabular-nums text-slate-300 shrink-0">
                    {ownedPrints}/{total}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>

        {/* Right: Per-Print Tracker Grid */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.08] bg-[#131822] p-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter prints in set..."
                className="w-full rounded-lg border border-white/10 bg-[#0B0E14] py-2 pl-9 pr-3 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center rounded-lg border border-white/10 bg-[#0B0E14] p-0.5 text-xs">
              {(['all', 'owned', 'missing', 'alt'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setFilterMode(m)}
                  className={`rounded-md px-3 py-1.5 font-medium transition-colors whitespace-nowrap ${
                    filterMode === m ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {m === 'all'
                    ? 'All Prints'
                    : m === 'owned'
                    ? 'Owned'
                    : m === 'missing'
                    ? 'Missing'
                    : 'Alt Arts'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {displayedPrints.slice(0, 80).map((card) => {
              const qty = collection[card.printId] ?? 0;
              const colorMeta = CARD_COLOR_META[card.color] ?? CARD_COLOR_META.Colorless;
              return (
                <div
                  key={card.printId}
                  className="flex flex-col rounded-lg border border-white/[0.08] bg-[#131822] p-2"
                >
                  <button
                    type="button"
                    onClick={() => onInspectCard(card.cardNo, card.printId)}
                    className={`relative aspect-[5/7] w-full overflow-hidden rounded transition-opacity ${
                      qty === 0 ? 'opacity-65 hover:opacity-100' : 'opacity-100'
                    }`}
                  >
                    <CardArtwork card={card} className="h-full w-full" />
                  </button>
                  <div className="mt-2 truncate text-xs font-medium text-slate-100">{card.name}</div>
                  <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400">
                    <span>{card.printId}</span>
                    <span style={{ color: colorMeta.hex }}>{card.rarity}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between rounded-md border border-white/[0.08] bg-[#0B0E14] px-2 py-1">
                    <button
                      type="button"
                      onClick={() => onUpdateCollection(card.printId, -1)}
                      disabled={qty === 0}
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-300 hover:bg-white/10 disabled:opacity-30"
                      aria-label={`Remove 1 ${card.printId}`}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="font-mono text-xs font-semibold tabular-nums text-white">
                      {qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => onUpdateCollection(card.printId, 1)}
                      className="flex h-6 w-6 items-center justify-center rounded text-slate-300 hover:bg-white/10"
                      aria-label={`Add 1 ${card.printId}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {displayedPrints.length > 80 && (
            <p className="text-center text-xs text-slate-400 font-mono">
              Showing first 80 of {displayedPrints.length} matching prints. Select a specific set or filter to narrow down.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
