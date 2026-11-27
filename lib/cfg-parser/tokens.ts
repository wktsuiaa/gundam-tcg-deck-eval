import { Lexer, createToken, type IToken, type TokenType } from 'chevrotain';

export const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /[ \t\r\n]+/,
  group: Lexer.SKIPPED,
});

// Abstract category for any English word token so general phrase slots accept keywords too
export const WordLike = createToken({ name: 'WordLike', pattern: Lexer.NA });

// Base fallback word token (excludes punctuation & card delimiter symbols)
export const WordTok = createToken({
  name: 'WordTok',
  pattern: /[^\s,./:【】<>[\]()"]+/,
  categories: [WordLike],
});

// Structural card delimiters
export const TimingTag = createToken({ name: 'TimingTag', pattern: /【[^】]+】/ });
export const ResCostTag = createToken({ name: 'ResCostTag', pattern: /<RES_COST:\d+>/ });
export const CostSep = createToken({ name: 'CostSep', pattern: /<COST_SEP>/ });
export const DotSep = createToken({ name: 'DotSep', pattern: /<DOT>/ });
export const KeywordTag = createToken({ name: 'KeywordTag', pattern: /<[^<>]+>/ });
export const BracketName = createToken({ name: 'BracketName', pattern: /\[[^\[\]]+\]/ });
export const ParenToken = createToken({
  name: 'ParenToken',
  pattern: /\((?:[^()]+|\([^()]*\))*\)/,
});
export const QuotedStr = createToken({ name: 'QuotedStr', pattern: /"[^"]*"/ });

// Card numeric / stat tokens
export const StatModTok = createToken({ name: 'StatModTok', pattern: /\b(?:AP|HP)\s*[+-]\d+/i });
export const LvPrefix = createToken({ name: 'LvPrefix', pattern: /\bLv\./i });
export const NumberTok = createToken({ name: 'NumberTok', pattern: /[+-]?\d+/ });

// Domain word tokens (all belong to WordLike and use longer_alt: WordTok)
const kw = (name: string, pattern: RegExp): TokenType =>
  createToken({ name, pattern, longer_alt: WordTok, categories: [WordLike] });

export const StatTok = kw('StatTok', /\b(?:AP|HP)\b/i);
export const NonColorTok = kw('NonColorTok', /\bnon-(?:blue|green|red|purple|white|colorless)\b/i);
export const ColorTok = kw('ColorTok', /\b(?:blue|green|red|purple|white|colorless)\b/i);

export const KwCant = kw('KwCant', /\b(?:can't|cannot)\b/i);
export const KwWont = kw('KwWont', /\bwon't\b/i);
export const KwDoesnt = kw('KwDoesnt', /\bdoesn't\b/i);
export const KwDont = kw('KwDont', /\bdon't\b/i);
export const KwWould = kw('KwWould', /\bwould\b/i);
export const KwInstead = kw('KwInstead', /\binstead\b/i);
export const KwWhen = kw('KwWhen', /\b(?:when|whenever)\b/i);
export const KwIf = kw('KwIf', /\bif\b/i);
export const KwWhile = kw('KwWhile', /\bwhile\b/i);
export const KwDuring = kw('KwDuring', /\bduring\b/i);
export const KwAt = kw('KwAt', /\bat\b/i);
export const KwUntil = kw('KwUntil', /\buntil\b/i);
export const KwThen = kw('KwThen', /\bthen\b/i);
export const KwAfter = kw('KwAfter', /\bafter\b/i);
export const KwMay = kw('KwMay', /\bmay\b/i);
export const KwAnd = kw('KwAnd', /\band\b/i);
export const KwOr = kw('KwOr', /\bor\b/i);
export const KwNot = kw('KwNot', /\bnot\b/i);
export const KwNo = kw('KwNo', /\bno\b/i);

export const VChoose = kw('VChoose', /\bchooses?\b/i);
export const VDraw = kw('VDraw', /\bdraws?\b/i);
export const VDiscard = kw('VDiscard', /\bdiscards?\b/i);
export const VLook = kw('VLook', /\blooks?\b/i);
export const VReveal = kw('VReveal', /\breveals?\b/i);
export const VDestroy = kw('VDestroy', /\bdestroys?\b/i);
export const VDeal = kw('VDeal', /\bdeals?\b/i);
export const VIncrease = kw('VIncrease', /\bincreases?\b/i);
export const VReduce = kw('VReduce', /\breduces?\b/i);
export const VGets = kw('VGets', /\bgets?\b/i);
export const VGains = kw('VGains', /\bgains?\b/i);
export const VRecovers = kw('VRecovers', /\brecovers?\b/i);
export const VRest = kw('VRest', /\brests?\b/i);
export const VSet = kw('VSet', /\bsets?\b/i);
export const VReturn = kw('VReturn', /\breturns?\b/i);
export const VExile = kw('VExile', /\bexiles?\b/i);
export const VDeploy = kw('VDeploy', /\bdeploys?\b/i);
export const VPair = kw('VPair', /\bpairs?\b/i);
export const VAdd = kw('VAdd', /\badds?\b/i);
export const VPlace = kw('VPlace', /\bplaces?\b/i);
export const VPay = kw('VPay', /\bpays?\b/i);
export const VCount = kw('VCount', /\bcount\b/i);
export const VChange = kw('VChange', /\bchanges?\b/i);
export const VBegin = kw('VBegin', /\bbegin\b/i);
export const VActivate = kw('VActivate', /\bactivates?\b/i);

export const Slash = createToken({ name: 'Slash', pattern: /\// });
export const Comma = createToken({ name: 'Comma', pattern: /,/ });
export const Period = createToken({ name: 'Period', pattern: /\./ });
export const Colon = createToken({ name: 'Colon', pattern: /:/ });

export const ALL_TOKENS = [
  WhiteSpace,
  TimingTag,
  ResCostTag,
  CostSep,
  DotSep,
  KeywordTag,
  BracketName,
  ParenToken,
  QuotedStr,
  StatModTok,
  LvPrefix,
  StatTok,
  NonColorTok,
  ColorTok,
  KwCant,
  KwWont,
  KwDoesnt,
  KwDont,
  KwWould,
  KwInstead,
  KwWhen,
  KwIf,
  KwWhile,
  KwDuring,
  KwAt,
  KwUntil,
  KwThen,
  KwAfter,
  KwMay,
  KwAnd,
  KwOr,
  KwNot,
  KwNo,
  VChoose,
  VDraw,
  VDiscard,
  VLook,
  VReveal,
  VDestroy,
  VDeal,
  VIncrease,
  VReduce,
  VGets,
  VGains,
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
  Slash,
  Comma,
  Period,
  Colon,
  NumberTok,
  WordTok,
  WordLike,
];

export const GundamLexer = new Lexer(ALL_TOKENS);

export function tokensText(toks: IToken[]): string {
  return toks.map((t) => t.image).join(' ');
}

export function stripDelimiters(raw: string): string {
  return raw.length >= 2 ? raw.slice(1, -1).trim() : raw.trim();
}
