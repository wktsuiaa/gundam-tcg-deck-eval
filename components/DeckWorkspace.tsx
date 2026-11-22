'use client';

import React, { useMemo, useState } from 'react';
import {
  Plus,
  Minus,
  Trash2,
  Wand2,
  Copy,
  Check,
  Shuffle,
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Swords,
  Target,
  BookOpen,
  Layers,
  X,
} from 'lucide-react';
import type {
  CardColor,
  DeckAnalysis,
  GundamCardPrint,
  HexagonAxes,
  PacingTier,
  SavedDeck,
  StrategyBlueprint,
  TacticalStyleTag,
} from '@/types/gundam';
import {
  analyzeDeck,
  buildStarterDeckFromCatalog,
  encodeDeckShareParam,
  evaluateMatchupBetween,
  exportDeckToText,
  generateStrategyDeck,
  getRecommendedCardsForStrategy,
  gradeSimulatedHand,
  META_ARCHETYPES,
  parseDeckFromText,
  resolveCardMap,
  STARTER_PRESETS,
} from '@/lib/deck-engine';
import { CARD_COLOR_META } from '@/lib/gundam-keywords';
import { CardArtwork } from '@/components/CardArtwork';
import { HEXAGON_AXIS_META, HexagonRadar } from '@/components/HexagonRadar';

interface DeckWorkspaceProps {
  allCards: GundamCardPrint[];
  decks: SavedDeck[];
  activeDeckId: string;
  onSelectDeck: (id: string) => void;
  onSaveDeck: (deck: SavedDeck) => void;
  onCreateDeck: (deck: SavedDeck) => void;
  onDeleteDeck: (id: string) => void;
  onInspectCard: (cardNo: string, printId?: string) => void;
}

const COLORS: CardColor[] = ['Blue', 'Green', 'Red', 'Purple', 'White'];
const PACING_OPTIONS: PacingTier[] = [
  'Early Rush',
  'Midrange Tempo',
  'Late-Game Control',
  'Ramp / Combo',
];
const STYLE_OPTIONS: TacticalStyleTag[] = [
  'Link-Strike',
  'High-Liquidity Draw',
  'Repair Fortress',
  'Shield Breach',
  'Wide Swarm',
  'Command Control',
  'Resource Ramp',
  'Balanced Midrange',
];

const DEFAULT_BLUEPRINT: StrategyBlueprint = {
  colors: ['Blue', 'White'],
  pacing: 'Midrange Tempo',
  primaryStyle: 'Link-Strike',
  traitFocus: '',
  targetHexagon: {
    aggro: 65,
    defense: 60,
    tempo: 70,
    liquidity: 65,
    synergy: 85,
    control: 55,
  },
};

