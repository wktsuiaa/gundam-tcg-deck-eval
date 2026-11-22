'use client';

import React, { useMemo, useState } from 'react';
import {
  Play,
  RotateCcw,
  FastForward,
  Swords,
  Shield,
  Sparkles,
  ArrowRight,
  Cpu,
  Eye,
  EyeOff,
  Trophy,
} from 'lucide-react';
import type {
  GundamCardPrint,
  SandboxMatchState,
  SandboxMoveSuggestion,
  SandboxSide,
  SavedDeck,
} from '@/types/gundam';
import {
  buildStarterDeckFromCatalog,
  resolveCardMap,
  STARTER_PRESETS,
} from '@/lib/deck-engine';
import {
  applySandboxMove,
  canPayCard,
  canUnitAttack,
  createInitialSandboxMatch,
  evaluateSandboxBestMoves,
  stepSandboxBot,
} from '@/lib/sandbox-engine';
import { CardArtwork } from '@/components/CardArtwork';

interface MatchSandboxProps {
  allCards: GundamCardPrint[];
  savedDecks: SavedDeck[];
  onInspectCard: (cardNo: string, printId?: string) => void;
}

export function MatchSandbox({
  allCards,
  savedDecks,
  onInspectCard,
}: MatchSandboxProps) {
  const { byPrintId, byCardNo } = useMemo(() => resolveCardMap(allCards), [allCards]);

  // Build selectable deck pool: Saved non-empty decks + Official Starter Presets
  const selectableDecks = useMemo(() => {
    const validSaved = savedDecks.filter((d) => d.mainDeck.length >= 10);
    const starters = STARTER_PRESETS.map((st) => ({
      ...buildStarterDeckFromCatalog(st.code, allCards),
      id: `preset:${st.code}`,
    }));
    return [...validSaved, ...starters];
  }, [savedDecks, allCards]);

  const [deckAId, setDeckAId] = useState<string>(
    () => selectableDecks[0]?.id ?? 'preset:ST01'
  );
  const [deckBId, setDeckBId] = useState<string>(
    () => selectableDecks[1]?.id ?? selectableDecks[0]?.id ?? 'preset:ST03'
  );
  const [firstSide, setFirstSide] = useState<SandboxSide>('A');
  const [match, setMatch] = useState<SandboxMatchState | null>(() => {
    const dA = selectableDecks[0];
    const dB = selectableDecks[1] ?? selectableDecks[0];
    if (!dA || !dB) return null;
    return createInitialSandboxMatch(dA, dB, 'A', byPrintId, byCardNo);
  });

  const [revealHandB, setRevealHandB] = useState(true);
  const [selectedPilotCard, setSelectedPilotCard] = useState<GundamCardPrint | null>(null);
  const [selectedAttackerId, setSelectedAttackerId] = useState<string | null>(null);

  const deckA = selectableDecks.find((d) => d.id === deckAId) ?? selectableDecks[0];
  const deckB = selectableDecks.find((d) => d.id === deckBId) ?? selectableDecks[1] ?? selectableDecks[0];

  const handleStartMatch = () => {
    if (!deckA || !deckB) return;
    setSelectedPilotCard(null);
    setSelectedAttackerId(null);
    setMatch(createInitialSandboxMatch(deckA, deckB, firstSide, byPrintId, byCardNo));
  };

  const bestMoves = useMemo(() => {
    if (!match || match.winner) return [];
    return evaluateSandboxBestMoves(match, match.activeSide);
  }, [match]);

  const executeMove = (move: SandboxMoveSuggestion) => {
    if (!match) return;
    setSelectedPilotCard(null);
    setSelectedAttackerId(null);
    setMatch(applySandboxMove(match, move));
  };

  const handleAutoStepMove = () => {
    if (!match || match.winner) return;
    setSelectedPilotCard(null);
    setSelectedAttackerId(null);
    setMatch(stepSandboxBot(match));
  };

  const handleAutoPlayTurn = () => {
    if (!match || match.winner) return;
    let current = match;
    const startSide = current.activeSide;
    let guard = 0;
    while (!current.winner && current.activeSide === startSide && guard < 12) {
      current = stepSandboxBot(current);
      guard += 1;
    }
    setSelectedPilotCard(null);
    setSelectedAttackerId(null);
    setMatch(current);
  };

  const handleManualCardClick = (side: SandboxSide, card: GundamCardPrint) => {
    if (!match || match.winner || match.activeSide !== side) return;
    const player = match.players[side];
    if (!canPayCard(player, card)) return;

    if (card.type === 'PILOT') {
      if (player.battleArea.some((u) => !u.pairedPilot)) {
        setSelectedPilotCard((prev) => (prev?.printId === card.printId ? null : card));
      }
      return;
    }

    const actionType =
      card.type === 'UNIT'
        ? 'DEPLOY_UNIT'
        : card.type === 'BASE'
        ? 'DEPLOY_BASE'
        : card.type === 'COMMAND'
        ? 'PLAY_COMMAND'
        : null;

    if (!actionType) return;
    executeMove({
      id: `manual-${card.printId}-${match.turn}-${match.log.length}`,
      rank: 1,
      actionType,
      title: `Play ${card.name}`,
      reason: 'Manual play',
      winDeltaPct: 0,
      priorityScore: 0,
      card,
    });
  };

  const handlePairSelectedPilot = (side: SandboxSide, unitInstanceId: string) => {
    if (!match || !selectedPilotCard || match.activeSide !== side) return;
    executeMove({
      id: `manual-pair-${selectedPilotCard.printId}-${unitInstanceId}`,
      rank: 1,
      actionType: 'PAIR_PILOT',
      title: `Pair ${selectedPilotCard.name}`,
      reason: 'Manual pilot pair',
      winDeltaPct: 0,
      priorityScore: 0,
      card: selectedPilotCard,
      unitInstanceId,
    });
  };

  if (!match) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-[#131822] p-12 text-center text-sm text-slate-300">
        Build or select two decks with at least 10 Main Deck cards to launch the Match Sandbox.
      </div>
    );
  }

  const playerA = match.players.A;
  const playerB = match.players.B;

  const renderSideBoard = (side: SandboxSide) => {
    const player = match.players[side];
    const opp = match.players[side === 'A' ? 'B' : 'A'];
    const isActive = match.activeSide === side && !match.winner;
    const isOpponentTargetable =
      selectedAttackerId !== null && match.activeSide !== side && !match.winner;
    const showHandCards = side === 'A' || revealHandB;

    return (
      <div
        className={`rounded-xl border p-4 space-y-3 transition-colors ${
          isActive
            ? 'border-blue-500/60 bg-[#131822]'
            : 'border-white/[0.08] bg-[#0F141E]'
        }`}
      >
        {/* Side Header & Telemetry */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-2.5">
          <div className="flex items-center gap-2.5">
            <span
              className={`rounded px-2 py-0.5 font-mono text-xs font-bold ${
                side === 'A'
                  ? 'bg-blue-600 text-white'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-400/40'
              }`}
            >
              Side {side}
            </span>
            <span className="font-display text-base font-bold text-white">
              {player.deckName}
            </span>
            {isActive && (
              <span className="text-xs font-medium text-emerald-400">· Active Turn</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 font-mono text-xs tabular-nums text-slate-300">
            <span className="flex items-center gap-1">
              <Shield className="h-3.5 w-3.5 text-amber-300" />
              Shields: <strong className="text-white">{player.shields}</strong>
            </span>
            <span>
              Resources:{' '}
              <strong className="text-emerald-300">
                {player.resourcesActive}/{player.resourcesTotal}
              </strong>
            </span>
            <span>
              Deck: <strong className="text-white">{player.library.length}</strong>
            </span>
            <span>
              Trash: <strong className="text-slate-200">{player.trash.length}</strong>
            </span>
            {side === 'B' && (
              <button
                type="button"
                onClick={() => setRevealHandB((v) => !v)}
                className="flex items-center gap-1 font-sans text-[11px] text-slate-400 hover:text-white"
              >
                {revealHandB ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                <span>{revealHandB ? 'Hide Hand' : 'Peek Hand'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Base & Battle Area */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          {/* Base Slot */}
          <div className="md:col-span-3 rounded-lg border border-white/[0.06] bg-[#0B0E14] p-2.5">
            <div className="mb-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-400">
              Base Area
            </div>
            {player.base ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onInspectCard(player.base!.cardNo, player.base!.printId)}
                  className="h-14 w-10 shrink-0 overflow-hidden rounded border border-white/10"
                >
                  <CardArtwork card={player.base} className="h-full w-full" />
                </button>
                <div className="min-w-0 text-xs">
                  <div className="truncate font-semibold text-white">{player.base.name}</div>
                  <div className="font-mono text-[11px] text-emerald-300">
                    HP {(player.base.hp ?? 5) - player.baseDamage}/{player.base.hp ?? 5}
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-3 text-center text-[11px] text-slate-500">No Base</div>
            )}
          </div>

          {/* Battle Area */}
          <div className="md:col-span-9 rounded-lg border border-white/[0.06] bg-[#0B0E14] p-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-400">
              <span>Battle Area ({player.battleArea.length}/6 Units)</span>
              {selectedPilotCard && isActive && (
                <span className="text-amber-300">
                  Click an unpaired Unit to pair {selectedPilotCard.name}
                </span>
              )}
              {isOpponentTargetable && (
                <span className="text-red-300">
                  Click a rested enemy Unit to attack it (or click Attack Shield on attacker)
                </span>
              )}
            </div>

            {player.battleArea.length === 0 ? (
              <div className="py-4 text-center text-[11px] text-slate-500">
                Battle Area empty
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {player.battleArea.map((u) => {
                  const totalAp = (u.card.ap ?? 2) + (u.pairedPilot?.ap ?? 0) + u.apBuff;
                  const remHp = (u.card.hp ?? 2) + (u.pairedPilot?.hp ?? 0) - u.damage;
                  const canAtk = isActive && canUnitAttack(u, match.turn);
                  const canPair = isActive && selectedPilotCard && !u.pairedPilot;
                  const isAttackTarget = isOpponentTargetable && u.rested;

                  return (
                    <div
                      key={u.instanceId}
                      className={`rounded-lg border p-2 text-xs transition-all ${
                        u.rested ? 'opacity-75 border-white/10 bg-[#131822]' : 'border-blue-500/30 bg-[#131822]'
                      } ${selectedAttackerId === u.instanceId ? 'ring-2 ring-amber-400' : ''}`}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => onInspectCard(u.card.cardNo, u.card.printId)}
                          className="h-14 w-10 shrink-0 overflow-hidden rounded border border-white/10"
                        >
                          <CardArtwork card={u.card} className="h-full w-full" />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold text-white">{u.card.name}</div>
                          <div className="font-mono text-[11px] tabular-nums">
                            <span className="text-amber-300">{totalAp} AP</span>
                            <span className="text-slate-500"> / </span>
                            <span className="text-emerald-300">{remHp} HP</span>
                          </div>
                          <div className="text-[10px] font-mono text-slate-400">
                            {u.rested ? 'Rested' : 'Active'}
                            {u.isLinked ? ' · Linked' : u.pairedPilot ? ' · Paired' : ''}
                          </div>
                          {u.pairedPilot && (
                            <div className="truncate text-[10px] text-blue-300">
                              + {u.pairedPilot.name}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1">
                        {canPair && (
                          <button
                            type="button"
                            onClick={() => handlePairSelectedPilot(side, u.instanceId)}
                            className="w-full rounded bg-amber-500/20 px-2 py-1 text-[10px] font-semibold text-amber-200 hover:bg-amber-500/35"
                          >
                            Pair {selectedPilotCard?.name}
                          </button>
                        )}
                        {canAtk && !canPair && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                executeMove({
                                  id: `atk-sh-${u.instanceId}`,
                                  rank: 1,
                                  actionType: 'ATTACK_SHIELD',
                                  title: `Attack Shield with ${u.card.name}`,
                                  reason: 'Manual shield attack',
                                  winDeltaPct: 0,
                                  priorityScore: 0,
                                  unitInstanceId: u.instanceId,
                                })
                              }
                              className="flex-1 rounded bg-red-600/80 px-1.5 py-1 text-[10px] font-medium text-white hover:bg-red-500 whitespace-nowrap"
                            >
                              Hit {opp.base ? 'Base' : 'Shield'}
                            </button>
                            {opp.battleArea.some((e) => e.rested) && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedAttackerId((prev) =>
                                    prev === u.instanceId ? null : u.instanceId
                                  )
                                }
                                className="rounded border border-white/15 px-1.5 py-1 text-[10px] text-slate-200 hover:bg-white/10 whitespace-nowrap"
                              >
                                Target Unit
                              </button>
                            )}
                          </>
                        )}
                        {isAttackTarget && selectedAttackerId && (
                          <button
                            type="button"
                            onClick={() =>
                              executeMove({
                                id: `atk-un-${selectedAttackerId}-${u.instanceId}`,
                                rank: 1,
                                actionType: 'ATTACK_UNIT',
                                title: 'Attack Rested Unit',
                                reason: 'Manual unit battle',
                                winDeltaPct: 0,
                                priorityScore: 0,
                                unitInstanceId: selectedAttackerId,
                                targetInstanceId: u.instanceId,
                              })
                            }
                            className="w-full rounded bg-red-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-red-500"
                          >
                            Strike This Unit
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Hand Area */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span>
              Hand ({player.hand.length} cards)
              {isActive ? ' — Click any highlighted playable card to deploy/play' : ''}
            </span>
            {isActive && (
              <button
                type="button"
                onClick={() =>
                  executeMove({
                    id: `pass-manual-${side}-${match.turn}`,
                    rank: 1,
                    actionType: 'PASS_TURN',
                    title: `End Turn ${match.turn}`,
                    reason: 'Pass turn',
                    winDeltaPct: 0,
                    priorityScore: 0,
                  })
                }
                className="rounded border border-white/15 bg-white/[0.04] px-2.5 py-1 font-sans text-[11px] font-medium text-slate-200 hover:bg-white/10"
              >
                End Turn →
              </button>
            )}
          </div>

          {showHandCards ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {player.hand.map((c, idx) => {
                const playable = isActive && canPayCard(player, c);
                return (
                  <div
                    key={`${c.printId}-${idx}`}
                    className={`w-24 shrink-0 rounded-lg border p-1 transition-all ${
                      playable
                        ? 'border-blue-500/60 bg-[#0B0E14] hover:border-blue-400'
                        : 'border-white/[0.07] bg-[#0B0E14] opacity-70'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        playable
                          ? handleManualCardClick(side, c)
                          : onInspectCard(c.cardNo, c.printId)
                      }
                      className="aspect-[5/7] w-full overflow-hidden rounded"
                      title={
                        playable
                          ? `Play ${c.name} (Lv.${c.lv ?? 1} / C${c.cost ?? 0})`
                          : `Inspect ${c.name}`
                      }
                    >
                      <CardArtwork card={c} className="h-full w-full" />
                    </button>
                    <div className="mt-1 truncate text-[10px] font-medium text-slate-100">
                      {c.name}
                    </div>
                    <div className="flex items-center justify-between font-mono text-[9px] text-slate-400">
                      <span>Lv{c.lv ?? 1}·C{c.cost ?? 0}</span>
                      <span>{c.type.slice(0, 4)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-white/10 py-3 text-center text-[11px] text-slate-500">
              Side B Hand Hidden ({player.hand.length} cards) — click Peek Hand to control/inspect Side B
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Sandbox Setup Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#131822] p-3.5">
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-bold text-blue-400">Side A</span>
            <select
              value={deckAId}
              onChange={(e) => setDeckAId(e.target.value)}
              aria-label="Select Side A Deck"
              className="rounded-lg border border-white/10 bg-[#0B0E14] px-2.5 py-2 text-xs text-white"
            >
              {selectableDecks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <span className="font-mono text-slate-500">vs</span>

          <div className="flex items-center gap-1.5">
            <span className="font-mono font-bold text-amber-300">Side B</span>
            <select
              value={deckBId}
              onChange={(e) => setDeckBId(e.target.value)}
              aria-label="Select Side B Deck"
              className="rounded-lg border border-white/10 bg-[#0B0E14] px-2.5 py-2 text-xs text-white"
            >
              {selectableDecks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <select
            value={firstSide}
            onChange={(e) => setFirstSide(e.target.value as SandboxSide)}
            aria-label="Going first side"
            className="rounded-lg border border-white/10 bg-[#0B0E14] px-2.5 py-2 text-xs text-slate-200"
          >
            <option value="A">Going 1st: Side A</option>
            <option value="B">Going 1st: Side B</option>
          </select>

          <button
            type="button"
            onClick={handleStartMatch}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-500 whitespace-nowrap"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>New Sandbox Match</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleAutoStepMove}
            disabled={Boolean(match.winner)}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 disabled:opacity-40 whitespace-nowrap"
          >
            <Play className="h-3.5 w-3.5 text-emerald-400" />
            <span>Auto-Step 1 Move (Side {match.activeSide})</span>
          </button>

          <button
            type="button"
            onClick={handleAutoPlayTurn}
            disabled={Boolean(match.winner)}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-40 whitespace-nowrap"
          >
            <FastForward className="h-3.5 w-3.5" />
            <span>Auto-Play Side {match.activeSide} Turn</span>
          </button>
        </div>
      </div>

      {/* Winner Banner */}
      {match.winner && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/50 bg-emerald-500/15 px-5 py-4">
          <div className="flex items-center gap-3">
            <Trophy className="h-6 w-6 text-amber-300" />
            <div>
              <div className="font-display text-lg font-bold text-white">
                Side {match.winner} ({match.players[match.winner].deckName}) Wins on Turn {match.turn}!
              </div>
              <div className="text-xs text-emerald-200">{match.lastOpponentAction}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleStartMatch}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500"
          >
            Rematch
          </button>
        </div>
      )}

      {/* Main Sandbox Grid: 2-Deck Table (8 cols) + Reactive Best-Move Advisor & Log (4 cols) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8 space-y-4">
          {renderSideBoard('B')}

          {/* Turn Divider Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#131822] px-4 py-2 text-xs">
            <div className="flex items-center gap-2 font-mono text-slate-200">
              <Swords className="h-4 w-4 text-blue-400" />
              <span className="font-bold">TURN {match.turn}</span>
              <span className="text-slate-500">·</span>
              <span>
                Active: <strong className="text-white">Side {match.activeSide}</strong>
              </span>
            </div>
            <div className="truncate text-[11px] text-slate-400 max-w-md">
              Last Action: {match.lastOpponentAction}
            </div>
          </div>

          {renderSideBoard('A')}
        </div>

        {/* Right: Reactive Best-Move Advisor + Match Log */}
        <aside className="lg:col-span-4 space-y-4">
          <div className="rounded-xl border border-blue-500/30 bg-[#131822] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-blue-400" />
                <h3 className="font-display text-base font-bold text-white">
                  Best-Move Advisor (Side {match.activeSide})
                </h3>
              </div>
              <span className="font-mono text-[11px] text-blue-300">
                Top {bestMoves.length}
              </span>
            </div>

            <div className="rounded-md border border-white/[0.06] bg-[#0B0E14] px-3 py-2 text-[11px] text-slate-300">
              <span className="font-semibold text-slate-100">Reacting to: </span>
              {match.lastOpponentAction}
            </div>

            {bestMoves.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-400">
                Match finished. Start a rematch to inspect new move lines.
              </div>
            ) : (
              <div className="space-y-2.5">
                {bestMoves.map((move) => (
                  <div
                    key={move.id}
                    className={`rounded-lg border p-3 space-y-2 ${
                      move.rank === 1
                        ? 'border-emerald-500/40 bg-emerald-500/10'
                        : 'border-white/[0.07] bg-[#0B0E14]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold text-amber-300">
                          #{move.rank}
                        </span>
                        <span className="text-xs font-semibold text-white">{move.title}</span>
                      </div>
                      <span className="font-mono text-[11px] font-semibold text-emerald-300 shrink-0 tabular-nums">
                        +{move.winDeltaPct}% Win
                      </span>
                    </div>
                    <p className="text-[11px] leading-snug text-slate-300">{move.reason}</p>
                    <button
                      type="button"
                      onClick={() => executeMove(move)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-600/85 py-1.5 text-[11px] font-medium text-white hover:bg-blue-500 transition-colors"
                    >
                      <Sparkles className="h-3 w-3" />
                      <span>Apply Move</span>
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action Log */}
          <div className="rounded-xl border border-white/[0.08] bg-[#131822] p-4 space-y-2.5">
            <h3 className="font-display text-sm font-bold text-white">Match Action Log</h3>
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1 text-[11px]">
              {match.log.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded border border-white/[0.05] bg-[#0B0E14] px-2.5 py-1.5 text-slate-300"
                >
                  <span className="font-mono text-slate-400">
                    T{entry.turn} · Side {entry.side}:{' '}
                  </span>
                  <span>{entry.summary}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
