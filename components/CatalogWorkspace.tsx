'use client';

import React, { useMemo, useState } from 'react';
import {
  Search,
  LayoutGrid,
  Table as TableIcon,
  Plus,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type {
  GundamCardGroup,
  GundamCardPrint,
  GundamPackage,
} from '@/types/gundam';
import { CARD_COLOR_META, groupPrintsByCardNo } from '@/lib/gundam-keywords';
import { CardArtwork } from '@/components/CardArtwork';
import {
  CatalogFilterPanel,
  INITIAL_CATALOG_FILTER_STATE,
  type CatalogFilterState,
} from '@/components/CatalogFilterPanel';

interface CatalogWorkspaceProps {
  cards: GundamCardPrint[];
  packages: GundamPackage[];
  onInspectCard: (cardNo: string, printId?: string) => void;
  onAddToDeck?: (card: GundamCardPrint) => void;
  activeDeckName?: string;
  initialPackageFilter?: string;
}

const PAGE_SIZE = 48;

export function CatalogWorkspace({
  cards,
  packages,
  onInspectCard,
  onAddToDeck,
  activeDeckName,
  initialPackageFilter = '',
}: CatalogWorkspaceProps) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<CatalogFilterState>(() => ({
    ...INITIAL_CATALOG_FILTER_STATE,
    packageIds: initialPackageFilter ? [initialPackageFilter] : [],
  }));
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [sortBy, setSortBy] = useState<
    'cardNoAsc' | 'cardNoDesc' | 'costAsc' | 'lvDesc' | 'apDesc'
  >('cardNoAsc');
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [page, setPage] = useState(1);

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

  const cardGroupsByNo = useMemo(() => {
    const groups = groupPrintsByCardNo(cards);
    const map = new Map<string, GundamCardGroup>();
    for (const g of groups) map.set(g.cardNo, g);
    return map;
  }, [cards]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const minApNum = filters.minAp ? Number(filters.minAp) : null;
    const minHpNum = filters.minHp ? Number(filters.minHp) : null;

    const categoryPkgIds =
      filters.packageCategories.length > 0 && filters.packageIds.length === 0
        ? new Set(
            packages
              .filter((p) => filters.packageCategories.includes(p.category))
              .map((p) => p.id)
          )
        : null;

    const matchedPrints = cards.filter((c) => {
      if (!filters.showAllAltArts && c.isParallel) {
        const hasBaseInCatalog = cardGroupsByNo
          .get(c.cardNo)
          ?.variants.some((v) => !v.isParallel);
        if (hasBaseInCatalog && filters.packageIds.length === 0) {
          return false;
        }
      }

      if (
        filters.packageIds.length > 0 &&
        !c.packageIds.some((pid) => filters.packageIds.includes(pid))
      ) {
        return false;
      }
      if (categoryPkgIds && !c.packageIds.some((pid) => categoryPkgIds.has(pid))) {
        return false;
      }

      if (filters.colors.length > 0 && !filters.colors.includes(c.color)) return false;
      if (filters.types.length > 0 && !filters.types.includes(c.type)) return false;

      if (filters.rarities.length > 0) {
        const baseRarity = c.rarity.replace(/\+/g, '');
        if (!filters.rarities.includes(baseRarity)) return false;
      }

      if (filters.lvs.length > 0 && (c.lv === null || !filters.lvs.includes(c.lv))) {
        return false;
      }
      if (filters.costs.length > 0 && (c.cost === null || !filters.costs.includes(c.cost))) {
        return false;
      }

      if (minApNum !== null && (c.ap === null || c.ap < minApNum)) return false;
      if (minHpNum !== null && (c.hp === null || c.hp < minHpNum)) return false;

      if (
        filters.zones.length > 0 &&
        !c.zones.some((z) => filters.zones.includes(z))
      ) {
        return false;
      }
      if (filters.blocks.length > 0 && !filters.blocks.includes(c.blockIcon)) {
        return false;
      }
      if (
        filters.traits.length > 0 &&
        !c.traits.some((t) => filters.traits.includes(t))
      ) {
        return false;
      }
      if (filters.links.length > 0 && !filters.links.includes(c.link)) return false;
      if (filters.sources.length > 0 && !filters.sources.includes(c.sourceTitle)) {
        return false;
      }

      if (q) {
        const hay =
          `${c.cardNo} ${c.name} ${c.effect} ${c.traits.join(' ')} ${c.link} ${c.sourceTitle}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });

    let items: { print: GundamCardPrint; group: GundamCardGroup }[] = [];
    if (!filters.showAllAltArts) {
      const seenNo = new Set<string>();
      for (const p of matchedPrints) {
        if (seenNo.has(p.cardNo)) continue;
        seenNo.add(p.cardNo);
        const group = cardGroupsByNo.get(p.cardNo) ?? {
          cardNo: p.cardNo,
          primary: p,
          variants: [p],
        };
        items.push({ print: filters.packageIds.length > 0 ? p : group.primary, group });
      }
    } else {
      items = matchedPrints.map((p) => ({
        print: p,
        group: cardGroupsByNo.get(p.cardNo) ?? {
          cardNo: p.cardNo,
          primary: p,
          variants: [p],
        },
      }));
    }

    items.sort((a, b) => {
      if (sortBy === 'cardNoDesc') return b.print.printId.localeCompare(a.print.printId);
      if (sortBy === 'costAsc') return (a.print.cost ?? 99) - (b.print.cost ?? 99);
      if (sortBy === 'lvDesc') return (b.print.lv ?? -1) - (a.print.lv ?? -1);
      if (sortBy === 'apDesc') return (b.print.ap ?? -1) - (a.print.ap ?? -1);
      return 0;
    });

    return items;
  }, [cards, packages, search, filters, cardGroupsByNo, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filteredItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleFiltersChange = (next: CatalogFilterState) => {
    setFilters(next);
    setPage(1);
  };

  const resetFilters = () => {
    setSearch('');
    setFilters(INITIAL_CATALOG_FILTER_STATE);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {filtersOpen && (
        <CatalogFilterPanel
          filters={filters}
          onChange={handleFiltersChange}
          onReset={resetFilters}
          packages={packages}
          traitsList={traitsList}
          linksList={linksList}
          sourcesList={sourcesList}
          blocksList={blocksList}
        />
      )}

      {/* Main Catalog Area */}
      <div className="min-w-0 flex-1 space-y-4">
        {/* Search & View Toolbar */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.08] bg-[#131822] p-3">
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/[0.08] whitespace-nowrap shrink-0"
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

          <div className="flex items-center rounded-lg border border-white/10 bg-[#0B0E14] p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
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
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
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
            {filters.showAllAltArts ? 'prints' : 'unique cards'}
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
              No Gundam cards match your current multi-select filters.
            </p>
            <p className="mt-1 text-sm text-slate-400">
              Try clearing a facet or expanding your selected Sets/Traits to broaden the catalog view.
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {pageItems.map(({ print, group }) => {
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

                  <div className="mt-2 px-0.5">
                    <div className="truncate text-xs font-medium text-slate-100">{print.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400 font-mono tabular-nums">
                      <span>{print.cardNo}</span>
                      <span aria-hidden="true">·</span>
                      <span style={{ color: colorMeta.hex }}>{print.rarity}</span>
                      {!filters.showAllAltArts && altCount > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-300">+{altCount} art</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
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
                  <th className="py-3 pl-3 pr-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {pageItems.map(({ print }) => {
                  const colorMeta = CARD_COLOR_META[print.color] ?? CARD_COLOR_META.Colorless;
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
                      <td className="py-2.5 px-3 text-slate-400 max-w-[240px] truncate">
                        {[...print.traits, print.link].filter(Boolean).join(' · ') || '—'}
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
