import type { GundamCardPrint } from '../../types/gundam.ts';
import type { CustomHookAst, EffectClauseAst } from '../cfg-parser.ts';
import { type EffectStep } from '../effect-parser.ts';
import { evaluateCondition } from './conditions';
import { evaluateUnitEffectiveState } from './effective-state';
import { RunnerBase } from './runner-base';
import { ChainFailError, QueuedTrigger } from './runner-support';
import { findUnitById, isUnitLinked, oppositeSide } from './state-helpers';
import { ChainSide, ChainUnitInstance } from './types';

export abstract class ResolutionRunner extends RunnerBase {
  protected abstract dealDamageToUnit( targetSide: ChainSide, target: ChainUnitInstance, rawAmount: number, damageType: 'BATTLE' | 'EFFECT', sourceUnit?: ChainUnitInstance, sourceSide?: ChainSide ): void;

  protected abstract dealDamageToBase( targetSide: ChainSide, amount: number, damageType: 'BATTLE' | 'EFFECT', sourceUnit?: ChainUnitInstance, sourceSide?: ChainSide ): void;

  protected abstract destroyShieldsSimultaneously( targetSide: ChainSide, count: number, sourceUnit?: ChainUnitInstance, sourceSide?: ChainSide, byBattle?: boolean ): void;

  protected drainResolutionFrame(frame: QueuedTrigger[]): void {
    if (frame.length === 0) return;
    const active = this.state.activeSide;
    const nonActive = oppositeSide(active);

    for (const side of [active, nonActive] as const) {
      const sideTriggers = frame.filter((t) => t.side === side);
      if (sideTriggers.length === 0) continue;
      const order = sideTriggers.length > 1 ? this.witness.nextTriggerOrder(sideTriggers.length) : [0];
      for (const idx of order) {
        const trig = sideTriggers[idx];
        if (!trig) continue;
        const liveUnit = trig.sourceUnitId ? findUnitById(this.state, trig.sourceUnitId)?.unit : undefined;
        const contextUnit = liveUnit ?? trig.lastKnownUnit;
        this.trace.push({
          kind: 'TRIGGER',
          detail: `Resolve ${trig.side} ${trig.sourceCard.cardNo} (${trig.clause.timings.join(',')})`,
        });
        // Even if trig.sourceUnitId left play, pending trigger still resolves via lastKnownUnit!
        this.resolveClause(trig.side, trig.clause, trig.sourceCard, contextUnit);
      }
    }
  }

  protected resolveClause(
    side: ChainSide,
    clause: EffectClauseAst,
    sourceCard: GundamCardPrint,
    selfUnit?: ChainUnitInstance
  ): void {
    let prevSucceeded = true;
    for (const step of clause.steps) {
      prevSucceeded = this.executeStep(side, step, sourceCard, selfUnit, prevSucceeded);
    }
  }

