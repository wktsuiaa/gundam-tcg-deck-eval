import { CstParser, type IToken } from 'chevrotain';
import {
  ALL_TOKENS,
  BracketName,
  Colon,
  Comma,
  CostSep,
  DotSep,
  KeywordTag,
  KwAt,
  KwCant,
  KwDoesnt,
  KwDuring,
  KwIf,
  KwInstead,
  KwMay,
  KwThen,
  KwUntil,
  KwWhen,
  KwWhile,
  KwWont,
  KwWould,
  LvPrefix,
  NumberTok,
  ParenToken,
  Period,
  QuotedStr,
  ResCostTag,
  Slash,
  StatModTok,
  TimingTag,
  VActivate,
  VExile,
  VGains,
  VGets,
  VIncrease,
  VReduce,
  VRest,
  VDestroy,
  VDiscard,
  VReturn,
  WordLike,
} from './tokens.ts';
import {
  COST_VERB_TOKENS,
  IMPERATIVE_VERB_TOKENS,
  isActiveOrTriggerTimingTag,
  isStaticTimingTag,
  parseKeywordTokenText,
} from './grammar-predicates.ts';

export { COST_VERB_TOKENS, IMPERATIVE_VERB_TOKENS, isActiveOrTriggerTimingTag, isStaticTimingTag, parseKeywordTokenText };

export class GundamPhraseParser extends CstParser {
  constructor() {
    super(ALL_TOKENS, { recoveryEnabled: false, maxLookahead: 1 });
  }

  protected scanAhead(limit = 220): IToken[] {
    const out: IToken[] = [];
    for (let i = 1; i <= limit; i += 1) {
      const tok = this.LA(i);
      if (!tok || tok.tokenType.name === 'EOF') break;
      out.push(tok);
    }
    return out;
  }

  protected scanCurrentSentence(): IToken[] {
    const out: IToken[] = [];
    for (let i = 1; i <= 200; i += 1) {
      const tok = this.LA(i);
      if (!tok || tok.tokenType.name === 'EOF') break;
      out.push(tok);
      if (tok.tokenType === Period) break;
    }
    return out;
  }

  protected scanBeforeNextComma(limit = 45): IToken[] {
    const out: IToken[] = [];
    for (let i = 1; i <= limit; i += 1) {
      const tok = this.LA(i);
      if (!tok || tok.tokenType.name === 'EOF' || tok.tokenType === Period) return [];
      if (tok.tokenType === Comma) return out;
      out.push(tok);
    }
    return [];
  }

  protected isKeywordOnlyLine(): boolean {
    const toks = this.scanAhead();
    return (
      toks.length > 0 &&
      toks.every(
        (t) =>
          (t.tokenType === KeywordTag || t.tokenType === BracketName) &&
          parseKeywordTokenText(t.image)
      )
    );
  }

  protected isReplacementClause(): boolean {
    const toks = this.scanAhead();
    const hasWould = toks.some((t) => t.tokenType === KwWould);
    const hasInstead = toks.some((t) => t.tokenType === KwInstead);
    const hasDoesnt = toks.some((t) => t.tokenType === KwDoesnt);
    const timingTags = toks.filter((t) => t.tokenType === TimingTag).map((t) => t.image);
    if (timingTags.some(isActiveOrTriggerTimingTag)) return false;
    if (hasWould && (hasInstead || hasDoesnt)) return true;
    if (hasInstead) {
      const whenIdx = toks.findIndex((t) => t.tokenType === KwWhen);
      if (
        whenIdx >= 0 &&
        toks[whenIdx + 1]?.image.toLowerCase() === 'you' &&
        toks[whenIdx + 2]?.tokenType === VRest
      ) {
        return true;
      }
    }
    return false;
  }

