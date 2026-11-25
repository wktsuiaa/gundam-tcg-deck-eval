'use client';

import React, { useMemo, useState } from 'react';
import {
  Plus,
  Minus,
  Trash2,
  Copy,
  Check,
  Shuffle,
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Swords,
  BookOpen,
  Layers,
  X,
  ExternalLink,
  Search,
  Sparkles,
  ShieldAlert,
  TrendingUp,
  GitBranch,
} from 'lucide-react';
import type {
  DeckAnalysis,
  DeckGenerationConstraints,
  GundamCardPrint,
  GundamPackage,
  HexagonAxes,
  OpeningHandQuality,
  RulesPayload,
  SavedDeck,
  StrategyBlueprint,
  TacticalStyleTag,
  TurnOrderSetting,
} from '@/types/gundam';
import {
  analyzeDeck,
  buildStarterDeckFromCatalog,
  computeTurnWinChances,
  createBlankCustomDeck,
  DEFAULT_BLUEPRINT,
  DEFAULT_CONSTRAINTS,
  EFFECT_STYLE_META,
  encodeDeckShareParam,
  evaluateConstraintFeasibility,
  evaluateMatchupBetween,
  exportDeckToText,
  generateStrategyDeck,
  getRecommendedCardsForStrategy,
  gradeSimulatedHand,
  META_ARCHETYPES,
  normalizeTraitFocus,
  parseDeckFromText,
  resolveCardMap,
  STARTER_PRESETS,
  TACTICAL_STYLE_META,
} from '@/lib/deck-engine';
import { CARD_COLOR_META } from '@/lib/gundam-keywords';
import { buildDeckChainPreviews, verifyCustomDeckChain } from '@/lib/chain-verifier';
import { CardArtwork } from '@/components/CardArtwork';
import { HexagonRadar } from '@/components/HexagonRadar';
import { RulesModal } from '@/components/RulesModal';
import { StrategyGeneratorPanel } from '@/components/StrategyGeneratorPanel';

interface DeckWorkspaceProps {
  allCards: GundamCardPrint[];
  packages: GundamPackage[];
  rules?: RulesPayload;
  decks: SavedDeck[];
  activeDeckId: string;
  onSelectDeck: (id: string) => void;
  onSaveDeck: (deck: SavedDeck) => void;
  onCreateDeck: (deck: SavedDeck) => void;
  onDeleteDeck: (id: string) => void;
  onInspectCard: (cardNo: string, printId?: string) => void;
}

function normalizeBlueprint(raw?: StrategyBlueprint): StrategyBlueprint {
  if (!raw) return DEFAULT_BLUEPRINT;
  const legacyPrimary = (raw as unknown as { primaryStyle?: TacticalStyleTag }).primaryStyle;
  const rawStyles = Array.isArray(raw.styles) ? raw.styles : [];
  const chosenStyle =
    rawStyles.find((s) => TACTICAL_STYLE_META.some((m) => m.tag === s)) ??
    (legacyPrimary && TACTICAL_STYLE_META.some((m) => m.tag === legacyPrimary)
      ? legacyPrimary
      : undefined) ??
    DEFAULT_BLUEPRINT.styles[0];

  const validEffects = Array.isArray(raw.effectStyles)
    ? raw.effectStyles
        .filter((e) => EFFECT_STYLE_META.some((m) => m.tag === e))
        .slice(0, 2)
    : [];

  return {
    colors: Array.isArray(raw.colors) ? raw.colors : DEFAULT_BLUEPRINT.colors,
    pacing: raw.pacing ?? DEFAULT_BLUEPRINT.pacing,
    styles: [chosenStyle],
    effectStyles: validEffects,
    traitFocus: normalizeTraitFocus(
      (raw as unknown as { traitFocus?: string | string[] }).traitFocus
    ),
    targetHexagon: raw.targetHexagon ?? DEFAULT_BLUEPRINT.targetHexagon,
    constraints: {
      ...DEFAULT_CONSTRAINTS,
      ...(raw.constraints ?? {}),
    },
  };
}