  protected executeStep(
    side: ChainSide,
    step: EffectStep,
    sourceCard: GundamCardPrint,
    selfUnit: ChainUnitInstance | undefined,
    prevSucceeded: boolean
  ): boolean {
    const player = this.state.players[side];
    switch (step.action) {
      case 'DRAW': {
        for (let i = 0; i < step.count; i += 1) {
          const drawn = this.witness.drawFromDeck(player);
          if (drawn) player.hand.push(drawn);
        }
        return true;
      }
      case 'ADD_SHIELD_TO_HAND': {
        for (let i = 0; i < step.count; i += 1) {
          const s = player.shields.shift();
          if (s) player.hand.push(s.card);
        }
        return true;
      }
      case 'SET_ACTIVE': {
        if (step.target.self && selfUnit) {
          const eff = evaluateUnitEffectiveState(selfUnit, this.state, side);
          if (eff.prohibitions.has('CANT_SET_ACTIVE')) return false;
          selfUnit.rested = false;
          return true;
        }
        return false;
      }
      case 'CANT_ATTACK': {
        if (step.target.self && selfUnit) {
          selfUnit.temporaryModifiers.push({
            id: this.nextEventId('cant'),
            layer: 4,
            rule: 'CANT_ATTACK',
            duration: step.duration ?? 'THIS_TURN',
          });
          return true;
        }
        return false;
      }
      case 'RESTRICTION': {
        const candidates = step.target.self && selfUnit
          ? [{ side, unit: selfUnit }]
          : this.findLegalUnitTargets(step.target, side, selfUnit);
        if (candidates.length === 0) return false;
        for (const c of candidates) {
          c.unit.temporaryModifiers.push({
            id: this.nextEventId('cant'),
            layer: 4,
            rule: step.rule,
            ...(step.sourceFilter ? { sourceFilter: step.sourceFilter } : {}),
            duration: step.duration ?? 'THIS_TURN',
          });
        }
        return true;
      }
      case 'DEAL_DAMAGE': {
        if (step.target.cardType === 'SHIELD') {
          const oppSide = oppositeSide(side);
          const opp = this.state.players[oppSide];
          if (opp.base) this.dealDamageToBase(oppSide, step.amount, 'EFFECT', selfUnit, side);
          else if (opp.shields.length > 0) this.destroyShieldsSimultaneously(oppSide, 1, selfUnit, side, false);
          return true;
        }
        const candidates = this.findLegalUnitTargets(step.target, side, selfUnit);
        if (candidates.length === 0) return false;
        const chosenIds =
          step.target.count === 'ALL'
            ? candidates.map((c) => c.unit.instanceId)
            : this.witness.nextTargets() ?? [candidates[0].unit.instanceId];
        for (const id of chosenIds) {
          const found = findUnitById(this.state, id);
          if (found) this.dealDamageToUnit(found.side, found.unit, step.amount, 'EFFECT', selfUnit, side);
        }
        return true;
      }
      case 'MODIFY_HP': {
        const candidates = step.target.self && selfUnit
          ? [{ side, unit: selfUnit }]
          : this.findLegalUnitTargets(step.target, side, selfUnit);
        if (candidates.length === 0) return false;
        const chosenIds =
          step.target.count === 'ALL'
            ? candidates.map((c) => c.unit.instanceId)
            : this.witness.nextTargets() ?? [candidates[0].unit.instanceId];
        for (const id of chosenIds) {
          const found = findUnitById(this.state, id);
          if (found) {
            found.unit.temporaryModifiers.push({
              id: this.nextEventId('hp'),
              layer: 3,
              stat: 'HP',
              delta: step.delta,
              duration: step.duration ?? 'THIS_TURN',
            });
          }
        }
        const dead = this.runStateBasedChecks(false);
        const frame: QueuedTrigger[] = [];
        for (const d of dead) this.enqueueDestructionTriggers(d.side, d.unit, 'EFFECT', frame);
        this.drainResolutionFrame(frame);
        return true;
      }
      case 'MODIFY_AP': {
        const candidates = step.target.self && selfUnit
          ? [{ side, unit: selfUnit }]
          : this.findLegalUnitTargets(step.target, side, selfUnit);
        if (candidates.length === 0) return false;
        const chosenIds =
          step.target.count === 'ALL'
            ? candidates.map((c) => c.unit.instanceId)
            : this.witness.nextTargets() ?? [candidates[0].unit.instanceId];
        for (const id of chosenIds) {
          const found = findUnitById(this.state, id);
          if (found) {
            found.unit.temporaryModifiers.push({
              id: this.nextEventId('ap'),
              layer: 3,
              stat: 'AP',
              delta: step.delta,
              duration: step.duration ?? 'THIS_TURN',
            });
          }
        }
        return true;
      }
      case 'DESTROY': {
        const candidates = this.findLegalUnitTargets(step.target, side, selfUnit);
        if (candidates.length === 0) return false;
        const chosenIds =
          step.target.count === 'ALL'
            ? candidates.map((c) => c.unit.instanceId)
            : this.witness.nextTargets() ?? [candidates[0].unit.instanceId];
        const frame: QueuedTrigger[] = [];
        for (const id of chosenIds) {
          const found = findUnitById(this.state, id);
          if (!found) continue;
          const p = this.state.players[found.side];
          const idx = p.battleArea.findIndex((u) => u.instanceId === id);
          if (idx >= 0) {
            const [dead] = p.battleArea.splice(idx, 1);
            p.trash.push(dead.card);
            if (dead.pairedPilot) p.trash.push(dead.pairedPilot);
            this.enqueueDestructionTriggers(found.side, dead, 'EFFECT', frame);
          }
        }
        this.drainResolutionFrame(frame);
        return true;
      }
      case 'REST': {
        const candidates = this.findLegalUnitTargets(step.target, side, selfUnit);
        if (candidates.length === 0) return false;
        const chosenIds = this.witness.nextTargets() ?? [candidates[0].unit.instanceId];
        for (const id of chosenIds) {
          const found = findUnitById(this.state, id);
          if (found) {
            // Check if a friendly Base/Unit has a WOULD_REST replacement (e.g. GD05-124)
            const repChoice = this.tryRunRestReplacement(found.side, found.unit);
            if (!repChoice) found.unit.rested = true;
          }
        }
        return true;
      }
      case 'DEPLOY_FROM_TRASH': {
        const trashMatches = player.trash.filter((c) => {
          if (step.target.cardType && c.type !== step.target.cardType) return false;
          if (step.target.lvMin !== undefined && (c.lv ?? 1) < step.target.lvMin) return false;
          if (step.target.lvMax !== undefined && (c.lv ?? 1) > step.target.lvMax) return false;
          if (step.target.nameContains && !c.name.toLowerCase().includes(step.target.nameContains.toLowerCase())) {
            return false;
          }
          return true;
        });
        if (trashMatches.length === 0) return false;
        const chosen = trashMatches[0];
        const tIdx = player.trash.indexOf(chosen);
        player.trash.splice(tIdx, 1);
        const unit: ChainUnitInstance = {
          instanceId: `${side}-U-${this.nextEventId('unit')}`,
          card: chosen,
          rested: Boolean(step.rested),
          damage: 0,
          deployedTurn: this.state.turn,
          deployedFromZone: 'trash',
          temporaryModifiers: [],
          triggeredOnceThisTurn: [],
        };
        player.battleArea.push(unit);
        const frame: QueuedTrigger[] = [];
        this.collectUnitTimingTriggers(side, unit, 'DEPLOY', frame);
        this.collectBoardTimingTriggers('WHEN_UNIT_DEPLOYED', frame, side);
        this.drainResolutionFrame(frame);
        return true;
      }
      case 'IF_CONDITION': {
        if (evaluateCondition(step.condition, this.state, side, selfUnit)) {
          let ok = true;
          for (const sub of step.thenSteps) ok = this.executeStep(side, sub, sourceCard, selfUnit, ok);
          return ok;
        } else if (step.elseSteps) {
          let ok = true;
          for (const sub of step.elseSteps) ok = this.executeStep(side, sub, sourceCard, selfUnit, ok);
          return ok;
        }
        return false;
      }
      case 'IF_PREVIOUS_SUCCEEDED': {
        const matches = step.negated ? !prevSucceeded : prevSucceeded;
        if (!matches) return false;
        let ok = true;
        for (const sub of step.thenSteps) ok = this.executeStep(side, sub, sourceCard, selfUnit, ok);
        return ok;
      }
      case 'DAMAGE_PROOF': {
        if (step.target?.cardType === 'SHIELD') {
          this.state.shieldDamageProhibitions = this.state.shieldDamageProhibitions ?? [];
          this.state.shieldDamageProhibitions.push({
            side,
            ...(step.sourceFilter?.lvMax !== undefined ? { lvMax: step.sourceFilter.lvMax } : {}),
            ...(step.sourceFilter?.apMax !== undefined ? { apMax: step.sourceFilter.apMax } : {}),
            duration: step.duration ?? 'THIS_BATTLE',
          });
          return true;
        }
        return true;
      }
      case 'RECOVER_HP': {
        const candidates = step.target.self && selfUnit
          ? [{ side, unit: selfUnit }]
          : this.findLegalUnitTargets(step.target, side, selfUnit);
        if (candidates.length === 0) return false;
        const chosenIds = this.witness.nextTargets() ?? [candidates[0].unit.instanceId];
        for (const id of chosenIds) {
          const found = findUnitById(this.state, id);
          if (found) found.unit.damage = Math.max(0, found.unit.damage - step.amount);
        }
        return true;
      }
      case 'PAIR_SELF_FROM_TRASH': {
        const candidates = this.findLegalUnitTargets(step.target, side, selfUnit).filter(
          (c) => c.side === side && !c.unit.pairedPilot
        );
        if (candidates.length === 0) return false;
        if (!this.witness.nextOptionalAccept(true)) return false;
        const chosenIds = this.witness.nextTargets() ?? [candidates[0].unit.instanceId];
        const target = candidates.find((c) => c.unit.instanceId === chosenIds[0])?.unit ?? candidates[0].unit;
        const trashIdx = player.trash.indexOf(sourceCard);
        if (trashIdx >= 0) {
          player.trash.splice(trashIdx, 1);
        } else {
          this.selfPairedCards.add(sourceCard);
        }
        target.pairedPilot = sourceCard;
        const linked = isUnitLinked(target);
        this.trace.push({
          kind: 'ACTION',
          detail: `${side} paired ${sourceCard.cardNo} from trash onto ${target.card.cardNo} (linked=${linked})`,
        });
        const frame: QueuedTrigger[] = [];
        this.collectUnitTimingTriggers(side, target, 'WHEN_PAIRED', frame);
        if (linked) {
          this.collectUnitTimingTriggers(side, target, 'WHEN_LINKED', frame);
        }
        this.drainResolutionFrame(frame);
        return true;
      }
      default:
        return true;
    }
  }