export function DeckWorkspace({
  allCards,
  decks,
  activeDeckId,
  onSelectDeck,
  onSaveDeck,
  onCreateDeck,
  onDeleteDeck,
  onInspectCard,
}: DeckWorkspaceProps) {
  const [subTab, setSubTab] = useState<'build' | 'strategy' | 'analysis' | 'playbook'>('build');
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerType, setPickerType] = useState<string>('ALL');
  const [pickerColorOnly, setPickerColorOnly] = useState(false);

  // Import / Export Modals
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [copiedMode, setCopiedMode] = useState<'text' | 'url' | null>(null);

  // Head-to-head comparison selection
  const [compareTargetId, setCompareTargetId] = useState<string>('arch:0');
  const [selectedAxis, setSelectedAxis] = useState<keyof HexagonAxes | null>(null);

  // Test Hand Simulator State
  const [simHandIndices, setSimHandIndices] = useState<number[]>([]);
  const [simDeckOrder, setSimDeckOrder] = useState<GundamCardPrint[]>([]);
  const [mulliganUsed, setMulliganUsed] = useState(false);

  const { byPrintId, byCardNo } = useMemo(() => resolveCardMap(allCards), [allCards]);

  const activeDeck = decks.find((d) => d.id === activeDeckId) ?? decks[0];

  const analysis: DeckAnalysis | null = useMemo(() => {
    if (!activeDeck) return null;
    return analyzeDeck(activeDeck, byPrintId, byCardNo);
  }, [activeDeck, byPrintId, byCardNo]);

  // Strategy Blueprint state synced with activeDeck or default
  const blueprint: StrategyBlueprint = activeDeck?.strategyBlueprint ?? DEFAULT_BLUEPRINT;

  const updateBlueprint = (patch: Partial<StrategyBlueprint>) => {
    if (!activeDeck) return;
    onSaveDeck({
      ...activeDeck,
      updatedAt: new Date().toISOString(),
      strategyBlueprint: { ...blueprint, ...patch },
    });
  };

  // Unique base cards for picker
  const uniqueBaseCards = useMemo(() => {
    const map = new Map<string, GundamCardPrint>();
    for (const c of allCards) {
      if (!['UNIT', 'PILOT', 'COMMAND', 'BASE', 'RESOURCE'].includes(c.type)) continue;
      const prev = map.get(c.cardNo);
      if (!prev || (prev.isParallel && !c.isParallel)) {
        map.set(c.cardNo, c);
      }
    }
    return [...map.values()];
  }, [allCards]);

  // Popular traits for Strategy Blueprint dropdown
  const topTraits = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of uniqueBaseCards) {
      for (const t of c.traits) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .filter(([, cnt]) => cnt >= 4)
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);
  }, [uniqueBaseCards]);

  const pickerCards = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    const deckColors = new Set(analysis?.validation.colors ?? []);
    return uniqueBaseCards
      .filter((c) => {
        if (pickerType !== 'ALL' && c.type !== pickerType) return false;
        if (
          pickerColorOnly &&
          deckColors.size > 0 &&
          c.type !== 'RESOURCE' &&
          c.color !== 'Colorless' &&
          !deckColors.has(c.color)
        ) {
          return false;
        }
        if (q) {
          const hay = `${c.cardNo} ${c.name} ${c.effect} ${c.traits.join(' ')} ${c.link}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .slice(0, 60);
  }, [uniqueBaseCards, pickerSearch, pickerType, pickerColorOnly, analysis]);

  const strategyRecommendations = useMemo(() => {
    if (!activeDeck) return [];
    return getRecommendedCardsForStrategy(allCards, blueprint, activeDeck.mainDeck, 18);
  }, [allCards, blueprint, activeDeck]);

  // Helper to adjust card qty in active deck
  const adjustDeckCard = (card: GundamCardPrint, delta: number) => {
    if (!activeDeck) return;
    const isResource = card.type === 'RESOURCE';
    const list = isResource ? [...activeDeck.resourceDeck] : [...activeDeck.mainDeck];
    const idx = list.findIndex((e) => e.cardNo === card.cardNo);
    const maxPerCard = isResource ? 10 : 4;

    if (idx === -1 && delta > 0) {
      list.push({ cardNo: card.cardNo, printId: card.printId, qty: Math.min(maxPerCard, delta) });
    } else if (idx !== -1) {
      const nextQty = Math.min(maxPerCard, Math.max(0, list[idx].qty + delta));
      if (nextQty === 0) {
        list.splice(idx, 1);
      } else {
        list[idx] = { ...list[idx], qty: nextQty };
      }
    }

    onSaveDeck({
      ...activeDeck,
      updatedAt: new Date().toISOString(),
      mainDeck: isResource ? activeDeck.mainDeck : list,
      resourceDeck: isResource ? list : activeDeck.resourceDeck,
    });
  };

  const handleGenerateFromStrategy = () => {
    if (!activeDeck) return;
    const generated = generateStrategyDeck(allCards, blueprint);
    onSaveDeck({
      ...activeDeck,
      name:
        activeDeck.name === 'New Custom Deck'
          ? `${blueprint.colors.join('/')} ${blueprint.primaryStyle}`
          : activeDeck.name,
      updatedAt: new Date().toISOString(),
      mainDeck: generated.mainDeck,
      resourceDeck: generated.resourceDeck,
      strategyBlueprint: blueprint,
    });
  };

  const handleCreateNewBlank = () => {
    const newDeck: SavedDeck = {
      id: `deck-${Date.now()}`,
      name: `Custom Deck ${decks.length + 1}`,
      updatedAt: new Date().toISOString(),
      mainDeck: [],
      resourceDeck: [],
      strategyBlueprint: DEFAULT_BLUEPRINT,
    };
    onCreateDeck(newDeck);
    setSubTab('strategy');
  };

  const handleCloneStarter = (code: string) => {
    const starter = buildStarterDeckFromCatalog(code, allCards);
    onCreateDeck(starter);
    setSubTab('analysis');
  };

  const handleImportSubmit = () => {
    if (!activeDeck) return;
    const parsed = parseDeckFromText(importText, byPrintId, byCardNo);
    if (parsed.mainDeck.length === 0 && parsed.resourceDeck.length === 0) {
      setImportError('No valid Gundam card numbers recognized (e.g., "4 GD01-001 Gundam").');
      return;
    }
    onSaveDeck({
      ...activeDeck,
      updatedAt: new Date().toISOString(),
      mainDeck: parsed.mainDeck,
      resourceDeck:
        parsed.resourceDeck.length > 0 ? parsed.resourceDeck : activeDeck.resourceDeck,
    });
    setImportError(
      parsed.unmatched.length > 0
        ? `Imported with ${parsed.unmatched.length} unrecognized line(s).`
        : null
    );
    if (parsed.unmatched.length === 0) {
      setImportOpen(false);
      setImportText('');
    }
  };

  const handleCopyText = async () => {
    if (!activeDeck) return;
    const txt = exportDeckToText(activeDeck, byPrintId, byCardNo);
    await navigator.clipboard.writeText(txt);
    setCopiedMode('text');
    setTimeout(() => setCopiedMode(null), 1800);
  };

  const handleCopyShareUrl = async () => {
    if (!activeDeck) return;
    const encoded = encodeDeckShareParam(activeDeck);
    const url = `${window.location.origin}${window.location.pathname}?deck=${encodeURIComponent(
      encoded
    )}`;
    await navigator.clipboard.writeText(url);
    setCopiedMode('url');
    setTimeout(() => setCopiedMode(null), 1800);
  };

  // Simulator helpers
  const deckPool50 = useMemo(() => {
    if (!activeDeck) return [];
    const pool: GundamCardPrint[] = [];
    for (const entry of activeDeck.mainDeck) {
      const card = byPrintId.get(entry.printId) ?? byCardNo.get(entry.cardNo);
      if (card) {
        for (let i = 0; i < entry.qty; i++) pool.push(card);
      }
    }
    return pool;
  }, [activeDeck, byPrintId, byCardNo]);

  const drawNewOpeningHand = () => {
    if (deckPool50.length < 5) return;
    const shuffled = [...deckPool50];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setSimDeckOrder(shuffled);
    setSimHandIndices([0, 1, 2, 3, 4]);
    setMulliganUsed(false);
  };

  const triggerMulligan = () => {
    if (simDeckOrder.length < 5 || mulliganUsed) return;
    const reshuffled = [...simDeckOrder];
    for (let i = reshuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [reshuffled[i], reshuffled[j]] = [reshuffled[j], reshuffled[i]];
    }
    setSimDeckOrder(reshuffled);
    setSimHandIndices([0, 1, 2, 3, 4]);
    setMulliganUsed(true);
  };

  const drawNextCard = () => {
    if (simHandIndices.length >= simDeckOrder.length) return;
    setSimHandIndices((prev) => [...prev, prev.length]);
  };

  const simulatedHandCards = useMemo(
    () => simHandIndices.map((idx) => simDeckOrder[idx]).filter(Boolean),
    [simHandIndices, simDeckOrder]
  );
  const simVerdict = useMemo(() => {
    if (!analysis || simulatedHandCards.length === 0) return null;
    return gradeSimulatedHand(simulatedHandCards.slice(0, 5), analysis.pacing, deckPool50);
  }, [analysis, simulatedHandCards, deckPool50]);

  // Head-to-head comparison target resolution
  const h2hComparison = useMemo(() => {
    if (!analysis || !activeDeck) return null;
    if (compareTargetId.startsWith('arch:')) {
      const idx = Number(compareTargetId.split(':')[1] ?? 0);
      const arch = META_ARCHETYPES[idx] ?? META_ARCHETYPES[0];
      return {
        label: arch.name,
        hexagon: arch.hexagon,
        assessment: evaluateMatchupBetween(
          activeDeck.name,
          analysis.hexagon,
          analysis.pacing,
          arch.name,
          arch.colors,
          arch.pacing,
          arch.hexagon
        ),
      };
    }
    if (compareTargetId.startsWith('starter:')) {
      const code = compareTargetId.split(':')[1];
      const stDeck = buildStarterDeckFromCatalog(code, allCards);
      const stAnalysis = analyzeDeck(stDeck, byPrintId, byCardNo);
      return {
        label: stDeck.name,
        hexagon: stAnalysis.hexagon,
        assessment: evaluateMatchupBetween(
          activeDeck.name,
          analysis.hexagon,
          analysis.pacing,
          stDeck.name,
          stAnalysis.validation.colors,
          stAnalysis.pacing,
          stAnalysis.hexagon
        ),
      };
    }
    const other = decks.find((d) => d.id === compareTargetId);
    if (other) {
      const otherAnalysis = analyzeDeck(other, byPrintId, byCardNo);
      return {
        label: other.name,
        hexagon: otherAnalysis.hexagon,
        assessment: evaluateMatchupBetween(
          activeDeck.name,
          analysis.hexagon,
          analysis.pacing,
          other.name,
          otherAnalysis.validation.colors,
          otherAnalysis.pacing,
          otherAnalysis.hexagon
        ),
      };
    }
    return null;
  }, [compareTargetId, analysis, activeDeck, decks, allCards, byPrintId, byCardNo]);

  if (!activeDeck || !analysis) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-[#131822] p-12 text-center">
        <h2 className="font-display text-2xl font-bold text-white">No Active Deck</h2>
        <p className="mt-2 text-sm text-slate-400">
          Create a custom deck, build from a Strategy Blueprint, or clone an official Starter Deck.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={handleCreateNewBlank}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500"
          >
            Create Strategy Deck
          </button>
          {STARTER_PRESETS.map((st) => (
            <button
              key={st.code}
              type="button"
              onClick={() => handleCloneStarter(st.code)}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-slate-200 hover:bg-white/10"
            >
              Clone {st.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const mainQtyByNo = new Map(activeDeck.mainDeck.map((e) => [e.cardNo, e.qty]));
  const resQtyByNo = new Map(activeDeck.resourceDeck.map((e) => [e.cardNo, e.qty]));

  return (
    <div className="space-y-5">
      {/* Top Deck Management Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#131822] p-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={activeDeck.id}
            onChange={(e) => onSelectDeck(e.target.value)}
            aria-label="Select deck"
            className="rounded-lg border border-white/10 bg-[#0B0E14] px-3 py-2 text-xs font-medium text-white focus:border-blue-500 focus:outline-none"
          >
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={activeDeck.name}
            onChange={(e) =>
              onSaveDeck({
                ...activeDeck,
                name: e.target.value,
                updatedAt: new Date().toISOString(),
              })
            }
            aria-label="Deck name"
            className="w-48 rounded-lg border border-white/10 bg-[#0B0E14] px-3 py-2 text-xs font-medium text-white focus:border-blue-500 focus:outline-none"
          />

          <button
            type="button"
            onClick={handleCreateNewBlank}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Deck</span>
          </button>

          <select
            value=""
            onChange={(e) => {
              if (e.target.value) handleCloneStarter(e.target.value);
            }}
            aria-label="Clone starter deck"
            className="rounded-lg border border-white/10 bg-[#0B0E14] px-2.5 py-2 text-xs text-slate-300"
          >
            <option value="">Clone Starter Deck...</option>
            {STARTER_PRESETS.map((st) => (
              <option key={st.code} value={st.code}>
                {st.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 whitespace-nowrap"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Import Text</span>
          </button>
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 whitespace-nowrap"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Export / Share</span>
          </button>
          {decks.length > 1 && (
            <button
              type="button"
              onClick={() => onDeleteDeck(activeDeck.id)}
              className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-xs font-medium text-red-300 hover:bg-red-500/20"
              aria-label="Delete deck"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Legal Status & Sub-Tab Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-3">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-[#131822] p-1">
          {[
            { id: 'build', label: 'Build & Cards', icon: Layers },
            { id: 'strategy', label: 'Strategy Blueprint', icon: Target },
            { id: 'analysis', label: 'Hexagon & Matchups', icon: Swords },
            { id: 'playbook', label: 'Playbook & Mulligan', icon: BookOpen },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = subTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id as typeof subTab)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  active ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums">
          <span
            className={
              analysis.validation.mainCount === 50 ? 'text-emerald-400' : 'text-amber-300'
            }
          >
            Main {analysis.validation.mainCount}/50
          </span>
          <span className="text-slate-600">·</span>
          <span
            className={
              analysis.validation.resourceCount === 10 ? 'text-emerald-400' : 'text-amber-300'
            }
          >
            Resource {analysis.validation.resourceCount}/10
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-200">
            {analysis.validation.colors.join(' / ') || 'No Color'}
          </span>
          <span className="text-slate-600">·</span>
          <span
            className={`inline-flex items-center gap-1 font-sans font-medium ${
              analysis.validation.isLegal ? 'text-emerald-400' : 'text-amber-300'
            }`}
          >
            {analysis.validation.isLegal ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Tournament Legal</span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>Needs {analysis.validation.errors.length} fix(es)</span>
              </>
            )}
          </span>
        </div>
      </div>

      {/* TAB 1: BUILD & CARDS */}
      {subTab === 'build' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: Fast Card Picker */}
          <div className="lg:col-span-7 space-y-3 rounded-xl border border-white/[0.08] bg-[#131822] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Search card name, number, trait, or effect..."
                className="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-[#0B0E14] px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <select
                value={pickerType}
                onChange={(e) => setPickerType(e.target.value)}
                className="rounded-lg border border-white/10 bg-[#0B0E14] px-2.5 py-2 text-xs text-slate-200"
              >
                <option value="ALL">All Types</option>
                <option value="UNIT">UNIT</option>
                <option value="PILOT">PILOT</option>
                <option value="COMMAND">COMMAND</option>
                <option value="BASE">BASE</option>
                <option value="RESOURCE">RESOURCE</option>
              </select>
              <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={pickerColorOnly}
                  onChange={(e) => setPickerColorOnly(e.target.checked)}
                  className="accent-blue-500"
                />
                <span>Deck Colors Only</span>
              </label>
            </div>

            <div className="grid max-h-[68vh] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4">
              {pickerCards.map((card) => {
                const inDeck =
                  card.type === 'RESOURCE'
                    ? resQtyByNo.get(card.cardNo) ?? 0
                    : mainQtyByNo.get(card.cardNo) ?? 0;
                const max = card.type === 'RESOURCE' ? 10 : 4;
                return (
                  <div
                    key={card.printId}
                    className="flex flex-col rounded-lg border border-white/[0.07] bg-[#0B0E14] p-1.5"
                  >
                    <button
                      type="button"
                      onClick={() => onInspectCard(card.cardNo, card.printId)}
                      className="relative aspect-[5/7] w-full overflow-hidden rounded"
                    >
                      <CardArtwork card={card} className="h-full w-full" />
                      {inDeck > 0 && (
                        <span className="absolute right-1 top-1 rounded bg-blue-600 px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">
                          ×{inDeck}
                        </span>
                      )}
                    </button>
                    <div className="mt-1.5 truncate text-[11px] font-medium text-slate-100">
                      {card.name}
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                      <span>{card.cardNo}</span>
                      <span>C:{card.cost ?? '-'}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => adjustDeckCard(card, -1)}
                        disabled={inDeck === 0}
                        className="flex h-7 flex-1 items-center justify-center rounded border border-white/10 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-30"
                      >
                        -
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustDeckCard(card, 1)}
                        disabled={inDeck >= max}
                        className="flex h-7 flex-[2] items-center justify-center rounded bg-blue-600/85 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-35"
                      >
                        + Add
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Current Deck List & Validation */}
          <div className="lg:col-span-5 space-y-4 rounded-xl border border-white/[0.08] bg-[#131822] p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-white">Decklist</h3>
              <span className="text-xs text-slate-400">
                {analysis.pacing} · {analysis.styles[0]}
              </span>
            </div>

            {analysis.validation.errors.length > 0 && (
              <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                {analysis.validation.errors.map((err, i) => (
                  <div key={i}>• {err}</div>
                ))}
              </div>
            )}

            <div className="max-h-[58vh] space-y-4 overflow-y-auto pr-1">
              {(['UNIT', 'PILOT', 'COMMAND', 'BASE'] as const).map((cardType) => {
                const entries = activeDeck.mainDeck
                  .map((e) => ({
                    entry: e,
                    card: byPrintId.get(e.printId) ?? byCardNo.get(e.cardNo),
                  }))
                  .filter((x): x is { entry: typeof x.entry; card: GundamCardPrint } =>
                    Boolean(x.card && x.card.type === cardType)
                  )
                  .sort((a, b) => (a.card.cost ?? 0) - (b.card.cost ?? 0));

                const count = entries.reduce((s, x) => s + x.entry.qty, 0);
                return (
                  <div key={cardType} className="space-y-1.5">
                    <div className="flex items-center justify-between border-b border-white/[0.06] pb-1 text-xs font-semibold text-slate-300">
                      <span>{cardType}</span>
                      <span className="font-mono tabular-nums text-slate-400">{count}</span>
                    </div>
                    {entries.length === 0 ? (
                      <div className="py-1 text-[11px] text-slate-500">None added yet</div>
                    ) : (
                      entries.map(({ entry, card }) => {
                        const cMeta = CARD_COLOR_META[card.color] ?? CARD_COLOR_META.Colorless;
                        return (
                          <div
                            key={card.cardNo}
                            className="flex items-center justify-between gap-2 rounded-md border border-white/[0.05] bg-[#0B0E14] px-2.5 py-1.5 text-xs"
                          >
                            <button
                              type="button"
                              onClick={() => onInspectCard(card.cardNo, card.printId)}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-blue-300"
                            >
                              <span
                                className="h-2 w-2 shrink-0 rounded-xs"
                                style={{ backgroundColor: cMeta.hex }}
                              />
                              <span className="font-mono text-[11px] text-slate-400 shrink-0">
                                {card.cardNo}
                              </span>
                              <span className="truncate font-medium text-slate-100">
                                {card.name}
                              </span>
                            </button>
                            <div className="flex items-center gap-1.5 shrink-0 font-mono tabular-nums">
                              <span className="text-[11px] text-slate-500">
                                Lv{card.lv ?? '-'}·C{card.cost ?? '-'}
                              </span>
                              <button
                                type="button"
                                onClick={() => adjustDeckCard(card, -1)}
                                className="flex h-6 w-6 items-center justify-center rounded border border-white/10 text-slate-300 hover:bg-white/10"
                              >
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className="w-4 text-center font-semibold text-white">
                                {entry.qty}
                              </span>
                              <button
                                type="button"
                                onClick={() => adjustDeckCard(card, 1)}
                                disabled={entry.qty >= 4}
                                className="flex h-6 w-6 items-center justify-center rounded border border-white/10 text-slate-300 hover:bg-white/10 disabled:opacity-30"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                );
              })}

              {/* Resource Deck */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between border-b border-white/[0.06] pb-1 text-xs font-semibold text-slate-300">
                  <span>RESOURCE DECK</span>
                  <span className="font-mono tabular-nums text-slate-400">
                    {analysis.validation.resourceCount} / 10
                  </span>
                </div>
                {activeDeck.resourceDeck.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      const res = allCards.find((c) => c.type === 'RESOURCE');
                      if (res) adjustDeckCard(res, 10);
                    }}
                    className="w-full rounded-md border border-dashed border-white/15 py-2 text-xs text-blue-300 hover:bg-white/[0.04]"
                  >
                    + Fill 10 Standard Resource Cards
                  </button>
                ) : (
                  activeDeck.resourceDeck.map((entry) => {
                    const card = byPrintId.get(entry.printId) ?? byCardNo.get(entry.cardNo);
                    if (!card) return null;
                    return (
                      <div
                        key={card.cardNo}
                        className="flex items-center justify-between gap-2 rounded-md border border-white/[0.05] bg-[#0B0E14] px-2.5 py-1.5 text-xs"
                      >
                        <span className="font-medium text-slate-200">
                          {card.cardNo} · {card.name}
                        </span>
                        <div className="flex items-center gap-1.5 font-mono tabular-nums">
                          <button
                            type="button"
                            onClick={() => adjustDeckCard(card, -1)}
                            className="flex h-6 w-6 items-center justify-center rounded border border-white/10 text-slate-300 hover:bg-white/10"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-5 text-center font-semibold text-white">
                            {entry.qty}
                          </span>
                          <button
                            type="button"
                            onClick={() => adjustDeckCard(card, 1)}
                            disabled={entry.qty >= 10}
                            className="flex h-6 w-6 items-center justify-center rounded border border-white/10 text-slate-300 hover:bg-white/10 disabled:opacity-30"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: STRATEGY BLUEPRINT BUILDER */}
      {subTab === 'strategy' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: User Strategy Controls */}
          <div className="lg:col-span-5 space-y-5 rounded-xl border border-white/[0.08] bg-[#131822] p-5">
            <div>
              <h3 className="font-display text-xl font-bold text-white">
                Define Your Deck Strategy
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                Set your target colors, pacing, tactical style, and 6-axis Hexagon priorities to generate a legal 50+10 deck or coach manual edits.
              </p>
            </div>

            {/* Colors (1-2) */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-300">
                Target Colors (select 1 or 2)
              </label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((col) => {
                  const selected = blueprint.colors.includes(col);
                  const meta = CARD_COLOR_META[col];
                  return (
                    <button
                      key={col}
                      type="button"
                      onClick={() => {
                        const next = selected
                          ? blueprint.colors.filter((c) => c !== col)
                          : blueprint.colors.length < 2
                          ? [...blueprint.colors, col]
                          : [blueprint.colors[1], col];
                        updateBlueprint({ colors: next.length > 0 ? next : [col] });
                      }}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        selected
                          ? `${meta.softBg} ${meta.border} text-white`
                          : 'border-white/10 bg-[#0B0E14] text-slate-400 hover:text-white'
                      }`}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-xs"
                        style={{ backgroundColor: meta.hex }}
                      />
                      <span>{col}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Pacing */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-300">Target Pacing</label>
              <div className="grid grid-cols-2 gap-2">
                {PACING_OPTIONS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => updateBlueprint({ pacing: p })}
                    className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                      blueprint.pacing === p
                        ? 'border-blue-500/60 bg-blue-500/15 text-white'
                        : 'border-white/10 bg-[#0B0E14] text-slate-300 hover:bg-white/[0.04]'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Primary Tactical Style */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Primary Style Focus
                </label>
                <select
                  value={blueprint.primaryStyle}
                  onChange={(e) =>
                    updateBlueprint({ primaryStyle: e.target.value as TacticalStyleTag })
                  }
                  className="w-full rounded-lg border border-white/10 bg-[#0B0E14] px-3 py-2 text-xs text-white"
                >
                  {STYLE_OPTIONS.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Optional Trait Theme
                </label>
                <select
                  value={blueprint.traitFocus}
                  onChange={(e) => updateBlueprint({ traitFocus: e.target.value })}
                  className="w-full rounded-lg border border-white/10 bg-[#0B0E14] px-3 py-2 text-xs text-white"
                >
                  <option value="">Any Faction / Trait</option>
                  {topTraits.map((tr) => (
                    <option key={tr} value={tr}>
                      {tr}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 6-Axis Target Hexagon Sliders */}
            <div className="space-y-3 border-t border-white/[0.08] pt-4">
              <div className="text-xs font-medium text-slate-300">
                Target 6-Axis Hexagon Profile
              </div>
              {HEXAGON_AXIS_META.map((ax) => (
                <div key={ax.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">{ax.label}</span>
                    <span className="font-mono tabular-nums text-amber-300">
                      {blueprint.targetHexagon[ax.key]}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={15}
                    max={95}
                    step={5}
                    value={blueprint.targetHexagon[ax.key]}
                    onChange={(e) =>
                      updateBlueprint({
                        targetHexagon: {
                          ...blueprint.targetHexagon,
                          [ax.key]: Number(e.target.value),
                        },
                      })
                    }
                    className="w-full accent-amber-400"
                  />
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleGenerateFromStrategy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
            >
              <Wand2 className="h-4 w-4" />
              <span>Generate Legal 50+10 Deck from Strategy</span>
            </button>
          </div>

          {/* Right: Target vs Actual Hexagon + Ranked Card Recommendations */}
          <div className="lg:col-span-7 space-y-6">
            <div className="rounded-xl border border-white/[0.08] bg-[#131822] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h3 className="font-display text-lg font-bold text-white">
                  Current Deck vs. Target Strategy Hexagon
                </h3>
                <span className="text-xs text-slate-400">
                  Solid = Current · Dashed = Target Blueprint
                </span>
              </div>
              <div className="flex justify-center">
                <HexagonRadar
                  primary={analysis.hexagon}
                  primaryLabel={activeDeck.name}
                  secondary={blueprint.targetHexagon}
                  secondaryLabel="Target Strategy"
                  secondaryColor="#F59E0B"
                  size={330}
                />
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-[#131822] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-bold text-white">
                  Recommended Cards for Your Strategy
                </h3>
                <span className="text-xs text-slate-400">
                  Ranked by fit + Link synergy
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {strategyRecommendations.map(({ card, fitScore, reason }) => {
                  const inDeck = mainQtyByNo.get(card.cardNo) ?? 0;
                  return (
                    <div
                      key={card.printId}
                      className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-[#0B0E14] p-2.5"
                    >
                      <button
                        type="button"
                        onClick={() => onInspectCard(card.cardNo, card.printId)}
                        className="h-16 w-12 shrink-0 overflow-hidden rounded"
                      >
                        <CardArtwork card={card} className="h-full w-full" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate text-xs font-semibold text-white">
                            {card.name}
                          </span>
                          <span className="font-mono text-[11px] text-amber-300 tabular-nums shrink-0">
                            {fitScore}% fit
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {card.cardNo} · {card.type} · C{card.cost ?? '-'}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-400">{reason}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => adjustDeckCard(card, 1)}
                        disabled={inDeck >= 4}
                        className="shrink-0 rounded-md bg-blue-600/85 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-35"
                      >
                        {inDeck > 0 ? `+1 (${inDeck})` : '+1'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: HEXAGON, STYLE, PACING & MATCHUPS */}
      {subTab === 'analysis' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Hexagon + H2H Overlay Selector */}
            <div className="lg:col-span-5 rounded-xl border border-white/[0.08] bg-[#131822] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-xl font-bold text-white">
                  6-Axis Deck Hexagon
                </h3>
                <select
                  value={compareTargetId}
                  onChange={(e) => setCompareTargetId(e.target.value)}
                  aria-label="Overlay comparison deck or archetype"
                  className="max-w-[220px] rounded-lg border border-white/10 bg-[#0B0E14] px-2.5 py-1.5 text-xs text-slate-200"
                >
                  <optgroup label="Meta Archetypes">
                    {META_ARCHETYPES.map((a, idx) => (
                      <option key={a.name} value={`arch:${idx}`}>
                        vs {a.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Starter Deck Presets">
                    {STARTER_PRESETS.map((st) => (
                      <option key={st.code} value={`starter:${st.code}`}>
                        vs {st.name}
                      </option>
                    ))}
                  </optgroup>
                  {decks.filter((d) => d.id !== activeDeck.id).length > 0 && (
                    <optgroup label="Your Saved Decks">
                      {decks
                        .filter((d) => d.id !== activeDeck.id)
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            vs {d.name}
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div className="flex justify-center">
                <HexagonRadar
                  primary={analysis.hexagon}
                  primaryLabel={activeDeck.name}
                  secondary={h2hComparison?.hexagon ?? null}
                  secondaryLabel={h2hComparison?.label}
                  secondaryColor="#F59E0B"
                  selectedAxis={selectedAxis}
                  onSelectAxis={setSelectedAxis}
                  size={340}
                />
              </div>

              {h2hComparison && (
                <div className="rounded-lg border border-white/[0.08] bg-[#0B0E14] p-3.5 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">
                      Head-to-Head: {h2hComparison.label}
                    </span>
                    <span
                      className={`font-mono font-semibold ${
                        h2hComparison.assessment.difficultyScore <= 2
                          ? 'text-emerald-400'
                          : h2hComparison.assessment.difficultyScore === 3
                          ? 'text-slate-200'
                          : 'text-red-400'
                      }`}
                    >
                      {h2hComparison.assessment.verdict} (Diff {h2hComparison.assessment.difficultyScore}/5)
                    </span>
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    {h2hComparison.assessment.keyTip}
                  </p>
                </div>
              )}
            </div>

            {/* Style, Pacing, Strengths, Weaknesses & Axis Breakdowns */}
            <div className="lg:col-span-7 space-y-5">
              <div className="rounded-xl border border-white/[0.08] bg-[#131822] p-5 space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-4">
                  <div>
                    <div className="text-xs text-slate-400">Deck Pacing & Tactical Style</div>
                    <div className="mt-1 font-display text-2xl font-bold text-white">
                      {analysis.pacing}{' '}
                      <span className="text-blue-400 font-normal">
                        · {analysis.styles.join(' / ')}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-5 font-mono text-xs tabular-nums text-slate-300">
                    <div>
                      <span className="text-slate-500">Avg Cost </span>
                      <span className="text-white font-semibold">{analysis.avgCost}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Avg Lv. </span>
                      <span className="text-white font-semibold">{analysis.avgLv}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Link Rate </span>
                      <span className="text-white font-semibold">{analysis.linkCoveragePct}%</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 border-t border-white/[0.08] pt-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                      Strengths
                    </div>
                    <ul className="space-y-1.5 text-xs leading-relaxed text-slate-200">
                      {analysis.strengths.map((s, i) => (
                        <li key={i}>• {s}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-amber-400">
                      Weaknesses
                    </div>
                    <ul className="space-y-1.5 text-xs leading-relaxed text-slate-200">
                      {analysis.weaknesses.map((w, i) => (
                        <li key={i}>• {w}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {/* 6-Axis Score Cards */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {analysis.breakdowns.map((ax) => (
                  <div
                    key={ax.key}
                    onMouseEnter={() => setSelectedAxis(ax.key)}
                    onMouseLeave={() => setSelectedAxis(null)}
                    className={`rounded-xl border p-4 transition-colors ${
                      selectedAxis === ax.key
                        ? 'border-blue-500/60 bg-blue-500/10'
                        : 'border-white/[0.08] bg-[#131822]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">{ax.label}</span>
                      <span className="font-mono text-sm font-bold tabular-nums text-blue-300">
                        {ax.score}/100
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                      <div
                        className="h-full bg-blue-500"
                        style={{ width: `${ax.score}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate-300">{ax.summary}</p>
                    <div className="mt-1.5 text-[11px] font-mono text-slate-400">
                      {ax.drivers.join(' · ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Cost & Level Curve Telemetry */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-white/[0.08] bg-[#131822] p-5 space-y-3">
              <h4 className="font-display text-base font-bold text-white">Cost Curve</h4>
              <div className="flex h-32 items-end gap-2 pt-4">
                {analysis.costCurve.map((b) => {
                  const maxVal = Math.max(1, ...analysis.costCurve.map((x) => x.count));
                  const h = Math.round((b.count / maxVal) * 100);
                  return (
                    <div key={b.cost} className="flex flex-1 flex-col items-center gap-1.5">
                      <span className="font-mono text-[11px] tabular-nums text-slate-300">
                        {b.count}
                      </span>
                      <div className="flex h-20 w-full items-end rounded bg-white/[0.04]">
                        <div
                          className="w-full rounded-t bg-blue-500/80 transition-all"
                          style={{ height: `${h}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] text-slate-400">C{b.cost}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-[#131822] p-5 space-y-3">
              <h4 className="font-display text-base font-bold text-white">Level Curve & Type Split</h4>
              <div className="flex h-32 items-end gap-2 pt-4">
                {analysis.lvCurve.map((b) => {
                  const maxVal = Math.max(1, ...analysis.lvCurve.map((x) => x.count));
                  const h = Math.round((b.count / maxVal) * 100);
                  return (
                    <div key={b.lv} className="flex flex-1 flex-col items-center gap-1.5">
                      <span className="font-mono text-[11px] tabular-nums text-slate-300">
                        {b.count}
                      </span>
                      <div className="flex h-20 w-full items-end rounded bg-white/[0.04]">
                        <div
                          className="w-full rounded-t bg-emerald-500/75 transition-all"
                          style={{ height: `${h}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] text-slate-400">Lv{b.lv}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-4 border-t border-white/[0.06] pt-2 text-xs font-mono tabular-nums text-slate-300">
                {analysis.typeSplit.map((t) => (
                  <span key={t.type}>
                    {t.type}: <strong className="text-white">{t.count}</strong>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Archetype Matchup Difficulty Matrix */}
          <div className="rounded-xl border border-white/[0.08] bg-[#131822] p-5 space-y-4">
            <div>
              <h3 className="font-display text-xl font-bold text-white">
                Difficulty Against Meta Deck Archetypes
              </h3>
              <p className="text-xs text-slate-400">
                Click any matchup row to overlay its Hexagon on the radar chart above.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {analysis.matchups.map((m, idx) => (
                <button
                  key={m.opponentName}
                  type="button"
                  onClick={() => setCompareTargetId(`arch:${idx}`)}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    compareTargetId === `arch:${idx}`
                      ? 'border-amber-400/60 bg-amber-500/10'
                      : 'border-white/[0.07] bg-[#0B0E14] hover:border-white/20'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-white">{m.opponentName}</div>
                      <div className="text-[11px] text-slate-400">{m.opponentPacing}</div>
                    </div>
                    <span
                      className={`shrink-0 font-mono text-xs font-semibold ${
                        m.difficultyScore <= 2
                          ? 'text-emerald-400'
                          : m.difficultyScore === 3
                          ? 'text-slate-200'
                          : 'text-red-400'
                      }`}
                    >
                      {m.verdict}
                    </span>
                  </div>

                  {/* Difficulty Meter 1-5 */}
                  <div className="mt-3 flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 mr-1">Difficulty</span>
                    {[1, 2, 3, 4, 5].map((step) => (
                      <span
                        key={step}
                        className={`h-1.5 flex-1 rounded-full ${
                          step <= m.difficultyScore
                            ? m.difficultyScore >= 4
                              ? 'bg-red-500'
                              : m.difficultyScore === 3
                              ? 'bg-amber-400'
                              : 'bg-emerald-500'
                            : 'bg-white/10'
                        }`}
                      />
                    ))}
                    <span className="ml-1 font-mono text-[11px] tabular-nums text-slate-300">
                      {m.difficultyScore}/5
                    </span>
                  </div>

                  <div className="mt-3 space-y-1 text-xs text-slate-300">
                    <div>+ {m.advantages[0]}</div>
                    <div className="text-slate-400">! {m.risks[0]}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PLAYBOOK, STARTING HAND, MULLIGAN, CRITICAL TURNS & COMBOS */}
      {subTab === 'playbook' && (
        <div className="space-y-6">
          {/* Primary Advantage Objective + Odds */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-8 rounded-xl border border-white/[0.08] bg-[#131822] p-5 space-y-3">
              <h3 className="font-display text-xl font-bold text-white">
                Primary Win Objective & Largest-Advantage Engine
              </h3>
              <p className="text-sm leading-relaxed text-slate-100">
                {analysis.playbook.primaryObjective}
              </p>
              <p className="text-xs leading-relaxed text-slate-400">
                Advantage Mechanism: {analysis.playbook.advantageMechanism}
              </p>
            </div>

            <div className="lg:col-span-4 rounded-xl border border-white/[0.08] bg-[#131822] p-5 space-y-3">
              <h4 className="font-display text-base font-bold text-white">
                5-Card Opening Hand Odds
              </h4>
              <div className="space-y-2 text-xs font-mono tabular-nums">
                <div className="flex justify-between">
                  <span className="font-sans text-slate-300">≥1 Early Unit (Cost ≤ 2)</span>
                  <span className="text-emerald-400 font-semibold">
                    {analysis.playbook.odds.earlyPlayablePct}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-sans text-slate-300">≥1 Card Liquidity Engine</span>
                  <span className="text-blue-300 font-semibold">
                    {analysis.playbook.odds.drawEnginePct}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="font-sans text-slate-300">Natural Link Pair in Opener</span>
                  <span className="text-amber-300 font-semibold">
                    {analysis.playbook.odds.linkPairPct}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Best vs Worst Starting Hand + Mulligan Criteria */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-emerald-500/25 bg-[#131822] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-display text-lg font-bold text-emerald-300">
                  Best Starting Hand Scenario
                </h4>
                <span className="text-xs font-mono text-emerald-400">Ideal 5 Cards</span>
              </div>
              <p className="text-xs text-slate-300">
                {analysis.playbook.bestStartingHand.explanation}
              </p>
              <div className="grid grid-cols-5 gap-2 pt-1">
                {analysis.playbook.bestStartingHand.cards.map((c, idx) => (
                  <button
                    key={`${c.printId}-${idx}`}
                    type="button"
                    onClick={() => onInspectCard(c.cardNo, c.printId)}
                    className="group text-left"
                  >
                    <div className="aspect-[5/7] overflow-hidden rounded border border-white/10">
                      <CardArtwork card={c} className="h-full w-full" />
                    </div>
                    <div className="mt-1 truncate text-[10px] text-slate-200">{c.name}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-red-500/25 bg-[#131822] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-display text-lg font-bold text-red-300">
                  Worst Starting Hand Scenario
                </h4>
                <span className="text-xs font-mono text-red-400">Auto-Mulligan</span>
              </div>
              <p className="text-xs text-slate-300">
                {analysis.playbook.worstStartingHand.explanation}
              </p>
              <div className="grid grid-cols-5 gap-2 pt-1">
                {analysis.playbook.worstStartingHand.cards.map((c, idx) => (
                  <button
                    key={`${c.printId}-${idx}`}
                    type="button"
                    onClick={() => onInspectCard(c.cardNo, c.printId)}
                    className="group text-left"
                  >
                    <div className="aspect-[5/7] overflow-hidden rounded border border-white/10">
                      <CardArtwork card={c} className="h-full w-full" />
                    </div>
                    <div className="mt-1 truncate text-[10px] text-slate-200">{c.name}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Mulligan Rules + Live Test Hand Simulator */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-5 rounded-xl border border-white/[0.08] bg-[#131822] p-5 space-y-4">
              <h4 className="font-display text-lg font-bold text-white">Mulligan Criteria</h4>
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  When to Keep
                </div>
                <ul className="space-y-1.5 text-xs text-slate-200 leading-relaxed">
                  {analysis.playbook.mulliganCriteria.keepRules.map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              </div>
              <div className="space-y-2 border-t border-white/[0.06] pt-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-red-400">
                  When to Mulligan
                </div>
                <ul className="space-y-1.5 text-xs text-slate-200 leading-relaxed">
                  {analysis.playbook.mulliganCriteria.redrawRules.map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="lg:col-span-7 rounded-xl border border-white/[0.08] bg-[#131822] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="font-display text-lg font-bold text-white">
                    Test Hand & Mulligan Simulator
                  </h4>
                  <p className="text-xs text-slate-400">
                    Draws 5 cards from your deck and grades Keep vs. Mulligan in real time.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={drawNewOpeningHand}
                    disabled={deckPool50.length < 5}
                    className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40 whitespace-nowrap"
                  >
                    <Shuffle className="h-3.5 w-3.5" />
                    <span>Draw 5-Card Hand</span>
                  </button>
                  <button
                    type="button"
                    onClick={triggerMulligan}
                    disabled={simulatedHandCards.length === 0 || mulliganUsed}
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-40 whitespace-nowrap"
                  >
                    {mulliganUsed ? 'Mulligan Used' : 'Mulligan (1x)'}
                  </button>
                  <button
                    type="button"
                    onClick={drawNextCard}
                    disabled={simulatedHandCards.length === 0 || simulatedHandCards.length >= deckPool50.length}
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-40 whitespace-nowrap"
                  >
                    +1 Draw
                  </button>
                </div>
              </div>

              {simulatedHandCards.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/10 py-10 text-center text-xs text-slate-400">
                  {deckPool50.length < 5
                    ? 'Add at least 5 cards to your Main Deck to test opening hands.'
                    : 'Click "Draw 5-Card Hand" to test your opening curve and Mulligan verdict.'}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-5 gap-2.5 sm:grid-cols-6">
                    {simulatedHandCards.map((c, idx) => (
                      <button
                        key={`${c.printId}-${idx}`}
                        type="button"
                        onClick={() => onInspectCard(c.cardNo, c.printId)}
                        className="text-left"
                      >
                        <div className="aspect-[5/7] overflow-hidden rounded border border-white/10">
                          <CardArtwork card={c} className="h-full w-full" />
                        </div>
                        <div className="mt-1 truncate text-[10px] text-slate-200">{c.name}</div>
                      </button>
                    ))}
                  </div>
                  {simVerdict && (
                    <div className="rounded-lg border border-white/[0.08] bg-[#0B0E14] p-3.5 text-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white">
                          Hand Verdict:{' '}
                          <span
                            className={
                              simVerdict.status === 'Keep'
                                ? 'text-emerald-400'
                                : simVerdict.status === 'Borderline'
                                ? 'text-amber-300'
                                : 'text-red-400'
                            }
                          >
                            {simVerdict.status}
                          </span>
                        </span>
                        <span className="font-mono tabular-nums text-slate-400">
                          Score {simVerdict.score}/100
                        </span>
                      </div>
                      <ul className="space-y-0.5 text-slate-300">
                        {simVerdict.reasons.map((r, i) => (
                          <li key={i}>• {r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Critical Turns Timeline */}
          <div className="rounded-xl border border-white/[0.08] bg-[#131822] p-5 space-y-4">
            <h4 className="font-display text-lg font-bold text-white">Critical Turns Timeline</h4>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {analysis.playbook.criticalTurns.map((turn) => (
                <div
                  key={turn.turnLabel}
                  className="flex flex-col justify-between rounded-lg border border-white/[0.07] bg-[#0B0E14] p-4 space-y-3"
                >
                  <div>
                    <div className="text-xs font-mono text-blue-300">{turn.levelWindow}</div>
                    <div className="mt-0.5 text-sm font-semibold text-white">{turn.turnLabel}</div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-300">{turn.objective}</p>
                  </div>
                  {turn.keyCards.length > 0 && (
                    <div className="flex gap-2 pt-2 border-t border-white/[0.06]">
                      {turn.keyCards.map((c, idx) => (
                        <button
                          key={`${c.printId}-${idx}`}
                          type="button"
                          onClick={() => onInspectCard(c.cardNo, c.printId)}
                          className="w-14 shrink-0 text-left"
                          title={c.name}
                        >
                          <div className="aspect-[5/7] overflow-hidden rounded border border-white/10">
                            <CardArtwork card={c} className="h-full w-full" />
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Capable Combos Detector */}
          <div className="rounded-xl border border-white/[0.08] bg-[#131822] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-display text-lg font-bold text-white">
                Detected Deck Combos & Synergies ({analysis.playbook.combos.length})
              </h4>
            </div>
            {analysis.playbook.combos.length === 0 ? (
              <p className="text-xs text-slate-400">
                Add matching Pilot + Link Units or trait-synergistic cards to surface capable combos.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {analysis.playbook.combos.map((combo, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 rounded-lg border border-white/[0.07] bg-[#0B0E14] p-3.5"
                  >
                    <div className="flex -space-x-3 shrink-0">
                      {combo.cards.slice(0, 3).map((c, ci) => (
                        <button
                          key={`${c.printId}-${ci}`}
                          type="button"
                          onClick={() => onInspectCard(c.cardNo, c.printId)}
                          className="h-16 w-12 overflow-hidden rounded border border-white/20 shadow-md transition-transform hover:z-10 hover:scale-105"
                        >
                          <CardArtwork card={c} className="h-full w-full" />
                        </button>
                      ))}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-mono text-amber-300">{combo.category}</div>
                      <div className="text-sm font-semibold text-white">{combo.title}</div>
                      <p className="mt-1 text-xs leading-relaxed text-slate-300">
                        {combo.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Import Text Modal */}
      {importOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onClick={() => setImportOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-white/10 bg-[#131822] p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl font-bold text-white">Import Text Decklist</h3>
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Paste lines in <code className="font-mono text-slate-200">4 GD01-001 Gundam</code> or{' '}
              <code className="font-mono text-slate-200">4x ST01-001</code> format.
            </p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={9}
              placeholder={'4 GD01-001 Gundam\n4 GD01-088 Banagher Links\n10 R-001 Resource'}
              className="w-full rounded-lg border border-white/10 bg-[#0B0E14] p-3 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
            />
            {importError && <div className="text-xs text-amber-300">{importError}</div>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="rounded-lg border border-white/10 px-4 py-2 text-xs text-slate-300 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportSubmit}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500"
              >
                Import Cards
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export & Visual Grid Modal */}
      {exportOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onClick={() => setExportOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-white/10 bg-[#131822] p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl font-bold text-white">
                Export & Visual Deck Grid — {activeDeck.name}
              </h3>
              <button
                type="button"
                onClick={() => setExportOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCopyText}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-500"
              >
                {copiedMode === 'text' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedMode === 'text' ? 'Copied Decklist' : 'Copy Text Decklist'}</span>
              </button>
              <button
                type="button"
                onClick={handleCopyShareUrl}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-white/10"
              >
                {copiedMode === 'url' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedMode === 'url' ? 'Share URL Copied' : 'Copy Shareable Deck URL'}</span>
              </button>
            </div>

            <pre className="max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-[#0B0E14] p-3 font-mono text-xs text-slate-200">
              {exportDeckToText(activeDeck, byPrintId, byCardNo)}
            </pre>

            <div>
              <div className="mb-2 text-xs font-medium text-slate-400">Visual Deck Layout</div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
                {activeDeck.mainDeck.map((entry) => {
                  const card = byPrintId.get(entry.printId) ?? byCardNo.get(entry.cardNo);
                  if (!card) return null;
                  return (
                    <div key={card.cardNo} className="relative">
                      <div className="aspect-[5/7] overflow-hidden rounded border border-white/10">
                        <CardArtwork card={card} className="h-full w-full" />
                      </div>
                      <span className="absolute bottom-1 right-1 rounded bg-black/85 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                        ×{entry.qty}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
