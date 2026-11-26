import type { GundamCardPrint } from '../../types/gundam.ts';
import { type ActivationCost, type EffectDuration, type EffectStep, type EffectTiming, type TargetSelector } from '../effect-parser.ts';
import { evaluateCondition } from './conditions';
import { effectivePlayCost, evaluateUnitEffectiveState } from './effective-state';
import { ChainFailError, QueuedTrigger, WitnessCursor } from './runner-support';
import { cloneState, getCardAbilities, isUnitLinked, matchesTargetSelectorSimple } from './state-helpers';
import { ChainMatchState, ChainSide, ChainTraceEntry, ChainUnitInstance, ChainWitness } from './types';

export abstract class RunnerBase {
  public state: ChainMatchState;
  public readonly witness: WitnessCursor;
  public readonly trace: ChainTraceEntry[] = [];
  protected eventSeq = 0;
  protected readonly appliedReplacements = new Set<string>();
  protected readonly selfPairedCards = new Set<GundamCardPrint>();

  constructor(initial: ChainMatchState, witness: ChainWitness) {
    this.state = cloneState(initial);
    this.witness = new WitnessCursor(witness);
  }

  protected nextEventId(prefix: string): string {
    this.eventSeq += 1;
    return `${prefix}#${this.eventSeq}`;
  }

  protected payLvAndCost(side: ChainSide, card: GundamCardPrint, extraCost = 0): void {
    const player = this.state.players[side];
    const totalLv = player.activeResources + player.restedResources + player.exResources;
    const reqLv = card.lv ?? 1;
    if (totalLv < reqLv) {
      throw new ChainFailError(
        'INSUFFICIENT_LV',
        `${card.cardNo} requires Lv.${reqLv} but player ${side} has Lv.${totalLv}.`
      );
    }

    const cost = effectivePlayCost(card, this.state, side) + extraCost;
    const totalActive = player.activeResources + player.exResources;
    if (totalActive < cost) {
      throw new ChainFailError(
        'INSUFFICIENT_RESOURCES',
        `${card.cardNo} costs ${cost} but player ${side} only has ${totalActive} active resources.`
      );
    }

    const spend = this.witness.nextResourceSpend(cost, player.activeResources, player.exResources);
    if (!spend) {
      throw new ChainFailError(
        'MISSING_WITNESS',
        `Unable to determine valid resource spend of ${cost} for ${card.cardNo}.`
      );
    }

    player.activeResources -= spend.regular;
    player.restedResources += spend.regular;
    player.exResources -= spend.ex;
    this.state.exResourceSpentOnCurrentPlay = spend.ex > 0;
  }

  protected payActivationCost(side: ChainSide, unit: ChainUnitInstance, cost?: ActivationCost): void {
    if (!cost) return;
    const player = this.state.players[side];
    if (cost.restSelf) {
      if (unit.rested) throw new ChainFailError('UNIT_RESTED', `${unit.card.cardNo} is already rested.`);
      unit.rested = true;
    }
    if (cost.resourceCost && cost.resourceCost > 0) {
      const totalActive = player.activeResources + player.exResources;
      if (totalActive < cost.resourceCost) {
        throw new ChainFailError('INSUFFICIENT_RESOURCES', `Ability cost ${cost.resourceCost} exceeds active resources.`);
      }
      const spend = this.witness.nextResourceSpend(cost.resourceCost, player.activeResources, player.exResources);
      if (!spend) throw new ChainFailError('MISSING_WITNESS', 'Missing resource spend witness for activation cost.');
      player.activeResources -= spend.regular;
      player.restedResources += spend.regular;
      player.exResources -= spend.ex;
    }
    if (cost.returnSelfToDeckBottom) {
      const idx = player.battleArea.findIndex((u) => u.instanceId === unit.instanceId);
      if (idx >= 0) {
        player.battleArea.splice(idx, 1);
        player.deck.push(unit.card);
        if (unit.pairedPilot) player.trash.push(unit.pairedPilot);
      }
    }
    if (cost.discardCount && cost.discardCount > 0) {
      if (player.hand.length < cost.discardCount) {
        throw new ChainFailError('INSUFFICIENT_RESOURCES', `Need ${cost.discardCount} cards in hand to discard.`);
      }
      for (let i = 0; i < cost.discardCount; i += 1) {
        player.trash.push(player.hand.pop()!);
      }
    }
  }