  protected isContinuousClause(): boolean {
    const toks = this.scanAhead();
    const timingTags = toks.filter((t) => t.tokenType === TimingTag).map((t) => t.image);
    const nonOnce = timingTags.filter((img) => img.toLowerCase() !== '【once per turn】');
    const hasStatic = nonOnce.some(isStaticTimingTag);
    const hasNonStatic = nonOnce.some((img) => !isStaticTimingTag(img));
    if (hasNonStatic) return false;

    // Name alias clause: "... name is also treated as [Name]."
    for (let i = 0; i + 4 < toks.length; i += 1) {
      if (
        toks[i].image.toLowerCase() === 'name' &&
        toks[i + 1].image.toLowerCase() === 'is' &&
        toks[i + 2].image.toLowerCase() === 'also' &&
        toks[i + 3].image.toLowerCase() === 'treated' &&
        toks[i + 4].image.toLowerCase() === 'as'
      ) {
        return true;
      }
    }

    // Phase-boundary triggers outside a leading "while" clause are triggered effects
    for (let i = 0; i + 2 < toks.length; i += 1) {
      if (
        toks[i].tokenType === KwAt &&
        toks[i + 1].image.toLowerCase() === 'the' &&
        (toks[i + 2].image.toLowerCase() === 'end' || toks[i + 2].image.toLowerCase() === 'start')
      ) {
        const beforeAt = toks.slice(0, i);
        if (!beforeAt.some((t) => t.tokenType === KwWhile)) return false;
      }
    }

    // Reactive "when/whenever" outside a leading "while" clause is triggered
    const whenIdx = toks.findIndex((t) => t.tokenType === KwWhen);
    if (whenIdx >= 0) {
      const beforeWhen = toks.slice(0, whenIdx);
      if (!beforeWhen.some((t) => t.tokenType === KwWhile)) return false;
    }

    if (hasStatic) return true;

    // Temporary one-shot duration or leading imperative verb is EFFECT_CLAUSE
    for (let i = 0; i + 1 < toks.length; i += 1) {
      const a = toks[i];
      const b = toks[i + 1];
      if (
        a.tokenType === KwDuring &&
        b.image.toLowerCase() === 'this' &&
        (toks[i + 2]?.image.toLowerCase() === 'turn' ||
          toks[i + 2]?.image.toLowerCase() === 'battle')
      ) {
        return false;
      }
      if (a.tokenType === KwUntil) return false;
    }

    const firstNonTiming = toks.find((t) => t.tokenType !== TimingTag && t.tokenType !== Slash);
    if (firstNonTiming && IMPERATIVE_VERB_TOKENS.has(firstNonTiming.tokenType)) {
      if (
        firstNonTiming.tokenType === VIncrease ||
        firstNonTiming.tokenType === VReduce
      ) {
        return true;
      }
      return false;
    }

    if (
      toks.some(
        (t) =>
          t.tokenType === KwCant ||
          t.tokenType === KwWont ||
          t.tokenType === VGains ||
          t.tokenType === VGets ||
          t.tokenType === VIncrease ||
          t.tokenType === VReduce
      )
    ) {
      return true;
    }

    return nonOnce.length === 0;
  }

  protected hasCostPrefix(): boolean {
    const toks = this.scanAhead(40);
    for (let i = 0; i < toks.length; i += 1) {
      const t = toks[i];
      if (t.tokenType === Period) return false;
      if (t.tokenType === CostSep || t.tokenType === Colon) {
        // Ensure separator isn't "following effect:"
        const isFollowingEffect =
          i >= 2 &&
          toks[i - 2].image.toLowerCase() === 'following' &&
          toks[i - 1].image.toLowerCase() === 'effect';
        if (isFollowingEffect) return false;
        const first = toks[0];
        return (
          first.tokenType === ResCostTag ||
          COST_VERB_TOKENS.has(first.tokenType) ||
          toks.slice(0, i).some((x) => x.tokenType === ResCostTag || COST_VERB_TOKENS.has(x.tokenType))
        );
      }
    }
    return false;
  }

  protected hasDevPrologue(): boolean {
    const toks = this.scanAhead(35);
    if (
      toks[0]?.image.toLowerCase() !== 'you' ||
      toks[1]?.tokenType !== KwMay ||
      toks[2]?.tokenType !== VExile
    ) {
      return false;
    }
    return toks.some(
      (t, idx) =>
        t.tokenType === VActivate &&
        (toks[idx + 4]?.tokenType === CostSep || toks[idx + 4]?.tokenType === Colon)
    );
  }

