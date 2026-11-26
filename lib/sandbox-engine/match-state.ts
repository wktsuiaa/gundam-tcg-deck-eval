import type { CardColor, GundamCardPrint, SandboxMatchState, SandboxPlayerState, SandboxSide, SandboxUnitInstance, SavedDeck } from '@/types/gundam';
import { expandEntries } from '@/lib/deck-engine';
import { resolveClausesForTiming } from './effects';

export function shuffleCards(cards: GundamCardPrint[]): GundamCardPrint[] {
  const arr = [...cards];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function buildPlayerState(
  side: SandboxSide,
  deck: SavedDeck,
  byPrintId: Map<string, GundamCardPrint>,
  byCardNo: Map<string, GundamCardPrint>
): SandboxPlayerState {
  const expanded = expandEntries(deck.mainDeck, byPrintId, byCardNo);
  const pool: GundamCardPrint[] = [];
  const colors = new Set<CardColor>();

  for (const { card, qty } of expanded) {
    if (card.color !== 'Colorless') colors.add(card.color);
    for (let i = 0; i < qty; i++) pool.push(card);
  }

  const library = shuffleCards(pool);
  const hand = library.splice(0, 5);
  const resourcesTotal = 1;

  return {
    side,
    deckName: deck.name,
    colors: [...colors],
    library,
    hand,
    shields: 6,
    resourcesTotal,
    resourcesActive: resourcesTotal,
    base: null,
    baseDamage: 0,
    battleArea: [],
    trash: [],
  };
}

export function createInitialSandboxMatch(
  deckA: SavedDeck,
  deckB: SavedDeck,
  firstSide: SandboxSide,
  byPrintId: Map<string, GundamCardPrint>,
  byCardNo: Map<string, GundamCardPrint>
): SandboxMatchState {
  const secondSide: SandboxSide = firstSide === 'A' ? 'B' : 'A';
  const playerA = buildPlayerState('A', deckA, byPrintId, byCardNo);
  const playerB = buildPlayerState('B', deckB, byPrintId, byCardNo);

  return {
    turn: 1,
    activeSide: firstSide,
    firstSide,
    phase: 'MAIN',
    winner: null,
    lastOpponentAction: `${firstSide === 'A' ? deckA.name : deckB.name} won the toss and goes first (5 cards, 6 Shields).`,
    players: { A: playerA, B: playerB },
    log: [
      {
        id: `log-init-${Date.now()}`,
        turn: 1,
        side: firstSide,
        summary: `Match started · Going 1st: Side ${firstSide} (${firstSide === 'A' ? deckA.name : deckB.name}) vs Side ${secondSide}.`,
      },
    ],
  };
}

export function cloneState(state: SandboxMatchState): SandboxMatchState {
  const cloneUnit = (u: SandboxUnitInstance): SandboxUnitInstance => ({
    ...u,
    ...(u.triggeredClauseTurns ? { triggeredClauseTurns: { ...u.triggeredClauseTurns } } : {}),
  });
  return {
    ...state,
    players: {
      A: {
        ...state.players.A,
        library: [...state.players.A.library],
        hand: [...state.players.A.hand],
        battleArea: state.players.A.battleArea.map(cloneUnit),
        trash: [...state.players.A.trash],
      },
      B: {
        ...state.players.B,
        library: [...state.players.B.library],
        hand: [...state.players.B.hand],
        battleArea: state.players.B.battleArea.map(cloneUnit),
        trash: [...state.players.B.trash],
      },
    },
    log: [...state.log],
  };
}

export function destroyUnit(
  state: SandboxMatchState,
  ownerSide: SandboxSide,
  instanceId: string,
  destroyedByBattle = false
): SandboxUnitInstance | null {
  const owner = state.players[ownerSide];
  const idx = owner.battleArea.findIndex((u) => u.instanceId === instanceId);
  if (idx === -1) return null;
  const [removed] = owner.battleArea.splice(idx, 1);
  owner.trash.push(removed.card);
  if (removed.pairedPilot) owner.trash.push(removed.pairedPilot);
  resolveClausesForTiming(state, ownerSide, removed.card, 'DESTROYED', removed, undefined, destroyedByBattle);
  return removed;
}
