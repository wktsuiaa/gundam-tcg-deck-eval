'use client';

import React, { useMemo, useState } from 'react';
import { RotateCcw, ChevronDown, ChevronUp, Search } from 'lucide-react';
import type { CardColor, GundamPackage } from '@/types/gundam';
import { CARD_COLOR_META } from '@/lib/gundam-keywords';

export interface CatalogFilterState {
  packageCategories: string[];
  packageIds: string[];
  colors: CardColor[];
  types: string[];
  rarities: string[];
  lvs: number[];
  costs: number[];
  minAp: string;
  minHp: string;
  zones: string[];
  blocks: string[];
  traits: string[];
  links: string[];
  sources: string[];
  showAllAltArts: boolean;
}

export const INITIAL_CATALOG_FILTER_STATE: CatalogFilterState = {
  packageCategories: [],
  packageIds: [],
  colors: [],
  types: [],
  rarities: [],
  lvs: [],
  costs: [],
  minAp: '',
  minHp: '',
  zones: [],
  blocks: [],
  traits: [],
  links: [],
  sources: [],
  showAllAltArts: false,
};

interface CatalogFilterPanelProps {
  filters: CatalogFilterState;
  onChange: (next: CatalogFilterState) => void;
  onReset: () => void;
  packages: GundamPackage[];
  traitsList: string[];
  linksList: string[];
  sourcesList: string[];
  blocksList: string[];
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
const PACKAGE_CATEGORIES = [
  'Booster Pack',
  'Starter Deck',
  'Special / Extra Set',
  'Promotion',
  'Basic Cards',
];
const ZONES = ['Space', 'Earth'];
const LV_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const COST_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function toggleValue<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

interface SearchableChecklistProps {
  title: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (val: string) => void;
  placeholder?: string;
}

function SearchableChecklist({
  title,
  options,
  selected,
  onToggle,
  placeholder = 'Filter list...',
}: SearchableChecklistProps) {
  const [open, setOpen] = useState(selected.length > 0);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div className="border-t border-white/[0.06] pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left text-xs font-medium text-slate-300 hover:text-white"
      >
        <span>
          {title}
          {selected.length > 0 && (
            <span className="ml-1.5 font-mono text-[11px] text-blue-400">
              ({selected.length})
            </span>
          )}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-md border border-white/10 bg-[#0B0E14] py-1.5 pl-6 pr-2 text-[11px] text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <div className="py-1 text-[11px] text-slate-500">No matches</div>
            ) : (
              filtered.map((opt) => {
                const checked = selected.includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] transition-colors ${
                      checked
                        ? 'bg-blue-500/15 text-blue-200'
                        : 'text-slate-300 hover:bg-white/[0.04]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(opt.value)}
                      className="h-3.5 w-3.5 shrink-0 accent-blue-500"
                    />
                    <span className="truncate">{opt.label}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CatalogFilterPanel({
  filters,
  onChange,
  onReset,
  packages,
  traitsList,
  linksList,
  sourcesList,
  blocksList,
}: CatalogFilterPanelProps) {
  const activeCount =
    filters.packageCategories.length +
    filters.packageIds.length +
    filters.colors.length +
    filters.types.length +
    filters.rarities.length +
    filters.lvs.length +
    filters.costs.length +
    filters.zones.length +
    filters.blocks.length +
    filters.traits.length +
    filters.links.length +
    filters.sources.length +
    (filters.minAp ? 1 : 0) +
    (filters.minHp ? 1 : 0) +
    (filters.showAllAltArts ? 1 : 0);

  const visiblePackages = useMemo(() => {
    if (filters.packageCategories.length === 0) return packages;
    return packages.filter((p) => filters.packageCategories.includes(p.category));
  }, [packages, filters.packageCategories]);

  return (
    <aside className="w-full shrink-0 space-y-4 rounded-xl border border-white/[0.08] bg-[#131822] p-4 lg:w-76">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-bold tracking-wide text-white">
            Multi-Select Filters
          </h2>
          <p className="text-[11px] text-slate-400">
            {activeCount > 0 ? `${activeCount} active · OR within facet` : 'All facets support multi-select'}
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors whitespace-nowrap shrink-0"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Reset</span>
        </button>
      </div>

      {/* Product Category (Multi-select) */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-slate-400">Product Category</label>
        <div className="flex flex-wrap gap-1">
          {PACKAGE_CATEGORIES.map((cat) => {
            const active = filters.packageCategories.includes(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() =>
                  onChange({
                    ...filters,
                    packageCategories: toggleValue(filters.packageCategories, cat),
                  })
                }
                className={`rounded-md border px-2 py-1 text-[11px] transition-colors whitespace-nowrap ${
                  active
                    ? 'border-blue-500/50 bg-blue-600/20 text-blue-200'
                    : 'border-white/[0.07] bg-white/[0.02] text-slate-300 hover:bg-white/[0.06]'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Specific Sets / Collections (Multi-select checklist) */}
      <SearchableChecklist
        title="Sets & Products"
        options={visiblePackages.map((p) => ({
          value: p.id,
          label: `${p.code} · ${p.name} (${p.cardCount})`,
        }))}
        selected={filters.packageIds}
        onToggle={(id) =>
          onChange({ ...filters, packageIds: toggleValue(filters.packageIds, id) })
        }
        placeholder="Search GD01, ST01, Booster..."
      />

      {/* Color (Multi-select) */}
      <div className="space-y-1.5 border-t border-white/[0.06] pt-3">
        <label className="block text-xs font-medium text-slate-400">Color</label>
        <div className="grid grid-cols-3 gap-1.5">
          {COLORS.map((col) => {
            const active = filters.colors.includes(col);
            const meta = CARD_COLOR_META[col];
            return (
              <button
                key={col}
                type="button"
                onClick={() =>
                  onChange({ ...filters, colors: toggleValue(filters.colors, col) })
                }
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

      {/* Card Type (Multi-select) */}
      <div className="space-y-1.5 border-t border-white/[0.06] pt-3">
        <label className="block text-xs font-medium text-slate-400">Card Type</label>
        <div className="flex flex-wrap gap-1.5">
          {CARD_TYPES.map((t) => {
            const active = filters.types.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => onChange({ ...filters, types: toggleValue(filters.types, t) })}
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

      {/* Level (Multi-select) & Cost (Multi-select) */}
      <div className="space-y-2.5 border-t border-white/[0.06] pt-3">
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">
            Level (Lv.) — multi-select
          </label>
          <div className="flex flex-wrap gap-1">
            {LV_OPTIONS.map((lv) => {
              const active = filters.lvs.includes(lv);
              return (
                <button
                  key={lv}
                  type="button"
                  onClick={() => onChange({ ...filters, lvs: toggleValue(filters.lvs, lv) })}
                  className={`h-6 min-w-[26px] rounded border px-1.5 font-mono text-[11px] tabular-nums transition-colors ${
                    active
                      ? 'border-blue-500/60 bg-blue-500/25 text-white'
                      : 'border-white/[0.07] bg-[#0B0E14] text-slate-300 hover:bg-white/[0.06]'
                  }`}
                >
                  {lv}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">
            Cost — multi-select
          </label>
          <div className="flex flex-wrap gap-1">
            {COST_OPTIONS.map((cost) => {
              const active = filters.costs.includes(cost);
              return (
                <button
                  key={cost}
                  type="button"
                  onClick={() => onChange({ ...filters, costs: toggleValue(filters.costs, cost) })}
                  className={`h-6 min-w-[26px] rounded border px-1.5 font-mono text-[11px] tabular-nums transition-colors ${
                    active
                      ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-200'
                      : 'border-white/[0.07] bg-[#0B0E14] text-slate-300 hover:bg-white/[0.06]'
                  }`}
                >
                  {cost}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Min AP</label>
            <input
              type="number"
              value={filters.minAp}
              onChange={(e) => onChange({ ...filters, minAp: e.target.value })}
              placeholder="e.g. 4"
              className="w-full rounded-md border border-white/10 bg-[#0B0E14] px-2 py-1.5 text-xs text-slate-200 font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Min HP</label>
            <input
              type="number"
              value={filters.minHp}
              onChange={(e) => onChange({ ...filters, minHp: e.target.value })}
              placeholder="e.g. 4"
              className="w-full rounded-md border border-white/10 bg-[#0B0E14] px-2 py-1.5 text-xs text-slate-200 font-mono"
            />
          </div>
        </div>
      </div>

      {/* Rarity (Multi-select) */}
      <div className="space-y-1.5 border-t border-white/[0.06] pt-3">
        <label className="block text-xs font-medium text-slate-400">Rarity</label>
        <div className="flex flex-wrap gap-1">
          {RARITIES.map((r) => {
            const active = filters.rarities.includes(r);
            return (
              <button
                key={r}
                type="button"
                onClick={() =>
                  onChange({ ...filters, rarities: toggleValue(filters.rarities, r) })
                }
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

      {/* Zone & Block (Multi-select) */}
      <div className="grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-3">
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Zone</label>
          <div className="flex flex-wrap gap-1">
            {ZONES.map((z) => {
              const active = filters.zones.includes(z);
              return (
                <button
                  key={z}
                  type="button"
                  onClick={() => onChange({ ...filters, zones: toggleValue(filters.zones, z) })}
                  className={`rounded border px-2 py-1 text-[11px] transition-colors ${
                    active
                      ? 'border-blue-500/50 bg-blue-500/20 text-blue-200'
                      : 'border-white/[0.07] bg-[#0B0E14] text-slate-300 hover:bg-white/[0.06]'
                  }`}
                >
                  {z}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Block Icon</label>
          <div className="flex flex-wrap gap-1">
            {blocksList.map((b) => {
              const active = filters.blocks.includes(b);
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => onChange({ ...filters, blocks: toggleValue(filters.blocks, b) })}
                  className={`rounded border px-2 py-1 font-mono text-[11px] transition-colors ${
                    active
                      ? 'border-blue-500/50 bg-blue-500/20 text-blue-200'
                      : 'border-white/[0.07] bg-[#0B0E14] text-slate-300 hover:bg-white/[0.06]'
                  }`}
                >
                  {b}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Searchable Multi-Select Lists for Traits, Link Conditions, Source Titles */}
      <SearchableChecklist
        title="Traits"
        options={traitsList.map((t) => ({ value: t, label: t }))}
        selected={filters.traits}
        onToggle={(val) =>
          onChange({ ...filters, traits: toggleValue(filters.traits, val) })
        }
        placeholder="Search Zeon, White Base..."
      />

      <SearchableChecklist
        title="Link Conditions"
        options={linksList.map((l) => ({ value: l, label: l }))}
        selected={filters.links}
        onToggle={(val) =>
          onChange({ ...filters, links: toggleValue(filters.links, val) })
        }
        placeholder="Search [Amuro Ray], [Kira]..."
      />

      <SearchableChecklist
        title="Source Titles"
        options={sourcesList.map((s) => ({ value: s, label: s }))}
        selected={filters.sources}
        onToggle={(val) =>
          onChange({ ...filters, sources: toggleValue(filters.sources, val) })
        }
        placeholder="Search Mobile Suit Gundam..."
      />

      {/* Alternate Arts toggle */}
      <div className="border-t border-white/[0.08] pt-3">
        <label className="flex items-center justify-between gap-2 text-xs text-slate-200 cursor-pointer">
          <span>Show All Alternate Arts</span>
          <input
            type="checkbox"
            checked={filters.showAllAltArts}
            onChange={(e) =>
              onChange({ ...filters, showAllAltArts: e.target.checked })
            }
            className="h-4 w-4 accent-blue-500"
          />
        </label>
      </div>
    </aside>
  );
}
