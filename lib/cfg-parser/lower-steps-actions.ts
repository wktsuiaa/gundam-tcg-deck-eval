import { type IToken } from 'chevrotain';
import type { EffectStep, TargetSelector } from '../effect-parser.ts';
import { lowerScaleMetric, lowerTargetSelector } from './lower-selectors.ts';
import {
  NumberTok,
  ParenToken,
  VActivate,
  VAdd,
  VCount,
  VDeal,
  VDeploy,
  VDestroy,
  VDiscard,
  VDraw,
  VExile,
  VLook,
  VPair,
  VPay,
  VPlace,
  VRecovers,
  VRest,
  VReturn,
  VReveal,
  VSet,
} from './tokens.ts';
import {
  extractAllTraitsFromTokens,
  extractBrackets,
  findWordSeq,
  hasAnyWord,
  hasWordSeq,
  parseIntTok,
  parseResCostValue,
  stripParens,
} from './token-utils.ts';

export interface LoweringState {
  chosenTarget?: TargetSelector;
  depth: number;
}

export const SELF_UNIT_TARGET: TargetSelector = { owner: 'SELF', self: true, cardType: 'UNIT' };

export function resolveSubjectTokens(toks: IToken[], state: LoweringState): TargetSelector {
  const head = toks[0]?.image.toLowerCase();
  if (
    (head === 'it' || head === 'its' || head === 'them' || head === 'they' || head === 'their' || head === 'that' || head === 'those') &&
    state.chosenTarget
  ) {
    return state.chosenTarget;
  }
  if (
    hasWordSeq(toks, ['that', 'unit']) ||
    hasWordSeq(toks, ['those', 'units']) ||
    hasWordSeq(toks, ['that', 'enemy', 'unit']) ||
    hasWordSeq(toks, ['the', 'chosen', 'unit']) ||
    hasWordSeq(toks, ['the', 'revealed', 'card'])
  ) {
    return state.chosenTarget ?? lowerTargetSelector(toks);
  }
  if (toks.length === 1 && (head === 'it' || head === 'they')) {
    return state.chosenTarget ?? SELF_UNIT_TARGET;
  }
  return lowerTargetSelector(toks);
}

function parseTokenParenSpecs(toks: IToken[]): { ap?: number; hp?: number; traits: string[] } {
  const traits: string[] = [];
  let ap: number | undefined;
  let hp: number | undefined;
  for (const t of toks) {
    if (t.tokenType !== ParenToken) continue;
    const inner = stripParens(t.image);
    const parts = inner.split('<DOT>');
    for (const part of parts) {
      const p = part.trim();
      if (p.startsWith('(') && p.endsWith(')')) {
        const tr = p.slice(1, -1).trim();
        if (tr) traits.push(tr);
      } else if (p.toUpperCase().startsWith('AP')) {
        const v = Number.parseInt(p.slice(2), 10);
        if (!Number.isNaN(v)) ap = v;
      } else if (p.toUpperCase().startsWith('HP')) {
        const v = Number.parseInt(p.slice(2), 10);
        if (!Number.isNaN(v)) hp = v;
      } else if (parts.length === 1 && p) {
        traits.push(p);
      }
    }
  }
  return { ...(ap !== undefined ? { ap } : {}), ...(hp !== undefined ? { hp } : {}), traits };
}

