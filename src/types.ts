export type PlayerId = 'jay' | 'kim';

export interface Player {
  id: PlayerId;
  name: string;
}

export type RoundingMode = 'nearest' | 'floor' | 'ceil';
export type AnswerType = 'number' | 'currency' | 'percentage' | 'count' | 'time' | 'custom' | 'text' | 'multipleChoice' | 'ranked' | 'pairedText';
export type RoundType =
  | 'numeric'
  | 'multipleChoice'
  | 'trueFalse'
  | 'text'
  | 'sortIntoOrder'
  | 'preference'
  | 'favourite'
  | 'petPeeve'
  | 'ranked'
  | 'rating'
  | 'manual';
export type QuestionSource = 'starter' | 'manual' | 'imported' | 'googleSheet' | 'googleSheetQuiz' | 'backup';
export type ScoringMode = 'direct_penalty_entry' | 'assisted_numeric' | 'fixed_penalty_outcome' | 'manual_outcome';
export type ScoringOutcomeType =
  | 'direct_manual'
  | 'closest_gets_zero_other_gets_fixed_penalty'
  | 'exact_match_else_fixed_penalty'
  | 'winner_gets_zero_loser_gets_fixed_penalty'
  | 'split_penalty'
  | 'custom';

export interface CategoryDefinition {
  id: string;
  name: string;
  color: string;
}

export interface QuestionTemplate {
  id: string;
  question: string;
  roundType: RoundType;
  category: string;
  tags: string[];
  unitLabel: string;
  scoringDivisor: number;
  roundingMode: RoundingMode;
  roundPenaltyValue: number;
  fixedPenalty: number;
  scoringMode: ScoringMode;
  scoringOutcomeType: ScoringOutcomeType;
  notes: string;
  defaultAnswerType: AnswerType;
  answerType: AnswerType;
  multipleChoiceOptions: string[];
  source: QuestionSource;
  sourceLabel?: string;
  addedBy?: string;
  importedFromGoogleSheet?: boolean;
  importDate?: string | null;
  used: boolean;
  timesPlayed: number;
  lastPlayedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoundResult {
  id: string;
  number: number;
  questionId: string | null;
  question: string;
  roundType: RoundType;
  answerType: AnswerType;
  defaultAnswerType: AnswerType;
  category: string;
  tags: string[];
  unitLabel: string;
  notes: string;
  actualAnswer: number;
  guesses: Record<PlayerId, number>;
  actualText: string;
  guessText: Record<PlayerId, string>;
  actualAnswers: Record<PlayerId, string>;
  guessedAnswers: Record<PlayerId, string>;
  actualList: Record<PlayerId, string[]>;
  guessedList: Record<PlayerId, string[]>;
  multipleChoiceOptions: string[];
  penaltyAdded: Record<PlayerId, number>;
  scores: Record<PlayerId, number>;
  manualScores: boolean;
  scoringMode: ScoringMode;
  scoringOutcomeType: ScoringOutcomeType;
  scoringDivisor: number;
  roundingMode: RoundingMode;
  roundPenaltyValue: number;
  fixedPenalty: number;
  scoreExplanation: string;
  allowDecimals: boolean;
  integerScores: boolean;
  winner: PlayerId | 'tie';
  overallLeader: PlayerId | 'tie';
  totalPenaltyAfterRound: Record<PlayerId, number>;
  totalsAfterRound: Record<PlayerId, number>;
  createdAt: string;
}

export interface GameSettings {
  gameMode: 'standard' | 'category' | 'unused' | 'repeat' | 'manual';
  selectedCategory: string;
  selectedTag: string;
  selectedRoundType: RoundType | '';
  allowRepeats: boolean;
  unusedOnly: boolean;
  skipDuplicates: boolean;
  allowDecimals: boolean;
  integerScores: boolean;
  requireNotes: boolean;
  lockDivisorFromTemplate: boolean;
  editableDivisorBeforeSave: boolean;
  googleSheetInput?: string;
  googleSheetId?: string;
  googleSheetGid?: string;
  googleSheetConnectedAt?: string | null;
  googleSheetLastSyncedAt?: string | null;
  googleSheetOverwriteExisting?: boolean;
}

export interface AnalyticsSummary {
  totalRounds: number;
  totals: Record<PlayerId, number>;
  averages: Record<PlayerId, number>;
  bestRounds: Record<PlayerId, { score: number; number: number; question: string } | null>;
  worstRounds: Record<PlayerId, { score: number; number: number; question: string } | null>;
  mostCommonCategory: string;
  closestRound: RoundResult | null;
  biggestBlowoutRound: RoundResult | null;
  currentStreak: { winner: PlayerId | 'tie'; count: number };
  longestWinningStreak: { winner: PlayerId | 'tie'; count: number };
  leaderboardSummary: string;
  categoryTrend?: Array<{ round: number; category: string; winner: PlayerId | 'tie'; jay: number; kim: number; gap: number }>;
}