  // shortcut: only WOULD_TAKE_DAMAGE and WOULD_REST exist in current 1,290-card corpus; add WOULD_BE_DESTROYED/WOULD_MOVE_ZONE pre-commit hooks when new sets introduce them.
  protected tryRunDamageReplacement(
    eventId: string,
    targetSide: ChainSide,
    target: ChainUnitInstance,
    _amount: number,
    damageType: 'BATTLE' | 'EFFECT',
    sourceUnit?: ChainUnitInstance,
    sourceSide?: ChainSide
  ): boolean {
    if (damageType !== 'BATTLE') return false;
    const cards = target.pairedPilot ? [target.card, target.pairedPilot] : [target.card];
    for (const c of cards) {
      for (const ab of getCardAbilities(c).abilities) {
        if (ab.kind !== 'REPLACEMENT_EFFECT' || ab.intercepts !== 'WOULD_TAKE_DAMAGE') continue;
        if (ab.scope === 'PAIRED' && !target.pairedPilot) continue;
        if (ab.scope === 'LINKED' && !isUnitLinked(target)) continue;
        const guardKey = `${eventId}:${target.instanceId}:${ab.clauseIndex}`;
        if (this.appliedReplacements.has(guardKey)) continue;
        if (ab.raw.includes('AP equal to or less than it') && sourceUnit && sourceSide) {
          const srcAp = evaluateUnitEffectiveState(sourceUnit, this.state, sourceSide).ap;
          const tgtAp = evaluateUnitEffectiveState(target, this.state, targetSide).ap;
          if (srcAp > tgtAp) continue;
        }
        const accept = ab.optional ? this.witness.nextOptionalAccept(true) : true;
        if (!accept) continue;
        this.appliedReplacements.add(guardKey);
        this.trace.push({ kind: 'REPLACEMENT', detail: `Replacement prevented damage on ${target.card.cardNo}` });
        return true;
      }
    }
    return false;
  }

  protected isShieldAreaDamageProhibited(
    targetSide: ChainSide,
    sourceUnit?: ChainUnitInstance,
    sourceSide?: ChainSide
  ): boolean {
    const prohs = (this.state.shieldDamageProhibitions ?? []).filter((p) => p.side === targetSide);
    if (prohs.length === 0 || !sourceUnit || !sourceSide) return false;
    const eff = evaluateUnitEffectiveState(sourceUnit, this.state, sourceSide);
    return prohs.some(
      (p) =>
        (p.lvMax === undefined || eff.lv <= p.lvMax) &&
        (p.apMax === undefined || eff.ap <= p.apMax)
    );
  }

  protected collectDestroyCardTriggers(
    actorSide: ChainSide,
    actorUnit: ChainUnitInstance,
    targetKind: 'BASE' | 'SHIELD',
    damageType: 'BATTLE' | 'EFFECT',
    frame: QueuedTrigger[]
  ): void {
    const ctx = { destroyedByBattle: damageType === 'BATTLE', actorUnit, actorSide, targetKind, damageType };
    this.collectUnitTimingTriggers(actorSide, actorUnit, 'WHEN_DESTROY_BY_BATTLE', frame, ctx);
    for (const u of this.state.players[actorSide].battleArea) {
      if (u.instanceId === actorUnit.instanceId) continue;
      this.collectUnitTimingTriggers(actorSide, u, 'WHEN_DESTROY_BY_BATTLE', frame, ctx);
    }
  }

