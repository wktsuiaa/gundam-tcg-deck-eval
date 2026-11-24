import type {
  CardColor,
  GundamCardPrint,
  SandboxMatchState,
  SandboxMoveSuggestion,
  SandboxPlayerState,
  SandboxSide,
  SandboxUnitInstance,
  SavedDeck,
} from '@/types/gundam';
import { doesPilotLinkUnit } from '@/lib/gundam-keywords';
import { expandEntries, scoreSingleCardSignals } from '@/lib/deck-engine';
import {
  parseCardEffects,
  type ActivationCost,
  type EffectClause,
  type EffectCondition,
  type EffectTiming,
  type KeywordName,
  type TargetSelector,
} from '@/lib/effect-parser';

function shuffleCards(cards: GundamCardPrint[]): GundamCardPrint[] {
  const arr = [...cards];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function effectiveAp(u: SandboxUnitInstance): number {
  return Math.max(0, (u.card.ap ?? 2) + (u.pairedPilot?.ap ?? 0) + u.apBuff);
}

function effectiveMaxHp(u: SandboxUnitInstance): number {
  return Math.max(1, (u.card.hp ?? 2) + (u.pairedPilot?.hp ?? 0));
}

function effectiveRemainingHp(u: SandboxUnitInstance): number {
  return effectiveMaxHp(u) - u.damage;
}

function checkCondition(
  cond: EffectCondition | undefined,
  state: SandboxMatchState,
  side: SandboxSide,
  selfUnit?: SandboxUnitInstance,
  destroyedByBattle = false
): boolean {
  if (!cond) return true;
  const player = state.players[side];
  const opp = state.players[side === 'A' ? 'B' : 'A'];

  switch (cond.kind) {
    case 'DEPLOYED_FROM_ZONE':
      return selfUnit?.deployedFromZone === cond.zone;
    case 'TRASH_COUNT_AT_LEAST': {
      const matching = player.trash.filter((c) => {
        if (cond.color && c.color !== cond.color) return false;
        if (cond.trait && !c.traits.some((t) => t.toLowerCase() === cond.trait!.toLowerCase())) return false;
        if (cond.cardType && c.type !== cond.cardType) return false;
        return true;
      });
      return matching.length >= cond.count;
    }
    case 'FRIENDLY_BASE_IN_PLAY':
      return player.base !== null;
    case 'SELF_AP_AT_LEAST':
      return selfUnit ? effectiveAp(selfUnit) >= cond.minAp : false;
    case 'UNIT_TRAIT_IS':
      return selfUnit
        ? selfUnit.card.traits.some((t) => t.toLowerCase() === cond.trait.toLowerCase())
        : false;
    case 'IS_YOUR_TURN':
      return state.activeSide === side;
    case 'SELF_RESTED':
      return Boolean(selfUnit?.rested);
    case 'DESTROYED_BY_BATTLE':
      return destroyedByBattle;
    case 'UNIT_COUNT_AT_LEAST': {
      const count =
        cond.owner === 'ENEMY'
          ? opp.battleArea.length
          : cond.owner === 'SELF'
          ? player.battleArea.length
          : player.battleArea.length + opp.battleArea.length;
      return count >= cond.count;
    }
    case 'DEVELOPMENT_EXILE':
    case 'RAW_CONDITION':
      return false;
  }
}

function unitKeywordValue(
  u: SandboxUnitInstance,
  name: KeywordName,
  state?: SandboxMatchState,
  side?: SandboxSide
): number | null {
  const cards = u.pairedPilot ? [u.card, u.pairedPilot] : [u.card];
  for (const c of cards) {
    const parsed = parseCardEffects(c);
    const innate = parsed.keywords.find((k) => k.name === name);
    if (innate) return innate.value ?? 1;

    if (state && side) {
      for (const clause of parsed.clauses) {
        const isContinuous =
          clause.timings.includes('CONTINUOUS') ||
          clause.timings.includes('DURING_PAIR') ||
          (clause.timings.includes('DURING_LINK') && u.isLinked);
        if (!isContinuous) continue;
        if (clause.timings.includes('DURING_PAIR') && !u.pairedPilot) continue;
        if (!checkCondition(clause.condition, state, side, u)) continue;
        const grant = clause.steps.find((s) => s.action === 'GRANT_KEYWORD' && s.keyword.name === name);
        if (grant && grant.action === 'GRANT_KEYWORD') return grant.keyword.value ?? 1;
      }
    }
  }
  return null;
}

function unitHasKeyword(
  u: SandboxUnitInstance,
  name: KeywordName,
  state?: SandboxMatchState,
  side?: SandboxSide
): boolean {
  return unitKeywordValue(u, name, state, side) !== null;
}

function matchesUnitSelector(
  u: SandboxUnitInstance,
  sel: TargetSelector,
  selfUnit?: SandboxUnitInstance
): boolean {
  if (sel.self && selfUnit && u.instanceId !== selfUnit.instanceId) return false;
  if (sel.other && selfUnit && u.instanceId === selfUnit.instanceId) return false;
  if (sel.cardType && sel.cardType !== 'UNIT' && sel.cardType !== 'CARD') return false;
  if (sel.state === 'ACTIVE' && u.rested) return false;
  if (sel.state === 'RESTED' && !u.rested) return false;
  if (sel.state === 'DAMAGED' && u.damage <= 0) return false;
  const lv = u.card.lv ?? 1;
  if (sel.lvMax !== undefined && lv > sel.lvMax) return false;
  if (sel.lvMin !== undefined && lv < sel.lvMin) return false;
  const ap = effectiveAp(u);
  if (sel.apMax !== undefined && ap > sel.apMax) return false;
  if (sel.apMin !== undefined && ap < sel.apMin) return false;
  if (sel.hpMax !== undefined && effectiveRemainingHp(u) > sel.hpMax) return false;
  if (sel.trait && !u.card.traits.some((t) => t.toLowerCase() === sel.trait!.toLowerCase())) return false;
  if (sel.nameContains && !u.card.name.toLowerCase().includes(sel.nameContains.toLowerCase())) return false;
  if (sel.excludeName && u.card.name.toLowerCase().includes(sel.excludeName.toLowerCase())) return false;
  return true;
}

function matchesCardSelector(card: GundamCardPrint, sel: TargetSelector): boolean {
  if (sel.cardType && sel.cardType !== 'CARD' && card.type !== sel.cardType) return false;
  const lv = card.lv ?? 1;
  if (sel.lvMax !== undefined && lv > sel.lvMax) return false;
  if (sel.lvMin !== undefined && lv < sel.lvMin) return false;
  if (sel.trait && !card.traits.some((t) => t.toLowerCase() === sel.trait!.toLowerCase())) return false;
  if (sel.nameContains && !card.name.toLowerCase().includes(sel.nameContains.toLowerCase())) return false;
  if (sel.excludeName && card.name.toLowerCase().includes(sel.excludeName.toLowerCase())) return false;
  return true;
}

function findBattleAreaTargets(
  state: SandboxMatchState,
  side: SandboxSide,
  sel: TargetSelector,
  selfUnit?: SandboxUnitInstance
): { side: SandboxSide; unit: SandboxUnitInstance }[] {
  const oppSide: SandboxSide = side === 'A' ? 'B' : 'A';
  const pools: SandboxSide[] =
    sel.owner === 'SELF' ? [side] : sel.owner === 'ENEMY' ? [oppSide] : [oppSide, side];
  const out: { side: SandboxSide; unit: SandboxUnitInstance }[] = [];
  for (const s of pools) {
    for (const u of state.players[s].battleArea) {
      if (matchesUnitSelector(u, sel, selfUnit)) out.push({ side: s, unit: u });
    }
  }
  return out;
}

/** Exposes legal enemy Battle Area target options for UI prompts when human plays a targeted effect. */
export function getLegalTargetOptions(
  state: SandboxMatchState,
  side: SandboxSide,
  card: GundamCardPrint,
  timing: EffectTiming,
  selfUnit?: SandboxUnitInstance
): SandboxUnitInstance[] {
  const parsed = parseCardEffects(card);
  for (const clause of parsed.clauses) {
    if (!clause.timings.includes(timing)) continue;
    if (!checkCondition(clause.condition, state, side, selfUnit)) continue;
    for (const step of clause.steps) {
      if ('target' in step && step.target && step.target.owner === 'ENEMY' && step.target.count === 1) {
        return findBattleAreaTargets(state, side, step.target, selfUnit).map((x) => x.unit);
      }
    }
  }
  return [];
}

function buildPlayerState(
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

function cloneState(state: SandboxMatchState): SandboxMatchState {
  return {
    ...state,
    players: {
      A: {
        ...state.players.A,
        library: [...state.players.A.library],
        hand: [...state.players.A.hand],
        battleArea: state.players.A.battleArea.map((u) => ({ ...u })),
        trash: [...state.players.A.trash],
      },
      B: {
        ...state.players.B,
        library: [...state.players.B.library],
        hand: [...state.players.B.hand],
        battleArea: state.players.B.battleArea.map((u) => ({ ...u })),
        trash: [...state.players.B.trash],
      },
    },
    log: [...state.log],
  };
}

function destroyUnit(
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

function canPayActivationCost(
  player: SandboxPlayerState,
  cost: ActivationCost | undefined,
  selfUnit?: SandboxUnitInstance
): boolean {
  if (!cost) return true;
  if (cost.resourceCost && player.resourcesActive < cost.resourceCost) return false;
  if (cost.restSelf && selfUnit?.rested) return false;
  if (cost.discardCount && player.hand.length < cost.discardCount) return false;
  if (cost.exileFromTrashCount && player.trash.length < cost.exileFromTrashCount) return false;
  return true;
}

function payActivationCost(
  state: SandboxMatchState,
  side: SandboxSide,
  cost: ActivationCost | undefined,
  selfUnit?: SandboxUnitInstance
) {
  if (!cost) return;
  const player = state.players[side];
  if (cost.resourceCost) player.resourcesActive = Math.max(0, player.resourcesActive - cost.resourceCost);
  if (cost.restSelf && selfUnit) selfUnit.rested = true;
  if (cost.discardCount) {
    for (let i = 0; i < cost.discardCount && player.hand.length > 0; i++) {
      const d = player.hand.pop();
      if (d) player.trash.push(d);
    }
  }
  if (cost.exileFromTrashCount && player.trash.length >= cost.exileFromTrashCount) {
    player.trash.splice(0, cost.exileFromTrashCount);
  }
  if (cost.destroySelf && selfUnit) {
    destroyUnit(state, side, selfUnit.instanceId);
  }
  if (cost.returnSelfToDeckBottom && selfUnit) {
    const idx = player.battleArea.findIndex((u) => u.instanceId === selfUnit.instanceId);
    if (idx !== -1) {
      const [removed] = player.battleArea.splice(idx, 1);
      if (removed.pairedPilot) player.trash.push(removed.pairedPilot);
      player.library.push(removed.card);
    }
  }
}

function resolveClause(
  state: SandboxMatchState,
  side: SandboxSide,
  clause: EffectClause,
  sourceCard: GundamCardPrint,
  selfUnit?: SandboxUnitInstance,
  targetInstanceId?: string,
  destroyedByBattle = false
): string[] {
  const notes: string[] = [];
  if (clause.unparsedResidual) {
    notes.push(`Manual resolution required: ${clause.raw}`);
    return notes;
  }
  if (!checkCondition(clause.condition, state, side, selfUnit, destroyedByBattle)) {
    return notes;
  }

  const actor = state.players[side];

  for (const step of clause.steps) {
    switch (step.action) {
      case 'DRAW': {
        for (let i = 0; i < step.count && actor.library.length > 0; i++) {
          const drawn = actor.library.shift();
          if (drawn) {
            actor.hand.push(drawn);
            notes.push(`drew ${drawn.name}`);
          }
        }
        break;
      }
      case 'DISCARD': {
        for (let i = 0; i < step.count && actor.hand.length > 0; i++) {
          const discarded = actor.hand.pop();
          if (discarded) {
            actor.trash.push(discarded);
            notes.push(`discarded ${discarded.name}`);
          }
        }
        break;
      }
      case 'ADD_SHIELD_TO_HAND': {
        if (actor.shields > 0) {
          actor.shields -= 1;
          const cardFromLib = actor.library.shift();
          if (cardFromLib) actor.hand.push(cardFromLib);
          notes.push('added 1 Shield to hand');
        }
        break;
      }
      case 'ADD_RESOURCE': {
        for (let i = 0; i < step.count && actor.resourcesTotal < 10; i++) {
          actor.resourcesTotal += 1;
          if (!step.rested) actor.resourcesActive += 1;
          notes.push(step.ex ? '+1 EX Resource' : '+1 Resource');
        }
        break;
      }
      case 'DEPLOY_TOKEN': {
        for (let i = 0; i < step.count && actor.battleArea.length < 6; i++) {
          const tokenCard: GundamCardPrint = {
            ...sourceCard,
            printId: `TOKEN-${sourceCard.printId}-${Date.now()}-${i}`,
            cardNo: 'TOKEN',
            name: `${sourceCard.traits[0] ?? 'Mobile Suit'} Token`,
            type: 'UNIT',
            lv: 1,
            cost: 1,
            ap: step.ap ?? 2,
            hp: step.hp ?? 2,
            apRaw: String(step.ap ?? 2),
            hpRaw: String(step.hp ?? 2),
            effect: '',
            link: '',
          };
          actor.battleArea.push({
            instanceId: `unit-tok-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
            card: tokenCard,
            pairedPilot: null,
            isLinked: false,
            rested: false,
            damage: 0,
            apBuff: 0,
            summonedTurn: state.turn,
            deployedFromZone: 'hand',
          });
          notes.push(`deployed ${tokenCard.apRaw}/${tokenCard.hpRaw} Token`);
        }
        break;
      }
      case 'DEPLOY_FROM_TRASH': {
        if (actor.battleArea.length >= 6) break;
        const idx = actor.trash.findIndex((c) => matchesCardSelector(c, step.target));
        if (idx === -1) break;
        const candidate = actor.trash[idx];
        const payCost = step.free ? 0 : candidate.cost ?? 0;
        if (!step.free && actor.resourcesActive < payCost) break;
        actor.resourcesActive -= payCost;
        actor.trash.splice(idx, 1);
        const deployed: SandboxUnitInstance = {
          instanceId: `unit-${side}-${state.turn}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          card: candidate,
          pairedPilot: null,
          isLinked: false,
          rested: Boolean(step.rested),
          damage: 0,
          apBuff: 0,
          summonedTurn: state.turn,
          deployedFromZone: 'trash',
        };
        actor.battleArea.push(deployed);
        notes.push(`deployed ${candidate.name} from trash`);
        // shortcut: chained DEPLOY targets auto-pick highest-AP enemy instead of opening a second prompt
        notes.push(...resolveClausesForTiming(state, side, candidate, 'DEPLOY', deployed, targetInstanceId));
        break;
      }
      case 'ADD_FROM_TRASH_TO_HAND': {
        const idx = actor.trash.findIndex((c) => matchesCardSelector(c, step.target));
        if (idx !== -1) {
          const [card] = actor.trash.splice(idx, 1);
          actor.hand.push(card);
          notes.push(`recovered ${card.name} from trash`);
        }
        break;
      }
      case 'PAIR_SELF_FROM_TRASH': {
        const trashIdx = actor.trash.findIndex((c) => c.printId === sourceCard.printId);
        if (trashIdx === -1) break;
        const unit = actor.battleArea.find((u) => !u.pairedPilot && matchesUnitSelector(u, step.target, selfUnit));
        if (!unit) break;
        const [pairedCard] = actor.trash.splice(trashIdx, 1);
        unit.pairedPilot = pairedCard;
        unit.isLinked = doesPilotLinkUnit(pairedCard, unit.card);
        notes.push(`paired ${pairedCard.name} from trash onto ${unit.card.name}`);
        break;
      }
      case 'DESTROY':
      case 'DEAL_DAMAGE':
      case 'MODIFY_AP':
      case 'REST':
      case 'SET_ACTIVE':
      case 'BOUNCE':
      case 'RECOVER_HP': {
        const legal = findBattleAreaTargets(state, side, step.target, selfUnit);
        if (legal.length === 0) break;

        const chosen =
          step.target.count === 'ALL'
            ? legal
            : [
                (targetInstanceId ? legal.find((x) => x.unit.instanceId === targetInstanceId) : undefined) ??
                  [...legal].sort((a, b) => effectiveAp(b.unit) - effectiveAp(a.unit))[0],
              ];

        for (const entry of chosen) {
          if (step.action === 'DESTROY') {
            destroyUnit(state, entry.side, entry.unit.instanceId);
            notes.push(`destroyed ${entry.unit.card.name}`);
          } else if (step.action === 'DEAL_DAMAGE') {
            entry.unit.damage += step.amount;
            notes.push(`dealt ${step.amount} damage to ${entry.unit.card.name}`);
            if (effectiveRemainingHp(entry.unit) <= 0) {
              destroyUnit(state, entry.side, entry.unit.instanceId);
              notes.push(`${entry.unit.card.name} destroyed`);
            }
          } else if (step.action === 'MODIFY_AP') {
            entry.unit.apBuff += step.delta;
            notes.push(`${step.delta >= 0 ? '+' : ''}${step.delta} AP to ${entry.unit.card.name}`);
          } else if (step.action === 'REST' && !entry.unit.rested) {
            entry.unit.rested = true;
            notes.push(`rested ${entry.unit.card.name}`);
          } else if (step.action === 'SET_ACTIVE' && entry.unit.rested) {
            entry.unit.rested = false;
            notes.push(`set ${entry.unit.card.name} active`);
          } else if (step.action === 'BOUNCE') {
            const owner = state.players[entry.side];
            const idx = owner.battleArea.findIndex((u) => u.instanceId === entry.unit.instanceId);
            if (idx !== -1) {
              const [bounced] = owner.battleArea.splice(idx, 1);
              owner.hand.push(bounced.card);
              if (bounced.pairedPilot) owner.hand.push(bounced.pairedPilot);
              notes.push(`bounced ${bounced.card.name} to hand`);
            }
          } else if (step.action === 'RECOVER_HP' && entry.unit.damage > 0) {
            entry.unit.damage = Math.max(0, entry.unit.damage - step.amount);
            notes.push(`repaired ${entry.unit.card.name} +${step.amount} HP`);
          }
        }
        break;
      }
      case 'LOOK_TOP': {
        if (actor.library.length > 0 && step.revealSearch) {
          const idx = step.trait
            ? actor.library.slice(0, step.count).findIndex((c) => c.traits.some((t) => t.toLowerCase() === step.trait!.toLowerCase()))
            : 0;
          if (idx >= 0) {
            const [picked] = actor.library.splice(idx, 1);
            actor.hand.push(picked);
            notes.push(`added ${picked.name} from top`);
          }
        }
        break;
      }
      case 'GRANT_KEYWORD':
      case 'ADD_SELF_TO_HAND':
      case 'DEPLOY_SELF':
      case 'FREEZE':
      case 'CANT_ATTACK':
      case 'ALLOW_ATTACK_ACTIVE':
      case 'DAMAGE_PROOF':
      case 'COST_REDUCTION':
      case 'REVEAL_TOP':
      case 'RETURN_TO_DECK':
        break;
      default:
        notes.push(`Manual resolution required: ${clause.raw}`);
    }
  }

  return notes;
}

function resolveClausesForTiming(
  state: SandboxMatchState,
  side: SandboxSide,
  card: GundamCardPrint,
  timing: EffectTiming,
  selfUnit?: SandboxUnitInstance,
  targetInstanceId?: string,
  destroyedByBattle = false
): string[] {
  const parsed = parseCardEffects(card);
  const notes: string[] = [];
  for (const clause of parsed.clauses) {
    if (!clause.timings.includes(timing)) continue;
    notes.push(...resolveClause(state, side, clause, card, selfUnit, targetInstanceId, destroyedByBattle));
  }
  return notes;
}

function resolveStartOfTurn(next: SandboxMatchState, side: SandboxSide) {
  const player = next.players[side];
  if (side === next.firstSide) {
    next.turn += 1;
  }
  if (player.resourcesTotal < 10) {
    player.resourcesTotal += 1;
  }
  player.resourcesActive = player.resourcesTotal;
  for (const u of player.battleArea) {
    u.rested = false;
    u.apBuff = 0;
  }
  if (player.library.length > 0) {
    const drawn = player.library.shift();
    if (drawn) player.hand.push(drawn);
  } else {
    next.winner = side === 'A' ? 'B' : 'A';
  }
}

export function canPayCard(player: SandboxPlayerState, card: GundamCardPrint): boolean {
  const lvReq = card.lv ?? 1;
  const costReq = card.cost ?? 0;
  return player.resourcesTotal >= lvReq && player.resourcesActive >= costReq;
}

export function canUnitAttack(unit: SandboxUnitInstance, currentTurn: number): boolean {
  if (unit.rested || effectiveAp(unit) <= 0) return false;
  if (unit.summonedTurn === currentTurn && !unit.isLinked) return false;
  return true;
}

export function canActivateUnitMain(state: SandboxMatchState, side: SandboxSide, unit: SandboxUnitInstance): boolean {
  const player = state.players[side];
  const parsed = parseCardEffects(unit.card);
  const clause = parsed.clauses.find((c) => c.timings.includes('ACTIVATE_MAIN'));
  if (!clause || clause.unparsedResidual) return false;
  if (clause.oncePerTurn && unit.activatedMainTurn === state.turn) return false;
  if (!canPayActivationCost(player, clause.cost, unit)) return false;
  if (!checkCondition(clause.condition, state, side, unit)) return false;

  const freesSlot = Boolean(clause.cost?.returnSelfToDeckBottom || clause.cost?.destroySelf);
  for (const step of clause.steps) {
    if (step.action === 'DEPLOY_FROM_TRASH') {
      if (player.battleArea.length - (freesSlot ? 1 : 0) >= 6) return false;
      const resAfterCost = player.resourcesActive - (clause.cost?.resourceCost ?? 0);
      const hasValid = player.trash.some(
        (c) => matchesCardSelector(c, step.target) && (step.free || resAfterCost >= (c.cost ?? 0))
      );
      if (!hasValid) return false;
    } else if (step.action === 'ADD_FROM_TRASH_TO_HAND') {
      if (!player.trash.some((c) => matchesCardSelector(c, step.target))) return false;
    }
  }
  return true;
}

export function applySandboxMove(
  state: SandboxMatchState,
  move: SandboxMoveSuggestion
): SandboxMatchState {
  if (state.winner) return state;

  const next = cloneState(state);
  const side = next.activeSide;
  const oppSide: SandboxSide = side === 'A' ? 'B' : 'A';
  const player = next.players[side];
  const opponent = next.players[oppSide];
  let summary = move.title;

  if (move.actionType === 'DEPLOY_UNIT' && move.card) {
    const handIdx = player.hand.findIndex((c) => c.printId === move.card!.printId);
    if (handIdx !== -1 && canPayCard(player, move.card) && player.battleArea.length < 6) {
      const [card] = player.hand.splice(handIdx, 1);
      player.resourcesActive -= card.cost ?? 0;
      const instance: SandboxUnitInstance = {
        instanceId: `unit-${side}-${next.turn}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        card,
        pairedPilot: null,
        isLinked: false,
        rested: false,
        damage: 0,
        apBuff: 0,
        summonedTurn: next.turn,
        deployedFromZone: 'hand',
      };
      player.battleArea.push(instance);
      const effNotes = resolveClausesForTiming(next, side, card, 'DEPLOY', instance, move.targetInstanceId);
      summary = `Deployed ${card.name} (${card.apRaw}/${card.hpRaw}, C${card.cost ?? 0})${
        effNotes.length > 0 ? ` — ${effNotes.join(', ')}` : ''
      }.`;
    }
  } else if (move.actionType === 'PAIR_PILOT' && move.card && move.unitInstanceId) {
    const handIdx = player.hand.findIndex((c) => c.printId === move.card!.printId);
    const unit = player.battleArea.find((u) => u.instanceId === move.unitInstanceId);
    if (handIdx !== -1 && unit && !unit.pairedPilot && canPayCard(player, move.card)) {
      const [pilot] = player.hand.splice(handIdx, 1);
      player.resourcesActive -= pilot.cost ?? 0;
      unit.pairedPilot = pilot;
      unit.isLinked = doesPilotLinkUnit(pilot, unit.card);
      const effNotes = [
        ...resolveClausesForTiming(next, side, pilot, 'WHEN_PAIRED', unit, move.targetInstanceId),
        ...resolveClausesForTiming(next, side, unit.card, 'WHEN_PAIRED', unit, move.targetInstanceId),
        ...(unit.isLinked
          ? [
              ...resolveClausesForTiming(next, side, pilot, 'WHEN_LINKED', unit, move.targetInstanceId),
              ...resolveClausesForTiming(next, side, unit.card, 'WHEN_LINKED', unit, move.targetInstanceId),
            ]
          : []),
      ];
      summary = `${unit.isLinked ? 'Linked' : 'Paired'} ${pilot.name} onto ${unit.card.name} (${effectiveAp(
        unit
      )}/${effectiveRemainingHp(unit)})${effNotes.length > 0 ? ` — ${effNotes.join(', ')}` : ''}.`;
    }
  } else if (move.actionType === 'DEPLOY_BASE' && move.card) {
    const handIdx = player.hand.findIndex((c) => c.printId === move.card!.printId);
    if (handIdx !== -1 && canPayCard(player, move.card)) {
      const [baseCard] = player.hand.splice(handIdx, 1);
      player.resourcesActive -= baseCard.cost ?? 0;
      if (player.base) player.trash.push(player.base);
      player.base = baseCard;
      player.baseDamage = 0;
      const effNotes = resolveClausesForTiming(next, side, baseCard, 'DEPLOY', undefined, move.targetInstanceId);
      summary = `Deployed Base ${baseCard.name} (HP ${baseCard.hp ?? 5})${
        effNotes.length > 0 ? ` — ${effNotes.join(', ')}` : ''
      }.`;
    }
  } else if (move.actionType === 'PLAY_COMMAND' && move.card) {
    const handIdx = player.hand.findIndex((c) => c.printId === move.card!.printId);
    if (handIdx !== -1 && canPayCard(player, move.card)) {
      const [cmd] = player.hand.splice(handIdx, 1);
      player.resourcesActive -= cmd.cost ?? 0;
      player.trash.push(cmd);
      const effNotes = resolveClausesForTiming(next, side, cmd, 'MAIN', undefined, move.targetInstanceId);
      summary = `Played Command ${cmd.name}${effNotes.length > 0 ? ` — ${effNotes.join(', ')}` : ''}.`;
    }
  } else if (move.actionType === 'ACTIVATE_MAIN' && move.unitInstanceId) {
    const unit = player.battleArea.find((u) => u.instanceId === move.unitInstanceId);
    if (unit && canActivateUnitMain(next, side, unit)) {
      const parsed = parseCardEffects(unit.card);
      const clause = parsed.clauses.find((c) => c.timings.includes('ACTIVATE_MAIN'));
      if (clause) {
        unit.activatedMainTurn = next.turn;
        payActivationCost(next, side, clause.cost, unit);
        const effNotes = resolveClause(next, side, clause, unit.card, unit, move.targetInstanceId);
        summary = `Activated ${unit.card.name}${effNotes.length > 0 ? ` — ${effNotes.join(', ')}` : ''}.`;
      }
    }
  } else if (move.actionType === 'ATTACK_SHIELD' && move.unitInstanceId) {
    const attacker = player.battleArea.find((u) => u.instanceId === move.unitInstanceId);
    if (attacker && canUnitAttack(attacker, next.turn)) {
      attacker.rested = true;
      resolveClausesForTiming(next, side, attacker.card, 'ATTACK', attacker, move.targetInstanceId);
      if (attacker.pairedPilot) {
        resolveClausesForTiming(next, side, attacker.pairedPilot, 'ATTACK', attacker, move.targetInstanceId);
      }

      const highManeuver = unitHasKeyword(attacker, 'High-Maneuver', next, side);
      const blocker = !highManeuver
        ? opponent.battleArea.find((u) => !u.rested && unitHasKeyword(u, 'Blocker', next, oppSide))
        : undefined;

      if (blocker) {
        blocker.rested = true;
        const atkAp = effectiveAp(attacker);
        const blkAp = effectiveAp(blocker);
        const firstStrike = unitHasKeyword(attacker, 'First Strike', next, side);

        blocker.damage += atkAp;
        const blkDied = effectiveRemainingHp(blocker) <= 0;
        if (blkDied) {
          destroyUnit(next, oppSide, blocker.instanceId, true);
          if (unitHasKeyword(attacker, 'Breach', next, side) && opponent.shields > 0) {
            opponent.shields = Math.max(0, opponent.shields - 1);
          }
        }
        if (!(firstStrike && blkDied)) {
          attacker.damage += blkAp;
          if (effectiveRemainingHp(attacker) <= 0) {
            destroyUnit(next, side, attacker.instanceId, true);
          }
        }
        summary = `${attacker.card.name} attacked Shields, intercepted by <Blocker> ${blocker.card.name}.`;
      } else if (opponent.base) {
        const baseMax = opponent.base.hp ?? 5;
        opponent.baseDamage += effectiveAp(attacker);
        if (opponent.baseDamage >= baseMax) {
          const destroyedName = opponent.base.name;
          opponent.trash.push(opponent.base);
          opponent.base = null;
          opponent.baseDamage = 0;
          summary = `${attacker.card.name} destroyed Base ${destroyedName}!`;
        } else {
          summary = `${attacker.card.name} dealt ${effectiveAp(attacker)} damage to Base ${opponent.base.name}.`;
        }
      } else if (opponent.shields > 0) {
        const shieldHit = unitHasKeyword(attacker, 'Suppression', next, side) ? 2 : 1;
        opponent.shields = Math.max(0, opponent.shields - shieldHit);
        summary = `${attacker.card.name} (${effectiveAp(attacker)} AP) broke ${shieldHit} Shield(s) (${opponent.shields} left).`;
      } else {
        next.winner = side;
        summary = `${attacker.card.name} landed a direct lethal hit with 0 Shields remaining — Side ${side} wins!`;
      }
    }
  } else if (move.actionType === 'ATTACK_UNIT' && move.unitInstanceId && move.targetInstanceId) {
    const attacker = player.battleArea.find((u) => u.instanceId === move.unitInstanceId);
    const defender = opponent.battleArea.find((u) => u.instanceId === move.targetInstanceId);
    if (attacker && defender && canUnitAttack(attacker, next.turn) && defender.rested) {
      attacker.rested = true;
      resolveClausesForTiming(next, side, attacker.card, 'ATTACK', attacker, defender.instanceId);
      if (attacker.pairedPilot) {
        resolveClausesForTiming(next, side, attacker.pairedPilot, 'ATTACK', attacker, defender.instanceId);
      }

      const atkAp = effectiveAp(attacker);
      const defAp = effectiveAp(defender);
      const firstStrike = unitHasKeyword(attacker, 'First Strike', next, side);

      defender.damage += atkAp;
      const defDied = effectiveRemainingHp(defender) <= 0;
      if (defDied) {
        destroyUnit(next, oppSide, defender.instanceId, true);
        if (unitHasKeyword(attacker, 'Breach', next, side) && opponent.shields > 0) {
          opponent.shields = Math.max(0, opponent.shields - 1);
        }
      }
      if (!(firstStrike && defDied)) {
        attacker.damage += defAp;
        if (effectiveRemainingHp(attacker) <= 0) {
          destroyUnit(next, side, attacker.instanceId, true);
        }
      }
      summary = `${attacker.card.name} battled ${defender.card.name} (${
        defDied ? 'defender destroyed' : 'damaged'
      }).`;
    }
  } else if (move.actionType === 'PASS_TURN') {
    const repaired: string[] = [];
    for (const u of player.battleArea) {
      const repairAmt = unitKeywordValue(u, 'Repair', next, side);
      if (u.damage > 0 && repairAmt !== null) {
        u.damage = Math.max(0, u.damage - repairAmt);
        repaired.push(`${u.card.name} +${repairAmt} HP`);
      }
    }
    summary = `Ended Turn ${next.turn}${repaired.length > 0 ? ` (<Repair>: ${repaired.join(', ')})` : ''}.`;
    next.lastOpponentAction = `Side ${side} ${summary}`;
    next.activeSide = oppSide;
    resolveStartOfTurn(next, oppSide);
  }

  if (move.actionType !== 'PASS_TURN') {
    next.lastOpponentAction = `Side ${side}: ${summary}`;
  }

  next.log = [
    {
      id: `log-${next.turn}-${next.log.length}-${Date.now()}`,
      turn: state.turn,
      side,
      summary,
    },
    ...next.log.slice(0, 39),
  ];

  return next;
}

function estimateBoardWinScore(state: SandboxMatchState, perspective: SandboxSide): number {
  const me = state.players[perspective];
  const oppSide: SandboxSide = perspective === 'A' ? 'B' : 'A';
  const opp = state.players[oppSide];

  const unitScore = (u: SandboxUnitInstance, s: SandboxSide) =>
    effectiveAp(u) * 2.2 +
    effectiveRemainingHp(u) * 1.8 +
    (u.isLinked ? 3 : 0) +
    (unitHasKeyword(u, 'Blocker', state, s) ? 2.5 : 0);

  const myBoard = me.battleArea.reduce((s, u) => s + unitScore(u, perspective), 0);
  const oppBoard = opp.battleArea.reduce((s, u) => s + unitScore(u, oppSide), 0);
  const shieldDiff = (me.shields - opp.shields) * 7.5;
  const handDiff = (me.hand.length - opp.hand.length) * 3.2;
  const baseDiff = (me.base ? 4 : 0) - (opp.base ? 4 : 0);

  return Math.max(8, Math.min(94, Math.round(50 + shieldDiff + (myBoard - oppBoard) * 0.9 + handDiff + baseDiff)));
}

export function evaluateSandboxBestMoves(
  state: SandboxMatchState,
  side: SandboxSide
): SandboxMoveSuggestion[] {
  if (state.winner) return [];
  const player = state.players[side];
  const oppSide: SandboxSide = side === 'A' ? 'B' : 'A';
  const opponent = state.players[oppSide];
  const baseWin = estimateBoardWinScore(state, side);
  const candidates: Omit<SandboxMoveSuggestion, 'rank'>[] = [];

  // 1. Evaluate deploying Units, pairing Pilots, Commands, Bases from hand
  const seenCardNos = new Set<string>();
  for (const card of player.hand) {
    if (seenCardNos.has(card.cardNo)) continue;
    seenCardNos.add(card.cardNo);
    if (!canPayCard(player, card)) continue;

    if (card.type === 'UNIT' && player.battleArea.length < 6) {
      const sig = scoreSingleCardSignals(card);
      const matchingPilotInHand = player.hand.some(
        (p) => p.type === 'PILOT' && doesPilotLinkUnit(p, card)
      );
      const statScore = (card.ap ?? 2) * 3 + (card.hp ?? 2) * 2.5;
      let score = 55 + statScore + (card.cost ?? 1) * 4;
      const reasonParts: string[] = [];

      if (player.battleArea.length === 0) {
        score += 18;
        reasonParts.push('Establishes board presence with Lv./Cost curve on time');
      }
      if (sig.hasBlocker && opponent.battleArea.length > 0) {
        score += 16;
        reasonParts.push('<Blocker> walls opposing attackers');
      }
      if (matchingPilotInHand) {
        score += 15;
        reasonParts.push('Prepares immediate [Link] Pilot pairing');
      }
      if (opponent.battleArea.some((u) => !u.rested) && sig.hasRest) {
        score += 12;
        reasonParts.push('Creates Rest disruption');
      }
      candidates.push({
        id: `deploy-${card.printId}`,
        actionType: 'DEPLOY_UNIT',
        title: `Deploy ${card.name} (C${card.cost ?? 0})`,
        reason:
          reasonParts.join('; ') ||
          `Adds ${card.apRaw}/${card.hpRaw} Unit pressure (${state.lastOpponentAction.slice(0, 48)})`,
        winDeltaPct: Math.min(18, Math.max(2, Math.round((score - 50) * 0.25))),
        priorityScore: score,
        card,
      });
    }

    if (card.type === 'PILOT') {
      for (const unit of player.battleArea) {
        if (unit.pairedPilot) continue;
        const links = doesPilotLinkUnit(card, unit.card);
        let score = links ? 86 : 52;
        if (links && unit.summonedTurn === state.turn) {
          score += 14;
        }
        const newAp = effectiveAp(unit) + (card.ap ?? 1);
        candidates.push({
          id: `pair-${card.printId}-${unit.instanceId}`,
          actionType: 'PAIR_PILOT',
          title: `${links ? 'Link' : 'Pair'} ${card.name} → ${unit.card.name}`,
          reason: links
            ? `Activates [Link] (${unit.card.link}) for ${newAp} AP immediate attack & 【When Linked】 value.`
            : `Buffs ${unit.card.name} to ${newAp} AP for stronger favorable trades.`,
          winDeltaPct: links ? 11 : 4,
          priorityScore: score,
          card,
          unitInstanceId: unit.instanceId,
        });
      }
    }

    if (card.type === 'COMMAND') {
      const legalTargets = getLegalTargetOptions(state, side, card, 'MAIN');
      const bestTarget = [...legalTargets].sort((a, b) => effectiveAp(b) - effectiveAp(a))[0];
      const sig = scoreSingleCardSignals(card);
      let score = 48;
      let reason = `Applies ${sig.effectStyles.join(' / ') || 'tactical'} effect.`;
      if (bestTarget) {
        score += 32 + effectiveAp(bestTarget) * 3;
        reason = `Answers opponent's ${bestTarget.card.name} (${effectiveAp(bestTarget)}/${effectiveRemainingHp(bestTarget)}).`;
      } else if (sig.hasDraw || sig.hasSearch || sig.hasRamp) {
        score += 24;
        reason = `Builds hand liquidity or Resource curve advantage without risking board tempo.`;
      }
      candidates.push({
        id: `cmd-${card.printId}`,
        actionType: 'PLAY_COMMAND',
        title: `Play ${card.name} (C${card.cost ?? 0})`,
        reason,
        winDeltaPct: Math.max(2, Math.round((score - 45) * 0.22)),
        priorityScore: score,
        card,
        targetInstanceId: bestTarget?.instanceId,
      });
    }

    if (card.type === 'BASE' && !player.base) {
      const incomingThreat = opponent.battleArea.reduce((s, u) => s + effectiveAp(u), 0);
      const score = 58 + (opponent.shields <= 3 || incomingThreat >= 5 ? 18 : 6);
      candidates.push({
        id: `base-${card.printId}`,
        actionType: 'DEPLOY_BASE',
        title: `Deploy Base ${card.name}`,
        reason: `Shields your remaining ${player.shields} Shield(s) behind ${card.hp ?? 5} Base HP.`,
        winDeltaPct: 5,
        priorityScore: score,
        card,
      });
    }
  }

  // 2. Evaluate Battle Area 【Activate･Main】 abilities (e.g. ST09-001 -> ST09-006 from trash)
  for (const unit of player.battleArea) {
    if (!canActivateUnitMain(state, side, unit)) continue;

    candidates.push({
      id: `act-${unit.instanceId}`,
      actionType: 'ACTIVATE_MAIN',
      title: `Activate ${unit.card.name}`,
      reason: `Triggers 【Activate･Main】 on ${unit.card.name} for board tempo/recursion.`,
      winDeltaPct: 9,
      priorityScore: 84,
      card: unit.card,
      unitInstanceId: unit.instanceId,
    });
  }

  // 3. Evaluate Attacks (Shields vs Rested Enemy Units)
  for (const unit of player.battleArea) {
    if (!canUnitAttack(unit, state.turn)) continue;
    const myAp = effectiveAp(unit);
    const myHp = effectiveRemainingHp(unit);
    const highManeuver = unitHasKeyword(unit, 'High-Maneuver', state, side);
    const oppBlocker = !highManeuver
      ? opponent.battleArea.find((u) => !u.rested && unitHasKeyword(u, 'Blocker', state, oppSide))
      : undefined;

    const isLethal = opponent.shields === 0 && !opponent.base && !oppBlocker;
    const shieldScore = isLethal
      ? 120
      : oppBlocker && effectiveAp(oppBlocker) >= myHp && !unitHasKeyword(unit, 'First Strike', state, side)
      ? 42
      : 74 + (unit.isLinked ? 6 : 0) + (highManeuver ? 8 : 0);

    candidates.push({
      id: `atk-shield-${unit.instanceId}`,
      actionType: 'ATTACK_SHIELD',
      title: isLethal
        ? `Lethal Attack with ${unit.card.name}!`
        : `Attack ${opponent.base ? 'Base' : 'Shield'} with ${unit.card.name} (${myAp} AP)`,
      reason: isLethal
        ? `0 Shields and no active <Blocker> — wins the game immediately.`
        : oppBlocker
        ? `Forces trade or burn past <Blocker> ${oppBlocker.card.name}.`
        : `Pressures opponent down to ${Math.max(0, opponent.shields - 1)} Shield(s).`,
      winDeltaPct: isLethal ? Math.max(10, 99 - baseWin) : 7,
      priorityScore: shieldScore,
      unitInstanceId: unit.instanceId,
    });

    for (const enemy of opponent.battleArea) {
      if (!enemy.rested) continue;
      const eAp = effectiveAp(enemy);
      const eHp = effectiveRemainingHp(enemy);
      if (myAp < eHp) continue;
      const survives = unitHasKeyword(unit, 'First Strike', state, side) || myHp > eAp;
      const hasBreach = unitHasKeyword(unit, 'Breach', state, side);
      const tradeScore = (survives ? 82 : 60) + (enemy.isLinked ? 10 : 0) + (hasBreach ? 10 : 0);

      candidates.push({
        id: `atk-unit-${unit.instanceId}-${enemy.instanceId}`,
        actionType: 'ATTACK_UNIT',
        title: `${unit.card.name} attacks rested ${enemy.card.name}`,
        reason: `${survives ? 'Clean value trade' : '1-for-1 trade'} removing ${eAp} AP threat${
          hasBreach ? ' + <Breach> Shield damage' : ''
        }.`,
        winDeltaPct: survives ? 9 : 4,
        priorityScore: tradeScore,
        unitInstanceId: unit.instanceId,
        targetInstanceId: enemy.instanceId,
      });
    }
  }

  candidates.push({
    id: `pass-${side}-${state.turn}`,
    actionType: 'PASS_TURN',
    title: `End Turn ${state.turn}`,
    reason: `Hold remaining ${player.resourcesActive} active Resource(s) and pass to Side ${oppSide}.`,
    winDeltaPct: 0,
    priorityScore: 25,
  });

  candidates.sort((a, b) => b.priorityScore - a.priorityScore);
  return candidates.slice(0, 3).map((c, idx) => ({
    ...c,
    rank: (idx + 1) as 1 | 2 | 3,
  }));
}

export function stepSandboxBot(state: SandboxMatchState): SandboxMatchState {
  if (state.winner) return state;
  const suggestions = evaluateSandboxBestMoves(state, state.activeSide);
  const best = suggestions[0];
  if (!best) return state;
  return applySandboxMove(state, best);
}
