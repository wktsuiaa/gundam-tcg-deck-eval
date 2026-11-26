import type { EffectClauseAst } from '../cfg-parser.ts';
import { CombatRunner } from './combat-runner';
import { evaluateCondition } from './conditions';
import { evaluateUnitEffectiveState } from './effective-state';
import { ChainFailError, QueuedTrigger } from './runner-support';
import { findUnitById, getCardAbilities, isUnitLinked, oppositeSide } from './state-helpers';
import { ChainSide, ChainUnitInstance, PlayerAction } from './types';

export class VerifierRunner extends CombatRunner {
  public executeAction(action: PlayerAction): void {
    if (action.side !== this.state.activeSide && action.type !== 'PASS_TURN') {
      throw new ChainFailError('NOT_ACTIVE_PLAYER', `Side ${action.side} is not active.`);
    }

    if (action.type === 'PASS_TURN') {
      this.endTurn();
      return;
    }

    if (this.state.phase !== 'MAIN') {
      throw new ChainFailError('WRONG_PHASE', `Cannot execute ${action.type} during ${this.state.phase}.`);
    }

    switch (action.type) {
      case 'DEPLOY_UNIT':
        this.doDeployUnit(action.side, action.handIndex);
        break;
      case 'DEPLOY_BASE':
        this.doDeployBase(action.side, action.handIndex);
        break;
      case 'PAIR_PILOT':
        this.doPairPilot(action.side, action.handIndex, action.targetUnitId);
        break;
      case 'PLAY_COMMAND':
        this.doPlayCommand(action.side, action.handIndex);
        break;
      case 'ACTIVATE_ABILITY':
        this.doActivateAbility(action.side, action.sourceId, action.clauseIndex);
        break;
      case 'ATTACK_SHIELD':
        this.doAttack(action.side, action.attackerId, 'SHIELD');
        break;
      case 'ATTACK_UNIT':
        this.doAttack(action.side, action.attackerId, 'UNIT', action.targetId);
        break;
    }
  }

  protected doDeployUnit(side: ChainSide, handIndex: number): void {
    const player = this.state.players[side];
    const card = player.hand[handIndex];
    if (!card || card.type !== 'UNIT') {
      throw new ChainFailError('INVALID_ACTION', `Hand index ${handIndex} is not a UNIT.`);
    }

    this.payLvAndCost(side, card);
    player.hand.splice(handIndex, 1);

    // 6-Unit Battle Area limit: displacing an existing Unit places it into Trash WITHOUT destruction triggers
    if (player.battleArea.length >= 6) {
      const replaceId = this.witness.nextZoneReplacement();
      if (!replaceId) {
        throw new ChainFailError(
          'MISSING_WITNESS',
          'Battle Area has 6 Units; ChainWitness.zoneReplacements must select a Unit to displace.'
        );
      }
      const idx = player.battleArea.findIndex((u) => u.instanceId === replaceId);
      if (idx < 0) {
        throw new ChainFailError('INVALID_TARGET', `Displaced Unit ${replaceId} not found.`);
      }
      const [displaced] = player.battleArea.splice(idx, 1);
      player.trash.push(displaced.card);
      if (displaced.pairedPilot) player.trash.push(displaced.pairedPilot);
      this.trace.push({
        kind: 'ACTION',
        detail: `Displaced ${displaced.card.cardNo} to Trash (not destroyed)`,
      });
    }

    const instance: ChainUnitInstance = {
      instanceId: `${side}-U-${this.nextEventId('unit')}`,
      card,
      rested: false,
      damage: 0,
      deployedTurn: this.state.turn,
      deployedFromZone: 'hand',
      temporaryModifiers: [],
      triggeredOnceThisTurn: [],
    };
    player.battleArea.push(instance);
    this.trace.push({ kind: 'ACTION', detail: `${side} deployed ${card.cardNo}` });

    const frame: QueuedTrigger[] = [];
    this.collectUnitTimingTriggers(side, instance, 'DEPLOY', frame);
    this.collectBoardTimingTriggers('WHEN_UNIT_DEPLOYED', frame, side);
    this.drainResolutionFrame(frame);
  }

  protected doDeployBase(side: ChainSide, handIndex: number): void {
    const player = this.state.players[side];
    const card = player.hand[handIndex];
    if (!card || card.type !== 'BASE') {
      throw new ChainFailError('INVALID_ACTION', `Hand index ${handIndex} is not a BASE.`);
    }
    this.payLvAndCost(side, card);
    player.hand.splice(handIndex, 1);
    if (player.base) {
      player.trash.push(player.base.card); // Base displacement is NOT destruction
    }
    player.base = {
      instanceId: `${side}-BASE-${this.nextEventId('base')}`,
      card,
      damage: 0,
      temporaryModifiers: [],
    };
    this.trace.push({ kind: 'ACTION', detail: `${side} deployed Base ${card.cardNo}` });
    const frame: QueuedTrigger[] = [];
    this.collectCardTimingTriggers(side, card, 'DEPLOY', frame);
    this.drainResolutionFrame(frame);
  }