export function DeckWorkspace({
  allCards,
  packages,
  rules,
  decks,
  activeDeckId,
  onSelectDeck,
  onSaveDeck,
  onCreateDeck,
  onDeleteDeck,
  onInspectCard,
}: DeckWorkspaceProps) {
  const [subTab, setSubTab] = useState<'build' | 'analysis' | 'playbook'>('build');
  const [strategyOpen, setStrategyOpen] = useState(true);
  const [leftPoolTab, setLeftPoolTab] = useState<'search' | 'suggested'>('search');
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerType, setPickerType] = useState<string>('ALL');
  const [pickerColorOnly, setPickerColorOnly] = useState(false);

  // Rules modal
  const [rulesOpen, setRulesOpen] = useState(false);

  // Import / Export Modals
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<'strict' | 'exburst'>('strict');
  const [importText, setImportText] = useState('');
  const [exburstUrl, setExburstUrl] = useState('');
  const [exburstLoading, setExburstLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [copiedMode, setCopiedMode] = useState<'text' | 'url' | 'exburst' | null>(null);

  // Head-to-head comparison selection
  const [compareTargetId, setCompareTargetId] = useState<string>('arch:0');
  const [selectedAxis, setSelectedAxis] = useState<keyof HexagonAxes | null>(null);

  // Playbook Win Chance Settings
  const [winTurnOrder, setWinTurnOrder] = useState<TurnOrderSetting>('first');
  const [winOpponentIdx, setWinOpponentIdx] = useState<number>(0);
  const [winHandQuality, setWinHandQuality] = useState<OpeningHandQuality>('average');

  // Test Hand Simulator State
  const [simHandIndices, setSimHandIndices] = useState<number[]>([]);
  const [simDeckOrder, setSimDeckOrder] = useState<GundamCardPrint[]>([]);
  const [mulliganUsed, setMulliganUsed] = useState(false);

  // Chain Preview State
  const [chainGoingSecond, setChainGoingSecond] = useState(false);
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null);
  const [customChainCardA, setCustomChainCardA] = useState<string>('');
  const [customChainCardB, setCustomChainCardB] = useState<string>('');

  const { byPrintId, byCardNo } = useMemo(() => resolveCardMap(allCards), [allCards]);
  const activeDeck = decks.find((d) => d.id === activeDeckId) ?? decks[0];

  const analysis: DeckAnalysis | null = useMemo(() => {
    if (!activeDeck) return null;
    return analyzeDeck(activeDeck, byPrintId, byCardNo);
  }, [activeDeck, byPrintId, byCardNo]);

  const deckUniqueCards = useMemo(() => {
    if (!activeDeck) return [];
    const seen = new Set<string>();
    const out: GundamCardPrint[] = [];
    for (const e of activeDeck.mainDeck) {
      const c = byPrintId.get(e.printId) ?? byCardNo.get(e.cardNo);
      if (c && !seen.has(c.cardNo)) {
        seen.add(c.cardNo);
        out.push(c);
      }
    }
    return out;
  }, [activeDeck, byPrintId, byCardNo]);

  const deckChainPreviews = useMemo(() => {
    return buildDeckChainPreviews(deckUniqueCards, 6);
  }, [deckUniqueCards]);

  const customChainResult = useMemo(() => {
    if (!customChainCardA) return null;
    const cardA = deckUniqueCards.find((c) => c.cardNo === customChainCardA);
    if (!cardA) return null;
    const cardB = customChainCardB ? deckUniqueCards.find((c) => c.cardNo === customChainCardB) ?? null : null;
    return {
      cardA,
      cardB,
      ...verifyCustomDeckChain(cardA, cardB, chainGoingSecond),
    };
  }, [customChainCardA, customChainCardB, deckUniqueCards, chainGoingSecond]);

  const blueprint = useMemo(
    () => normalizeBlueprint(activeDeck?.strategyBlueprint),
    [activeDeck?.strategyBlueprint]
  );

  const updateBlueprint = (patch: Partial<StrategyBlueprint>) => {
    if (!activeDeck) return;
    onSaveDeck({
      ...activeDeck,
      updatedAt: new Date().toISOString(),
      strategyBlueprint: { ...blueprint, ...patch },
    });
  };

  const updateConstraints = (patch: Partial<DeckGenerationConstraints>) => {
    updateBlueprint({
      constraints: {
        ...blueprint.constraints,
        ...patch,
      },
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

  // Popular traits for Trait Focus dropdown (Series is explicitly NOT included per Q9)
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
          const hay =
            `${c.cardNo} ${c.name} ${c.effect} ${c.traits.join(' ')} ${c.link}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .slice(0, 80);
  }, [uniqueBaseCards, pickerSearch, pickerType, pickerColorOnly, analysis]);

  const feasibility = useMemo(
    () => evaluateConstraintFeasibility(allCards, blueprint),
    [allCards, blueprint]
  );

  const strategyRecommendations = useMemo(() => {
    if (!activeDeck) return [];
    return getRecommendedCardsForStrategy(allCards, blueprint, activeDeck.mainDeck, 24);
  }, [allCards, blueprint, activeDeck]);

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
    if (!activeDeck || !feasibility.feasible) return;
    const generated = generateStrategyDeck(allCards, blueprint);
    if (generated.mainDeck.length === 0) return;

    const styleLabel = blueprint.styles[0] ?? 'Custom';
    const colorLabel = generated.resolvedColors.join('/') || 'Custom';

    onSaveDeck({
      ...activeDeck,
      name:
        activeDeck.name.startsWith('Custom Deck')
          ? `${colorLabel} ${styleLabel}`
          : activeDeck.name,
      updatedAt: new Date().toISOString(),
      mainDeck: generated.mainDeck,
      resourceDeck: generated.resourceDeck,
      strategyBlueprint: {
        ...blueprint,
        colors:
          blueprint.colors.length === 0 ? generated.resolvedColors : blueprint.colors,
      },
    });
    setLeftPoolTab('suggested');
    setStrategyOpen(false);
  };

  const handleCreateNewBlank = () => {
    const newDeck = createBlankCustomDeck(decks.length + 1);
    onCreateDeck(newDeck);
    setSubTab('build');
    setStrategyOpen(true);
  };

  const handleCloneStarter = (code: string) => {
    const starter = buildStarterDeckFromCatalog(code, allCards);
    onCreateDeck(starter);
    setSubTab('build');
  };

  const handleStrictImportSubmit = () => {
    if (!activeDeck) return;
    const parsed = parseDeckFromText(importText, byPrintId, byCardNo);
    if (parsed.mainDeck.length === 0 && parsed.resourceDeck.length === 0) {
      setImportError(
        'Strict format required: "<number> <cardNo>" only (e.g. "4 GD01-001"). Comments, "4x", or trailing card names are rejected.'
      );
      return;
    }
    onSaveDeck({
      ...activeDeck,
      updatedAt: new Date().toISOString(),
      mainDeck: parsed.mainDeck,
      resourceDeck:
        parsed.resourceDeck.length > 0 ? parsed.resourceDeck : activeDeck.resourceDeck,
    });
    if (parsed.unmatched.length > 0) {
      setImportError(
        `Imported valid lines, but rejected ${parsed.unmatched.length} non-strict or unknown line(s): ${parsed.unmatched
          .slice(0, 3)
          .join(' | ')}`
      );
    } else {
      setImportError(null);
      setImportOpen(false);
      setImportText('');
    }
  };

  const handleExBurstImportSubmit = async () => {
    if (!activeDeck || !exburstUrl.trim()) return;
    setExburstLoading(true);
    setImportError(null);
    try {
      const res = await fetch('/api/exburst/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: exburstUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error || 'Failed to fetch ExBurst deck.');
        return;
      }
      const parsed = parseDeckFromText(data.strictText || '', byPrintId, byCardNo);
      if (parsed.mainDeck.length === 0 && parsed.resourceDeck.length === 0) {
        setImportError(
          'ExBurst deck resolved zero matching cards. Copy the strict list from ExBurst and paste in Strict Text mode.'
        );
        return;
      }
      onSaveDeck({
        ...activeDeck,
        name: data.deckTitle ? String(data.deckTitle).slice(0, 48) : activeDeck.name,
        updatedAt: new Date().toISOString(),
        mainDeck: parsed.mainDeck,
        resourceDeck:
          parsed.resourceDeck.length > 0 ? parsed.resourceDeck : activeDeck.resourceDeck,
      });
      setImportOpen(false);
      setExburstUrl('');
    } catch {
      setImportError('Network error fetching ExBurst deck. Try pasting the strict decklist directly.');
    } finally {
      setExburstLoading(false);
    }
  };

  const handleCopyText = async () => {
    if (!activeDeck) return;
    const txt = exportDeckToText(activeDeck, byPrintId, byCardNo);
    await navigator.clipboard.writeText(txt);
    setCopiedMode('text');
    setTimeout(() => setCopiedMode(null), 1800);
  };

  const handleCopyForExBurst = async () => {
    if (!activeDeck) return;
    const txt = exportDeckToText(activeDeck, byPrintId, byCardNo);
    await navigator.clipboard.writeText(txt);
    setCopiedMode('exburst');
    setTimeout(() => setCopiedMode(null), 2400);
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

  const turnWinChances = useMemo(() => {
    if (!analysis) return [];
    const opp = META_ARCHETYPES[winOpponentIdx] ?? META_ARCHETYPES[0];
    return computeTurnWinChances(analysis, deckPool50, winTurnOrder, opp, winHandQuality);
  }, [analysis, deckPool50, winTurnOrder, winOpponentIdx, winHandQuality]);

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
          Start with an empty Custom Deck or clone an official Starter Preset.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={handleCreateNewBlank}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500"
          >
            Create Custom Deck
          </button>
          {STARTER_PRESETS.map((st) => (
            <button
              key={st.code}
              type="button"
              onClick={() => handleCloneStarter(st.code)}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-slate-200 hover:bg-white/10"
            >
              Load {st.name}
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
            <span>New Custom Deck</span>
          </button>

          <select
            value=""
            onChange={(e) => {
              if (e.target.value) handleCloneStarter(e.target.value);
            }}
            aria-label="Load starter deck preset"
            className="rounded-lg border border-white/10 bg-[#0B0E14] px-2.5 py-2 text-xs text-slate-300"
          >
            <option value="">Starter Presets...</option>
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
            onClick={() => {
              setImportError(null);
              setImportOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 whitespace-nowrap"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>Import / ExBurst</span>
          </button>
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 whitespace-nowrap"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Export / ExBurst</span>
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

      {/* Legal Status & 3 Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-3">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-[#131822] p-1">
          {[
            { id: 'build', label: 'Build & Cards', icon: Layers },
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
          {rules && (
            <button
              type="button"
              onClick={() => setRulesOpen(true)}
              className="flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 font-sans text-[11px] font-medium text-blue-300 hover:bg-white/[0.08] whitespace-nowrap"
            >
              <BookOpen className="h-3 w-3" />
              <span>Official Rules</span>
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: CONSOLIDATED BUILD & CARDS (STRATEGY GENERATOR + SEARCH/SUGGESTIONS + VISUAL DECKLIST) */}
      {subTab === 'build' && (
        <div className="space-y-5">
          <StrategyGeneratorPanel
            open={strategyOpen}
            onToggleOpen={() => setStrategyOpen((v) => !v)}
            blueprint={blueprint}
            packages={packages}
            topTraits={topTraits}
            feasibility={feasibility}
            onUpdateBlueprint={updateBlueprint}
            onUpdateConstraints={updateConstraints}
            onGenerate={handleGenerateFromStrategy}
          />

          {/* Two-Column Build Area: Left (Search / Suggested Cards) | Right (Visual Decklist) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left Pool Panel */}
            <div className="lg:col-span-7 space-y-3 rounded-xl border border-white/[0.08] bg-[#131822] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
                <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#0B0E14] p-0.5">
                  <button
                    type="button"
                    onClick={() => setLeftPoolTab('search')}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      leftPoolTab === 'search'
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    <Search className="h-3.5 w-3.5" />
                    <span>Card Search</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLeftPoolTab('suggested')}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      leftPoolTab === 'suggested'
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Suggested Cards ({strategyRecommendations.length})</span>
                  </button>
                </div>

                {leftPoolTab === 'search' && (
                  <span className="text-[11px] font-mono text-slate-400">
                    {pickerCards.length} shown
                  </span>
                )}
              </div>

              {leftPoolTab === 'search' ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={pickerSearch}
                      onChange={(e) => setPickerSearch(e.target.value)}
                      placeholder="Search card name, number, trait, link, or effect..."
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
                            <span>
                              Lv{card.lv ?? '-'}·C{card.cost ?? '-'}
                            </span>
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
                </>
              ) : (
                <div className="max-h-[72vh] space-y-2.5 overflow-y-auto pr-1">
                  {strategyRecommendations.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-400">
                      No eligible cards match your active Strategy &amp; Constraints filters.
                    </div>
                  ) : (
                    strategyRecommendations.map((rec) => {
                      const inDeck = mainQtyByNo.get(rec.card.cardNo) ?? 0;
                      const maxCopy = blueprint.constraints.maxCopiesPerCard;
                      return (
                        <div
                          key={rec.card.printId}
                          className="flex items-center gap-3 rounded-lg border border-white/[0.07] bg-[#0B0E14] p-2.5"
                        >
                          <button
                            type="button"
                            onClick={() => onInspectCard(rec.card.cardNo, rec.card.printId)}
                            className="h-20 w-14 shrink-0 overflow-hidden rounded border border-white/10"
                          >
                            <CardArtwork card={rec.card} className="h-full w-full" />
                          </button>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="truncate text-xs font-semibold text-white">
                                {rec.card.name}
                              </span>
                              <span className="font-mono text-[11px] text-amber-300 tabular-nums shrink-0">
                                {rec.fitScore}% fit · Coherence {rec.coherenceScore}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-400">
                              <span>{rec.card.cardNo}</span>
                              <span>·</span>
                              <span>{rec.card.type}</span>
                              <span>·</span>
                              <span>
                                Lv{rec.card.lv ?? '-'}/C{rec.card.cost ?? '-'}
                              </span>
                              <span>·</span>
                              <span className="font-sans text-blue-300">
                                Axis: {rec.primaryAxisLabel}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-300 leading-snug">
                              {rec.reason}
                            </div>
                            {rec.matchedEffectStyles.length > 0 && (
                              <div className="text-[10px] font-mono text-emerald-300">
                                Effects: {rec.matchedEffectStyles.join(' · ')}
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => adjustDeckCard(rec.card, 1)}
                            disabled={inDeck >= maxCopy}
                            className="shrink-0 rounded-md bg-blue-600/85 px-2.5 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-35 whitespace-nowrap"
                          >
                            {inDeck > 0 ? `+1 (${inDeck})` : '+1'}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Right: Persistent Visual Decklist (Card Picture + Card No + Qty) */}
            <div className="lg:col-span-5 space-y-4 rounded-xl border border-white/[0.08] bg-[#131822] p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-bold text-white">Visual Decklist</h3>
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

              <div className="max-h-[64vh] space-y-4 overflow-y-auto pr-1">
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
                              className="flex items-center justify-between gap-2.5 rounded-md border border-white/[0.06] bg-[#0B0E14] p-1.5 text-xs"
                            >
                              <button
                                type="button"
                                onClick={() => onInspectCard(card.cardNo, card.printId)}
                                className="flex min-w-0 flex-1 items-center gap-2.5 text-left hover:text-blue-300"
                              >
                                <div className="h-12 w-9 shrink-0 overflow-hidden rounded border border-white/10">
                                  <CardArtwork card={card} className="h-full w-full" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate font-medium text-slate-100">
                                    {card.name}
                                  </div>
                                  <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400 tabular-nums">
                                    <span
                                      className="h-2 w-2 shrink-0 rounded-xs"
                                      style={{ backgroundColor: cMeta.hex }}
                                    />
                                    <span>{card.cardNo}</span>
                                    <span>·</span>
                                    <span>
                                      Lv{card.lv ?? '-'} C{card.cost ?? '-'}
                                    </span>
                                  </div>
                                </div>
                              </button>
                              <div className="flex items-center gap-1 shrink-0 font-mono tabular-nums">
                                <button
                                  type="button"
                                  onClick={() => adjustDeckCard(card, -1)}
                                  className="flex h-6 w-6 items-center justify-center rounded border border-white/10 text-slate-300 hover:bg-white/10"
                                  aria-label={`Remove 1 ${card.name}`}
                                >
                                  <Minus className="h-3 w-3" />
                                </button>
                                <span className="w-6 text-center font-semibold text-white">
                                  ×{entry.qty}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => adjustDeckCard(card, 1)}
                                  disabled={entry.qty >= 4}
                                  className="flex h-6 w-6 items-center justify-center rounded border border-white/10 text-slate-300 hover:bg-white/10 disabled:opacity-30"
                                  aria-label={`Add 1 ${card.name}`}
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
                          className="flex items-center justify-between gap-2.5 rounded-md border border-white/[0.06] bg-[#0B0E14] p-1.5 text-xs"
                        >
                          <button
                            type="button"
                            onClick={() => onInspectCard(card.cardNo, card.printId)}
                            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                          >
                            <div className="h-12 w-9 shrink-0 overflow-hidden rounded border border-white/10">
                              <CardArtwork card={card} className="h-full w-full" />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-slate-200">{card.name}</div>
                              <div className="font-mono text-[10px] text-slate-400">
                                {card.cardNo}
                              </div>
                            </div>
                          </button>
                          <div className="flex items-center gap-1 font-mono tabular-nums">
                            <button
                              type="button"
                              onClick={() => adjustDeckCard(card, -1)}
                              className="flex h-6 w-6 items-center justify-center rounded border border-white/10 text-slate-300 hover:bg-white/10"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="w-7 text-center font-semibold text-white">
                              ×{entry.qty}
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

          {/* Rules-Accurate Chain Preview Section */}
          <div className="rounded-xl border border-white/[0.08] bg-[#131822] p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-blue-400" />
                <div>
                  <h3 className="font-display text-base font-bold text-white">
                    Chain Preview (Rules Verifier)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Simulates Lv., Cost, EX Resource, [Link] timing, and triggered resolution lines from this deck.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#0B0E14] p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setChainGoingSecond(false)}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    !chainGoingSecond ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Going 1st
                </button>
                <button
                  type="button"
                  onClick={() => setChainGoingSecond(true)}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    chainGoingSecond ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Going 2nd (+1 EX)
                </button>
              </div>
            </div>

            {deckChainPreviews.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 py-5 text-center text-xs text-slate-400">
                Add Units with matching Pilots, Command-Pilots, or Enabler/Payoff cards to preview verified chains.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <div className="lg:col-span-5 space-y-2">
                  {deckChainPreviews.map((chain, idx) => {
                    const res = chainGoingSecond ? chain.secondPlayerResult : chain.firstPlayerResult;
                    const active = (selectedChainId ?? deckChainPreviews[0].id) === chain.id;
                    return (
                      <button
                        key={chain.id}
                        type="button"
                        onClick={() => setSelectedChainId(chain.id)}
                        className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
                          active
                            ? 'border-blue-500/60 bg-blue-500/10'
                            : 'border-white/[0.07] bg-[#0B0E14] hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold text-white">
                            {idx + 1}. {chain.title}
                          </span>
                          <span
                            className={`shrink-0 font-mono text-[10px] font-semibold ${
                              res.legal ? 'text-emerald-400' : 'text-amber-300'
                            }`}
                          >
                            {res.legal ? `Turn ${chain.minTurn} Legal` : res.reason}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[10px] font-mono text-slate-400">
                          <span>{chain.category}</span>
                          <span>{chain.cards.map((c) => c.cardNo).join(' + ')}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="lg:col-span-7 space-y-3 rounded-lg border border-white/[0.07] bg-[#0B0E14] p-3.5">
                  {(() => {
                    const chosen =
                      deckChainPreviews.find((c) => c.id === selectedChainId) ?? deckChainPreviews[0];
                    const res = chainGoingSecond ? chosen.secondPlayerResult : chosen.firstPlayerResult;
                    return (
                      <div className="space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-white">{chosen.title}</span>
                          <span className="font-mono text-[11px] text-slate-300">
                            Earliest Full Line: Turn {chosen.minTurn}
                            {chainGoingSecond ? ' (uses EX Resource)' : ''}
                          </span>
                        </div>
                        {!res.legal && (
                          <div className="rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-200">
                            {res.reason}: {res.detail}
                          </div>
                        )}
                        <div className="space-y-1.5 text-[11px]">
                          {res.trace.map((step, i) => (
                            <div
                              key={i}
                              className="flex items-start gap-2 rounded border border-white/[0.05] bg-[#131822] px-2.5 py-1.5 text-slate-200"
                            >
                              <span className="shrink-0 font-mono text-[10px] font-semibold text-blue-300">
                                {step.kind}
                              </span>
                              <span>{step.detail}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Custom 2-Card Line Verifier */}
            {deckUniqueCards.length > 0 && (
              <div className="border-t border-white/[0.06] pt-3 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-slate-300">Test Custom 2-Card Line:</span>
                  <select
                    value={customChainCardA}
                    onChange={(e) => setCustomChainCardA(e.target.value)}
                    aria-label="Custom chain first card"
                    className="rounded-lg border border-white/10 bg-[#0B0E14] px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="">Select Card 1...</option>
                    {deckUniqueCards.map((c) => (
                      <option key={c.cardNo} value={c.cardNo}>
                        {c.cardNo} · {c.name} ({c.type})
                      </option>
                    ))}
                  </select>
                  <span className="text-slate-500">→</span>
                  <select
                    value={customChainCardB}
                    onChange={(e) => setCustomChainCardB(e.target.value)}
                    aria-label="Custom chain second card"
                    className="rounded-lg border border-white/10 bg-[#0B0E14] px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="">None (1-Card Play)</option>
                    {deckUniqueCards.map((c) => (
                      <option key={c.cardNo} value={c.cardNo}>
                        {c.cardNo} · {c.name} ({c.type})
                      </option>
                    ))}
                  </select>
                </div>

                {customChainResult && (
                  <div className="rounded-lg border border-white/[0.06] bg-[#0B0E14] p-3 space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-white">
                        {customChainResult.cardA.name}
                        {customChainResult.cardB ? ` + ${customChainResult.cardB.name}` : ''} (Turn {customChainResult.turn})
                      </span>
                      <span
                        className={`font-mono font-semibold ${
                          customChainResult.result.legal ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {customChainResult.result.legal
                          ? 'Verified Legal'
                          : customChainResult.result.reason}
                      </span>
                    </div>
                    {!customChainResult.result.legal && (
                      <div className="text-red-200">{customChainResult.result.detail}</div>
                    )}
                    {customChainResult.result.trace.map((step, i) => (
                      <div key={i} className="flex items-start gap-2 text-slate-300">
                        <span className="shrink-0 font-mono text-[10px] text-blue-300">{step.kind}</span>
                        <span>{step.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: HEXAGON & MATCHUPS */}
      {subTab === 'analysis' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
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
                      {h2hComparison.assessment.verdict} (Diff{' '}
                      {h2hComparison.assessment.difficultyScore}/5)
                    </span>
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    {h2hComparison.assessment.keyTip}
                  </p>
                </div>
              )}
            </div>

            <div className="lg:col-span-7 space-y-5">
              <div className="rounded-xl border border-white/[0.08] bg-[#131822] p-5 space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-4">
                  <div>
                    <div className="text-xs text-slate-400">Deck Pacing &amp; Tactical Style</div>
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
                      <div className="h-full bg-blue-500" style={{ width: `${ax.score}%` }} />
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
              <h4 className="font-display text-base font-bold text-white">
                Level Curve &amp; Type Split
              </h4>
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

      {/* TAB 3: PLAYBOOK, TURN WIN CHANCES, BEST/WORST TURN ACTIONS & MULLIGAN */}
      {subTab === 'playbook' && (
        <div className="space-y-6">
          {/* Primary Objective + Odds */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-8 rounded-xl border border-white/[0.08] bg-[#131822] p-5 space-y-3">
              <h3 className="font-display text-xl font-bold text-white">
                Primary Win Objective &amp; Largest-Advantage Engine
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

          {/* Turn-by-Turn Winning Chance % Estimator (Configurable Settings) */}
          <div className="rounded-xl border border-white/[0.08] bg-[#131822] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-blue-400" />
                <div>
                  <h4 className="font-display text-lg font-bold text-white">
                    Turn-by-Turn Winning Chance % by Setting
                  </h4>
                  <p className="text-xs text-slate-400">
                    Adjust Turn Order, Opponent Archetype, and Opening Hand State to inspect win-rate trajectory from Turn 1 to Turn 6+.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select
                  value={winTurnOrder}
                  onChange={(e) => setWinTurnOrder(e.target.value as TurnOrderSetting)}
                  aria-label="Turn order setting"
                  className="rounded-lg border border-white/10 bg-[#0B0E14] px-2.5 py-1.5 text-slate-200"
                >
                  <option value="first">Going 1st</option>
                  <option value="second">Going 2nd (+1 EX Res)</option>
                </select>

                <select
                  value={winOpponentIdx}
                  onChange={(e) => setWinOpponentIdx(Number(e.target.value))}
                  aria-label="Opponent matchup setting"
                  className="rounded-lg border border-white/10 bg-[#0B0E14] px-2.5 py-1.5 text-slate-200"
                >
                  {META_ARCHETYPES.map((arch, idx) => (
                    <option key={arch.name} value={idx}>
                      vs {arch.name}
                    </option>
                  ))}
                </select>

                <select
                  value={winHandQuality}
                  onChange={(e) => setWinHandQuality(e.target.value as OpeningHandQuality)}
                  aria-label="Opening hand quality setting"
                  className="rounded-lg border border-white/10 bg-[#0B0E14] px-2.5 py-1.5 text-slate-200"
                >
                  <option value="optimal">Optimal Opener</option>
                  <option value="average">Average Opener</option>
                  <option value="mulliganed">Post-Mulligan</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {turnWinChances.map((pt) => {
                const colorClass =
                  pt.winChancePct >= 56
                    ? 'text-emerald-400 border-emerald-500/30'
                    : pt.winChancePct <= 44
                    ? 'text-red-400 border-red-500/30'
                    : 'text-amber-300 border-amber-500/30';
                const barBg =
                  pt.winChancePct >= 56
                    ? 'bg-emerald-500'
                    : pt.winChancePct <= 44
                    ? 'bg-red-500'
                    : 'bg-amber-400';

                return (
                  <div
                    key={pt.turnNumber}
                    className={`rounded-lg border bg-[#0B0E14] p-3 space-y-2 ${colorClass}`}
                  >
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="text-slate-300 font-semibold">{pt.turnLabel}</span>
                      <span className="text-sm font-bold tabular-nums">{pt.winChancePct}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                      <div className={`h-full ${barBg}`} style={{ width: `${pt.winChancePct}%` }} />
                    </div>
                    <div className="space-y-0.5 text-[10px] font-mono text-slate-400 tabular-nums">
                      <div>Curve Hit: {pt.curveHitPct}%</div>
                      <div>Link Ready: {pt.linkReadyPct}%</div>
                      <div>
                        Tempo: {pt.tempoDelta >= 0 ? `+${pt.tempoDelta}` : pt.tempoDelta}
                      </div>
                    </div>
                    <p className="text-[11px] leading-snug text-slate-300 font-sans">{pt.note}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Turn 1-6+ Best Action & Worst Action Insights */}
          <div className="rounded-xl border border-white/[0.08] bg-[#131822] p-5 space-y-4">
            <div>
              <h4 className="font-display text-lg font-bold text-white">
                Turn 1–6+ Best Action &amp; Worst Action Guide
              </h4>
              <p className="text-xs text-slate-400">
                Optimal tactical sequencing and common misplays to avoid on every resource turn.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {analysis.playbook.turnInsights.map((turn) => (
                <div
                  key={turn.turnNumber}
                  className="flex flex-col justify-between rounded-lg border border-white/[0.07] bg-[#0B0E14] p-4 space-y-3"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
                      <span className="font-display text-sm font-bold text-white">
                        {turn.turnLabel}
                      </span>
                      <span className="text-[11px] font-mono text-blue-300">
                        {turn.levelWindow}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Best Action</span>
                      </div>
                      <p className="text-xs leading-relaxed text-slate-200">{turn.bestAction}</p>
                    </div>

                    <div className="space-y-1 border-t border-white/[0.05] pt-2">
                      <div className="flex items-center gap-1 text-[11px] font-semibold text-red-400">
                        <ShieldAlert className="h-3.5 w-3.5" />
                        <span>Worst Action (Avoid)</span>
                      </div>
                      <p className="text-xs leading-relaxed text-slate-400">{turn.worstAction}</p>
                    </div>
                  </div>

                  {turn.bestCards.length > 0 && (
                    <div className="space-y-1 border-t border-white/[0.06] pt-2.5">
                      <div className="text-[10px] font-mono text-slate-400">Key Turn Plays</div>
                      <div className="flex gap-2">
                        {turn.bestCards.map((c, idx) => (
                          <button
                            key={`${c.printId}-${idx}`}
                            type="button"
                            onClick={() => onInspectCard(c.cardNo, c.printId)}
                            className="w-12 shrink-0 text-left"
                            title={c.name}
                          >
                            <div className="aspect-[5/7] overflow-hidden rounded border border-white/10">
                              <CardArtwork card={c} className="h-full w-full" />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Best vs Worst Starting Hand */}
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
                    Test Hand &amp; Mulligan Simulator
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
                    disabled={
                      simulatedHandCards.length === 0 ||
                      simulatedHandCards.length >= deckPool50.length
                    }
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

          {/* Detected Combos */}
          <div className="rounded-xl border border-white/[0.08] bg-[#131822] p-5 space-y-4">
            <h4 className="font-display text-lg font-bold text-white">
              Detected Deck Combos &amp; Synergies ({analysis.playbook.combos.length})
            </h4>
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

      {/* Import Modal (Strict <qty> <cardNo> OR ExBurst URL) */}
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
              <h3 className="font-display text-xl font-bold text-white">
                Import Decklist
              </h3>
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#0B0E14] p-1">
              <button
                type="button"
                onClick={() => {
                  setImportMode('strict');
                  setImportError(null);
                }}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                  importMode === 'strict'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Strict &lt;qty&gt; &lt;cardNo&gt; Text
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportMode('exburst');
                  setImportError(null);
                }}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                  importMode === 'exburst'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                ExBurst Deck URL
              </button>
            </div>

            {importMode === 'strict' ? (
              <>
                <p className="text-xs text-slate-400">
                  Strict format only: each line must be{' '}
                  <code className="font-mono text-slate-200">&lt;number&gt; &lt;cardNo&gt;</code>{' '}
                  (e.g. <code className="font-mono text-slate-200">4 GD01-001</code>). No card names,{' '}
                  <code>4x</code>, or comments.
                </p>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={9}
                  placeholder={'4 GD01-001\n4 GD01-088\n10 R-001'}
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
                    onClick={handleStrictImportSubmit}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500"
                  >
                    Import Strict List
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-slate-400">
                  Paste a public{' '}
                  <code className="font-mono text-slate-200">https://exburst.dev/gundam/deck/...</code>{' '}
                  URL to fetch and convert its decklist directly into your active deck.
                </p>
                <input
                  type="url"
                  value={exburstUrl}
                  onChange={(e) => setExburstUrl(e.target.value)}
                  placeholder="https://exburst.dev/gundam/deck/12345"
                  className="w-full rounded-lg border border-white/10 bg-[#0B0E14] px-3 py-2.5 font-mono text-xs text-white focus:border-blue-500 focus:outline-none"
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
                    onClick={handleExBurstImportSubmit}
                    disabled={exburstLoading || !exburstUrl.trim()}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    {exburstLoading ? 'Importing from ExBurst...' : 'Fetch ExBurst Deck'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Export Modal (Strict Format + ExBurst Integration) */}
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
                Strict Export &amp; ExBurst — {activeDeck.name}
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
                {copiedMode === 'text' ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>
                  {copiedMode === 'text' ? 'Copied Strict List' : 'Copy Strict <qty> <cardNo>'}
                </span>
              </button>

              <a
                href="https://exburst.dev/gundam/deckbuilder"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  void handleCopyForExBurst();
                }}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25"
              >
                {copiedMode === 'exburst' ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5" />
                )}
                <span>
                  {copiedMode === 'exburst'
                    ? 'Copied! Opening ExBurst...'
                    : 'Copy Strict List & Open ExBurst'}
                </span>
              </a>

              <button
                type="button"
                onClick={handleCopyShareUrl}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-white/10"
              >
                {copiedMode === 'url' ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span>{copiedMode === 'url' ? 'Share URL Copied' : 'Copy Shareable URL'}</span>
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

      {/* Official Rules Modal */}
      {rulesOpen && rules && (
        <RulesModal rules={rules} onClose={() => setRulesOpen(false)} />
      )}
    </div>
  );
}