export function lowerVerbActionSentence(
  toks: IToken[],
  state: LoweringState,
  optional: boolean
): EffectStep[] | null {
  const firstTok = toks[0];
  if (!firstTok) return null;

  if (firstTok.tokenType === VDeal) {
    const eqIdx = findWordSeq(toks, ['equal', 'to']);
    const scaleBy = eqIdx >= 0 ? lowerScaleMetric(toks.slice(eqIdx)) : undefined;
    const amt = parseIntTok(toks.find((t) => t.tokenType === NumberTok)) ?? 1;
    const toIdx = findWordSeq(toks, ['to']);
    const targetToks = toIdx >= 0 ? toks.slice(toIdx + 1) : toks.slice(1);
    const target = resolveSubjectTokens(targetToks, state);
    return [{ action: 'DEAL_DAMAGE', amount: amt, ...(scaleBy ? { scaleBy } : {}), target }];
  }

  if (firstTok.tokenType === VDestroy) {
    const target = resolveSubjectTokens(toks.slice(1), state);
    return [{ action: 'DESTROY', target }];
  }

  if (firstTok.tokenType === VRest) {
    const target = resolveSubjectTokens(toks.slice(1), state);
    return [{ action: 'REST', target }];
  }

  if (firstTok.tokenType === VSet) {
    const asIdx = findWordSeq(toks, ['as']);
    const targetToks = asIdx > 1 ? toks.slice(1, asIdx) : toks.slice(1);
    const target = resolveSubjectTokens(targetToks, state);
    if (target.self) state.chosenTarget = target;
    if (hasWordSeq(toks, ['as', 'active'])) return [{ action: 'SET_ACTIVE', target }];
    if (hasWordSeq(toks, ['as', 'rested'])) return [{ action: 'REST', target }];
  }

  if (firstTok.tokenType === VReturn) {
    const toIdx = findWordSeq(toks, ['to']);
    const targetToks = toIdx > 1 ? toks.slice(1, toIdx) : toks.slice(1);
    const target = resolveSubjectTokens(targetToks, state);
    if (hasWordSeq(toks, ["owner's", 'hand']) || hasWordSeq(toks, ['your', 'hand'])) {
      return [{ action: 'BOUNCE', target }];
    }
    const pos = hasWordSeq(toks, ['top'])
      ? ('TOP' as const)
      : hasWordSeq(toks, ['bottom'])
      ? ('BOTTOM' as const)
      : ('SHUFFLE' as const);
    return [
      {
        action: 'RETURN_TO_DECK',
        position: pos,
        ...(hasAnyWord(toks, ['shuffle']) ? { shuffle: true } : {}),
        target,
      },
    ];
  }

  if (firstTok.tokenType === VExile) {
    const target = resolveSubjectTokens(toks.slice(1), state);
    return [{ action: 'EXILE', target }];
  }

  if (toks.some((t) => t.tokenType === VRecovers)) {
    const recIdx = toks.findIndex((t) => t.tokenType === VRecovers);
    const target = resolveSubjectTokens(recIdx > 0 ? toks.slice(0, recIdx) : [firstTok], state);
    const amt = parseIntTok(toks.slice(recIdx).find((t) => t.tokenType === NumberTok)) ?? 1;
    return [{ action: 'RECOVER_HP', amount: amt, target }];
  }

  if (firstTok.tokenType === VAdd) {
    if (hasWordSeq(toks, ['this', 'card', 'to', 'your', 'hand'])) return [{ action: 'ADD_SELF_TO_HAND' }];
    if (hasAnyWord(toks, ['shield', 'shields'])) {
      const cnt = parseIntTok(toks.find((t) => t.tokenType === NumberTok)) ?? 1;
      return [{ action: 'ADD_SHIELD_TO_HAND', count: cnt }];
    }
    if (hasAnyWord(toks, ['resource', 'resources'])) {
      const cnt = parseIntTok(toks.find((t) => t.tokenType === NumberTok)) ?? 1;
      return [
        {
          action: 'ADD_RESOURCE',
          count: cnt,
          ...(hasWordSeq(toks, ['ex', 'resource']) || hasWordSeq(toks, ['ex', 'resources']) ? { ex: true } : {}),
          ...(hasAnyWord(toks, ['rested']) ? { rested: true } : {}),
        },
      ];
    }
    if (hasWordSeq(toks, ['from', 'your', 'trash']) || hasWordSeq(toks, ['from', 'any', "player's", 'trash']) || state.chosenTarget?.zone === 'TRASH') {
      const toHandIdx = findWordSeq(toks, ['to', 'your', 'hand']);
      const targetToks = toHandIdx > 1 ? toks.slice(1, toHandIdx) : toks.slice(1);
      const target = resolveSubjectTokens(targetToks, state);
      return [{ action: 'ADD_FROM_TRASH_TO_HAND', target }];
    }
    if (hasWordSeq(toks, ['to', 'your', 'hand'])) {
      const cnt = parseIntTok(toks.find((t) => t.tokenType === NumberTok)) ?? 1;
      return [{ action: 'DRAW', count: cnt }];
    }
  }

  if (firstTok.tokenType === VDraw || hasWordSeq(toks, ['all', 'players', 'draw']) || hasWordSeq(toks, ['each', 'player', 'draws'])) {
    const eqIdx = findWordSeq(toks, ['equal', 'to']);
    const scaleBy = eqIdx >= 0 ? lowerScaleMetric(toks.slice(eqIdx)) : undefined;
    const cnt = parseIntTok(toks.find((t) => t.tokenType === NumberTok)) ?? 1;
    const both = hasWordSeq(toks, ['all', 'players']) || hasWordSeq(toks, ['each', 'player']);
    const enemyOnly = hasWordSeq(toks, ['enemy', 'player']) || hasWordSeq(toks, ['your', 'opponent']);
    return [
      {
        action: 'DRAW',
        count: cnt,
        ...(scaleBy ? { scaleBy } : {}),
        ...(both ? { bothPlayers: true, targetOwner: 'ALL_PLAYERS' as const } : enemyOnly ? { targetOwner: 'ENEMY' as const } : {}),
        ...(optional ? { optional: true } : {}),
      },
    ];
  }

  if (firstTok.tokenType === VDiscard || hasWordSeq(toks, ['all', 'enemy', 'players', 'each', 'discard']) || hasWordSeq(toks, ['your', 'opponent', 'discards'])) {
    const eqIdx = findWordSeq(toks, ['equal', 'to']);
    const scaleBy = eqIdx >= 0 ? lowerScaleMetric(toks.slice(eqIdx)) : undefined;
    const cnt = parseIntTok(toks.find((t) => t.tokenType === NumberTok)) ?? 1;
    const owner = hasAnyWord(toks, ['enemy', 'opponent'])
      ? hasWordSeq(toks, ['all', 'players'])
        ? ('ALL_PLAYERS' as const)
        : ('ENEMY' as const)
      : ('SELF' as const);
    return [
      {
        action: 'DISCARD',
        count: cnt,
        ...(scaleBy ? { scaleBy } : {}),
        targetOwner: owner,
        ...(optional ? { optional: true } : {}),
      },
    ];
  }

  if (firstTok.tokenType === VLook) {
    const topIdx = findWordSeq(toks, ['top']);
    const afterTop = topIdx >= 0 ? toks.slice(topIdx + 1) : toks;
    const cnt =
      afterTop[0]?.tokenType === NumberTok
        ? parseIntTok(afterTop[0]) ?? 1
        : afterTop[0]?.image.toLowerCase() === 'card'
        ? 1
        : parseIntTok(toks.find((t) => t.tokenType === NumberTok)) ?? 3;
    const remAnchor = [
      findWordSeq(toks, ['remaining']),
      findWordSeq(toks, ['rest']),
      findWordSeq(toks, ['return']),
      findWordSeq(toks, ['place']),
    ].filter((x) => x >= 0);
    const remIdx = remAnchor.length > 0 ? Math.min(...remAnchor) : -1;
    const remToks = remIdx >= 0 ? toks.slice(remIdx) : [];
    const revealSearch = hasAnyWord(toks, ['reveal']) || hasWordSeq(toks, ['add', '1']) || hasWordSeq(toks, ['add', 'it']);
    const trashRest = remToks.length > 0 && hasAnyWord(remToks, ['trash']);
    const traits = extractAllTraitsFromTokens(toks);
    const remainderPosition =
      remToks.length === 0
        ? undefined
        : trashRest
        ? ('TRASH' as const)
        : hasWordSeq(remToks, ['top'])
        ? ('TOP' as const)
        : ('BOTTOM' as const);
    return [
      {
        action: 'LOOK_TOP',
        count: cnt,
        ...(revealSearch ? { revealSearch: true } : {}),
        ...(trashRest ? { trashRest: true } : {}),
        ...(traits.length > 0 ? { trait: traits[0] } : {}),
        ...(revealSearch ? { target: lowerTargetSelector(toks) } : {}),
        ...(remainderPosition ? { remainderPosition } : {}),
      },
    ];
  }

  if (firstTok.tokenType === VReveal) {
    if (hasWordSeq(toks, ['from', 'your', 'hand'])) {
      return [{ action: 'REVEAL_FROM_HAND', target: lowerTargetSelector(toks.slice(1)) }];
    }
    const cnt = parseIntTok(toks.find((t) => t.tokenType === NumberTok)) ?? 1;
    return [{ action: 'REVEAL_TOP', count: cnt }];
  }

  if (firstTok.tokenType === VPlace) {
    if (hasWordSeq(toks, ['ex', 'resource']) || hasWordSeq(toks, ['ex', 'resources'])) {
      const cnt = parseIntTok(toks.find((t) => t.tokenType === NumberTok)) ?? 1;
      return [{ action: 'ADD_RESOURCE', count: cnt, ex: true, ...(hasAnyWord(toks, ['rested']) ? { rested: true } : {}) }];
    }
    if (hasAnyWord(toks, ['resource', 'resources'])) {
      const cnt = parseIntTok(toks.find((t) => t.tokenType === NumberTok)) ?? 1;
      return [{ action: 'ADD_RESOURCE', count: cnt, ...(hasAnyWord(toks, ['rested']) ? { rested: true } : {}) }];
    }
    if (hasWordSeq(toks, ['ex', 'base'])) {
      return [{ action: 'DEPLOY_TOKEN', count: 1, exBase: true, baseToken: true }];
    }
    if (hasWordSeq(toks, ['in', 'your', 'trash']) || hasWordSeq(toks, ['into', 'your', 'trash'])) {
      const cnt = parseIntTok(toks.find((t) => t.tokenType === NumberTok)) ?? 1;
      return [{ action: 'MILL', count: cnt }];
    }
  }

  if (firstTok.tokenType === VDeploy) {
    if (hasWordSeq(toks, ['this', 'card'])) return [{ action: 'DEPLOY_SELF' }];
    if (hasWordSeq(toks, ['token']) || hasWordSeq(toks, ['tokens']) || hasWordSeq(toks, ['ex', 'base'])) {
      const cnt = parseIntTok(toks.find((t) => t.tokenType === NumberTok)) ?? 1;
      const names = extractBrackets(toks);
      const specs = parseTokenParenSpecs(toks);
      const owner = hasWordSeq(toks, ['that', 'was', 'destroyed'])
        ? ('DESTROYED_OWNER' as const)
        : hasWordSeq(toks, ['enemy', 'player'])
        ? ('ENEMY' as const)
        : ('SELF' as const);
      return [
        {
          action: 'DEPLOY_TOKEN',
          count: cnt,
          ...(specs.ap !== undefined ? { ap: specs.ap } : {}),
          ...(specs.hp !== undefined ? { hp: specs.hp } : {}),
          ...(names.length > 0 ? { name: names[0] } : {}),
          ...(specs.traits.length > 0 ? { traits: specs.traits } : {}),
          ...(owner !== 'SELF' ? { owner } : {}),
          ...(hasWordSeq(toks, ['base', 'token']) ? { baseToken: true } : {}),
          ...(hasWordSeq(toks, ['ex', 'base']) ? { exBase: true } : {}),
        },
      ];
    }
    if (hasWordSeq(toks, ['from', 'your', 'trash']) || state.chosenTarget?.zone === 'TRASH') {
      const target = resolveSubjectTokens(toks.slice(1), state);
      const free = !hasWordSeq(toks, ['by', 'paying']);
      return [{ action: 'DEPLOY_FROM_TRASH', free, ...(hasAnyWord(toks, ['rested']) ? { rested: true } : {}), target }];
    }
    if (hasWordSeq(toks, ['from', 'your', 'hand'])) {
      const target = lowerTargetSelector(toks.slice(1));
      const free = !hasWordSeq(toks, ['by', 'paying']);
      return [{ action: 'DEPLOY_FROM_HAND', free, ...(hasAnyWord(toks, ['rested']) ? { rested: true } : {}), target }];
    }
    if (hasWordSeq(toks, ['top', 'of', 'your', 'deck']) || hasWordSeq(toks, ['revealed', 'card'])) {
      return [{ action: 'DEPLOY_FROM_TOP_DECK', target: lowerTargetSelector(toks.slice(1)) }];
    }
  }

  if (firstTok.tokenType === VPair) {
    if (hasWordSeq(toks, ['this', 'card']) || hasWordSeq(toks, ['it', 'from', 'your', 'trash'])) {
      const withIdx = findWordSeq(toks, ['with']);
      const targetToks = withIdx >= 0 ? toks.slice(withIdx + 1) : toks.slice(1);
      const tgt = lowerTargetSelector(targetToks);
      if (!tgt.zone) tgt.zone = 'BATTLE_AREA';
      return [{ action: 'PAIR_SELF_FROM_TRASH', target: tgt }];
    }
    return [{ action: 'PAIR_FROM_HAND', target: lowerTargetSelector(toks.slice(1)) }];
  }

  if (firstTok.tokenType === VPay) {
    const costTok = toks.find((t) => parseResCostValue(t) !== undefined);
    const amt = (costTok ? parseResCostValue(costTok) : undefined) ?? 1;
    return [{ action: 'PAY_RESOURCE', amount: amt, ...(optional ? { optional: true } : {}) }];
  }

  if (firstTok.tokenType === VCount) {
    return [
      {
        action: 'COUNT_UNITS',
        target: lowerTargetSelector(toks.slice(1)),
        ...(hasWordSeq(toks, ['and', 'this', 'unit']) ? { plusSelf: true } : {}),
      },
    ];
  }

  if (firstTok.tokenType === VActivate) {
    const fromDiscard = hasWordSeq(toks, ['from', 'your', 'trash']);
    return [{ action: 'ACTIVATE_MAIN_EFFECT', ...(fromDiscard ? { fromDiscard: true } : {}) }];
  }

  return null;
}
