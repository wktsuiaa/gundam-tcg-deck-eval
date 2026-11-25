grammar GundamEffect;

// Formal CFG specification for Gundam Card Game prose (ADR-0003).
// Runtime execution in pure TypeScript mirrors these productions in lib/cfg-parser.ts (Chevrotain).

cardAbilityList
  : abilityLine+ EOF
  ;

abilityLine
  : keywordLine
  | replacementClause
  | continuousClause
  | effectClause
  ;

keywordLine
  : (KEYWORD_TAG | '[' WORD ']')
  ;

replacementClause
  : timingHeader* oncePerTurn? guardPrefix*
    replacementTrigger replacementOutcome '.'?
  ;

replacementTrigger
  : ('When' | 'If') clauseSegment+ ('would' | 'with') clauseSegment+ COMMA
  ;

replacementOutcome
  : ('you' 'may')? clauseSegment+ ('instead' | 'doesn\'t' 'receive' 'that' 'damage')
  ;

continuousClause
  : staticScope+ oncePerTurn? guardPrefix* continuousBody '.'?
  | guardPrefix* prohibitionBody '.'?
  | guardPrefix* statAuraBody '.'?
  | identityAliasBody '.'?
  ;

staticScope
  : '【During Pair' (DOT traitToken)? '】'
  | '【During Link】'
  | '【Pilot】' bracketName
  ;

prohibitionBody
  : clauseSegment+ ('can\'t' | 'cannot' | 'won\'t') clauseSegment+
  ;

statAuraBody
  : ('Increase' | 'Reduce' | 'This' 'Unit' 'gets' | 'All' 'your' | 'While') clauseSegment+
  ;

identityAliasBody
  : 'This' 'card\'s' 'name' 'is' 'also' 'treated' 'as' bracketName
  ;

effectClause
  : timingHeader+ oncePerTurn? guardPrefix* triggerPrefix? activationCost? stepSequence '.'?
  | staticScope* oncePerTurn? guardPrefix* triggerPrefix activationCost? stepSequence '.'?
  | staticScope* oncePerTurn? guardPrefix+ stepSequence '.'?
  ;

timingHeader
  : TIMING_TAG ('/' TIMING_TAG)?
  ;

oncePerTurn
  : '【Once per Turn】'
  ;

guardPrefix
  : ('During' ('your' | 'your opponent\'s') 'turn' | 'While' clauseSegment+ | 'If' clauseSegment+) COMMA
  | 'At' 'the' ('end' | 'start') 'of' clauseSegment+ COMMA
  ;

triggerPrefix
  : ('When' | 'Whenever') clauseSegment+ COMMA
  ;

activationCost
  : costSegment+ COST_SEP
  ;

stepSequence
  : clauseSegment+ (PERIOD clauseSegment+)*
  ;

clauseSegment
  : WORD | INT | traitToken | bracketName | QUOTED_STR | KEYWORD_TAG | RES_COST | DOT | SLASH | COMMA
  ;

traitToken  : '(' (~[()])+ ')' ;
bracketName : '[' (~[\[\]])+ ']' ;

TIMING_TAG  : '【' ~[】]+ '】' ;
KEYWORD_TAG : '<' ~[>]+ '>' ;
RES_COST    : '<RES_COST:' [0-9]+ '>' ;
COST_SEP    : '<COST_SEP>' ;
DOT         : '<DOT>' ;
QUOTED_STR  : '"' ~["]+ '"' ;
INT         : [0-9]+ ;
COMMA       : ',' ;
PERIOD      : '.' ;
SLASH       : '/' ;
WORD        : [A-Za-z0-9'+\-]+ ;
WS          : [ \t\r\n]+ -> skip ;
