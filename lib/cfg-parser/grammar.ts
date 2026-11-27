import { BracketName, Colon, Comma, CostSep, KeywordTag, KwAt, KwDuring, KwIf, KwThen, KwWhile, Period, Slash, TimingTag } from './tokens.ts';
import { GundamPhraseParser } from './grammar-phrases.ts';
export { GundamLexer } from './tokens.ts';

export class GundamClauseCstParser extends GundamPhraseParser {
  constructor() {
    super();
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
    this.MANY(() => this.SUBRULE(this.timingPrefix));
    this.OPTION({
      GATE: () => this.startsWithTurnPhaseLead(),
      DEF: () => this.SUBRULE(this.turnPhaseLead),
    });
    this.OPTION2({
      GATE: () => this.startsWithWhenTrigger(),
      DEF: () => this.SUBRULE(this.whenTriggerClause),
    });
    this.AT_LEAST_ONE(() => this.SUBRULE(this.sentenceUnit));
  });

  private continuousUnit = this.RULE('continuousUnit', () => {
    this.MANY(() => this.SUBRULE(this.timingPrefix));
    this.OPTION({
      GATE: () => this.startsWithTurnPhaseLead(),
      DEF: () => this.SUBRULE(this.turnPhaseLead),
    });
    this.OPTION2({
      GATE: () => this.startsWithGuardCondition(),
      DEF: () => this.SUBRULE(this.guardCondition),
    });
    this.AT_LEAST_ONE(() => this.SUBRULE(this.continuousSentence));
  });

  private continuousSentence = this.RULE('continuousSentence', () => {
    this.OR([
      {
        GATE: () => this.isPilotBracketSentence(),
        ALT: () => this.SUBRULE(this.pilotModeSentence),
      },
      {
        GATE: () => this.isNameAliasSentence(),
        ALT: () => this.SUBRULE(this.nameAliasSentence),
      },
      {
        GATE: () => this.isProhibitionSentence(),
        ALT: () => this.SUBRULE(this.prohibitionSentence),
      },
      {
        GATE: () => this.isStatOrCostSentence(),
        ALT: () => this.SUBRULE(this.statOrCostSentence),
      },
      {
        ALT: () => this.SUBRULE(this.generalContinuousSentence),
      },
    ]);
    this.OPTION(() => this.CONSUME(Period));
  });

  private pilotModeSentence = this.RULE('pilotModeSentence', () => {
    this.CONSUME(BracketName);
  });

  private nameAliasSentence = this.RULE('nameAliasSentence', () => {
    this.AT_LEAST_ONE(() => this.SUBRULE(this.commaExprTok));
  });

  private prohibitionSentence = this.RULE('prohibitionSentence', () => {
    this.AT_LEAST_ONE(() => this.SUBRULE(this.commaExprTok));
  });

  private statOrCostSentence = this.RULE('statOrCostSentence', () => {
    this.AT_LEAST_ONE(() => this.SUBRULE(this.commaExprTok));
  });

  private generalContinuousSentence = this.RULE('generalContinuousSentence', () => {
    this.AT_LEAST_ONE(() => this.SUBRULE(this.commaExprTok));
  });

  private effectClauseUnit = this.RULE('effectClauseUnit', () => {
    this.MANY(() => this.SUBRULE(this.timingPrefix));
    this.OPTION({
      GATE: () => this.hasCostPrefix(),
      DEF: () => this.SUBRULE(this.costPrefix),
    });
    this.OPTION2({
      GATE: () => this.hasDevPrologue(),
      DEF: () => this.SUBRULE(this.devPrologue),
    });
    this.OPTION3({
      GATE: () => this.startsWithTurnPhaseLead(),
      DEF: () => this.SUBRULE(this.turnPhaseLead),
    });
    this.OPTION4({
      GATE: () => this.startsWithWhenTrigger(),
      DEF: () => this.SUBRULE(this.whenTriggerClause),
    });
    this.OPTION5({
      GATE: () => this.startsWithGuardCondition(),
      DEF: () => this.SUBRULE(this.guardCondition),
    });
    this.AT_LEAST_ONE(() => this.SUBRULE(this.sentenceUnit));
  });

  private sentenceUnit = this.RULE('sentenceUnit', () => {
    this.OR([
      {
        GATE: () => this.isGrantEffectSentenceStart(),
        ALT: () => this.SUBRULE(this.grantEffectSentence),
      },
      {
        GATE: () => this.isConditionalSentenceStart(),
        ALT: () => this.SUBRULE(this.conditionalSentence),
      },
      {
        GATE: () => this.startsWithWhenTrigger(),
        ALT: () => this.SUBRULE(this.whenTriggerSentence),
      },
      {
        GATE: () => this.isDuringDurationLead(),
        ALT: () => this.SUBRULE(this.durationLeadSentence),
      },
      {
        GATE: () => this.isImperativeSentenceStart(),
        ALT: () => this.SUBRULE(this.imperativeSentence),
      },
      {
        ALT: () => this.SUBRULE(this.subjectPredicateSentence),
      },
    ]);
  });

  private grantEffectSentence = this.RULE('grantEffectSentence', () => {
    this.AT_LEAST_ONE(() => this.SUBRULE(this.commaExprTok));
    this.OR([
      { ALT: () => this.CONSUME(CostSep) },
      { ALT: () => this.CONSUME(Colon) },
    ]);
    this.MANY(() => this.SUBRULE(this.timingPrefix));
    this.OPTION({
      GATE: () => this.startsWithTurnPhaseLead(),
      DEF: () => this.SUBRULE(this.turnPhaseLead),
    });
    this.OPTION2({
      GATE: () => this.startsWithWhenTrigger(),
      DEF: () => this.SUBRULE(this.whenTriggerClause),
    });
    this.AT_LEAST_ONE2(() => this.SUBRULE(this.simpleSentenceUnit));
  });

  private simpleSentenceUnit = this.RULE('simpleSentenceUnit', () => {
    this.OR([
      {
        GATE: () => this.isConditionalSentenceStart(),
        ALT: () => this.SUBRULE2(this.conditionalSentence),
      },
      {
        GATE: () => this.isImperativeSentenceStart(),
        ALT: () => this.SUBRULE2(this.imperativeSentence),
      },
      {
        ALT: () => this.SUBRULE2(this.subjectPredicateSentence),
      },
    ]);
  });

  private conditionalSentence = this.RULE('conditionalSentence', () => {
    this.OPTION(() => {
      this.CONSUME(KwThen);
      this.CONSUME(Comma);
    });
    this.OR([
      { ALT: () => this.CONSUME(KwIf) },
      { ALT: () => this.CONSUME(KwWhile) },
    ]);
    this.SUBRULE(this.conditionExpr);
    this.CONSUME2(Comma);
    this.AT_LEAST_ONE(() => this.SUBRULE(this.commaExprTok));
    this.OPTION2(() => this.CONSUME(Period));
  });

  private whenTriggerSentence = this.RULE('whenTriggerSentence', () => {
    this.SUBRULE(this.whenTriggerClause);
    this.AT_LEAST_ONE(() => this.SUBRULE(this.commaExprTok));
    this.OPTION(() => this.CONSUME(Period));
  });

  private durationLeadSentence = this.RULE('durationLeadSentence', () => {
    this.CONSUME(KwDuring);
    this.AT_LEAST_ONE(() => this.SUBRULE(this.phraseUnitTok));
    this.CONSUME(Comma);
    this.OR([
      {
        GATE: () => this.startsWithWhenTrigger(),
        ALT: () => this.SUBRULE(this.whenTriggerSentence),
      },
      {
        GATE: () => this.isConditionalSentenceStart(),
        ALT: () => this.SUBRULE(this.conditionalSentence),
      },
      {
        ALT: () => {
          this.AT_LEAST_ONE2(() => this.SUBRULE(this.commaExprTok));
          this.OPTION(() => this.CONSUME(Period));
        },
      },
    ]);
  });

  private imperativeSentence = this.RULE('imperativeSentence', () => {
    this.AT_LEAST_ONE(() => this.SUBRULE(this.commaExprTok));
    this.OPTION(() => this.CONSUME(Period));
  });

  private subjectPredicateSentence = this.RULE('subjectPredicateSentence', () => {
    this.AT_LEAST_ONE(() => this.SUBRULE(this.commaExprTok));
    this.OPTION(() => this.CONSUME(Period));
  });
}

// Keep unused-token tree-shaking quiet if needed
void TimingTag;
void Slash;
void KwAt;

export const clauseParser = new GundamClauseCstParser();
