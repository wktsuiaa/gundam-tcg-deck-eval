import type { GundamCardPrint } from '../../types/gundam.ts';
import type { EffectClauseAst } from '../cfg-parser.ts';
import { ActionStepWitnessMove, ChainPlayerState, ChainSide, ChainUnitInstance, ChainWitness, IllegalChainReason } from './types';

export class WitnessCursor {
  private readonly w: ChainWitness;
  private resIdx = 0;
  private zoneIdx = 0;
  private targetIdx = 0;
  private optIdx = 0;
  private modalIdx = 0;
  private orderIdx = 0;
  private repIdx = 0;
  private actionIdx = 0;
  private burstAccIdx = 0;
  private deckIdx = 0;

  constructor(w: ChainWitness) {
    this.w = w;
  }

  nextResourceSpend(cost: number, activeReg: number, activeEx: number): { regular: number; ex: number } | null {
    const provided = this.w.resourceSpends?.[this.resIdx];
    if (provided) {
      this.resIdx += 1;
      if (provided.regular + provided.ex !== cost) return null;
      if (provided.regular > activeReg || provided.ex > activeEx) return null;
      return provided;
    }
    // Unambiguous auto-spend if only regular or only ex resources cover it
    if (cost === 0) return { regular: 0, ex: 0 };
    if (activeEx === 0 && activeReg >= cost) return { regular: cost, ex: 0 };
    if (activeReg === 0 && activeEx >= cost) return { regular: 0, ex: cost };
    if (activeReg >= cost) return { regular: cost, ex: 0 };
    const exNeeded = cost - activeReg;
    if (activeEx >= exNeeded) return { regular: activeReg, ex: exNeeded };
    return null;
  }

  nextZoneReplacement(): string | null {
    const v = this.w.zoneReplacements?.[this.zoneIdx];
    if (v === undefined) return null;
    this.zoneIdx += 1;
    return v;
  }

  nextTargets(): string[] | null {
    const v = this.w.targets?.[this.targetIdx];
    if (v === undefined) return null;
    this.targetIdx += 1;
    return v;
  }

  nextOptionalAccept(defaultVal = true): boolean {
    const v = this.w.optionalAccepts?.[this.optIdx];
    if (v === undefined) return defaultVal;
    this.optIdx += 1;
    return v;
  }

  nextModalChoice(): number | null {
    const v = this.w.modalChoices?.[this.modalIdx];
    if (v === undefined) return null;
    this.modalIdx += 1;
    return v;
  }

  nextTriggerOrder(count: number): number[] {
    const v = this.w.triggerOrders?.[this.orderIdx];
    if (v !== undefined && v.length === count) {
      this.orderIdx += 1;
      return v;
    }
    return Array.from({ length: count }, (_, i) => i);
  }

  nextReplacementChoice(): { accept: boolean; targetId?: string } | null {
    const v = this.w.replacementChoices?.[this.repIdx];
    if (v === undefined) return null;
    this.repIdx += 1;
    return v;
  }

  nextActionStepMove(): ActionStepWitnessMove | null {
    const v = this.w.actionSteps?.[this.actionIdx];
    if (v === undefined) return null;
    this.actionIdx += 1;
    return v;
  }

  nextBurstAccept(): boolean {
    const v = this.w.burstAccepts?.[this.burstAccIdx];
    if (v === undefined) return true;
    this.burstAccIdx += 1;
    return v;
  }

  peekBurstOrder(count: number): number[] {
    if (this.w.burstOrder && this.w.burstOrder.length === count) {
      return this.w.burstOrder;
    }
    return Array.from({ length: count }, (_, i) => i);
  }

  drawFromDeck(player: ChainPlayerState): GundamCardPrint | null {
    if (player.deck.length > 0) return player.deck.shift()!;
    const revealed = this.w.deckTopReveals?.[this.deckIdx];
    if (revealed) {
      this.deckIdx += 1;
      return revealed;
    }
    return null;
  }
}

export interface QueuedTrigger {
  side: ChainSide;
  clause: EffectClauseAst;
  sourceCard: GundamCardPrint;
  sourceUnitId?: string;
  lastKnownUnit?: ChainUnitInstance;
  ctx?: { destroyedByBattle?: boolean };
}

export class ChainFailError extends Error {
  public readonly reason: IllegalChainReason;
  constructor(reason: IllegalChainReason, message: string) {
    super(message);
    this.reason = reason;
  }
}