  protected doPairPilot(side: ChainSide, handIndex: number, targetUnitId: string): void {
    const player = this.state.players[side];
    const pilot = player.hand[handIndex];
    if (!pilot) throw new ChainFailError('INVALID_ACTION', `Missing card at hand[${handIndex}].`);
    const isCmdPilot = getCardAbilities(pilot).abilities.some(
      (a) => a.kind === 'CONTINUOUS_MODIFIER' && a.modifier.type === 'GRANT_PILOT_MODE'
    );
    if (pilot.type !== 'PILOT' && !isCmdPilot) {
      throw new ChainFailError('INVALID_ACTION', `${pilot.cardNo} cannot be paired as a Pilot.`);
    }

    const target = player.battleArea.find((u) => u.instanceId === targetUnitId);
    if (!target) throw new ChainFailError('INVALID_TARGET', `Unit ${targetUnitId} not found.`);
    if (target.pairedPilot) throw new ChainFailError('ALREADY_PAIRED', `${targetUnitId} already has a Pilot.`);

    const eff = evaluateUnitEffectiveState(target, this.state, side);
    if (eff.prohibitions.has('CANT_BE_PAIRED')) {
      throw new ChainFailError('PROHIBITED_BY_CANT', `${targetUnitId} cannot be paired.`);
    }

    this.payLvAndCost(side, pilot);
    player.hand.splice(handIndex, 1);
    target.pairedPilot = pilot;
    const linked = isUnitLinked(target);

    this.trace.push({
      kind: 'ACTION',
      detail: `${side} paired ${pilot.cardNo} onto ${target.card.cardNo} (linked=${linked})`,
    });

    const frame: QueuedTrigger[] = [];
    this.collectUnitTimingTriggers(side, target, 'WHEN_PAIRED', frame);
    if (linked) {
      this.collectUnitTimingTriggers(side, target, 'WHEN_LINKED', frame);
    }
    this.drainResolutionFrame(frame);
  }

  protected doPlayCommand(side: ChainSide, handIndex: number): void {
    const player = this.state.players[side];
    const card = player.hand[handIndex];
    if (!card || card.type !== 'COMMAND') {
      throw new ChainFailError('INVALID_ACTION', `Hand index ${handIndex} is not a COMMAND.`);
    }

    const { abilities } = getCardAbilities(card);
    const mainClauses = abilities.filter(
      (a): a is EffectClauseAst => a.kind === 'EFFECT_CLAUSE' && a.timings.includes('MAIN')
    );
    if (mainClauses.length === 0) {
      throw new ChainFailError('INVALID_ACTION', `${card.cardNo} has no 【Main】 clause.`);
    }

    const chosenIdx = mainClauses.length > 1 ? this.witness.nextModalChoice() ?? 0 : 0;
    const clause = mainClauses[chosenIdx];
    if (!clause) throw new ChainFailError('MISSING_WITNESS', `Invalid modal choice ${chosenIdx}.`);

    // Bandai FAQ: cannot activate/play a card requiring a target when no legal target exists
    this.assertMandatoryTargetsExist(clause.steps, side);

    this.payLvAndCost(side, card);
    player.hand.splice(handIndex, 1);
    player.activatedCommandTraitsThisTurn = [
      ...(player.activatedCommandTraitsThisTurn ?? []),
      ...(card.traits ?? []),
    ];

    this.trace.push({ kind: 'ACTION', detail: `${side} played Command ${card.cardNo}` });
    this.resolveClause(side, clause, card);
    if (!this.selfPairedCards.delete(card)) {
      player.trash.push(card);
    }
  }