  protected runStateBasedChecks(destroyedByBattle: boolean): { side: ChainSide; unit: ChainUnitInstance }[] {
    const destroyed: { side: ChainSide; unit: ChainUnitInstance }[] = [];
    for (const side of ['A', 'B'] as const) {
      const player = this.state.players[side];
      const survivors: ChainUnitInstance[] = [];
      for (const u of player.battleArea) {
        const eff = evaluateUnitEffectiveState(u, this.state, side);
        if (eff.remainingHp <= 0) {
          player.trash.push(u.card);
          if (u.pairedPilot) player.trash.push(u.pairedPilot);
          destroyed.push({ side, unit: u });
          this.trace.push({
            kind: 'SBA',
            detail: `${u.card.cardNo} destroyed by SBA (${destroyedByBattle ? 'BATTLE' : 'EFFECT'})`,
          });
        } else {
          survivors.push(u);
        }
      }
      player.battleArea = survivors;
    }
    return destroyed;
  }

  protected enqueueDestructionTriggers(
    ownerSide: ChainSide,
    unit: ChainUnitInstance,
    damageType: 'BATTLE' | 'EFFECT',
    frame: QueuedTrigger[]
  ): void {
    this.collectUnitTimingTriggers(ownerSide, unit, 'DESTROYED', frame, {
      destroyedByBattle: damageType === 'BATTLE',
    });
    this.collectBoardTimingTriggers('WHEN_UNIT_DESTROYED', frame, ownerSide, {
      destroyedByBattle: damageType === 'BATTLE',
    });
  }

  protected collectUnitTimingTriggers(
    side: ChainSide,
    unit: ChainUnitInstance,
    timing: EffectTiming,
    frame: QueuedTrigger[],
    ctx?: {
      destroyedByBattle?: boolean;
      actorUnit?: ChainUnitInstance;
      actorSide?: ChainSide;
      targetKind?: 'BASE' | 'SHIELD';
      damageType?: 'BATTLE' | 'EFFECT';
    }
  ): void {
    const cards = unit.pairedPilot ? [unit.card, unit.pairedPilot] : [unit.card];
    for (const c of cards) {
      for (const ab of getCardAbilities(c).abilities) {
        if (ab.kind !== 'EFFECT_CLAUSE') continue;
        if (!ab.timings.includes(timing)) continue;
        if (ab.timings.includes('DURING_PAIR')) {
          if (!unit.pairedPilot) continue;
          if (ab.pairFilter?.trait) {
            const reqT = ab.pairFilter.trait.toLowerCase();
            if (!unit.pairedPilot.traits.some((t) => t.toLowerCase() === reqT)) continue;
          }
        }
        if (ab.triggerEvent?.actor === 'SELF' && ctx?.actorUnit && ctx.actorUnit.instanceId !== unit.instanceId) {
          continue;
        }
        if (ab.triggerEvent?.actor === 'FRIENDLY' && ctx?.actorUnit) {
          if (ctx.actorSide !== side) continue;
          if (ab.triggerEvent.actorFilter?.trait) {
            const reqT = ab.triggerEvent.actorFilter.trait.toLowerCase();
            if (!ctx.actorUnit.card.traits.some((t) => t.toLowerCase() === reqT)) continue;
          }
        }
        if (ab.triggerEvent?.damageType === 'BATTLE' && ctx?.damageType === 'EFFECT') continue;
        if (ab.oncePerTurn && unit.triggeredOnceThisTurn.includes(ab.raw)) continue;
        if (!evaluateCondition(ab.condition, this.state, side, unit, ctx)) continue;
        if (ab.oncePerTurn) unit.triggeredOnceThisTurn.push(ab.raw);
        frame.push({
          side,
          clause: ab,
          sourceCard: c,
          sourceUnitId: unit.instanceId,
          lastKnownUnit: structuredClone(unit),
          ctx,
        });
      }
    }
  }

