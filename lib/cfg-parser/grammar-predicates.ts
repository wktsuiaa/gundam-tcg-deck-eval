import { type TokenType } from 'chevrotain';
import { KEYWORD_NAMES } from './normalize.ts';
import {
  VActivate,
  VAdd,
  VBegin,
  VChange,
  VChoose,
  VCount,
  VDeal,
  VDeploy,
  VDestroy,
  VDiscard,
  VDraw,
  VExile,
  VIncrease,
  VLook,
  VPair,
  VPay,
  VPlace,
  VRecovers,
  VReduce,
  VRest,
  VReturn,
  VReveal,
  VSet,
} from './tokens.ts';

export const IMPERATIVE_VERB_TOKENS: Set<TokenType> = new Set([
  VChoose,
  VDraw,
  VDiscard,
  VLook,
  VReveal,
  VDestroy,
  VDeal,
  VIncrease,
  VReduce,
  VRecovers,
  VRest,
  VSet,
  VReturn,
  VExile,
  VDeploy,
  VPair,
  VAdd,
  VPlace,
  VPay,
  VCount,
  VChange,
  VBegin,
  VActivate,
]);

export const COST_VERB_TOKENS: Set<TokenType> = new Set([
  VRest,
  VDestroy,
  VDiscard,
  VExile,
  VReturn,
]);

export function parseKeywordTokenText(raw: string): boolean {
  const trimmed = raw.trim();
  const inner =
    (trimmed.startsWith('<') && trimmed.endsWith('>')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ? trimmed.slice(1, -1).trim()
      : trimmed;
  if (!inner) return false;
  const parts = inner.split(/\s+/);
  const last = parts[parts.length - 1];
  const hasNum = parts.length > 1 && last.split('').every((ch) => ch >= '0' && ch <= '9');
  const kwName = (hasNum ? parts.slice(0, -1).join(' ') : inner).toLowerCase();
  return Object.prototype.hasOwnProperty.call(KEYWORD_NAMES, kwName);
}

export function isStaticTimingTag(img: string): boolean {
  const low = img.toLowerCase();
  return (
    low.includes('during pair') ||
    low.includes('during link') ||
    low === '【pilot】' ||
    low === '【once per turn】'
  );
}

export function isActiveOrTriggerTimingTag(img: string): boolean {
  const low = img.toLowerCase();
  return (
    low.includes('main') ||
    low.includes('action') ||
    low.includes('burst') ||
    low.includes('deploy') ||
    low.includes('attack') ||
    low.includes('destroyed') ||
    low.includes('when ') ||
    low.includes('activate')
  );
}