  protected doActivateAbility(side: ChainSide, sourceId: string, clauseIndex: number): void {
    const found = findUnitById(this.state, sourceId);
    if (!found || found.side !== side) {
      throw new ChainFailError('INVALID_TARGET', `Source Unit ${sourceId} not controlled by ${side}.`);
    }
    const { unit } = found;
    const allAbilities = [
      ...getCardAbilities(unit.card).abilities,
      ...(unit.pairedPilot ? getCardAbilities(unit.pairedPilot).abilities : []),
    ];
    const targetAb = allAbilities.find((a) => a.clauseIndex === clauseIndex) ?? allAbilities[clauseIndex];
    if (!targetAb) {
      throw new ChainFailError('INVALID_ACTION', `Clause #${clauseIndex} not found on ${sourceId}.`);
    }
    if (targetAb.kind === 'CUSTOM_HOOK') {
      this.executeCustomHook(side, unit, targetAb);
      return;
    }
    if (targetAb.kind !== 'EFFECT_CLAUSE') {
      throw new ChainFailError('INVALID_ACTION', `Clause #${clauseIndex} is not an activatable EffectClause.`);
    }

    if (targetAb.oncePerTurn && unit.triggeredOnceThisTurn.includes(targetAb.raw)) {
      throw new ChainFailError('ONCE_PER_TURN_EXHAUSTED', `${targetAb.raw} already used this turn.`);
    }
    if (!evaluateCondition(targetAb.condition, this.state, side, unit)) {
      throw new ChainFailError('CONDITION_NOT_MET', `Condition failed for ${targetAb.raw}.`);
    }

    this.assertMandatoryTargetsExist(targetAb.steps, side, unit);
    this.payActivationCost(side, unit, targetAb.cost);
    if (targetAb.oncePerTurn) unit.triggeredOnceThisTurn.push(targetAb.raw);

    this.trace.push({ kind: 'ACTION', detail: `${side} activated ${unit.card.cardNo}#${clauseIndex}` });
    this.resolveClause(side, targetAb, unit.card, unit);
  }

