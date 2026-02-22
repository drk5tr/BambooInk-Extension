import type { LocalRule } from "./types";

export const RULES: LocalRule[] = [
  // ═══════════════════════════════════════════
  // HOMOPHONES
  // ═══════════════════════════════════════════

  // their → there (existence / location)
  {
    id: "their-there",
    pattern: /\btheir\b(?=\s+(is|are|was|were|will|would|could|should|might|must|has|have|had|going|exists?|remains?|seems?|appears?|stands?))/gi,
    type: "grammar",
    suggestion: "there",
    explanation: "'Their' is possessive. Use 'there' for existence or location.",
  },

  // there → their (possession)
  {
    id: "there-their",
    pattern: /\bthere\b(?=\s+(own|car|house|home|dog|cat|kids?|children|parents?|family|friends?|work|job|boss|team|name|lives?|phone|email|opinion|idea|plan|money|stuff|things?))/gi,
    type: "grammar",
    suggestion: "their",
    explanation: "'There' is for location/existence. Use 'their' for possession.",
  },

  // your → you're (you are)
  {
    id: "your-youre",
    pattern: /\byour\b(?=\s+(a |an |the |going|welcome|right|wrong|not |never |always |being |so |very |too |just |really |probably |certainly |absolutely |doing|making|looking|getting|coming|running|trying|having))/gi,
    type: "grammar",
    suggestion: "you're",
    explanation: "'Your' is possessive. Use 'you're' (you are) here.",
  },

  // you're → your (possession)
  {
    id: "youre-your",
    pattern: /\byou're\b(?=\s+(own|car|house|home|dog|cat|kids?|children|parents?|family|friends?|work|job|boss|team|name|life|phone|email|opinion|idea|plan|money|stuff|things?))/gi,
    type: "grammar",
    suggestion: "your",
    explanation: "'You're' = 'you are'. Use 'your' for possession.",
  },

  // it's → its (possession)
  {
    id: "its-its",
    pattern: /\bit's\b(?=\s+(own|self|way|place|time|color|colour|size|shape|name|value|purpose|role|function|position|weight|height|length|width|price|cost|effect|impact|origin|source|content|meaning|definition|form|nature|core|base|peak|limit|end|start|beginning))/gi,
    type: "grammar",
    suggestion: "its",
    explanation: "'It's' = 'it is'. Use 'its' for possession.",
  },

  // hear → here (location)
  {
    id: "hear-here",
    pattern: /\b(come|over|right|up|around|from|near|out|in|down|click|tap|look|stay|sit|stand|wait|stop|live|be|got|get) hear\b/gi,
    type: "grammar",
    suggestion: "$1 here",
    explanation: "'Hear' means to listen. Use 'here' for location.",
  },

  // here → hear (listening)
  {
    id: "here-hear",
    pattern: /\bhere (me|us|him|her|them|that|this|it) out\b/gi,
    type: "grammar",
    suggestion: "hear $1 out",
    explanation: "'Here' is a location. Use 'hear' for listening.",
  },
  {
    id: "here-hear-2",
    pattern: /\b(can't|cannot|couldn't|didn't|don't|won't|can|could|did|do|will|want to|wanted to|need to|trying to|able to) here\b/gi,
    type: "grammar",
    suggestion: "$1 hear",
    explanation: "'Here' is a location. Use 'hear' for listening.",
  },
  {
    id: "here-hear-3",
    pattern: /\b(can't|cannot|couldn't|didn't|don't|won't|can|could|did|do|will) (you|we|they|I|he|she|it) here\b/gi,
    type: "grammar",
    suggestion: "$1 $2 hear",
    explanation: "'Here' is a location. Use 'hear' for listening.",
  },

  // affect → effect (noun)
  {
    id: "affect-effect",
    pattern: /\b(the|a|an|this|that|its|no|any|positive|negative|big|huge|major|minor|small|side|lasting|long-term|short-term|overall|net|full|direct|indirect|adverse|beneficial|significant|profound|dramatic|minimal|negligible) affect\b/gi,
    type: "grammar",
    suggestion: "$1 effect",
    explanation: "'Affect' is usually a verb. Use 'effect' as a noun.",
  },

  // effect → affect (verb)
  {
    id: "effect-affect",
    pattern: /\b(will|would|could|can|may|might|shall|should|must|does|did|doesn't|didn't|won't|wouldn't|couldn't|can't|to|not|never|also|directly|indirectly|negatively|positively|greatly|significantly|seriously|adversely) effect\b(?!\s+(a |an |the |change))/gi,
    type: "grammar",
    suggestion: "$1 affect",
    explanation: "'Effect' is usually a noun. Use 'affect' as a verb.",
  },

  // then → than (comparisons)
  {
    id: "then-than",
    pattern: /\b(more|less|better|worse|greater|bigger|smaller|faster|slower|rather|other|higher|lower|older|younger|newer|earlier|later|longer|shorter|stronger|weaker|harder|easier|further|fewer|taller|deeper|wider|thinner|richer|poorer|smarter|louder|quieter|closer|farther) then\b/gi,
    type: "grammar",
    suggestion: "$1 than",
    explanation: "Use 'than' for comparisons, 'then' for time/sequence.",
  },

  // accept → except (exclusion)
  {
    id: "accept-except",
    pattern: /\baccept\b(?=\s+(for|that|when|if|in|on|during|where))/gi,
    type: "grammar",
    suggestion: "except",
    explanation: "'Accept' means to receive. Use 'except' for exclusions.",
  },

  // loose → lose (misplace/fail)
  {
    id: "loose-lose",
    pattern: /\b(don't|didn't|won't|wouldn't|going to|gonna|might|will|could|can't|cannot|couldn't|to|not|never|afraid to|about to|going|hate to) loose\b/gi,
    type: "grammar",
    suggestion: "$1 lose",
    explanation: "'Loose' means not tight. Use 'lose' for misplacing/failing.",
  },

  // to → too (also / excessive)
  {
    id: "to-too-excessive",
    pattern: /\b(is|are|was|were|it's|that's|this is|seems?|looks?|feels?|sounds?|appears?|gets?|got|became|become) to (much|many|few|little|big|small|large|long|short|fast|slow|hard|easy|hot|cold|late|early|old|young|high|low|loud|quiet|far|close|dark|bright|heavy|light|thick|thin|expensive|cheap|difficult|complex|simple|dangerous|risky)\b/gi,
    type: "grammar",
    suggestion: "$1 too $2",
    explanation: "Use 'too' for 'excessively'. 'To' is a preposition.",
  },

  // to → too (also — end of clause)
  {
    id: "to-too-also",
    pattern: /\b(me|us|him|her|them|it) to([.!,;]|\s*$)/gi,
    type: "grammar",
    suggestion: (m) => `${m[1]} too${m[2]}`,
    explanation: "Use 'too' to mean 'also'.",
  },

  // were → where (location)
  {
    id: "were-where",
    pattern: /\bwere\b(?=\s+(is|are|do|does|did|can|could|should|would|will|was|were|have) (you|we|they|he|she|it|I))/gi,
    type: "grammar",
    suggestion: "where",
    explanation: "'Were' is past tense of 'are'. Use 'where' for location/questions.",
  },

  // where → were (past tense)
  {
    id: "where-were",
    pattern: /\b(you|we|they) where\b(?=\s+(going|doing|saying|looking|trying|working|living|talking|playing|sitting|standing|running|walking|eating|sleeping|waiting|watching|reading|writing|thinking|hoping))/gi,
    type: "grammar",
    suggestion: "$1 were",
    explanation: "'Where' is for location. Use 'were' for past tense.",
  },

  // we're → were / where
  {
    id: "were-were",
    pattern: /\b(if|when|while|where|before|after|once|until|although|though|as|since) we're\b/gi,
    type: "grammar",
    suggestion: "$1 were",
    explanation: "In conditional/temporal clauses, use 'were' (past tense), not 'we're' (we are).",
  },

  // who's → whose (possession)
  {
    id: "whos-whose",
    pattern: /\bwho's\b(?=\s+(car|house|home|dog|cat|kid|child|book|phone|bag|name|fault|idea|turn|job|responsibility|problem|decision|choice))/gi,
    type: "grammar",
    suggestion: "whose",
    explanation: "'Who's' = 'who is'. Use 'whose' for possession.",
  },

  // whose → who's (who is)
  {
    id: "whose-whos",
    pattern: /\bwhose\b(?=\s+(going|coming|doing|making|getting|trying|being|running|looking|asking|telling|calling|that|the |a |an |is|are|was|were|has|have|had))/gi,
    type: "grammar",
    suggestion: "who's",
    explanation: "'Whose' is possessive. Use 'who's' (who is/who has) here.",
  },

  // weather → whether (choice)
  {
    id: "weather-whether",
    pattern: /\bweather\b(?=\s+(or not|to |we |you |they |he |she |it |I |the |this |that |there ))/gi,
    type: "grammar",
    suggestion: "whether",
    explanation: "'Weather' is about climate. Use 'whether' for choices/conditions.",
  },

  // alot → a lot
  {
    id: "alot",
    pattern: /\balot\b/gi,
    type: "spelling",
    suggestion: "a lot",
    explanation: "'A lot' is two words.",
  },

  // ═══════════════════════════════════════════
  // COMMON WORD CONFUSIONS
  // ═══════════════════════════════════════════

  // could/should/would of → have
  {
    id: "could-of",
    pattern: /\bcould of\b/gi,
    type: "grammar",
    suggestion: "could have",
    explanation: "'Could of' is a mishearing of 'could have' or 'could've'.",
  },
  {
    id: "should-of",
    pattern: /\bshould of\b/gi,
    type: "grammar",
    suggestion: "should have",
    explanation: "'Should of' should be 'should have' or 'should've'.",
  },
  {
    id: "would-of",
    pattern: /\bwould of\b/gi,
    type: "grammar",
    suggestion: "would have",
    explanation: "'Would of' should be 'would have' or 'would've'.",
  },
  {
    id: "must-of",
    pattern: /\bmust of\b/gi,
    type: "grammar",
    suggestion: "must have",
    explanation: "'Must of' should be 'must have' or 'must've'.",
  },
  {
    id: "might-of",
    pattern: /\bmight of\b/gi,
    type: "grammar",
    suggestion: "might have",
    explanation: "'Might of' should be 'might have' or 'might've'.",
  },

  // suppose to → supposed to
  {
    id: "suppose-to",
    pattern: /\bsuppose to\b/gi,
    type: "grammar",
    suggestion: "supposed to",
    explanation: "Use 'supposed to', not 'suppose to'.",
  },

  // use to → used to
  {
    id: "use-to",
    pattern: /\buse to\b(?!\s+(?:it|this|that|them|the|a|an|his|her|my|your|our))/gi,
    type: "grammar",
    suggestion: "used to",
    explanation: "Use 'used to' for past habits, not 'use to'.",
  },

  // apart → a part (participation)
  {
    id: "apart-a-part",
    pattern: /\bapart of\b/gi,
    type: "grammar",
    suggestion: "a part of",
    explanation: "'Apart' means separate. Use 'a part of' for belonging.",
  },

  // alright → all right (formal)
  {
    id: "everyday-every-day",
    pattern: /\beveryday\b(?=\s+(I|we|you|they|he|she|it|the|this|that|there|people|someone|everyone|is|are|was|were))/gi,
    type: "grammar",
    suggestion: "every day",
    explanation: "'Everyday' is an adjective (everyday life). Use 'every day' for frequency.",
  },

  // ═══════════════════════════════════════════
  // A/AN AGREEMENT
  // ═══════════════════════════════════════════

  // a → an (before vowel sounds)
  {
    id: "a-an",
    pattern: /\ba ([aeiou]\w+)/gi,
    type: "grammar",
    suggestion: (m) => `an ${m[1]}`,
    explanation: "Use 'an' before words starting with a vowel sound.",
  },

  // an → a (before consonant sounds)
  {
    id: "an-a",
    pattern: /\ban ([bcdfgjklmnpqrstvwxyz]\w+)/gi,
    type: "grammar",
    suggestion: (m) => `a ${m[1]}`,
    explanation: "Use 'a' before words starting with a consonant sound.",
  },

  // Fix: "an" before "uni-" words (which have a consonant /juː/ sound)
  {
    id: "an-a-uni",
    pattern: /\ban (uni\w+)/gi,
    type: "grammar",
    suggestion: (m) => `a ${m[1]}`,
    explanation: "Words starting with 'uni-' have a consonant 'y' sound. Use 'a'.",
  },

  // Fix: "a" before "hour/honest/heir/honor" (silent h)
  {
    id: "a-an-silent-h",
    pattern: /\ba (hour|honest|heir|honor|honour|herb)\b/gi,
    type: "grammar",
    suggestion: (m) => `an ${m[1]}`,
    explanation: "This word has a silent 'h', so use 'an'.",
  },

  // ═══════════════════════════════════════════
  // SUBJECT-VERB AGREEMENT
  // ═══════════════════════════════════════════

  {
    id: "he-dont",
    pattern: /\b(he|she|it) don't\b/gi,
    type: "grammar",
    suggestion: "$1 doesn't",
    explanation: "Use 'doesn't' with he/she/it.",
  },
  {
    id: "they-was",
    pattern: /\bthey was\b/gi,
    type: "grammar",
    suggestion: "they were",
    explanation: "'They' takes 'were', not 'was'.",
  },
  {
    id: "i-is",
    pattern: /\bI is\b/g,
    type: "grammar",
    suggestion: "I am",
    explanation: "'I' takes 'am', not 'is'.",
  },
  {
    id: "we-is",
    pattern: /\b(we|they) is\b/gi,
    type: "grammar",
    suggestion: "$1 are",
    explanation: "Use 'are' with '$1', not 'is'.",
  },
  {
    id: "he-have",
    pattern: /\b(he|she|it) have\b(?!\s+to)/gi,
    type: "grammar",
    suggestion: "$1 has",
    explanation: "Use 'has' with he/she/it.",
  },
  {
    id: "i-has",
    pattern: /\bI has\b/g,
    type: "grammar",
    suggestion: "I have",
    explanation: "'I' takes 'have', not 'has'.",
  },

  // ═══════════════════════════════════════════
  // DOUBLED / MISSING WORDS
  // ═══════════════════════════════════════════

  {
    id: "doubled-word",
    pattern: /\b(a|an|the|is|in|it|of|to|and|that|this|for|on|are|was|with|as|at|be|or|but|not|you|we|he|she|they|my|your|his|her|our|do|did|has|have|had|can|will|would|could|should|may|might|if|so|up|no|go|get|got|just|also|very|much|more|some|all|any|each|from) \1\b/gi,
    type: "grammar",
    suggestion: "$1",
    explanation: "Repeated word detected.",
  },

  // ═══════════════════════════════════════════
  // TENSE / FORM ERRORS
  // ═══════════════════════════════════════════

  // didn't/doesn't/don't + past tense → base form
  {
    id: "didnt-past",
    pattern: /\b(didn't|did not) (went|saw|came|gave|took|made|found|knew|got|had|said|told|thought|felt|left|kept|ran|wrote|ate|broke|drove|chose|spoke|woke|wore|threw|grew|drew|began|sang|swam|drank|rang|stole|froze|forgot|understood)\b/gi,
    type: "grammar",
    suggestion: (m) => {
      const fixes: Record<string, string> = {
        went: "go", saw: "see", came: "come", gave: "give", took: "take",
        made: "make", found: "find", knew: "know", got: "get", had: "have",
        said: "say", told: "tell", thought: "think", felt: "feel", left: "leave",
        kept: "keep", ran: "run", wrote: "write", ate: "eat", broke: "break",
        drove: "drive", chose: "choose", spoke: "speak", woke: "wake",
        wore: "wear", threw: "throw", grew: "grow", drew: "draw",
        began: "begin", sang: "sing", swam: "swim", drank: "drink",
        rang: "ring", stole: "steal", froze: "freeze", forgot: "forget",
        understood: "understand",
      };
      return `${m[1]} ${fixes[m[2].toLowerCase()] || m[2]}`;
    },
    explanation: "After 'didn't', use the base form of the verb, not the past tense.",
  },

  // ═══════════════════════════════════════════
  // COMMON MISSPELLINGS (regex-catchable)
  // ═══════════════════════════════════════════

  {
    id: "definately",
    pattern: /\bdefin(ate|ite|at)ly\b/gi,
    type: "spelling",
    suggestion: "definitely",
    explanation: "The correct spelling is 'definitely'.",
  },
  {
    id: "occured",
    pattern: /\boccured\b/gi,
    type: "spelling",
    suggestion: "occurred",
    explanation: "Double the 'r': 'occurred'.",
  },
  {
    id: "recieve",
    pattern: /\brecieve\b/gi,
    type: "spelling",
    suggestion: "receive",
    explanation: "Remember: 'i' before 'e', except after 'c'.",
  },
  {
    id: "seperate",
    pattern: /\bseperate\b/gi,
    type: "spelling",
    suggestion: "separate",
    explanation: "The correct spelling is 'separate' (with an 'a').",
  },
  {
    id: "accomodate",
    pattern: /\baccomodate\b/gi,
    type: "spelling",
    suggestion: "accommodate",
    explanation: "Double 'c' and double 'm': 'accommodate'.",
  },
  {
    id: "neccessary",
    pattern: /\bn(e|a)cess(a|e)ry\b/gi,
    type: "spelling",
    suggestion: "necessary",
    explanation: "One 'c', double 's': 'necessary'.",
  },
  {
    id: "occassion",
    pattern: /\bocc?ass?ion\b(?<!occasion)/gi,
    type: "spelling",
    suggestion: "occasion",
    explanation: "Double 'c', single 's': 'occasion'.",
  },
  {
    id: "untill",
    pattern: /\buntill\b/gi,
    type: "spelling",
    suggestion: "until",
    explanation: "'Until' has only one 'l'.",
  },
  {
    id: "tommorow",
    pattern: /\btomm?or+ow\b(?<!tomorrow)/gi,
    type: "spelling",
    suggestion: "tomorrow",
    explanation: "The correct spelling is 'tomorrow'.",
  },
  {
    id: "begining",
    pattern: /\bbegining\b/gi,
    type: "spelling",
    suggestion: "beginning",
    explanation: "Double the 'n': 'beginning'.",
  },
  {
    id: "beleive",
    pattern: /\bbeleive\b/gi,
    type: "spelling",
    suggestion: "believe",
    explanation: "Remember: 'lie' is in 'believe'.",
  },
  {
    id: "wierd",
    pattern: /\bwierd\b/gi,
    type: "spelling",
    suggestion: "weird",
    explanation: "'Weird' is an exception to the 'i before e' rule.",
  },
  {
    id: "goverment",
    pattern: /\bgover[nm]ent\b(?<!government)/gi,
    type: "spelling",
    suggestion: "government",
    explanation: "Don't forget the 'n': 'government'.",
  },
  {
    id: "enviroment",
    pattern: /\benviro[nm]ent\b(?<!environment)/gi,
    type: "spelling",
    suggestion: "environment",
    explanation: "Don't forget the 'n': 'environment'.",
  },

  // ═══════════════════════════════════════════
  // PUNCTUATION
  // ═══════════════════════════════════════════

  {
    id: "double-period",
    pattern: /\.{2}(?!\.)/g,
    type: "grammar",
    suggestion: ".",
    explanation: "Double period detected.",
  },
  {
    id: "no-space-after-period",
    pattern: /\.([A-Z])/g,
    type: "grammar",
    suggestion: ". $1",
    explanation: "Add a space after the period.",
  },
  {
    id: "no-space-after-comma",
    pattern: /,([A-Za-z])/g,
    type: "grammar",
    suggestion: ", $1",
    explanation: "Add a space after the comma.",
  },
  {
    id: "space-before-comma",
    pattern: /(\w) ,/g,
    type: "grammar",
    suggestion: "$1,",
    explanation: "Remove the space before the comma.",
  },
  {
    id: "space-before-period",
    pattern: /(\w) \./g,
    type: "grammar",
    suggestion: "$1.",
    explanation: "Remove the space before the period.",
  },
  {
    id: "multiple-spaces",
    pattern: /(\S)  +(\S)/g,
    type: "grammar",
    suggestion: "$1 $2",
    explanation: "Multiple consecutive spaces detected.",
  },

  // ═══════════════════════════════════════════
  // MISC COMMON ERRORS
  // ═══════════════════════════════════════════

  // less → fewer (countable nouns)
  {
    id: "less-fewer",
    pattern: /\bless (people|items|things|options|choices|problems|issues|errors|mistakes|words|pages|files|steps|days|weeks|months|years|hours|minutes|seconds|times|questions|answers|points|goals|tasks|features|users|members|employees|customers|students|players|teams|groups|emails|messages|comments|posts|votes|likes|clicks|downloads|uploads|visits|requests|calls|meetings|events|tests|bugs|tickets|reviews|changes|updates|commits|lines|rows|columns|entries|records|accounts|orders|payments|products)\b/gi,
    type: "grammar",
    suggestion: "fewer $1",
    explanation: "Use 'fewer' for countable nouns, 'less' for uncountable.",
  },

  // i → I (capitalization)
  {
    id: "lowercase-i",
    pattern: /(?<=\s)i(?=\s+(am|was|were|have|had|will|would|could|should|can|may|might|shall|do|did|don't|didn't|won't|wouldn't|couldn't|shouldn't|can't|think|know|want|need|like|love|hate|hope|wish|feel|believe|remember|understand|mean|see|hear|go|went|come|came|get|got|say|said|tell|told|ask|asked|try|tried|make|made|take|took|give|gave|find|found|keep|kept|let|put|seem|leave|left|call|called|just|also|really|always|never|often|usually|still|already|actually))/g,
    type: "grammar",
    suggestion: "I",
    explanation: "The pronoun 'I' should always be capitalized.",
  },
];