  protected startsWithTurnPhaseLead(): boolean {
    const prefix = this.scanBeforeNextComma(24);
    if (prefix.length === 0) return false;
    const first = prefix[0];
    if (first.tokenType === KwDuring) {
      const second = prefix[1]?.image.toLowerCase();
      if (second === 'your') return true;
      // "During this turn/battle," is handled inside sentences when followed by when/if
      return false;
    }
    if (first.tokenType === KwAt) {
      return (
        prefix[1]?.image.toLowerCase() === 'the' &&
        (prefix[2]?.image.toLowerCase() === 'end' || prefix[2]?.image.toLowerCase() === 'start')
      );
    }
    if (
      first.image.toLowerCase() === 'on' &&
      prefix[1]?.image.toLowerCase() === 'the' &&
      prefix[2]?.image.toLowerCase() === 'turn'
    ) {
      return true;
    }
    return false;
  }

  protected startsWithWhenTrigger(): boolean {
    const prefix = this.scanBeforeNextComma(45);
    if (prefix.length === 0) return false;
    if (prefix[0].tokenType === KwWhen) return true;
    if (prefix[0].tokenType === KwWhile && prefix.some((t) => t.tokenType === KwWhen)) return true;
    return false;
  }

  protected startsWithGuardCondition(): boolean {
    const prefix = this.scanBeforeNextComma(45);
    if (prefix.length === 0) return false;
    const f = prefix[0].tokenType;
    if (f !== KwIf && f !== KwWhile) return false;
    // Do not treat "If you do," / "If it/they ... instead" as top-level guard if follow-up
    const second = prefix[1]?.image.toLowerCase();
    const third = prefix[2]?.image.toLowerCase();
    if (f === KwIf && second === 'you' && third === 'do') return false;
    return true;
  }

  protected isGrantEffectSentenceStart(): boolean {
    const toks = this.scanAhead(60);
    for (let i = 0; i + 2 < toks.length; i += 1) {
      if (toks[i].tokenType === Period) return false;
      if (
        toks[i].tokenType === VGains &&
        toks[i + 1].image.toLowerCase() === 'the' &&
        toks[i + 2].image.toLowerCase() === 'following' &&
        toks[i + 3]?.image.toLowerCase() === 'effect'
      ) {
        return toks
          .slice(i + 3)
          .some((t) => t.tokenType === CostSep || t.tokenType === Colon);
      }
    }
    return false;
  }

  protected isConditionalSentenceStart(): boolean {
    const l1 = this.LA(1);
    if (l1.tokenType === KwIf || l1.tokenType === KwWhile) {
      return this.scanBeforeNextComma(45).length > 0;
    }
    if (l1.tokenType === KwThen && this.LA(2).tokenType === Comma) {
      const l3 = this.LA(3);
      return l3.tokenType === KwIf || l3.tokenType === KwWhile;
    }
    return false;
  }

  protected isImperativeSentenceStart(): boolean {
    const l1 = this.LA(1);
    if (IMPERATIVE_VERB_TOKENS.has(l1.tokenType)) return true;
    if (l1.tokenType === KwThen && this.LA(2).tokenType === Comma) {
      const l3 = this.LA(3);
      if (IMPERATIVE_VERB_TOKENS.has(l3.tokenType)) return true;
      if (l3.image.toLowerCase() === 'you' && this.LA(4).tokenType === KwMay) return true;
    }
    if (l1.image.toLowerCase() === 'you' && this.LA(2).tokenType === KwMay) return true;
    return false;
  }

  protected isDuringDurationLead(): boolean {
    const prefix = this.scanBeforeNextComma(16);
    return (
      prefix.length >= 2 &&
      prefix[0].tokenType === KwDuring &&
      prefix[1].image.toLowerCase() === 'this'
    );
  }

  protected isPilotBracketSentence(): boolean {
    return this.LA(1).tokenType === BracketName;
  }

  protected isNameAliasSentence(): boolean {
    const toks = this.scanCurrentSentence();
    for (let i = 0; i + 4 < toks.length; i += 1) {
      if (
        toks[i].image.toLowerCase() === 'name' &&
        toks[i + 1].image.toLowerCase() === 'is' &&
        toks[i + 2].image.toLowerCase() === 'also' &&
        toks[i + 3].image.toLowerCase() === 'treated' &&
        toks[i + 4].image.toLowerCase() === 'as'
      ) {
        return true;
      }
    }
    return false;
  }

  protected isProhibitionSentence(): boolean {
    const toks = this.scanCurrentSentence();
    return toks.some((t) => t.tokenType === KwCant || t.tokenType === KwWont);
  }