  protected collectCardTimingTriggers(
    side: ChainSide,
    card: GundamCardPrint,
    timing: EffectTiming,
    frame: QueuedTrigger[]
  ): void {
    for (const ab of getCardAbilities(card).abilities) {
      if (ab.kind !== 'EFFECT_CLAUSE' || !ab.timings.includes(timing)) continue;
      if (!evaluateCondition(ab.condition, this.state, side)) continue;
      frame.push({ side, clause: ab, sourceCard: card });
    }
  }

  protected collectBoardTimingTriggers(
    timing: EffectTiming,
    frame: QueuedTrigger[],
    _actorSide?: ChainSide,
    ctx?: { destroyedByBattle?: boolean }
  ): void {
    for (const side of ['A', 'B'] as const) {
      for (const u of this.state.players[side].battleArea) {
        this.collectUnitTimingTriggers(side, u, timing, frame, ctx);
      }
    }
  }

  protected assertMandatoryTargetsExist(
    steps: EffectStep[],
    side: ChainSide,
    selfUnit?: ChainUnitInstance
  ): void {
    for (const s of steps) {
      if (s.action === 'DESTROY' || s.action === 'BOUNCE' || s.action === 'REST' || s.action === 'DEAL_DAMAGE') {
        if (s.target.cardType === 'UNIT' && s.target.count !== 'ALL' && s.target.count !== 'UP_TO' && !s.target.self) {
          const candidates = this.findLegalUnitTargets(s.target, side, selfUnit);
          if (candidates.length === 0) {
            throw new ChainFailError('NO_LEGAL_TARGET', `No legal target for ${s.action}.`);
          }
        }
      }
    }
  }

  protected findLegalUnitTargets(
    selector: TargetSelector,
    side: ChainSide,
    selfUnit?: ChainUnitInstance
  ): { side: ChainSide; unit: ChainUnitInstance }[] {
    const out: { side: ChainSide; unit: ChainUnitInstance }[] = [];
    for (const s of ['A', 'B'] as const) {
      for (const u of this.state.players[s].battleArea) {
        const eff = evaluateUnitEffectiveState(u, this.state, s);
        if (!eff.canBeChosen && s !== side) continue;
        if (matchesTargetSelectorSimple(u, selector, this.state, side, selfUnit)) {
          out.push({ side: s, unit: u });
        }
      }
    }
    return out;
  }

  protected tryRunRestReplacement(targetSide: ChainSide, _targetUnit: ChainUnitInstance): boolean {
    const player = this.state.players[targetSide];
    const sources: { card: GundamCardPrint; id: string; isBase: boolean }[] = [];
    if (player.base) sources.push({ card: player.base.card, id: player.base.instanceId, isBase: true });
    for (const u of player.battleArea) sources.push({ card: u.card, id: u.instanceId, isBase: false });

    const eventId = this.nextEventId('rest');
    for (const src of sources) {
      for (const ab of getCardAbilities(src.card).abilities) {
        if (ab.kind !== 'REPLACEMENT_EFFECT' || ab.intercepts !== 'WOULD_REST') continue;
        const key = `${eventId}:${src.id}:${ab.clauseIndex}`;
        if (this.appliedReplacements.has(key)) continue;
        if (!evaluateCondition(ab.condition, this.state, targetSide)) continue;
        const choice = this.witness.nextReplacementChoice();
        const accept = choice ? choice.accept : ab.optional ? this.witness.nextOptionalAccept(true) : true;
        if (!accept) continue;
        this.appliedReplacements.add(key);
        this.trace.push({ kind: 'REPLACEMENT', detail: `${src.card.cardNo} replaced WOULD_REST` });
        return true;
      }
    }
    return false;
  }

  protected expireDurationModifiers(duration: EffectDuration): void {
    for (const side of ['A', 'B'] as const) {
      for (const u of this.state.players[side].battleArea) {
        u.temporaryModifiers = u.temporaryModifiers.filter((m) => m.duration !== duration);
      }
    }
    if (this.state.shieldDamageProhibitions) {
      this.state.shieldDamageProhibitions = this.state.shieldDamageProhibitions.filter(
        (p) => p.duration !== duration
      );
    }
  }
}