  protected doAttack(
    side: ChainSide,
    attackerId: string,
    targetKind: 'SHIELD' | 'UNIT',
    targetId?: string
  ): void {
    const attackerFound = findUnitById(this.state, attackerId);
    if (!attackerFound || attackerFound.side !== side) {
      throw new ChainFailError('INVALID_TARGET', `Attacker ${attackerId} not controlled by ${side}.`);
    }
    const attacker = attackerFound.unit;
    const effAttacker = evaluateUnitEffectiveState(attacker, this.state, side);

    if (attacker.rested) throw new ChainFailError('UNIT_RESTED', `${attacker.card.cardNo} is rested.`);
    if (attacker.deployedTurn === this.state.turn && !effAttacker.isLinked) {
      throw new ChainFailError('SUMMON_SICKNESS', `${attacker.card.cardNo} cannot attack on deploy turn without Link.`);
    }
    if (effAttacker.prohibitions.has('CANT_ATTACK')) {
      throw new ChainFailError('PROHIBITED_BY_CANT', `${attacker.card.cardNo} cannot attack (Layer 4).`);
    }
    if (targetKind === 'SHIELD' && effAttacker.prohibitions.has('CANT_CHOOSE_ENEMY_PLAYER')) {
      throw new ChainFailError(
        'PROHIBITED_BY_CANT',
        `${attacker.card.cardNo} cannot choose enemy player/Base/Shields as attack target.`
      );
    }

    const defSide = oppositeSide(side);
    let currentTargetKind = targetKind;
    let currentTargetId = targetId;

    if (currentTargetKind === 'UNIT') {
      const defFound = currentTargetId ? findUnitById(this.state, currentTargetId) : null;
      if (!defFound || defFound.side !== defSide) {
        throw new ChainFailError('INVALID_TARGET', `Target Unit ${currentTargetId} not found.`);
      }
      if (!defFound.unit.rested) {
        throw new ChainFailError('INVALID_ACTION', `Cannot attack active enemy Unit ${currentTargetId}.`);
      }
    }

    attacker.rested = true;
    this.trace.push({
      kind: 'ACTION',
      detail: `${side} attacked ${currentTargetKind}${currentTargetId ? `(${currentTargetId})` : ''} with ${attacker.card.cardNo}`,
    });

    // Attack & When-Attacked trigger frame
    const attackFrame: QueuedTrigger[] = [];
    this.collectUnitTimingTriggers(side, attacker, 'ATTACK', attackFrame);
    if (currentTargetKind === 'UNIT' && currentTargetId) {
      const defNow = findUnitById(this.state, currentTargetId);
      if (defNow) this.collectUnitTimingTriggers(defSide, defNow.unit, 'WHEN_ATTACKED', attackFrame);
    }
    this.drainResolutionFrame(attackFrame);

    // Action Step (Blocker & 【Action】 alternating single activations; no stack)
    let blockerUsed = false;
    while (true) {
      const move = this.witness.nextActionStepMove();
      if (!move || move.kind === 'PASS') break;
      if (move.kind === 'BLOCKER') {
        if (blockerUsed || move.side !== defSide || !move.unitId) {
          throw new ChainFailError('INVALID_ACTION', 'Invalid Blocker activation.');
        }
        if (effAttacker.keywords.has('High-Maneuver')) {
          throw new ChainFailError('PROHIBITED_BY_CANT', '<High-Maneuver> prevents blocking.');
        }
        const blkFound = findUnitById(this.state, move.unitId);
        if (!blkFound || blkFound.side !== defSide) {
          throw new ChainFailError('INVALID_TARGET', `Blocker ${move.unitId} not found.`);
        }
        const blkEff = evaluateUnitEffectiveState(blkFound.unit, this.state, defSide);
        if (!blkEff.canBlock) {
          throw new ChainFailError('PROHIBITED_BY_CANT', `${blkFound.unit.card.cardNo} cannot activate <Blocker>.`);
        }
        blkFound.unit.rested = true;
        blockerUsed = true;
        currentTargetKind = 'UNIT';
        currentTargetId = blkFound.unit.instanceId;
        this.trace.push({ kind: 'ACTION', detail: `${defSide} intercepted with <Blocker> ${blkFound.unit.card.cardNo}` });
        const blkFrame: QueuedTrigger[] = [];
        this.collectUnitTimingTriggers(defSide, blkFound.unit, 'WHEN_ATTACKED', blkFrame);
        this.drainResolutionFrame(blkFrame);
      } else if (move.kind === 'PLAY_ACTION' && move.handIndex !== undefined) {
        const cmdPlayer = this.state.players[move.side];
        const cmd = cmdPlayer.hand[move.handIndex];
        if (!cmd) throw new ChainFailError('INVALID_ACTION', 'Missing Action Command.');
        const actionClause = getCardAbilities(cmd).abilities.find(
          (a): a is EffectClauseAst => a.kind === 'EFFECT_CLAUSE' && a.timings.includes('ACTION')
        );
        if (!actionClause) throw new ChainFailError('INVALID_ACTION', `${cmd.cardNo} has no 【Action】.`);
        this.payLvAndCost(move.side, cmd);
        cmdPlayer.hand.splice(move.handIndex, 1);
        this.resolveClause(move.side, actionClause, cmd);
        cmdPlayer.trash.push(cmd);
      }
    }

    // Damage Step
    const atkNow = findUnitById(this.state, attacker.instanceId);
    if (!atkNow) return;
    const atkEffNow = evaluateUnitEffectiveState(atkNow.unit, this.state, side);

    if (currentTargetKind === 'UNIT' && currentTargetId) {
      const defNow = findUnitById(this.state, currentTargetId);
      if (!defNow) return;
      const defEffNow = evaluateUnitEffectiveState(defNow.unit, this.state, defSide);

      if (atkEffNow.keywords.has('First Strike')) {
        // First Strike deals attacker damage first; if defender is destroyed, skip reciprocal damage
        this.dealDamageToUnit(defSide, defNow.unit, atkEffNow.ap, 'BATTLE', atkNow.unit, side);
        const defStillAlive = findUnitById(this.state, currentTargetId);
        if (defStillAlive) {
          this.dealDamageToUnit(side, atkNow.unit, defEffNow.ap, 'BATTLE', defStillAlive.unit, defSide);
        }
      } else {
        // Simultaneous battle damage
        this.applyBattleDamagePair(side, atkNow.unit, atkEffNow.ap, defSide, defNow.unit, defEffNow.ap);
      }
    } else {
      // Attacking Opponent Shields / Base
      if (atkEffNow.ap <= 0) return; // 0 AP cannot destroy a Shield per Bandai FAQ
      const oppPlayer = this.state.players[defSide];
      if (oppPlayer.base) {
        this.dealDamageToBase(defSide, atkEffNow.ap, 'BATTLE', atkNow.unit, side);
      } else if (oppPlayer.shields.length > 0) {
        const shieldCount = atkEffNow.keywords.has('Suppression')
          ? Math.min(2, oppPlayer.shields.length)
          : 1;
        this.destroyShieldsSimultaneously(defSide, shieldCount, atkNow.unit, side, true);
      }
    }

    this.expireDurationModifiers('THIS_BATTLE');
  }

  protected endTurn(): void {
    this.expireDurationModifiers('THIS_TURN');
    const nextSide = oppositeSide(this.state.activeSide);
    this.state.activeSide = nextSide;
    this.state.turn += 1;
    const nextPlayer = this.state.players[nextSide];
    nextPlayer.activeResources += nextPlayer.restedResources;
    nextPlayer.restedResources = 0;
    for (const u of nextPlayer.battleArea) {
      u.rested = false;
      u.triggeredOnceThisTurn = [];
    }
    if (nextPlayer.activeResources + nextPlayer.restedResources < 10) {
      nextPlayer.activeResources += 1;
    }
    const drawn = this.witness.drawFromDeck(nextPlayer);
    if (drawn) nextPlayer.hand.push(drawn);
  }
}


// ---------------------------------------------------------------------------
// 4. Minimal-Board Synthesizer & Public Entry Point verifyPlayLine
// ---------------------------------------------------------------------------
