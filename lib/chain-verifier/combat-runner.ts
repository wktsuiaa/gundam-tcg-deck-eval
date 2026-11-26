import type { EffectClauseAst } from '../cfg-parser.ts';
import { evaluateUnitEffectiveState } from './effective-state';
import { ResolutionRunner } from './resolution-runner';
import { QueuedTrigger } from './runner-support';
import { findUnitById, getCardAbilities, oppositeSide } from './state-helpers';
import { ChainSide, ChainUnitInstance } from './types';

export abstract class CombatRunner extends ResolutionRunner {
  protected dealDamageToUnit(
    targetSide: ChainSide,
    target: ChainUnitInstance,
    rawAmount: number,
    damageType: 'BATTLE' | 'EFFECT',
    sourceUnit?: ChainUnitInstance,
    sourceSide?: ChainSide
  ): void {
    if (rawAmount <= 0) return;
    const effTarget = evaluateUnitEffectiveState(target, this.state, targetSide);

    // Layer-4 damage immunity check
    if (damageType === 'BATTLE' && sourceUnit && sourceSide) {
      const effSrc = evaluateUnitEffectiveState(sourceUnit, this.state, sourceSide);
      const immune = effTarget.damageImmunities.some(
        (imm) =>
          (imm.damageType === 'BATTLE' || imm.damageType === 'ANY') &&
          (imm.apMax === undefined || effSrc.ap <= imm.apMax) &&
          (imm.lvMax === undefined || effSrc.lv <= imm.lvMax)
      );
      if (immune) {
        this.trace.push({ kind: 'DAMAGE', detail: `${target.card.cardNo} prevented ${rawAmount} battle damage (Layer 4)` });
        return;
      }
    }

    // Pre-commit Replacement Effects (max 1x per source per event)
    const eventId = this.nextEventId('dmg');
    const replaced = this.tryRunDamageReplacement(eventId, targetSide, target, rawAmount, damageType, sourceUnit, sourceSide);
    if (replaced) return;

    target.damage += rawAmount;
    this.trace.push({ kind: 'DAMAGE', detail: `${target.card.cardNo} took ${rawAmount} ${damageType} damage` });

    const sbaDestroyed = this.runStateBasedChecks(damageType === 'BATTLE');
    const frame: QueuedTrigger[] = [];
    for (const d of sbaDestroyed) {
      this.enqueueDestructionTriggers(d.side, d.unit, damageType, frame);
      if (damageType === 'BATTLE' && sourceUnit && sourceSide && findUnitById(this.state, sourceUnit.instanceId)) {
        this.collectUnitTimingTriggers(sourceSide, sourceUnit, 'WHEN_DESTROY_BY_BATTLE', frame, {
          destroyedByBattle: true,
        });
      }
    }
    // Note: <Breach> also triggers even if both Units died in battle (sourceUnit may be in sbaDestroyed!)
    if (damageType === 'BATTLE' && sourceUnit && sourceSide && sbaDestroyed.some((d) => d.unit.instanceId === target.instanceId)) {
      const srcEff = evaluateUnitEffectiveState(sourceUnit, this.state, sourceSide);
      const breachVal = srcEff.keywordValues.get('Breach');
      if (srcEff.keywords.has('Breach') && breachVal && breachVal > 0) {
        const oppSide = oppositeSide(sourceSide);
        const oppPlayer = this.state.players[oppSide];
        const breachClause: EffectClauseAst = {
          kind: 'EFFECT_CLAUSE',
          clauseIndex: -1,
          raw: `<Breach ${breachVal}>`,
          timings: ['WHEN_DESTROY_BY_BATTLE'],
          oncePerTurn: false,
          steps: [{ action: 'DEAL_DAMAGE', amount: breachVal, target: { owner: 'ENEMY', cardType: 'SHIELD', count: 1 } }],
        };
        if (oppPlayer.base || oppPlayer.shields.length > 0) {
          frame.push({
            side: sourceSide,
            clause: breachClause,
            sourceCard: sourceUnit.card,
            sourceUnitId: sourceUnit.instanceId,
            lastKnownUnit: sourceUnit,
          });
        }
      }
    }
    this.drainResolutionFrame(frame);
  }

  protected applyBattleDamagePair(
    sideA: ChainSide,
    unitA: ChainUnitInstance,
    apA: number,
    sideB: ChainSide,
    unitB: ChainUnitInstance,
    apB: number
  ): void {
    const effA = evaluateUnitEffectiveState(unitA, this.state, sideA);
    const effB = evaluateUnitEffectiveState(unitB, this.state, sideB);

    const immuneB = effB.damageImmunities.some(
      (i) => (i.apMax === undefined || effA.ap <= i.apMax) && (i.lvMax === undefined || effA.lv <= i.lvMax)
    );
    const immuneA = effA.damageImmunities.some(
      (i) => (i.apMax === undefined || effB.ap <= i.apMax) && (i.lvMax === undefined || effB.lv <= i.lvMax)
    );

    if (!immuneB && apA > 0) {
      const repB = this.tryRunDamageReplacement(this.nextEventId('bdmg'), sideB, unitB, apA, 'BATTLE', unitA, sideA);
      if (!repB) unitB.damage += apA;
    }
    if (!immuneA && apB > 0) {
      const repA = this.tryRunDamageReplacement(this.nextEventId('bdmg'), sideA, unitA, apB, 'BATTLE', unitB, sideB);
      if (!repA) unitA.damage += apB;
    }

    const destroyed = this.runStateBasedChecks(true);
    const frame: QueuedTrigger[] = [];

    // <Breach> on either survivor/attacker if opposing Unit was destroyed
    if (destroyed.some((d) => d.unit.instanceId === unitB.instanceId)) {
      const breachVal = effA.keywordValues.get('Breach');
      if (effA.keywords.has('Breach') && breachVal && breachVal > 0) {
        frame.push({
          side: sideA,
          clause: {
            kind: 'EFFECT_CLAUSE',
            clauseIndex: -1,
            raw: `<Breach ${breachVal}>`,
            timings: ['WHEN_DESTROY_BY_BATTLE'],
            oncePerTurn: false,
            steps: [{ action: 'DEAL_DAMAGE', amount: breachVal, target: { owner: 'ENEMY', cardType: 'SHIELD', count: 1 } }],
          },
          sourceCard: unitA.card,
          sourceUnitId: unitA.instanceId,
          lastKnownUnit: unitA,
        });
      }
      this.collectUnitTimingTriggers(sideA, unitA, 'WHEN_DESTROY_BY_BATTLE', frame, { destroyedByBattle: true });
    }

    for (const d of destroyed) {
      this.enqueueDestructionTriggers(d.side, d.unit, 'BATTLE', frame);
    }
    this.drainResolutionFrame(frame);
  }

