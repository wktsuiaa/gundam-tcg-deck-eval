'use client';

import React, { useMemo, useState } from 'react';
import {
  Search,
  LayoutGrid,
  Table as TableIcon,
  Plus,
  Minus,
  RotateCcw,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type {
  CardColor,
  CollectionMap,
  GundamCardGroup,
  GundamCardPrint,
  GundamPackage,
} from '@/types/gundam';
import { CARD_COLOR_META, groupPrintsByCardNo } from '@/lib/gundam-keywords';
import { CardArtwork } from '@/components/CardArtwork';

interface CatalogWorkspaceProps {
  cards: GundamCardPrint[];
  packages: GundamPackage[];
  collection: CollectionMap;
  onUpdateCollection: (printId: string, delta: number) => void;
  onInspectCard: (cardNo: string, printId?: string) => void;
  onAddToDeck?: (card: GundamCardPrint) => void;
  activeDeckName?: string;
  initialPackageFilter?: string;
}

const COLORS: CardColor[] = ['Blue', 'Green', 'Red', 'Purple', 'White', 'Colorless'];
const CARD_TYPES = [
  'UNIT',
  'PILOT',
  'COMMAND',
  'BASE',
  'RESOURCE',
  'EX BASE',
  'EX RESOURCE',
  'UNIT TOKEN',
];
const RARITIES = ['C', 'U', 'R', 'LR', 'P', 'SP', 'LKC', 'LKU', 'LKR'];
const PAGE_SIZE = 48;

export function CatalogWorkspace({
  cards,
  packages,
  collection,
  onUpdateCollection,
  onInspectCard,
  onAddToDeck,
  activeDeckName,
  initialPackageFilter = '',
}: CatalogWorkspaceProps) {
  const [search, setSearch] = useState('');
  const [packageCategory, setPackageCategory] = useState<string>('ALL');
  const [selectedPackage, setSelectedPackage] = useState<string>(initialPackageFilter);
  const [selectedColors, setSelectedColors] = useState<CardColor[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedRarities, setSelectedRarities] = useState<string[]>([]);
  const [selectedLv, setSelectedLv] = useState<string>('');
  const [selectedCost, setSelectedCost] = useState<string>('');
  const [minAp, setMinAp] = useState<string>('');
  const [minHp, setMinHp] = useState<string>('');
  const [selectedZone, setSelectedZone] = useState<string>('');
  const [selectedTrait, setSelectedTrait] = useState<string>('');
  const [selectedLink, setSelectedLink] = useState<string>('');
  const [selectedSource, setSelectedSource] = useState<string>('');
  const [selectedBlock, setSelectedBlock] = useState<string>('');
  const [showAllAltArts, setShowAllAltArts] = useState(false);
  const [collectionFilter, setCollectionFilter] = useState<
    'all' | 'owned' | 'missing' | 'incomplete' | 'alt_owned'
  >('all');
  const [quickCollectMode, setQuickCollectMode] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [sortBy, setSortBy] = useState<
    'cardNoAsc' | 'cardNoDesc' | 'costAsc' | 'lvDesc' | 'apDesc'
  >('cardNoAsc');
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [page, setPage] = useState(1);

  // Extract dynamic facet lists from full card pool
  const { traitsList, linksList, sourcesList, blocksList } = useMemo(() => {
    const traits = new Set<string>();
    const links = new Set<string>();
    const sources = new Set<string>();
    const blocks = new Set<string>();
    for (const c of cards) {
      for (const t of c.traits) traits.add(t);
      if (c.link) links.add(c.link);
      if (c.sourceTitle) sources.add(c.sourceTitle);
      if (c.blockIcon) blocks.add(c.blockIcon);
    }
    return {
      traitsList: [...traits].sort((a, b) => a.localeCompare(b)),
      linksList: [...links].sort((a, b) => a.localeCompare(b)),
      sourcesList: [...sources].sort((a, b) => a.localeCompare(b)),
      blocksList: [...blocks].sort((a, b) => a.localeCompare(b)),
    };
  }, [cards]);

  const filteredPackages = useMemo(() => {
    if (packageCategory === 'ALL') return packages;
    return packages.filter((p) => p.category === packageCategory);
  }, [packages, packageCategory]);

  // Group all cards by cardNo for variant rollups
  const cardGroupsByNo = useMemo(() => {
    const groups = groupPrintsByCardNo(cards);
    const map = new Map<string, GundamCardGroup>();
    for (const g of groups) map.set(g.cardNo, g);
    return map;
  }, [cards]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const minApNum = minAp ? Number(minAp) : null;
    const minHpNum = minHp ? Number(minHp) : null;
    const lvNum = selectedLv ? Number(selectedLv) : null;
    const costNum = selectedCost ? Number(selectedCost) : null;

    const packageIdSet =
      packageCategory !== 'ALL' && !selectedPackage
        ? new Set(filteredPackages.map((p) => p.id))
        : null;

    // Filter prints first
    const matchedPrints = cards.filter((c) => {
      if (!showAllAltArts && c.isParallel) {
        // Keep parallel prints if user specifically filtered by a package that only has the parallel or collection alt_owned
        const hasBaseInCatalog = cardGroupsByNo.get(c.cardNo)?.variants.some((v) => !v.isParallel);
        if (hasBaseInCatalog && !selectedPackage && collectionFilter !== 'alt_owned') {
          return false;
        }
      }
      if (selectedPackage && !c.packageIds.includes(selectedPackage)) return false;
      if (packageIdSet && !c.packageIds.some((pid) => packageIdSet.has(pid))) return false;

      if (selectedColors.length > 0 && !selectedColors.includes(c.color)) return false;
      if (selectedTypes.length > 0 && !selectedTypes.includes(c.type)) return false;
      if (selectedRarities.length > 0) {
        const baseRarity = c.rarity.replace(/\+/g, '');
        if (!selectedRarities.includes(baseRarity)) return false;
      }
      if (lvNum !== null && c.lv !== lvNum) return false;
      if (costNum !== null && c.cost !== costNum) return false;
      if (minApNum !== null && (c.ap === null || c.ap < minApNum)) return false;
      if (minHpNum !== null && (c.hp === null || c.hp < minHpNum)) return false;
      if (selectedZone && !c.zones.includes(selectedZone)) return false;
      if (selectedTrait && !c.traits.includes(selectedTrait)) return false;
      if (selectedLink && c.link !== selectedLink) return false;
      if (selectedSource && c.sourceTitle !== selectedSource) return false;
      if (selectedBlock && c.blockIcon !== selectedBlock) return false;

      if (q) {
        const hay = `${c.cardNo} ${c.name} ${c.effect} ${c.traits.join(' ')} ${c.link} ${c.sourceTitle}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      const group = cardGroupsByNo.get(c.cardNo);
      const totalOwned = group
        ? group.variants.reduce((s, v) => s + (collection[v.printId] ?? 0), 0)
        : collection[c.printId] ?? 0;

      if (collectionFilter === 'owned' && totalOwned === 0) return false;
      if (collectionFilter === 'missing' && totalOwned > 0) return false;
      if (collectionFilter === 'incomplete' && totalOwned >= 4) return false;
      if (collectionFilter === 'alt_owned') {
        const altOwned = group
          ? group.variants.some((v) => v.isParallel && (collection[v.printId] ?? 0) > 0)
          : c.isParallel && (collection[c.printId] ?? 0) > 0;
        if (!altOwned) return false;
      }

      return true;
    });

    // If grouping alt arts, deduplicate by cardNo keeping best representative
    let items: { print: GundamCardPrint; group: GundamCardGroup }[] = [];
    if (!showAllAltArts) {
      const seenNo = new Set<string>();
      for (const p of matchedPrints) {
        if (seenNo.has(p.cardNo)) continue;
        seenNo.add(p.cardNo);
        const group = cardGroupsByNo.get(p.cardNo) ?? {
          cardNo: p.cardNo,
          primary: p,
          variants: [p],
        };
        items.push({ print: selectedPackage ? p : group.primary, group });
      }
    } else {
      items = matchedPrints.map((p) => ({
        print: p,
        group: cardGroupsByNo.get(p.cardNo) ?? { cardNo: p.cardNo, primary: p, variants: [p] },
      }));
    }

    // Sort
    items.sort((a, b) => {
      if (sortBy === 'cardNoDesc') return b.print.printId.localeCompare(a.print.printId);
      if (sortBy === 'costAsc') return (a.print.cost ?? 99) - (b.print.cost ?? 99);
      if (sortBy === 'lvDesc') return (b.print.lv ?? -1) - (a.print.lv ?? -1);
      if (sortBy === 'apDesc') return (b.print.ap ?? -1) - (a.print.ap ?? -1);
      return 0; // cardNoAsc already sorted from server
    });

    return items;
  }, [
    cards,
    search,
    packageCategory,
    selectedPackage,
    filteredPackages,
    selectedColors,
    selectedTypes,
    selectedRarities,
    selectedLv,
    selectedCost,
    minAp,
    minHp,
    selectedZone,
    selectedTrait,
    selectedLink,
    selectedSource,
    selectedBlock,
    showAllAltArts,
    collectionFilter,
    collection,
    cardGroupsByNo,
    sortBy,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filteredItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const resetFilters = () => {
    setSearch('');
    setPackageCategory('ALL');
    setSelectedPackage('');
    setSelectedColors([]);
    setSelectedTypes([]);
    setSelectedRarities([]);
    setSelectedLv('');
    setSelectedCost('');
    setMinAp('');
    setMinHp('');
    setSelectedZone('');
    setSelectedTrait('');
    setSelectedLink('');
    setSelectedSource('');
    setSelectedBlock('');
    setCollectionFilter('all');
    setPage(1);
  };

  const toggleArr = <T,>(arr: T[], val: T, setter: React.Dispatch<React.SetStateAction<T[]>>) => {
    setPage(1);
    setter(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
  };

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* Left Multi-Facet Filter Sidebar */}
      {filtersOpen && (
        <aside className="w-full shrink-0 space-y-5 rounded-xl border border-white/[0.08] bg-[#131822] p-4 lg:w-72">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold tracking-wide text-white">
              Catalog Filters
            </h2>
            <button
              type="button"
              onClick={resetFilters}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors whitespace-nowrap"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset</span>
            </button>
          </div>

          {/* Product Category + Set */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-400">Product Category</label>
            <div className="grid grid-cols-2 gap-1">
              {['ALL', 'Booster Pack', 'Starter Deck', 'Special / Extra Set', 'Promotion', 'Basic Cards'].map(
                (cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      setPackageCategory(cat);
                      setSelectedPackage('');
                      setPage(1);
                    }}
                    className={`truncate rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                      packageCategory === cat
                        ? 'bg-blue-600/25 text-blue-300 border border-blue-500/40'
                        : 'bg-white/[0.03] text-slate-300 border border-transparent hover:bg-white/[0.06]'
                    }`}
                  >
                    {cat === 'ALL' ? 'All Sets' : cat}
                  </button>
                )
              )}
            </div>

            <select
              value={selectedPackage}
              onChange={(e) => {
                setSelectedPackage(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by specific set"
              className="w-full rounded-lg border border-white/10 bg-[#0B0E14] px-2.5 py-2 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              <option value="">All Products ({filteredPackages.length})</option>
              {filteredPackages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.cardCount})
                </option>
              ))}
            </select>
          </div>

          {/* Colors */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-400">Color</label>
            <div className="grid grid-cols-3 gap-1.5">
              {COLORS.map((col) => {
                const active = selectedColors.includes(col);
                const meta = CARD_COLOR_META[col];
                return (
                  <button
                    key={col}
                    type="button"
                    onClick={() => toggleArr(selectedColors, col, setSelectedColors)}
                    className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors whitespace-nowrap ${
                      active
                        ? `${meta.softBg} ${meta.border} text-white`
                        : 'border-white/[0.07] bg-white/[0.02] text-slate-300 hover:bg-white/[0.05]'
                    }`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-xs"
                      style={{ backgroundColor: meta.hex }}
                    />
                    <span className="truncate">{col}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Card Type */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-400">Card Type</label>
            <div className="flex flex-wrap gap-1.5">
              {CARD_TYPES.map((t) => {
                const active = selectedTypes.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleArr(selectedTypes, t, setSelectedTypes)}
                    className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'border-blue-500/50 bg-blue-500/20 text-blue-200'
                        : 'border-white/[0.07] bg-white/[0.02] text-slate-300 hover:bg-white/[0.06]'
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Lv, Cost, AP, HP */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Level (Lv.)</label>
              <select
                value={selectedLv}
                onChange={(e) => {
                  setSelectedLv(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-md border border-white/10 bg-[#0B0E14] px-2 py-1.5 text-xs text-slate-200 font-mono"
              >
                <option value="">Any</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={String(n)}>
                    Lv. {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Cost</label>
              <select
                value={selectedCost}
                onChange={(e) => {
                  setSelectedCost(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-md border border-white/10 bg-[#0B0E14] px-2 py-1.5 text-xs text-slate-200 font-mono"
              >
                <option value="">Any</option>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={String(n)}>
                    Cost {n}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Min AP</label>
              <input
                type="number"
                value={minAp}
                onChange={(e) => {
                  setMinAp(e.target.value);
                  setPage(1);
                }}
                placeholder="e.g. 4"
                className="w-full rounded-md border border-white/10 bg-[#0B0E14] px-2 py-1.5 text-xs text-slate-200 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Min HP</label>
              <input
                type="number"
                value={minHp}
                onChange={(e) => {
                  setMinHp(e.target.value);
                  setPage(1);
                }}
                placeholder="e.g. 4"
                className="w-full rounded-md border border-white/10 bg-[#0B0E14] px-2 py-1.5 text-xs text-slate-200 font-mono"
              />
            </div>
          </div>

          {/* Rarity */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-400">Rarity</label>
            <div className="flex flex-wrap gap-1">
              {RARITIES.map((r) => {
                const active = selectedRarities.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleArr(selectedRarities, r, setSelectedRarities)}
                    className={`rounded border px-2 py-1 font-mono text-[11px] transition-colors ${
                      active
                        ? 'border-amber-400/50 bg-amber-500/20 text-amber-200'
                        : 'border-white/[0.07] bg-white/[0.02] text-slate-300 hover:bg-white/[0.06]'
                    }`}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Zone & Block */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Zone</label>
              <select
                value={selectedZone}
                onChange={(e) => {
                  setSelectedZone(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-md border border-white/10 bg-[#0B0E14] px-2 py-1.5 text-xs text-slate-200"
              >
                <option value="">Any Zone</option>
                <option value="Space">Space</option>
                <option value="Earth">Earth</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Block Icon</label>
              <select
                value={selectedBlock}
                onChange={(e) => {
                  setSelectedBlock(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-md border border-white/10 bg-[#0B0E14] px-2 py-1.5 text-xs text-slate-200 font-mono"
              >
                <option value="">Any</option>
                {blocksList.map((b) => (
                  <option key={b} value={b}>
                    Block {b}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Trait, Link, Source Title */}
          <div className="space-y-2.5">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Trait</label>
              <select
                value={selectedTrait}
                onChange={(e) => {
                  setSelectedTrait(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-md border border-white/10 bg-[#0B0E14] px-2 py-1.5 text-xs text-slate-200"
              >
                <option value="">All Traits ({traitsList.length})</option>
                {traitsList.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Link Condition</label>
              <select
                value={selectedLink}
                onChange={(e) => {
                  setSelectedLink(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-md border border-white/10 bg-[#0B0E14] px-2 py-1.5 text-xs text-slate-200"
              >
                <option value="">All Link Conditions ({linksList.length})</option>
                {linksList.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Source Title</label>
              <select
                value={selectedSource}
                onChange={(e) => {
                  setSelectedSource(e.target.value);
                  setPage(1);
                }}
                className="w-full rounded-md border border-white/10 bg-[#0B0E14] px-2 py-1.5 text-xs text-slate-200"
              >
                <option value="">All Gundam Series ({sourcesList.length})</option>
                {sourcesList.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Alternate Art & Collection */}
          <div className="space-y-2.5 border-t border-white/[0.08] pt-3">
            <label className="flex items-center justify-between gap-2 text-xs text-slate-200 cursor-pointer">
              <span>Show All Alternate Arts</span>
              <input
                type="checkbox"
                checked={showAllAltArts}
                onChange={(e) => {
                  setShowAllAltArts(e.target.checked);
                  setPage(1);
                }}
                className="h-4 w-4 accent-blue-500"
              />
            </label>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Collection Status</label>
              <select
                value={collectionFilter}
                onChange={(e) => {
                  setCollectionFilter(
                    e.target.value as 'all' | 'owned' | 'missing' | 'incomplete' | 'alt_owned'
                  );
                  setPage(1);
                }}
                className="w-full rounded-md border border-white/10 bg-[#0B0E14] px-2 py-1.5 text-xs text-slate-200"
              >
                <option value="all">All Cards</option>
                <option value="owned">Owned (1+)</option>
                <option value="missing">Missing (0 Owned)</option>
                <option value="incomplete">Incomplete Playset (&lt;4)</option>
                <option value="alt_owned">Alternate Arts Owned</option>
              </select>
            </div>
          </div>
        </aside>
      )}

      {/* Main Catalog Area */}
      <div className="min-w-0 flex-1 space-y-4">
        {/* Search & View Toolbar */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.08] bg-[#131822] p-3">
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/[0.08] whitespace-nowrap"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>{filtersOpen ? 'Hide Filters' : 'Filters'}</span>
          </button>

          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search card name, ID (GD01-001), effect text, trait..."
              className="w-full rounded-lg border border-white/10 bg-[#0B0E14] py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            aria-label="Sort cards"
            className="rounded-lg border border-white/10 bg-[#0B0E14] px-3 py-2 text-xs text-slate-200 focus:border-blue-500 focus:outline-none"
          >
            <option value="cardNoAsc">Card No. (A–Z)</option>
            <option value="cardNoDesc">Card No. (Z–A)</option>
            <option value="costAsc">Cost (Low–High)</option>
            <option value="lvDesc">Level (High–Low)</option>
            <option value="apDesc">AP (High–Low)</option>
          </select>

          <button
            type="button"
            onClick={() => setQuickCollectMode((v) => !v)}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              quickCollectMode
                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]'
            }`}
          >
            {quickCollectMode ? 'Quick Collect: On' : 'Quick Collect'}
          </button>

          <div className="flex items-center rounded-lg border border-white/10 bg-[#0B0E14] p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
              aria-label="Visual card grid view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>Grid</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                viewMode === 'table' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
              aria-label="Compact table view"
            >
              <TableIcon className="h-3.5 w-3.5" />
              <span>Table</span>
            </button>
          </div>
        </div>

        {/* Result Summary + Pagination Top */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-400">
          <div className="font-mono tabular-nums">
            Showing <span className="text-slate-200 font-semibold">{filteredItems.length}</span>{' '}
            {showAllAltArts ? 'prints' : 'unique cards'}
            {activeDeckName ? (
              <span className="ml-2 font-sans text-slate-400">
                · Active Deck: <span className="text-blue-300">{activeDeckName}</span>
              </span>
            ) : null}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-2 font-mono tabular-nums">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="flex h-7 w-7 items-center justify-center rounded border border-white/10 bg-[#131822] text-slate-300 hover:bg-white/10 disabled:opacity-35"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span>
                Page {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="flex h-7 w-7 items-center justify-center rounded border border-white/10 bg-[#131822] text-slate-300 hover:bg-white/10 disabled:opacity-35"
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        {/* Empty State */}
        {pageItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-white/[0.08] bg-[#131822] py-16 px-6 text-center">
            <p className="text-base font-medium text-slate-200">
              No Gundam cards match your current filters.
            </p>
            <p className="mt-1 text-sm text-slate-400">
              Try clearing a trait, level, or product filter to broaden the catalog view.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
            >
              Reset All Filters
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          /* Visual Card Grid */
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {pageItems.map(({ print, group }) => {
              const totalOwned = showAllAltArts
                ? collection[print.printId] ?? 0
                : group.variants.reduce((s, v) => s + (collection[v.printId] ?? 0), 0);
              const altCount = group.variants.length - 1;
              const colorMeta = CARD_COLOR_META[print.color] ?? CARD_COLOR_META.Colorless;

              return (
                <div key={print.printId} className="group relative flex flex-col">
                  <div className="relative aspect-[5/7] w-full overflow-hidden rounded-lg border border-white/10 bg-[#131822] transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:border-blue-500/60">
                    <button
                      type="button"
                      onClick={() => onInspectCard(print.cardNo, print.printId)}
                      className="h-full w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      aria-label={`Inspect ${print.name} (${print.cardNo})`}
                    >
                      <CardArtwork card={print} className="h-full w-full" />
                    </button>

                    {/* Top-right subtle count indicator only when owned > 0 */}
                    {totalOwned > 0 && (
                      <span className="pointer-events-none absolute right-1.5 top-1.5 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-emerald-300 backdrop-blur-xs">
                        ×{totalOwned}
                      </span>
                    )}

                    {/* Quick +Deck hover trigger */}
                    {onAddToDeck && (
                      <button
                        type="button"
                        onClick={() => onAddToDeck(print)}
                        className="absolute bottom-2 right-2 flex h-7 items-center gap-1 rounded bg-blue-600/95 px-2 text-[11px] font-medium text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-blue-500"
                        title={`Add to ${activeDeckName || 'Deck'}`}
                      >
                        <Plus className="h-3 w-3" />
                        <span>Deck</span>
                      </button>
                    )}
                  </div>

                  {/* Clean unboxed metadata below card */}
                  <div className="mt-2 px-0.5">
                    <div className="truncate text-xs font-medium text-slate-100">{print.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400 font-mono tabular-nums">
                      <span>{print.cardNo}</span>
                      <span aria-hidden="true">·</span>
                      <span style={{ color: colorMeta.hex }}>{print.rarity}</span>
                      {!showAllAltArts && altCount > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-300">+{altCount} art</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Quick-collect controls when toggled */}
                  {quickCollectMode && (
                    <div className="mt-1.5 flex items-center justify-between rounded-md border border-white/[0.08] bg-[#131822] px-2 py-1">
                      <button
                        type="button"
                        onClick={() => onUpdateCollection(print.printId, -1)}
                        disabled={(collection[print.printId] ?? 0) === 0}
                        className="flex h-6 w-6 items-center justify-center rounded text-slate-300 hover:bg-white/10 disabled:opacity-35"
                        aria-label={`Remove 1 ${print.name}`}
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="font-mono text-xs tabular-nums text-white">
                        {collection[print.printId] ?? 0}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateCollection(print.printId, 1)}
                        className="flex h-6 w-6 items-center justify-center rounded text-slate-300 hover:bg-white/10"
                        aria-label={`Add 1 ${print.name}`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* Compact Tactical Table View */
          <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-[#131822]">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] text-slate-400">
                  <th className="py-3 pl-4 pr-3 font-medium">Card No.</th>
                  <th className="py-3 px-3 font-medium">Name</th>
                  <th className="py-3 px-3 font-medium">Color</th>
                  <th className="py-3 px-3 font-medium">Type</th>
                  <th className="py-3 px-3 font-medium text-right">Lv.</th>
                  <th className="py-3 px-3 font-medium text-right">Cost</th>
                  <th className="py-3 px-3 font-medium text-right">AP / HP</th>
                  <th className="py-3 px-3 font-medium">Trait / Link</th>
                  <th className="py-3 px-3 font-medium text-right">Owned</th>
                  <th className="py-3 pl-3 pr-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {pageItems.map(({ print, group }) => {
                  const colorMeta = CARD_COLOR_META[print.color] ?? CARD_COLOR_META.Colorless;
                  const owned = showAllAltArts
                    ? collection[print.printId] ?? 0
                    : group.variants.reduce((s, v) => s + (collection[v.printId] ?? 0), 0);
                  return (
                    <tr
                      key={print.printId}
                      onClick={() => onInspectCard(print.cardNo, print.printId)}
                      className="cursor-pointer hover:bg-white/[0.04] transition-colors"
                    >
                      <td className="py-2.5 pl-4 pr-3 font-mono tabular-nums text-slate-300 whitespace-nowrap">
                        {print.cardNo}{' '}
                        <span className="text-slate-500">{print.rarity}</span>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-white">{print.name}</td>
                      <td className={`py-2.5 px-3 font-medium whitespace-nowrap ${colorMeta.text}`}>
                        {print.color}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300 whitespace-nowrap">{print.type}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-200">
                        {print.lv ?? '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-200">
                        {print.cost ?? '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                        {print.apRaw !== '-' || print.hpRaw !== '-'
                          ? `${print.apRaw} / ${print.hpRaw}`
                          : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400 max-w-[220px] truncate">
                        {[...print.traits, print.link].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td
                        className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-300"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onUpdateCollection(print.printId, -1)}
                            disabled={(collection[print.printId] ?? 0) === 0}
                            className="rounded border border-white/10 px-1.5 py-0.5 text-slate-300 hover:bg-white/10 disabled:opacity-30"
                          >
                            -
                          </button>
                          <span className="w-5 text-center">{owned}</span>
                          <button
                            type="button"
                            onClick={() => onUpdateCollection(print.printId, 1)}
                            className="rounded border border-white/10 px-1.5 py-0.5 text-slate-300 hover:bg-white/10"
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td
                        className="py-2.5 pl-3 pr-4 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {onAddToDeck && (
                          <button
                            type="button"
                            onClick={() => onAddToDeck(print)}
                            className="rounded bg-blue-600/20 px-2.5 py-1 text-[11px] font-medium text-blue-300 hover:bg-blue-600 hover:text-white transition-colors whitespace-nowrap"
                          >
                            + Deck
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Bottom Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-2 font-mono text-xs tabular-nums text-slate-400">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-white/10 bg-[#131822] px-3 py-1.5 text-slate-200 hover:bg-white/10 disabled:opacity-35"
            >
              Previous
            </button>
            <span>
              Page {safePage} of {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-lg border border-white/10 bg-[#131822] px-3 py-1.5 text-slate-200 hover:bg-white/10 disabled:opacity-35"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
