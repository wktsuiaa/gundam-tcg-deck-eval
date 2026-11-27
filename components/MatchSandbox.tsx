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
  GitBranch,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import type {
  GundamCardPrint,
  SandboxMatchState,
  SandboxMoveSuggestion,
  SandboxSide,
  SandboxUnitInstance,
  SavedDeck,
} from '@/types/gundam';
import {
  buildStarterDeckFromCatalog,
  resolveCardMap,
  STARTER_PRESETS,
} from '@/lib/deck-engine';
import { extractPilotNamesForLink, isCommandPilot } from '@/lib/gundam-keywords';
import { previewSandboxMoveChain } from '@/lib/chain-verifier';
import {
  applySandboxMove,
  canActivateUnitMain,
  canPayCard,
  canUnitAttack,
  createInitialSandboxMatch,
  evaluateSandboxBestMoves,
  getLegalTargetOptions,
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
  const [commandPilotPendingCard, setCommandPilotPendingCard] = useState<GundamCardPrint | null>(null);
  const [selectedAttackerId, setSelectedAttackerId] = useState<string | null>(null);
  const [previewedMoveId, setPreviewedMoveId] = useState<string | null>(null);
  const [pendingTargetMove, setPendingTargetMove] = useState<{
    move: SandboxMoveSuggestion;
    options: SandboxUnitInstance[];
  } | null>(null);

  const deckA = selectableDecks.find((d) => d.id === deckAId) ?? selectableDecks[0];
  const deckB = selectableDecks.find((d) => d.id === deckBId) ?? selectableDecks[1] ?? selectableDecks[0];

  const handleStartMatch = () => {
    if (!deckA || !deckB) return;
    setSelectedPilotCard(null);
    setCommandPilotPendingCard(null);
    setSelectedAttackerId(null);
    setPreviewedMoveId(null);
    setPendingTargetMove(null);
    setMatch(createInitialSandboxMatch(deckA, deckB, firstSide, byPrintId, byCardNo));
  };

  const bestMoves = useMemo(() => {
    if (!match || match.winner) return [];
    return evaluateSandboxBestMoves(match, match.activeSide);
  }, [match]);

  const activePreviewMove = useMemo(() => {
    if (!match || match.winner) return null;
    if (previewedMoveId) {
      const found = bestMoves.find((m) => m.id === previewedMoveId);
      if (found) return found;
    }
    if (selectedPilotCard) {
      const firstUnpaired = match.players[match.activeSide].battleArea.find((u) => !u.pairedPilot);
      if (firstUnpaired) {
        return {
          id: `preview-pair-${selectedPilotCard.printId}`,
          rank: 1 as const,
          actionType: 'PAIR_PILOT' as const,
          title: `Pair ${selectedPilotCard.name} → ${firstUnpaired.card.name}`,
          reason: 'Staged Pilot / Command-Pilot pair',
          winDeltaPct: 0,
          priorityScore: 0,
          card: selectedPilotCard,
          unitInstanceId: firstUnpaired.instanceId,
        };
      }
    }
    return bestMoves[0] ?? null;
  }, [match, bestMoves, previewedMoveId, selectedPilotCard]);

  const chainPreview = useMemo(() => {
    if (!match || !activePreviewMove) return null;
    return previewSandboxMoveChain(match, activePreviewMove);
  }, [match, activePreviewMove]);

  const executeMove = (move: SandboxMoveSuggestion) => {
    if (!match) return;
    setSelectedPilotCard(null);
    setCommandPilotPendingCard(null);
    setSelectedAttackerId(null);
    setPreviewedMoveId(null);
    setPendingTargetMove(null);
    setMatch(applySandboxMove(match, move));
  };

  const handleAutoStepMove = () => {
    if (!match || match.winner) return;
    setSelectedPilotCard(null);
    setCommandPilotPendingCard(null);
    setSelectedAttackerId(null);
    setPreviewedMoveId(null);
    setPendingTargetMove(null);
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
    setCommandPilotPendingCard(null);
    setSelectedAttackerId(null);
    setPreviewedMoveId(null);
    setPendingTargetMove(null);
    setMatch(current);
  };

  const dispatchTargetedOrImmediate = (
    side: SandboxSide,
    move: SandboxMoveSuggestion,
    card: GundamCardPrint,
    timing: 'DEPLOY' | 'MAIN' | 'ACTIVATE_MAIN',
    selfUnit?: SandboxUnitInstance
  ) => {
    if (!match) return;
    const options = getLegalTargetOptions(match, side, card, timing, selfUnit);
    if (options.length >= 2) {
      setPendingTargetMove({ move, options });
      return;
    }
    executeMove({ ...move, targetInstanceId: options[0]?.instanceId });
  };

  const playCommandCard = (side: SandboxSide, card: GundamCardPrint) => {
    if (!match) return;
    const move: SandboxMoveSuggestion = {
      id: `manual-${card.printId}-${match.turn}-${match.log.length}`,
      rank: 1,
      actionType: 'PLAY_COMMAND',
      title: `Play ${card.name}`,
      reason: 'Manual Command play',
      winDeltaPct: 0,
      priorityScore: 0,
      card,
    };
    dispatchTargetedOrImmediate(side, move, card, 'MAIN');
  };

  const handleManualCardClick = (side: SandboxSide, card: GundamCardPrint) => {
    if (!match || match.winner || match.activeSide !== side) return;
    const player = match.players[side];
    if (!canPayCard(player, card, match, side)) return;

    const hasUnpairedUnit = player.battleArea.some((u) => !u.pairedPilot);

    if (card.type === 'PILOT') {
      if (hasUnpairedUnit) {
        setCommandPilotPendingCard(null);
        setSelectedPilotCard((prev) => (prev?.printId === card.printId ? null : card));
      }
      return;
    }

    if (isCommandPilot(card)) {
      const hasMainClause = (card.compiledEffect?.abilities ?? []).some(
        (ab) => ab.kind === 'EFFECT_CLAUSE' && ab.timings.includes('MAIN')
      );
      if (hasMainClause && hasUnpairedUnit) {
        setSelectedPilotCard(null);
        setCommandPilotPendingCard((prev) => (prev?.printId === card.printId ? null : card));
        return;
      }
      if (!hasMainClause && hasUnpairedUnit) {
        setCommandPilotPendingCard(null);
        setSelectedPilotCard((prev) => (prev?.printId === card.printId ? null : card));
        return;
      }
      if (hasMainClause) {
        playCommandCard(side, card);
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
    const move: SandboxMoveSuggestion = {
      id: `manual-${card.printId}-${match.turn}-${match.log.length}`,
      rank: 1,
      actionType,
      title: `Play ${card.name}`,
      reason: 'Manual play',
      winDeltaPct: 0,
      priorityScore: 0,
      card,
    };
    if (actionType === 'DEPLOY_UNIT' || actionType === 'PLAY_COMMAND') {
      dispatchTargetedOrImmediate(side, move, card, actionType === 'DEPLOY_UNIT' ? 'DEPLOY' : 'MAIN');
    } else {
      executeMove(move);
    }
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
              {pendingTargetMove && match.activeSide !== side && (
                <span className="flex items-center gap-2 text-amber-300">
                  <span>Select legal target for {pendingTargetMove.move.card?.name}</span>
                  <button
                    type="button"
                    onClick={() => setPendingTargetMove(null)}
                    className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] text-slate-200 hover:bg-white/10"
                  >
                    Cancel
                  </button>
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
                  const canAtk = isActive && canUnitAttack(u, match.turn, match, side);
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
                        {isActive && !canPair && canActivateUnitMain(match, side, u) && (
                          <button
                            type="button"
                            onClick={() =>
                              dispatchTargetedOrImmediate(
                                side,
                                {
                                  id: `act-${u.instanceId}-${match.turn}`,
                                  rank: 1,
                                  actionType: 'ACTIVATE_MAIN',
                                  title: `Activate ${u.card.name}`,
                                  reason: 'Manual Activate Main',
                                  winDeltaPct: 0,
                                  priorityScore: 0,
                                  card: u.card,
                                  unitInstanceId: u.instanceId,
                                },
                                u.card,
                                'ACTIVATE_MAIN',
                                u
                              )
                            }
                            className="w-full rounded bg-purple-600/80 px-2 py-1 text-[10px] font-semibold text-white hover:bg-purple-500"
                          >
                            Activate Main
                          </button>
                        )}
                        {pendingTargetMove &&
                          match.activeSide !== side &&
                          pendingTargetMove.options.some((opt) => opt.instanceId === u.instanceId) && (
                            <button
                              type="button"
                              onClick={() =>
                                executeMove({ ...pendingTargetMove.move, targetInstanceId: u.instanceId })
                              }
                              className="w-full rounded bg-amber-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-amber-500"
                            >
                              Choose Target
                            </button>
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

          {isActive && commandPilotPendingCard && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
              <div className="text-amber-200">
                <strong className="text-white">{commandPilotPendingCard.name}</strong> has dual Command / Pilot mode (
                {extractPilotNamesForLink(commandPilotPendingCard).join(', ') || 'Pilot'} +{commandPilotPendingCard.ap ?? 0}/+{commandPilotPendingCard.hp ?? 0}). Choose how to play:
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const card = commandPilotPendingCard;
                    setCommandPilotPendingCard(null);
                    playCommandCard(side, card);
                  }}
                  className="rounded bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-500"
                >
                  Play as Command
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPilotCard(commandPilotPendingCard);
                    setCommandPilotPendingCard(null);
                  }}
                  className="rounded bg-amber-500/30 border border-amber-400/50 px-2.5 py-1 text-[11px] font-medium text-amber-100 hover:bg-amber-500/45"
                >
                  Pair as Pilot
                </button>
                <button
                  type="button"
                  onClick={() => setCommandPilotPendingCard(null)}
                  className="rounded border border-white/15 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {showHandCards ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {player.hand.map((c, idx) => {
                const playable = isActive && canPayCard(player, c, match, side);
                const cmdPilot = isCommandPilot(c);
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
                          ? `${cmdPilot ? 'Play Command or Pair as Pilot: ' : 'Play '}${c.name} (Lv.${c.lv ?? 1} / C${c.cost ?? 0})`
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
                      <span className={cmdPilot ? 'text-amber-300' : ''}>
                        {cmdPilot ? 'CMD·PLT' : c.type.slice(0, 4)}
                      </span>
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
                    onMouseEnter={() => setPreviewedMoveId(move.id)}
                    className={`rounded-lg border p-3 space-y-2 transition-colors ${
                      move.rank === 1
                        ? 'border-emerald-500/40 bg-emerald-500/10'
                        : 'border-white/[0.07] bg-[#0B0E14]'
                    } ${activePreviewMove?.id === move.id ? 'ring-1 ring-blue-400/60' : ''}`}
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
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => executeMove(move)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-blue-600/85 py-1.5 text-[11px] font-medium text-white hover:bg-blue-500 transition-colors"
                      >
                        <Sparkles className="h-3 w-3" />
                        <span>Apply Move</span>
                        <ArrowRight className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewedMoveId(move.id)}
                        className="rounded-md border border-white/15 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-slate-200 hover:bg-white/10"
                        title="Preview Chain Resolution"
                      >
                        Chain
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rules-Accurate Chain Preview */}
          <div className="rounded-xl border border-white/[0.08] bg-[#131822] p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-blue-400" />
                <h3 className="font-display text-sm font-bold text-white">Chain Preview</h3>
              </div>
              {chainPreview && (
                <span
                  className={`inline-flex items-center gap-1 font-mono text-[11px] font-semibold ${
                    chainPreview.result.legal ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {chainPreview.result.legal ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Verified Legal</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <span>{chainPreview.result.reason}</span>
                    </>
                  )}
                </span>
              )}
            </div>

            {chainPreview ? (
              <div className="space-y-2">
                <div className="rounded border border-white/[0.06] bg-[#0B0E14] px-2.5 py-2 text-[11px]">
                  <div className="font-semibold text-white">{chainPreview.moveTitle}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-slate-400 tabular-nums">
                    Lv.{chainPreview.lvRequired} · Cost {chainPreview.costRequired} ({chainPreview.activeResources} active)
                  </div>
                </div>
                {!chainPreview.result.legal && (
                  <div className="rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-200">
                    {chainPreview.result.detail}
                  </div>
                )}
                {chainPreview.result.trace.length > 0 && (
                  <div className="max-h-40 space-y-1 overflow-y-auto pr-1 text-[11px]">
                    {chainPreview.result.trace.map((step, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 rounded border border-white/[0.05] bg-[#0B0E14] px-2 py-1 text-slate-300"
                      >
                        <span className="shrink-0 font-mono text-[10px] font-semibold text-blue-300">
                          {step.kind}
                        </span>
                        <span className="leading-snug">{step.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="py-3 text-center text-[11px] text-slate-500">
                Hover or select a candidate move to preview its rules-verified resolution chain.
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
