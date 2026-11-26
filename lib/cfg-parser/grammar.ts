import { CstParser, Lexer, createToken, type IToken } from 'chevrotain';
import { parseKeywordTag } from './lift.ts';

export const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /[ \t\r\n]+/,
  group: Lexer.SKIPPED,
});

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

export const KwWould = createToken({ name: 'KwWould', pattern: /\bwould\b/i });

export const KwInstead = createToken({ name: 'KwInstead', pattern: /\binstead\b/i });

export const KwCant = createToken({ name: 'KwCant', pattern: /\b(?:can't|cannot)\b/i });

export const KwDoesnt = createToken({ name: 'KwDoesnt', pattern: /\bdoesn't\b/i });

export const KwWhen = createToken({ name: 'KwWhen', pattern: /\b(?:When|Whenever)\b/i });

export const KwIf = createToken({ name: 'KwIf', pattern: /\bIf\b/ });

export const KwDuring = createToken({ name: 'KwDuring', pattern: /\bDuring\b/ });

export const KwWhile = createToken({ name: 'KwWhile', pattern: /\bWhile\b/ });

export const KwAt = createToken({ name: 'KwAt', pattern: /\bAt\b/ });

export const Slash = createToken({ name: 'Slash', pattern: /\// });

export const Comma = createToken({ name: 'Comma', pattern: /,/ });

export const Period = createToken({ name: 'Period', pattern: /\./ });

export const Colon = createToken({ name: 'Colon', pattern: /:/ });

export const NumberTok = createToken({ name: 'NumberTok', pattern: /[+-]?\d+/ });

export const WordTok = createToken({ name: 'WordTok', pattern: /[^\s,./:【】<>[\]()"]+/ });

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
  KwWould,
  KwInstead,
  KwCant,
  KwDoesnt,
  KwWhen,
  KwIf,
  KwDuring,
  KwWhile,
  KwAt,
  Slash,
  Comma,
  Period,
  Colon,
  NumberTok,
  WordTok,
];

export const GundamLexer = new Lexer(ALL_TOKENS);

export class GundamClauseCstParser extends CstParser {
  constructor() {
    super(ALL_TOKENS, { recoveryEnabled: false });
    this.performSelfAnalysis();
  }

  public clauseLine = this.RULE('clauseLine', () => {
    this.OR([
      {
        GATE: () => this.isKeywordOnlyLine(),
        ALT: () => this.SUBRULE(this.keywordOnlyUnit),
      },
      {
        GATE: () => this.isReplacementClause(),
        ALT: () => this.SUBRULE(this.replacementUnit),
      },
      {
        GATE: () => this.isContinuousClause(),
        ALT: () => this.SUBRULE(this.continuousUnit),
      },
      {
        ALT: () => this.SUBRULE(this.effectClauseUnit),
      },
    ]);
  });

  private keywordOnlyUnit = this.RULE('keywordOnlyUnit', () => {
    this.AT_LEAST_ONE(() => {
      this.OR([
        { ALT: () => this.CONSUME(KeywordTag) },
        { ALT: () => this.CONSUME(BracketName) },
      ]);
    });
  });

  private replacementUnit = this.RULE('replacementUnit', () => {
    this.MANY(() => {
      this.SUBRULE(this.timingPrefix);
    });
    this.MANY2(() => {
      this.OR([
        { ALT: () => this.CONSUME(KwWould) },
        { ALT: () => this.CONSUME(KwInstead) },
        { ALT: () => this.CONSUME(KwDoesnt) },
        { ALT: () => this.CONSUME(KwWhen) },
        { ALT: () => this.CONSUME(KwIf) },
        { ALT: () => this.CONSUME(KwDuring) },
        { ALT: () => this.CONSUME(KwWhile) },
        { ALT: () => this.CONSUME(KwAt) },
        { ALT: () => this.SUBRULE(this.clauseBodyAtom) },
      ]);
    });
  });

  private continuousUnit = this.RULE('continuousUnit', () => {
    this.MANY(() => {
      this.SUBRULE(this.timingPrefix);
    });
    this.AT_LEAST_ONE(() => {
      this.OR([
        { ALT: () => this.CONSUME(KwCant) },
        { ALT: () => this.CONSUME(KwIf) },
        { ALT: () => this.CONSUME(KwDuring) },
        { ALT: () => this.CONSUME(KwWhile) },
        { ALT: () => this.CONSUME(KwAt) },
        { ALT: () => this.CONSUME(KwWhen) },
        { ALT: () => this.SUBRULE(this.clauseBodyAtom) },
      ]);
    });
  });

  private effectClauseUnit = this.RULE('effectClauseUnit', () => {
    this.MANY(() => {
      this.SUBRULE(this.timingPrefix);
    });
    this.AT_LEAST_ONE(() => {
      this.OR([
        { ALT: () => this.CONSUME(KwWhen) },
        { ALT: () => this.CONSUME(KwIf) },
        { ALT: () => this.CONSUME(KwDuring) },
        { ALT: () => this.CONSUME(KwWhile) },
        { ALT: () => this.CONSUME(KwAt) },
        { ALT: () => this.CONSUME(KwCant) },
        { ALT: () => this.CONSUME(KwInstead) },
        { ALT: () => this.CONSUME(KwDoesnt) },
        { ALT: () => this.CONSUME(KwWould) },
        { ALT: () => this.SUBRULE(this.clauseBodyAtom) },
      ]);
    });
  });

  private timingPrefix = this.RULE('timingPrefix', () => {
    this.CONSUME(TimingTag);
    this.OPTION(() => {
      this.CONSUME(Slash);
      this.CONSUME2(TimingTag);
    });
  });

  private clauseBodyAtom = this.RULE('clauseBodyAtom', () => {
    this.OR([
      { ALT: () => this.CONSUME(ResCostTag) },
      { ALT: () => this.CONSUME(CostSep) },
      { ALT: () => this.CONSUME(DotSep) },
      { ALT: () => this.CONSUME(TimingTag) },
      { ALT: () => this.CONSUME(KeywordTag) },
      { ALT: () => this.CONSUME(BracketName) },
      { ALT: () => this.CONSUME(ParenToken) },
      { ALT: () => this.CONSUME(QuotedStr) },
      { ALT: () => this.CONSUME(Slash) },
      { ALT: () => this.CONSUME(Comma) },
      { ALT: () => this.CONSUME(Period) },
      { ALT: () => this.CONSUME(Colon) },
      { ALT: () => this.CONSUME(NumberTok) },
      { ALT: () => this.CONSUME(WordTok) },
    ]);
  });

  // Lookahead predicates keeping LL(k) selection deterministic & ambiguity-free
  private scanLineTokens(): IToken[] {
    const out: IToken[] = [];
    for (let i = 1; i <= 200; i += 1) {
      const tok = this.LA(i);
      if (!tok || tok.tokenType.name === 'EOF') break;
      out.push(tok);
    }
    return out;
  }

  private isKeywordOnlyLine(): boolean {
    const toks = this.scanLineTokens();
    return (
      toks.length > 0 &&
      toks.every(
        (t) =>
          (t.tokenType === KeywordTag || t.tokenType === BracketName) &&
          parseKeywordTag(t.image) !== null
      )
    );
  }

  private isReplacementClause(): boolean {
    const toks = this.scanLineTokens();
    const hasWould = toks.some((t) => t.tokenType === KwWould);
    const hasInstead = toks.some((t) => t.tokenType === KwInstead);
    const hasDoesnt = toks.some((t) => t.tokenType === KwDoesnt);
    const timingTags = toks
      .filter((t) => t.tokenType === TimingTag)
      .map((t) => t.image);
    // Clauses with active or trigger timing tags (e.g. 【Attack】, 【When Linked】, 【Activate･Action】)
    // are triggered/activated EFFECT_CLAUSE abilities that set up a temporary or conditional effect, not passive replacements.
    const hasActiveOrTriggerTiming = timingTags.some((img) =>
      /【(?:Main|Action|Burst|Deploy|Attack|Destroyed|When |Activate)/i.test(img)
    );
    if (hasActiveOrTriggerTiming) return false;
    // True event replacements: "would ... instead", "would ... doesn't receive", or "When you rest ... instead"
    if (hasWould && (hasInstead || hasDoesnt)) return true;
    const text = toks.map((t) => t.image).join(' ');
    if (
      hasInstead &&
      /\bWhen\s+you\s+rest\b/i.test(text)
    ) {
      return true;
    }
    return false;
  }

  private isContinuousClause(): boolean {
    const toks = this.scanLineTokens();
    const timingTags = toks
      .filter((t) => t.tokenType === TimingTag)
      .map((t) => t.image);
    const nonOnceTimings = timingTags.filter((img) => img !== '【Once per Turn】');
    const hasStaticTiming = nonOnceTimings.some((img) =>
      /【(?:During Pair|During Link|Pilot)/i.test(img)
    );
    const hasActiveTiming = nonOnceTimings.some(
      (img) => !/【(?:During Pair|During Link|Pilot)/i.test(img)
    );
    if (hasActiveTiming) return false;

    const text = toks.map((t) => t.image).join(' ');
    if (/name is also treated as/i.test(text)) return true;

    // Phase-boundary triggers ("At the end of your/a/the turn,", "At the start of your opponent's turn,")
    if (
      /\bAt\s+the\s+(?:end|start)\s+of\b/i.test(text) &&
      !/\bwhile\b/i.test(text.split(/\bAt\s+the\b/i)[0] ?? '')
    ) {
      return false;
    }

    // Reactive "when/whenever" triggers (even under 【During Pair】 or "During your turn,")
    const hasReactiveWhen = toks.some((t) => t.tokenType === KwWhen);
    if (hasReactiveWhen && !/\bwhile\b/i.test(text.split(/\bwhen\b/i)[0] ?? '')) {
      return false;
    }

    if (hasStaticTiming) return true;

    // Imperative or temporary one-shot spell sentences ("Choose 1 ...", "... until end of turn", "... during this turn")
    if (
      /\b(?:until end of turn|during this turn|during this battle)\b/i.test(text) ||
      /^(?:Choose|Destroy|Draw|Deal|Return|Deploy|Recover|Discard|Rest|Set)\b/i.test(text)
    ) {
      return false;
    }

    if (
      /can't|cannot/i.test(text) ||
      /\b(?:Increase|Reduce|gains?|gets)\b/i.test(text)
    ) {
      return true;
    }
    return nonOnceTimings.length === 0;
  }
}

export const clauseParser = new GundamClauseCstParser();

// ---------------------------------------------------------------------------
// 4. CST-to-AST Helpers & Lifting
// ---------------------------------------------------------------------------
