import { type IToken } from 'chevrotain';
import type {
  EffectCondition,
  EffectDuration,
  ScaleMetric,
  TargetSelector,
  TriggerEvent,
} from '../effect-parser.ts';
import { ParenToken } from './tokens.ts';
import {
  extractAllTraitsFromTokens,
  extractQuotes,
  findWordSeq,
  hasAnyWord,
  hasWordSeq,
  parseResCostValue,
} from './token-utils.ts';

export function lowerDuration(toks: IToken[]): EffectDuration | undefined {
  if (hasWordSeq(toks, ['during', 'this', 'battle'])) return 'THIS_BATTLE';
  if (
    hasWordSeq(toks, ['during', 'this', 'turn']) ||
    hasWordSeq(toks, ['until', 'the', 'end', 'of', 'this', 'turn']) ||
    hasWordSeq(toks, ['until', 'end', 'of', 'turn']) ||
    hasWordSeq(toks, ['this', 'turn'])
  ) {
    return 'THIS_TURN';
  }
  if (hasWordSeq(toks, ["opponent's", 'next', 'turn'])) return 'NEXT_TURN';
  return undefined;
}

export function lowerScaleMetric(toks: IToken[]): ScaleMetric | undefined {
  if (hasWordSeq(toks, ['number', 'of', 'cards', 'in', 'your', 'hand'])) {
    return { metric: 'HAND_COUNT', owner: 'SELF' };
  }
  if (hasWordSeq(toks, ['amount', 'of', 'damage', 'it', 'has', 'received'])) {
    return { metric: 'SELF_DAMAGE', owner: 'SELF' };
  }
  if (hasWordSeq(toks, ['cost', 'paid'])) return { metric: 'PAID_COST' };
  if (hasWordSeq(toks, ['number', 'of', 'enemy', 'players'])) {
    return { metric: 'ENEMY_PLAYER_COUNT', owner: 'ENEMY' };
  }
  if (hasWordSeq(toks, ['number', 'of', 'units', 'rested', 'with', 'this', 'effect'])) {
    return { metric: 'AFFECTED_COUNT' };
  }
  if (hasWordSeq(toks, ['same', 'number', 'of', 'cards', 'you', 'drew', 'with', 'this', 'effect'])) {
    return { metric: 'DRAWN_COUNT' };
  }
  if (hasWordSeq(toks, ['cards', 'placed', 'with', 'this', 'effect'])) {
    return { metric: 'AFFECTED_COUNT', traits: extractAllTraitsFromTokens(toks) };
  }
  if (hasWordSeq(toks, ['in', 'your', 'trash'])) {
    const traits = extractAllTraitsFromTokens(toks);
    const quotes = extractQuotes(toks);
    return {
      metric: 'TRASH_COUNT',
      owner: 'SELF',
      ...(traits.length > 0 ? { traits } : {}),
      ...(quotes.length > 0 ? { nameContains: quotes[0] } : {}),
      ...(hasWordSeq(toks, ['unique', 'names']) ? { uniqueNames: true } : {}),
    };
  }
  if (hasWordSeq(toks, ['rested', 'enemy', 'units']) || hasWordSeq(toks, ['rested', 'enemy', 'unit'])) {
    return { metric: 'RESTED_ENEMY_UNIT_COUNT', owner: 'ENEMY', cardType: 'UNIT', rested: true };
  }
  if (hasWordSeq(toks, ['enemy', 'units', 'in', 'play']) || hasWordSeq(toks, ['enemy', 'unit', 'in', 'play'])) {
    return { metric: 'ENEMY_UNIT_COUNT', owner: 'ENEMY', cardType: 'UNIT' };
  }
  if (hasWordSeq(toks, ['unit', 'tokens', 'you', 'have', 'in', 'play']) || hasWordSeq(toks, ['friendly', 'unit', 'tokens', 'in', 'play'])) {
    return {
      metric: 'BOARD_UNIT_COUNT',
      owner: 'SELF',
      cardType: 'UNIT_TOKEN',
      traits: extractAllTraitsFromTokens(toks),
    };
  }
  if (
    (hasWordSeq(toks, ['in', 'play']) || hasAnyWord(toks, ['friendly', 'your'])) &&
    hasAnyWord(toks, ['unit', 'units']) &&
    !hasWordSeq(toks, ['in', 'your', 'trash'])
  ) {
    const traits = extractAllTraitsFromTokens(toks);
    return {
      metric: 'BOARD_UNIT_COUNT',
      owner: hasAnyWord(toks, ['enemy', 'opponent']) ? 'ENEMY' : 'SELF',
      cardType: 'UNIT',
      ...(traits.length > 0 ? { traits } : {}),
    };
  }
  return undefined;
}

