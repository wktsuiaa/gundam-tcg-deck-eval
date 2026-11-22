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
import { detectEffectStyles, expandEntries, scoreSingleCardSignals } from '@/lib/deck-engine';

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

function hasKeyword(card: GundamCardPrint, tag: string): boolean {
  return (card.effect || '').toLowerCase().includes(tag.toLowerCase());
}

function unitHasKeyword(u: SandboxUnitInstance, tag: string): boolean {
  return (
    hasKeyword(u.card, tag) ||
    (u.pairedPilot ? hasKeyword(u.pairedPilot, tag) : false)
  );
}

function extractKeywordNumber(effect: string, tag: string, fallback = 1): number {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = effect.match(new RegExp(`${escaped}\\s*(\\d+)`, 'i'));
  return m ? parseInt(m[1], 10) : fallback;
}

function buildPlayerState(
  side: SandboxSide,
  deck: SavedDeck,
  isSecond: boolean,
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
  // First player starts Turn 1 with 1 active Resource; second player gets 1 EX Resource baseline so on their Turn 1 they reach 2
  const resourcesTotal = isSecond ? 1 : 1;

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
  const playerA = buildPlayerState('A', deckA, firstSide !== 'A', byPrintId, byCardNo);
  const playerB = buildPlayerState('B', deckB, firstSide !== 'B', byPrintId, byCardNo);

  return {
    turn: 1,
    activeSide: firstSide,
    firstSide,
    phase: 'MAIN',
    winner: null,
    lastOpponentAction: `${firstSide === 'A' ? deckA.name : deckB.name} won the toss and goes first (5 cards, 6 Shields).`,
    players: {
      A: playerA,
      B: playerB,
    },
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

function destroyUnit(owner: SandboxPlayerState, instanceId: string): SandboxUnitInstance | null {
  const idx = owner.battleArea.findIndex((u) => u.instanceId === instanceId);
  if (idx === -1) return null;
  const [removed] = owner.battleArea.splice(idx, 1);
  owner.trash.push(removed.card);
  if (removed.pairedPilot) owner.trash.push(removed.pairedPilot);
  return removed;
}

function applyCardEffectStyles(
  actor: SandboxPlayerState,
  opponent: SandboxPlayerState,
  card: GundamCardPrint,
  targetInstanceId?: string
): string[] {
  const notes: string[] = [];
  const styles = detectEffectStyles(card);

  if (styles.includes('Draw & Search') && actor.library.length > 0) {
    const drawn = actor.library.shift();
    if (drawn) {
      actor.hand.push(drawn);
      notes.push(`drew ${drawn.name}`);
    }
  }

  if (styles.includes('Resource Ramp') && actor.resourcesTotal < 10) {
    actor.resourcesTotal += 1;
    actor.resourcesActive += 1;
    notes.push('+1 EX Resource');
  }

  if (styles.includes('Token Deploy') && actor.battleArea.length < 6) {
    const tokenCard: GundamCardPrint = {
      ...card,
      printId: `TOKEN-${card.printId}-${Date.now()}`,
      cardNo: 'TOKEN',
      name: `${card.traits[0] ?? 'Mobile Suit'} Token`,
      type: 'UNIT',
      lv: 1,
      cost: 1,
      ap: 2,
      hp: 2,
      apRaw: '2',
      hpRaw: '2',
      effect: '',
      link: '',
    };
    actor.battleArea.push({
      instanceId: `unit-tok-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      card: tokenCard,
      pairedPilot: null,
      isLinked: false,
      rested: false,
      damage: 0,
      apBuff: 0,
      summonedTurn: 0,
    });
    notes.push('deployed 2/2 Unit Token');
  }

  const target =
    (targetInstanceId
      ? opponent.battleArea.find((u) => u.instanceId === targetInstanceId)
      : undefined) ??
    [...opponent.battleArea].sort((a, b) => effectiveAp(b) - effectiveAp(a))[0];

  if (!target) return notes;

  if (styles.includes('Destroy')) {
    const hp = effectiveRemainingHp(target);
    if (hp <= 5 || card.type === 'COMMAND') {
      destroyUnit(opponent, target.instanceId);
      notes.push(`destroyed ${target.card.name}`);
      return notes;
    }
  }

  if (styles.includes('Bounce')) {
    const idx = opponent.battleArea.findIndex((u) => u.instanceId === target.instanceId);
    if (idx !== -1) {
      const [bounced] = opponent.battleArea.splice(idx, 1);
      opponent.hand.push(bounced.card);
      if (bounced.pairedPilot) opponent.hand.push(bounced.pairedPilot);
      notes.push(`bounced ${bounced.card.name} to hand`);
      return notes;
    }
  }

  if (styles.includes('Rest Lock') && !target.rested) {
    target.rested = true;
    notes.push(`rested ${target.card.name}`);
  }

  if (styles.includes('AP Deduction')) {
    target.apBuff -= 2;
    notes.push(`applied -2 AP to ${target.card.name}`);
  }

  if (styles.includes('Direct Damage')) {
    target.damage += 2;
    notes.push(`dealt 2 damage to ${target.card.name}`);
    if (effectiveRemainingHp(target) <= 0) {
      destroyUnit(opponent, target.instanceId);
      notes.push(`${target.card.name} destroyed`);
    }
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
      };
      player.battleArea.push(instance);
      const effNotes = hasKeyword(card, '【Deploy】')
        ? applyCardEffectStyles(player, opponent, card, move.targetInstanceId)
        : [];
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
      const effNotes = applyCardEffectStyles(player, opponent, pilot, move.targetInstanceId);
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
      summary = `Deployed Base ${baseCard.name} (HP ${baseCard.hp ?? 5}).`;
    }
  } else if (move.actionType === 'PLAY_COMMAND' && move.card) {
    const handIdx = player.hand.findIndex((c) => c.printId === move.card!.printId);
    if (handIdx !== -1 && canPayCard(player, move.card)) {
      const [cmd] = player.hand.splice(handIdx, 1);
      player.resourcesActive -= cmd.cost ?? 0;
      player.trash.push(cmd);
      const effNotes = applyCardEffectStyles(player, opponent, cmd, move.targetInstanceId);
      summary = `Played Command ${cmd.name}${effNotes.length > 0 ? ` — ${effNotes.join(', ')}` : ''}.`;
    }
  } else if (move.actionType === 'ATTACK_SHIELD' && move.unitInstanceId) {
    const attacker = player.battleArea.find((u) => u.instanceId === move.unitInstanceId);
    if (attacker && canUnitAttack(attacker, next.turn)) {
      attacker.rested = true;
      const highManeuver = unitHasKeyword(attacker, '<High-Maneuver');
      const blocker = !highManeuver
        ? opponent.battleArea.find((u) => !u.rested && unitHasKeyword(u, '<Blocker'))
        : undefined;

      if (blocker) {
        // Redirect combat into Blocker
        blocker.rested = true;
        const atkAp = effectiveAp(attacker);
        const blkAp = effectiveAp(blocker);
        const firstStrike = unitHasKeyword(attacker, '<First Strike');

        blocker.damage += atkAp;
        const blkDied = effectiveRemainingHp(blocker) <= 0;
        if (blkDied) {
          destroyUnit(opponent, blocker.instanceId);
          if (unitHasKeyword(attacker, '<Breach') && opponent.shields > 0) {
            opponent.shields = Math.max(0, opponent.shields - 1);
          }
        }
        if (!(firstStrike && blkDied)) {
          attacker.damage += blkAp;
          if (effectiveRemainingHp(attacker) <= 0) {
            destroyUnit(player, attacker.instanceId);
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
        opponent.shields -= 1;
        summary = `${attacker.card.name} (${effectiveAp(attacker)} AP) broke 1 Shield (${opponent.shields} left).`;
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
      const atkAp = effectiveAp(attacker);
      const defAp = effectiveAp(defender);
      const firstStrike = unitHasKeyword(attacker, '<First Strike');

      defender.damage += atkAp;
      const defDied = effectiveRemainingHp(defender) <= 0;
      if (defDied) {
        destroyUnit(opponent, defender.instanceId);
        if (unitHasKeyword(attacker, '<Breach') && opponent.shields > 0) {
          opponent.shields = Math.max(0, opponent.shields - 1);
        }
      }
      if (!(firstStrike && defDied)) {
        attacker.damage += defAp;
        if (effectiveRemainingHp(attacker) <= 0) {
          destroyUnit(player, attacker.instanceId);
        }
      }
      summary = `${attacker.card.name} battled ${defender.card.name} (${
        defDied ? 'defender destroyed' : 'damaged'
      }).`;
    }
  } else if (move.actionType === 'PASS_TURN') {
    // End of turn Repair triggers
    const repaired: string[] = [];
    for (const u of player.battleArea) {
      if (u.damage > 0 && unitHasKeyword(u, '<Repair')) {
        const amt = extractKeywordNumber(u.card.effect || '', '<Repair', 1);
        u.damage = Math.max(0, u.damage - amt);
        repaired.push(`${u.card.name} +${amt} HP`);
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
  const opp = state.players[perspective === 'A' ? 'B' : 'A'];

  const unitScore = (u: SandboxUnitInstance) =>
    effectiveAp(u) * 2.2 +
    effectiveRemainingHp(u) * 1.8 +
    (u.isLinked ? 3 : 0) +
    (unitHasKeyword(u, '<Blocker') ? 2.5 : 0);

  const myBoard = me.battleArea.reduce((s, u) => s + unitScore(u), 0);
  const oppBoard = opp.battleArea.reduce((s, u) => s + unitScore(u), 0);
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
  const opponent = state.players[side === 'A' ? 'B' : 'A'];
  const baseWin = estimateBoardWinScore(state, side);
  const candidates: Omit<SandboxMoveSuggestion, 'rank'>[] = [];

  // 1. Evaluate deploying Units from hand
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

    // 2. Evaluate pairing Pilots onto existing Battle Area Units
    if (card.type === 'PILOT') {
      for (const unit of player.battleArea) {
        if (unit.pairedPilot) continue;
        const links = doesPilotLinkUnit(card, unit.card);
        let score = links ? 86 : 52;
        if (links && unit.summonedTurn === state.turn) {
          score += 14; // grants immediate attack haste!
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

    // 3. Evaluate Commands
    if (card.type === 'COMMAND') {
      const styles = detectEffectStyles(card);
      const bestTarget = [...opponent.battleArea].sort((a, b) => effectiveAp(b) - effectiveAp(a))[0];
      let score = 48;
      let reason = `Applies ${styles.join(' / ') || 'tactical'} effect.`;
      if ((styles.includes('Destroy') || styles.includes('Bounce') || styles.includes('Direct Damage') || styles.includes('AP Deduction')) && bestTarget) {
        score += 30 + effectiveAp(bestTarget) * 3;
        reason = `Answers opponent's ${bestTarget.card.name} (${effectiveAp(bestTarget)}/${effectiveRemainingHp(bestTarget)}) using ${styles[0]}.`;
      } else if (styles.includes('Rest Lock') && opponent.battleArea.some((u) => !u.rested)) {
        score += 26;
        reason = `Rests opposing <Blocker> or active defender to open lethal Shield swings.`;
      } else if (styles.includes('Draw & Search') || styles.includes('Resource Ramp')) {
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

    // 4. Evaluate Base deployment
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

  // 5. Evaluate Attacks (Shields vs Rested Enemy Units)
  for (const unit of player.battleArea) {
    if (!canUnitAttack(unit, state.turn)) continue;
    const myAp = effectiveAp(unit);
    const myHp = effectiveRemainingHp(unit);
    const highManeuver = unitHasKeyword(unit, '<High-Maneuver');
    const oppBlocker = !highManeuver
      ? opponent.battleArea.find((u) => !u.rested && unitHasKeyword(u, '<Blocker'))
      : undefined;

    // Attack Shield / Lethal
    const isLethal = opponent.shields === 0 && !opponent.base && !oppBlocker;
    const shieldScore = isLethal
      ? 120
      : oppBlocker && effectiveAp(oppBlocker) >= myHp && !unitHasKeyword(unit, '<First Strike')
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

    // Attack Rested Enemy Units for favorable trade
    for (const enemy of opponent.battleArea) {
      if (!enemy.rested) continue;
      const eAp = effectiveAp(enemy);
      const eHp = effectiveRemainingHp(enemy);
      if (myAp < eHp) continue;
      const survives = unitHasKeyword(unit, '<First Strike') || myHp > eAp;
      const hasBreach = unitHasKeyword(unit, '<Breach');
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

  // Always offer End Turn as fallback / tempo option
  candidates.push({
    id: `pass-${side}-${state.turn}`,
    actionType: 'PASS_TURN',
    title: `End Turn ${state.turn}`,
    reason: `Hold remaining ${player.resourcesActive} active Resource(s) and pass to Side ${
      side === 'A' ? 'B' : 'A'
    }.`,
    winDeltaPct: 0,
    priorityScore: 25,
  });

  candidates.sort((a, b) => b.priorityScore - a.priorityScore);
  const top3 = candidates.slice(0, 3);
  return top3.map((c, idx) => ({
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