  protected isStatOrCostSentence(): boolean {
    const toks = this.scanCurrentSentence();
    return toks.some(
      (t) =>
        t.tokenType === StatModTok ||
        t.tokenType === VIncrease ||
        t.tokenType === VReduce ||
        t.tokenType === VGets
    );
  }

  protected isCostItemStart(): boolean {
    const l1 = this.LA(1);
    return l1.tokenType === ResCostTag || COST_VERB_TOKENS.has(l1.tokenType);
  }

  // Common reusable phrase subrules

  public timingPrefix = this.RULE('timingPrefix', () => {
    this.CONSUME(TimingTag);
    this.OPTION(() => {
      this.CONSUME(Slash);
      this.CONSUME2(TimingTag);
    });
  });

  protected phraseUnitTok = this.RULE('phraseUnitTok', () => {
    this.OR([
      { ALT: () => this.CONSUME(WordLike) },
      { ALT: () => this.CONSUME(ParenToken) },
      { ALT: () => this.CONSUME(BracketName) },
      { ALT: () => this.CONSUME(KeywordTag) },
      { ALT: () => this.CONSUME(QuotedStr) },
      { ALT: () => this.CONSUME(StatModTok) },
      { ALT: () => this.CONSUME(LvPrefix) },
      { ALT: () => this.CONSUME(NumberTok) },
      { ALT: () => this.CONSUME(ResCostTag) },
      { ALT: () => this.CONSUME(TimingTag) },
      { ALT: () => this.CONSUME(DotSep) },
      { ALT: () => this.CONSUME(Slash) },
    ]);
  });

  protected commaExprTok = this.RULE('commaExprTok', () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.phraseUnitTok) },
      { ALT: () => this.CONSUME(Comma) },
    ]);
  });

  public costPrefix = this.RULE('costPrefix', () => {
    this.AT_LEAST_ONE_SEP({
      SEP: Comma,
      DEF: () => this.SUBRULE(this.costItem),
    });
    this.OR([
      { ALT: () => this.CONSUME(CostSep) },
      { ALT: () => this.CONSUME(Colon) },
    ]);
  });

  protected costItem = this.RULE('costItem', () => {
    this.OR([
      { ALT: () => this.CONSUME(ResCostTag) },
      {
        ALT: () => {
          this.OR2([
            { ALT: () => this.CONSUME(VRest) },
            { ALT: () => this.CONSUME(VDestroy) },
            { ALT: () => this.CONSUME(VDiscard) },
            { ALT: () => this.CONSUME(VExile) },
            { ALT: () => this.CONSUME(VReturn) },
          ]);
          this.MANY(() => this.SUBRULE(this.phraseUnitTok));
        },
      },
    ]);
  });

  public devPrologue = this.RULE('devPrologue', () => {
    this.AT_LEAST_ONE(() => this.SUBRULE(this.commaExprTok));
    this.OR([
      { ALT: () => this.CONSUME(CostSep) },
      { ALT: () => this.CONSUME(Colon) },
    ]);
  });

  public turnPhaseLead = this.RULE('turnPhaseLead', () => {
    this.AT_LEAST_ONE(() => this.SUBRULE(this.phraseUnitTok));
    this.CONSUME(Comma);
  });

  public whenTriggerClause = this.RULE('whenTriggerClause', () => {
    this.OPTION({
      GATE: () => this.LA(1).tokenType === KwWhile,
      DEF: () => {
        this.CONSUME(KwWhile);
        this.MANY(() => this.SUBRULE(this.phraseUnitTok));
      },
    });
    this.CONSUME(KwWhen);
    this.AT_LEAST_ONE(() => this.SUBRULE2(this.phraseUnitTok));
    this.CONSUME(Comma);
  });

  public guardCondition = this.RULE('guardCondition', () => {
    this.OR([
      { ALT: () => this.CONSUME(KwIf) },
      { ALT: () => this.CONSUME(KwWhile) },
    ]);
    this.SUBRULE(this.conditionExpr);
    this.CONSUME(Comma);
  });

  public conditionExpr = this.RULE('conditionExpr', () => {
    this.AT_LEAST_ONE(() => this.SUBRULE(this.phraseUnitTok));
  });
}