  protected dealDamageToBase(
    targetSide: ChainSide,
    amount: number,
    damageType: 'BATTLE' | 'EFFECT',
    sourceUnit?: ChainUnitInstance,
    sourceSide?: ChainSide
  ): void {
    const player = this.state.players[targetSide];
    if (!player.base) return;
    if (this.isShieldAreaDamageProhibited(targetSide, sourceUnit, sourceSide)) {
      this.trace.push({ kind: 'DAMAGE', detail: `${targetSide} Base prevented ${amount} damage (shield immunity)` });
      return;
    }
    player.base.damage += amount;
    const maxHp = player.base.card.hp ?? 5;
    if (player.base.damage >= maxHp) {
      const deadBase = player.base;
      player.base = null;
      player.trash.push(deadBase.card);
      this.trace.push({ kind: 'SBA', detail: `${targetSide} Base ${deadBase.card.cardNo} destroyed` });
      if (sourceUnit && sourceSide) {
        const frame: QueuedTrigger[] = [];
        this.collectDestroyCardTriggers(sourceSide, sourceUnit, 'BASE', damageType, frame);
        this.drainResolutionFrame(frame);
      }
    }
  }

  protected destroyShieldsSimultaneously(
    targetSide: ChainSide,
    count: number,
    sourceUnit?: ChainUnitInstance,
    sourceSide?: ChainSide,
    byBattle = false
  ): void {
    const player = this.state.players[targetSide];
    if (this.isShieldAreaDamageProhibited(targetSide, sourceUnit, sourceSide)) {
      this.trace.push({ kind: 'DAMAGE', detail: `${targetSide} Shields prevented damage (shield immunity)` });
      return;
    }
    const destroyed = player.shields.splice(0, Math.min(count, player.shields.length));
    if (destroyed.length === 0) return;

    this.trace.push({
      kind: 'DAMAGE',
      detail: `${targetSide} lost ${destroyed.length} Shield(s) simultaneously`,
    });

    // Check which revealed Shields have 【Burst】
    const burstEntries = destroyed
      .map((s) => ({
        shield: s,
        burstClause: getCardAbilities(s.card).abilities.find(
          (a): a is EffectClauseAst => a.kind === 'EFFECT_CLAUSE' && a.timings.includes('BURST')
        ),
      }))
      .filter((x) => Boolean(x.burstClause));

    const order = this.witness.peekBurstOrder(destroyed.length);
    const ordered = order.map((idx) => destroyed[idx]).filter(Boolean);

    // Move Shields not activating Burst (or after Burst) into Trash; per FAQ, a Base deployed by Burst 1
    // cannot pick up Shield 2 that was destroyed simultaneously because `destroyed` is already spliced!
    const frame: QueuedTrigger[] = [];
    for (const s of ordered) {
      const entry = burstEntries.find((b) => b.shield.id === s.id);
      if (entry?.burstClause && this.witness.nextBurstAccept()) {
        this.trace.push({ kind: 'BURST', detail: `${targetSide} activated 【Burst】 on ${s.card.cardNo}` });
        if (entry.burstClause.steps.some((st) => st.action === 'DEPLOY_SELF')) {
          if (s.card.type === 'BASE') {
            if (player.base) player.trash.push(player.base.card);
            player.base = { instanceId: `${targetSide}-BASE-${this.nextEventId('base')}`, card: s.card, damage: 0 };
            this.collectCardTimingTriggers(targetSide, s.card, 'DEPLOY', frame);
          } else {
            player.battleArea.push({
              instanceId: `${targetSide}-U-${this.nextEventId('unit')}`,
              card: s.card,
              rested: false,
              damage: 0,
              deployedTurn: this.state.turn,
              temporaryModifiers: [],
              triggeredOnceThisTurn: [],
            });
          }
        } else if (entry.burstClause.steps.some((st) => st.action === 'ADD_SELF_TO_HAND')) {
          player.hand.push(s.card);
        } else {
          frame.push({
            side: targetSide,
            clause: entry.burstClause,
            sourceCard: s.card,
          });
          player.trash.push(s.card);
        }
      } else {
        player.trash.push(s.card);
      }
    }

    if (sourceUnit && sourceSide) {
      this.collectDestroyCardTriggers(sourceSide, sourceUnit, 'SHIELD', byBattle ? 'BATTLE' : 'EFFECT', frame);
    }
    this.drainResolutionFrame(frame);
  }
}