  protected executeCustomHook(side: ChainSide, unit: ChainUnitInstance, hook: CustomHookAst): void {
    if (hook.hookId === 'ST01-015#2') {
      const player = this.state.players[side];
      this.payActivationCost(side, unit, { resourceCost: 2 });
      const n = player.battleArea.length;
      const spec =
        n === 0
          ? { name: 'Gundam', ap: 3, hp: 3 }
          : n === 1
          ? { name: 'Guncannon', ap: 2, hp: 2 }
          : { name: 'Guntank', ap: 1, hp: 1 };
      const tokenCard: GundamCardPrint = {
        ...unit.card,
        cardNo: 'TOKEN',
        printId: `TOKEN-${spec.name}`,
        name: spec.name,
        type: 'UNIT TOKEN',
        traits: ['White Base Team'],
        ap: spec.ap,
        hp: spec.hp,
        effect: '',
      };
      player.battleArea.push({
        instanceId: `${side}-TOK-${this.nextEventId('tok')}`,
        card: tokenCard,
        rested: false,
        damage: 0,
        deployedTurn: this.state.turn,
        temporaryModifiers: [],
        triggeredOnceThisTurn: [],
      });
      return;
    }
    throw new ChainFailError('UNIMPLEMENTED_CUSTOM_HOOK', `No execution handler for ${hook.hookId}.`);
  }
}