export function lowerTriggerEventFromTokens(
  triggerToks: IToken[],
  extraCondToks: IToken[] | undefined,
  lowerCondFn: (toks: IToken[]) => EffectCondition | undefined,
  lowerSelFn: (toks: IToken[]) => TargetSelector
): { triggerEvent: TriggerEvent; extraCondition?: EffectCondition } {
  let activeToks = triggerToks;
  let extraCondition: EffectCondition | undefined = extraCondToks ? lowerCondFn(extraCondToks) : undefined;
  let whileAttacking = false;

  const whileIdx = findWordSeq(activeToks, ['while']);
  if (whileIdx > 0) {
    const whileSlice = activeToks.slice(whileIdx);
    activeToks = activeToks.slice(0, whileIdx);
    if (hasWordSeq(whileSlice, ['while', 'this', 'unit', 'is', 'attacking'])) {
      whileAttacking = true;
    } else {
      const parsed = lowerCondFn(whileSlice);
      if (parsed) extraCondition = parsed;
    }
  }

  let kind: TriggerEvent['kind'] = 'WHEN_ATTACKED';
  let actor: TriggerEvent['actor'] = 'SELF';
  let actorFilter: TargetSelector | undefined;
  let targetKind: TriggerEvent['targetKind'];
  let targetFilter: TargetSelector | undefined;
  let damageType: TriggerEvent['damageType'];

  if (hasWordSeq(activeToks, ['this', 'unit', 'is', 'attacked'])) {
    kind = 'WHEN_ATTACKED';
    actor = 'SELF';
  } else if (hasWordSeq(activeToks, ['another', 'unit', 'attacks'])) {
    kind = 'ATTACK';
    actor = 'ANY';
    actorFilter = lowerSelFn(activeToks.slice(1));
  } else if (
    (hasAnyWord(activeToks, ['destroy', 'destroys', 'destroyed']) && hasWordSeq(activeToks, ['with', 'damage'])) ||
    (hasAnyWord(activeToks, ['destroy', 'destroys', 'destroyed']) && hasWordSeq(activeToks, ['with', 'battle', 'damage'])) ||
    (hasAnyWord(activeToks, ['destroy', 'destroys', 'destroyed']) && hasWordSeq(activeToks, ['with', 'effect', 'damage']))
  ) {
    kind = 'WHEN_DESTROY_BY_BATTLE';
    damageType = hasWordSeq(activeToks, ['battle', 'damage'])
      ? 'BATTLE'
      : hasWordSeq(activeToks, ['effect', 'damage'])
      ? 'EFFECT'
      : 'ANY';
    const destIdx = activeToks.findIndex((t) => ['destroy', 'destroys', 'destroyed'].includes(t.image.toLowerCase()));
    if (hasWordSeq(activeToks.slice(0, destIdx), ['an', 'enemy'])) {
      actor = 'ENEMY';
      targetKind = 'UNIT';
      targetFilter = lowerSelFn(activeToks);
    } else if (hasAnyWord(activeToks.slice(0, destIdx), ['your', 'friendly'])) {
      actor = 'FRIENDLY';
      actorFilter = lowerSelFn(activeToks.slice(0, destIdx));
    } else {
      actor = 'SELF';
    }
    const afterDest = destIdx >= 0 ? activeToks.slice(destIdx + 1) : activeToks;
    if (hasWordSeq(afterDest, ['enemy', 'card'])) targetKind = 'ANY_ENEMY_CARD';
    else if (hasWordSeq(afterDest, ['shield', 'area', 'card'])) targetKind = 'SHIELD';
    else if (hasWordSeq(afterDest, ['enemy', 'unit'])) {
      targetKind = 'UNIT';
      targetFilter = lowerSelFn(afterDest);
    }
  } else if (hasWordSeq(activeToks, ['deals', 'damage']) || hasWordSeq(activeToks, ['deals', 'battle', 'damage'])) {
    kind = 'WHEN_DEAL_DAMAGE';
    damageType = hasWordSeq(activeToks, ['battle', 'damage']) ? 'BATTLE' : 'ANY';
    actor = hasAnyWord(activeToks.slice(0, 6), ['your', 'friendly']) ? 'FRIENDLY' : 'SELF';
    if (hasAnyWord(activeToks.slice(0, 6), ['your']) && activeToks.slice(0, 6).some((t) => t.tokenType === ParenToken)) {
      actorFilter = lowerSelFn(activeToks.slice(0, 6));
    }
    const toIdx = findWordSeq(activeToks, ['to']);
    if (toIdx >= 0) targetFilter = lowerSelFn(activeToks.slice(toIdx + 1));
    targetKind = 'UNIT';
  } else if (hasAnyWord(activeToks, ['receive', 'receives']) && hasAnyWord(activeToks, ['damage'])) {
    kind = 'WHEN_RECEIVE_DAMAGE';
    damageType = hasWordSeq(activeToks, ['battle', 'damage'])
      ? 'BATTLE'
      : hasWordSeq(activeToks, ['effect', 'damage'])
      ? 'EFFECT'
      : 'ANY';
    actor = hasAnyWord(activeToks, ['friendly', 'your']) ? 'FRIENDLY' : 'SELF';
    targetKind = hasAnyWord(activeToks, ['shield'])
      ? 'SHIELD'
      : hasWordSeq(activeToks, ['this', 'base'])
      ? 'BASE'
      : 'UNIT';
  } else if (hasWordSeq(activeToks, ['recovers', 'hp'])) {
    kind = 'WHEN_RECOVER_HP';
    actor = 'SELF';
  } else if (hasWordSeq(activeToks, ['is', 'deployed']) || hasWordSeq(activeToks, ['are', 'deployed'])) {
    kind = 'WHEN_UNIT_DEPLOYED';
    actor =
      hasWordSeq(activeToks, ['this', 'unit', 'or']) || hasAnyWord(activeToks, ['your', 'friendly', 'another'])
        ? 'FRIENDLY'
        : 'SELF';
    actorFilter = lowerSelFn(activeToks);
  } else if (hasWordSeq(activeToks, ['pair', 'a', 'pilot'])) {
    kind = 'WHEN_UNIT_PAIRED';
    actor = 'FRIENDLY';
  } else if (hasAnyWord(activeToks, ['link', 'links'])) {
    kind = 'WHEN_UNIT_LINKED';
    actor = 'FRIENDLY';
    actorFilter = lowerSelFn(activeToks);
  } else if (hasWordSeq(activeToks, ['is', 'destroyed', 'by', 'an', 'effect'])) {
    kind = 'WHEN_UNIT_DESTROYED';
    actor = 'FRIENDLY';
  } else if (hasWordSeq(activeToks, ['is', 'rested']) || hasWordSeq(activeToks, ['would', 'rest'])) {
    kind = 'WHEN_RESTED';
    actor = hasWordSeq(activeToks, ['this', 'unit']) ? 'SELF' : 'FRIENDLY';
  } else if (hasWordSeq(activeToks, ['is', 'blocked']) || hasAnyWord(activeToks, ['activates'])) {
    kind = 'WHEN_BLOCKED';
    actor = 'SELF';
  } else if (hasWordSeq(activeToks, ['ex', 'resource']) && hasAnyWord(activeToks, ['exile', 'exiled', 'exiles'])) {
    kind = 'WHEN_EXILE_EX_RESOURCE';
    actor = 'FRIENDLY';
  } else if (hasWordSeq(activeToks, ['place', 'an', 'ex', 'resource'])) {
    kind = 'WHEN_PLACE_EX_RESOURCE';
    actor = 'SELF';
  } else if (hasWordSeq(activeToks, ['using', 'an', 'ex', 'resource'])) {
    kind = 'WHEN_PLAY_CARD_WITH_EX_RESOURCE';
    actor = 'SELF';
    targetFilter = lowerSelFn(activeToks);
  } else if (hasWordSeq(activeToks, ['activate', 'a']) && hasAnyWord(activeToks, ['command'])) {
    kind = 'WHEN_ACTIVATE_COMMAND';
    actor = 'SELF';
    targetFilter = lowerSelFn(activeToks);
  } else if (hasAnyWord(activeToks, ['pay']) && activeToks.some((t) => parseResCostValue(t) !== undefined)) {
    kind = 'WHEN_PAY_EFFECT_COST';
    actor = 'FRIENDLY';
  } else if (hasWordSeq(activeToks, ['draw', 'with', 'an', 'effect'])) {
    kind = 'WHEN_DRAW';
    actor = 'SELF';
  } else if (hasWordSeq(activeToks, ['ap', 'is', 'reduced'])) {
    kind = 'WHEN_AP_REDUCED';
    actor = 'SELF';
  } else if (hasWordSeq(activeToks, ['playing', 'this', 'card'])) {
    kind = 'WHEN_PLAYING';
    actor = 'SELF';
    const pairIdx = findWordSeq(activeToks, ['pairing', 'it', 'with']);
    if (pairIdx >= 0) {
      const pairingToks = activeToks.slice(pairIdx + 3);
      const tgt = lowerSelFn(pairingToks);
      const linkCondIdx = findWordSeq(pairingToks, ['link', 'condition']);
      const bracketTok =
        linkCondIdx > 0 && pairingToks[linkCondIdx - 1]?.image.startsWith('[')
          ? pairingToks[linkCondIdx - 1].image.slice(1, -1).trim()
          : undefined;
      extraCondition = {
        kind: 'SELF_STATE',
        pairedWithUnit: {
          ...(tgt.traits ? { traits: tgt.traits } : tgt.trait ? { traits: [tgt.trait] } : {}),
          ...(tgt.nameContains ? { nameContains: tgt.nameContains } : {}),
          ...(bracketTok ? { linkNames: [bracketTok] } : {}),
          ...(tgt.lvMin !== undefined ? { lvMin: tgt.lvMin } : {}),
        },
      };
    }
  }

  return {
    triggerEvent: {
      kind,
      actor,
      ...(actorFilter ? { actorFilter } : {}),
      ...(targetKind ? { targetKind } : {}),
      ...(targetFilter ? { targetFilter } : {}),
      ...(damageType ? { damageType } : {}),
      ...(whileAttacking ? { whileAttacking } : {}),
      raw: triggerToks.map((t) => t.image).join(' '),
    },
    ...(extraCondition ? { extraCondition } : {}),
  };
}
