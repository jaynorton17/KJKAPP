export const HOLDEM_SMALL_BLIND = 5;
export const HOLDEM_BIG_BLIND = 10;

const HOLDEM_SEATS = ['jay', 'kim'];
const SUITS = ['s', 'h', 'd', 'c'];
const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const RANK_VALUES = Object.fromEntries(RANK_ORDER.map((rank, index) => [rank, index + 2]));
const HAND_CATEGORY = {
  high_card: 0,
  one_pair: 1,
  two_pair: 2,
  three_of_a_kind: 3,
  straight: 4,
  flush: 5,
  full_house: 6,
  four_of_a_kind: 7,
  straight_flush: 8,
  royal_flush: 9,
};

const normalizeSeat = (seat = 'jay') => (seat === 'kim' ? 'kim' : 'jay');
const oppositeSeat = (seat = 'jay') => (normalizeSeat(seat) === 'kim' ? 'jay' : 'kim');
const toWholePoints = (value = 0) => Math.max(0, Math.floor(Number(value || 0) || 0));
const sortDesc = (values = []) => [...values].sort((left, right) => right - left);

const defaultHoldemPlayerState = (seat = 'jay', stack = 0) => ({
  seat: normalizeSeat(seat),
  stack: toWholePoints(stack),
  startingStack: toWholePoints(stack),
  streetCommitted: 0,
  totalCommitted: 0,
  folded: false,
  allIn: false,
  holeCards: [],
  hasActedThisStreet: false,
  lastAction: '',
  lastActionAmount: 0,
});

const defaultBalances = (balances = {}) => ({
  jay: toWholePoints(balances?.jay),
  kim: toWholePoints(balances?.kim),
});

const defaultDealReadyBySeat = (ready = {}) => ({
  jay: Boolean(ready?.jay),
  kim: Boolean(ready?.kim),
});

const clonePlayers = (players = {}) => ({
  jay: { ...defaultHoldemPlayerState('jay', 0), ...(players?.jay || {}), holeCards: [...(players?.jay?.holeCards || [])] },
  kim: { ...defaultHoldemPlayerState('kim', 0), ...(players?.kim || {}), holeCards: [...(players?.kim?.holeCards || [])] },
});

const buildPlayersFromBalances = (balances = {}) => ({
  jay: defaultHoldemPlayerState('jay', balances?.jay || 0),
  kim: defaultHoldemPlayerState('kim', balances?.kim || 0),
});

const buildEmptyHoldemState = ({
  lastSettledBalances = {},
  nextDealerSeat = 'jay',
  handNumber = 0,
  sessionStatus = 'waiting_for_players',
  statusMessage = 'Waiting for both players to join.',
} = {}) => {
  const normalizedBalances = defaultBalances(lastSettledBalances);
  return {
    version: 1,
    sessionStatus,
    statusMessage,
    handNumber: Number(handNumber || 0),
    phase: '',
    nextDealerSeat: normalizeSeat(nextDealerSeat),
    dealerSeat: '',
    smallBlindSeat: '',
    bigBlindSeat: '',
    actionSeat: '',
    currentBet: 0,
    minRaiseTo: HOLDEM_BIG_BLIND,
    lastFullRaiseSize: HOLDEM_BIG_BLIND,
    pendingSeats: [],
    raiseDisabledSeats: [],
    communityRunout: [],
    communityCards: [],
    startingBankrolls: normalizedBalances,
    lastSettledBalances: normalizedBalances,
    players: buildPlayersFromBalances(normalizedBalances),
    potTotal: 0,
    showdown: null,
    settlement: null,
    dealReadyBySeat: defaultDealReadyBySeat(),
    actionLog: [],
    updatedAt: '',
    completedAt: '',
  };
};

const buildActionLogEntry = (state = {}, seat = '', action = '', amount = 0, meta = {}) => ({
  id: `holdem-log-${Number(state?.handNumber || 0)}-${Number((state?.actionLog || []).length || 0) + 1}`,
  handNumber: Number(state?.handNumber || 0),
  seat: normalizeSeat(seat),
  action,
  amount: toWholePoints(amount),
  phase: state?.phase || '',
  ...meta,
});

export const createHoldemDeck = () =>
  SUITS.flatMap((suit) => RANK_ORDER.map((rank) => `${rank}${suit}`));

export const shuffleHoldemDeck = (cards = []) => {
  const deck = [...cards];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
};

const rankValueFromCard = (card = '') => RANK_VALUES[String(card || '').charAt(0)] || 0;
const suitValueFromCard = (card = '') => String(card || '').slice(1, 2);

const compareNumberArrays = (left = [], right = []) => {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = Number(left[index] || 0);
    const rightValue = Number(right[index] || 0);
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }
  return 0;
};

const compareEvaluatedHands = (left = null, right = null) => {
  if (!left && !right) return 0;
  if (left && !right) return 1;
  if (!left && right) return -1;
  if (Number(left.categoryRank || 0) > Number(right.categoryRank || 0)) return 1;
  if (Number(left.categoryRank || 0) < Number(right.categoryRank || 0)) return -1;
  return compareNumberArrays(left.tiebreakers || [], right.tiebreakers || []);
};

const getStraightHighCard = (values = []) => {
  const uniqueValues = [...new Set(values)].sort((left, right) => right - left);
  if (uniqueValues.includes(14)) uniqueValues.push(1);
  for (let index = 0; index <= uniqueValues.length - 5; index += 1) {
    const window = uniqueValues.slice(index, index + 5);
    if (window.length === 5 && window[0] - window[4] === 4) {
      return window[0] === 5 && window[4] === 1 ? 5 : window[0];
    }
  }
  return 0;
};

const evaluateFiveCardHand = (cards = []) => {
  const values = sortDesc(cards.map((card) => rankValueFromCard(card)));
  const suits = cards.map((card) => suitValueFromCard(card));
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  const groups = [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return right[0] - left[0];
  });
  const flush = suits.every((suit) => suit && suit === suits[0]);
  const straightHigh = getStraightHighCard(values);
  if (flush && straightHigh === 14 && values.includes(10)) {
    return {
      category: 'royal_flush',
      categoryRank: HAND_CATEGORY.royal_flush,
      tiebreakers: [14],
      cards: [...cards],
      label: 'Royal Flush',
    };
  }
  if (flush && straightHigh) {
    return {
      category: 'straight_flush',
      categoryRank: HAND_CATEGORY.straight_flush,
      tiebreakers: [straightHigh],
      cards: [...cards],
      label: 'Straight Flush',
    };
  }
  if (groups[0]?.[1] === 4) {
    const quadRank = groups[0][0];
    const kicker = groups[1]?.[0] || 0;
    return {
      category: 'four_of_a_kind',
      categoryRank: HAND_CATEGORY.four_of_a_kind,
      tiebreakers: [quadRank, kicker],
      cards: [...cards],
      label: 'Four of a Kind',
    };
  }
  if (groups[0]?.[1] === 3 && groups[1]?.[1] === 2) {
    return {
      category: 'full_house',
      categoryRank: HAND_CATEGORY.full_house,
      tiebreakers: [groups[0][0], groups[1][0]],
      cards: [...cards],
      label: 'Full House',
    };
  }
  if (flush) {
    return {
      category: 'flush',
      categoryRank: HAND_CATEGORY.flush,
      tiebreakers: values,
      cards: [...cards],
      label: 'Flush',
    };
  }
  if (straightHigh) {
    return {
      category: 'straight',
      categoryRank: HAND_CATEGORY.straight,
      tiebreakers: [straightHigh],
      cards: [...cards],
      label: 'Straight',
    };
  }
  if (groups[0]?.[1] === 3) {
    const kickers = sortDesc(groups.slice(1).map(([rank]) => rank));
    return {
      category: 'three_of_a_kind',
      categoryRank: HAND_CATEGORY.three_of_a_kind,
      tiebreakers: [groups[0][0], ...kickers],
      cards: [...cards],
      label: 'Three of a Kind',
    };
  }
  if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) {
    const pairRanks = sortDesc([groups[0][0], groups[1][0]]);
    const kicker = groups[2]?.[0] || 0;
    return {
      category: 'two_pair',
      categoryRank: HAND_CATEGORY.two_pair,
      tiebreakers: [...pairRanks, kicker],
      cards: [...cards],
      label: 'Two Pair',
    };
  }
  if (groups[0]?.[1] === 2) {
    const kickers = sortDesc(groups.slice(1).map(([rank]) => rank));
    return {
      category: 'one_pair',
      categoryRank: HAND_CATEGORY.one_pair,
      tiebreakers: [groups[0][0], ...kickers],
      cards: [...cards],
      label: 'One Pair',
    };
  }
  return {
    category: 'high_card',
    categoryRank: HAND_CATEGORY.high_card,
    tiebreakers: values,
    cards: [...cards],
    label: 'High Card',
  };
};

const buildFiveCardCombinations = (cards = []) => {
  const combinations = [];
  for (let first = 0; first < cards.length - 4; first += 1) {
    for (let second = first + 1; second < cards.length - 3; second += 1) {
      for (let third = second + 1; third < cards.length - 2; third += 1) {
        for (let fourth = third + 1; fourth < cards.length - 1; fourth += 1) {
          for (let fifth = fourth + 1; fifth < cards.length; fifth += 1) {
            combinations.push([cards[first], cards[second], cards[third], cards[fourth], cards[fifth]]);
          }
        }
      }
    }
  }
  return combinations;
};

export const evaluateBestHoldemHand = (cards = []) => {
  const combinations = buildFiveCardCombinations(cards);
  let best = null;
  combinations.forEach((combo) => {
    const evaluation = evaluateFiveCardHand(combo);
    if (!best || compareEvaluatedHands(evaluation, best) > 0) best = evaluation;
  });
  return best;
};

const buildEligiblePotSegments = (players = {}) => {
  const contributions = HOLDEM_SEATS
    .map((seat) => ({
      seat,
      contributed: toWholePoints(players?.[seat]?.totalCommitted || 0),
      folded: Boolean(players?.[seat]?.folded),
    }))
    .filter((entry) => entry.contributed > 0)
    .sort((left, right) => left.contributed - right.contributed);
  const levels = [...new Set(contributions.map((entry) => entry.contributed))];
  let previousLevel = 0;
  return levels.map((level) => {
    const contributors = contributions.filter((entry) => entry.contributed >= level).map((entry) => entry.seat);
    const eligibleSeats = contributors.filter((seat) => !players?.[seat]?.folded);
    const amount = (level - previousLevel) * contributors.length;
    previousLevel = level;
    return {
      level,
      amount: toWholePoints(amount),
      contributors,
      eligibleSeats,
    };
  }).filter((segment) => segment.amount > 0 && segment.eligibleSeats.length);
};

const buildOddChipOrder = (dealerSeat = 'jay', eligibleSeats = []) => {
  const firstSeat = oppositeSeat(dealerSeat);
  const seen = new Set();
  const order = [];
  let cursor = firstSeat;
  for (let index = 0; index < HOLDEM_SEATS.length; index += 1) {
    if (eligibleSeats.includes(cursor) && !seen.has(cursor)) {
      seen.add(cursor);
      order.push(cursor);
    }
    cursor = oppositeSeat(cursor);
  }
  return order;
};

const distributePotAmount = (amount = 0, winningSeats = [], dealerSeat = 'jay') => {
  const payouts = { jay: 0, kim: 0 };
  if (!winningSeats.length || amount <= 0) return payouts;
  const share = Math.floor(amount / winningSeats.length);
  let remainder = amount - (share * winningSeats.length);
  winningSeats.forEach((seat) => {
    payouts[seat] += share;
  });
  const oddChipOrder = buildOddChipOrder(dealerSeat, winningSeats);
  while (remainder > 0 && oddChipOrder.length) {
    oddChipOrder.forEach((seat) => {
      if (remainder <= 0) return;
      payouts[seat] += 1;
      remainder -= 1;
    });
  }
  return payouts;
};

const getContestableSeats = (state = {}) =>
  HOLDEM_SEATS.filter((seat) => !state?.players?.[seat]?.folded);

const getActionableSeats = (state = {}) =>
  HOLDEM_SEATS.filter((seat) => !state?.players?.[seat]?.folded && !state?.players?.[seat]?.allIn);

const getActionOrder = (startingSeat = 'jay', eligibleSeats = []) => {
  const normalizedEligible = HOLDEM_SEATS.filter((seat) => eligibleSeats.includes(seat));
  if (!normalizedEligible.length) return [];
  const ordered = [];
  let cursor = normalizeSeat(startingSeat);
  for (let index = 0; index < HOLDEM_SEATS.length; index += 1) {
    if (normalizedEligible.includes(cursor) && !ordered.includes(cursor)) ordered.push(cursor);
    cursor = oppositeSeat(cursor);
  }
  return ordered;
};

const getPreflopFirstSeat = (state = {}) => normalizeSeat(state?.smallBlindSeat || state?.dealerSeat || 'jay');
const getPostflopFirstSeat = (state = {}) => normalizeSeat(state?.bigBlindSeat || oppositeSeat(state?.dealerSeat || 'jay'));

const updateSessionStatusForBalances = (state = {}, balances = {}, bothPlayersJoined = false) => {
  const normalizedBalances = defaultBalances(balances);
  if (!bothPlayersJoined) {
    return {
      ...buildEmptyHoldemState({
        lastSettledBalances: normalizedBalances,
        nextDealerSeat: state?.nextDealerSeat || 'jay',
        handNumber: state?.handNumber || 0,
        sessionStatus: 'waiting_for_players',
        statusMessage: 'Waiting for both players to join the table.',
      }),
      showdown: state?.showdown || null,
      settlement: state?.settlement || null,
    };
  }
  if (normalizedBalances.jay <= 0 || normalizedBalances.kim <= 0) {
    return {
      ...buildEmptyHoldemState({
        lastSettledBalances: normalizedBalances,
        nextDealerSeat: state?.nextDealerSeat || 'jay',
        handNumber: state?.handNumber || 0,
        sessionStatus: 'bankroll_blocked',
        statusMessage: 'Both players need penalty points available before the next Hold’em hand can start.',
      }),
      showdown: state?.showdown || null,
      settlement: state?.settlement || null,
    };
  }
  return {
    ...buildEmptyHoldemState({
      lastSettledBalances: normalizedBalances,
      nextDealerSeat: state?.nextDealerSeat || 'jay',
      handNumber: state?.handNumber || 0,
      sessionStatus: 'ready_to_deal',
      statusMessage: 'Players are seated. Deal the next hand to begin.',
    }),
    showdown: state?.showdown || null,
    settlement: state?.settlement || null,
  };
};

export const createHoldemSessionState = ({
  balances = {},
  nextDealerSeat = 'jay',
  bothPlayersJoined = false,
} = {}) =>
  updateSessionStatusForBalances(
    buildEmptyHoldemState({
      lastSettledBalances: balances,
      nextDealerSeat,
      handNumber: 0,
    }),
    balances,
    bothPlayersJoined,
  );

const postBlind = (player = {}, blindAmount = 0) => {
  const postAmount = Math.min(toWholePoints(blindAmount), toWholePoints(player?.stack || 0));
  return {
    ...player,
    stack: toWholePoints(player?.stack || 0) - postAmount,
    streetCommitted: postAmount,
    totalCommitted: postAmount,
    allIn: toWholePoints(player?.stack || 0) - postAmount <= 0,
    lastAction: blindAmount === HOLDEM_SMALL_BLIND ? 'small_blind' : 'big_blind',
    lastActionAmount: postAmount,
  };
};

const createLiveHandState = ({
  balances = {},
  nextDealerSeat = 'jay',
  previousHandNumber = 0,
  startedAt = new Date().toISOString(),
} = {}) => {
  const normalizedBalances = defaultBalances(balances);
  const dealerSeat = normalizeSeat(nextDealerSeat);
  const smallBlindSeat = dealerSeat;
  const bigBlindSeat = oppositeSeat(dealerSeat);
  const deck = shuffleHoldemDeck(createHoldemDeck());
  const jayHoleCards = [deck[0], deck[2]];
  const kimHoleCards = [deck[1], deck[3]];
  const communityRunout = [deck[4], deck[5], deck[6], deck[7], deck[8]];
  const basePlayers = buildPlayersFromBalances(normalizedBalances);
  let players = {
    jay: { ...basePlayers.jay, holeCards: jayHoleCards },
    kim: { ...basePlayers.kim, holeCards: kimHoleCards },
  };
  players = {
    ...players,
    [smallBlindSeat]: postBlind(players[smallBlindSeat], HOLDEM_SMALL_BLIND),
    [bigBlindSeat]: postBlind(players[bigBlindSeat], HOLDEM_BIG_BLIND),
  };
  const actionOrder = getActionOrder(
    getPreflopFirstSeat({ smallBlindSeat, dealerSeat }),
    getActionableSeats({ players }),
  );
  const state = {
    version: 1,
    sessionStatus: 'hand_live',
    statusMessage: 'Hand in progress.',
    handNumber: Number(previousHandNumber || 0) + 1,
    phase: 'preflop',
    nextDealerSeat: oppositeSeat(dealerSeat),
    dealerSeat,
    smallBlindSeat,
    bigBlindSeat,
    actionSeat: actionOrder[0] || '',
    currentBet: Math.max(
      toWholePoints(players[smallBlindSeat]?.streetCommitted || 0),
      toWholePoints(players[bigBlindSeat]?.streetCommitted || 0),
    ),
    minRaiseTo: Math.max(
      toWholePoints(players[bigBlindSeat]?.streetCommitted || 0) + HOLDEM_BIG_BLIND,
      HOLDEM_BIG_BLIND,
    ),
    lastFullRaiseSize: HOLDEM_BIG_BLIND,
    pendingSeats: actionOrder,
    raiseDisabledSeats: [],
    communityRunout,
    communityCards: [],
    startingBankrolls: normalizedBalances,
    lastSettledBalances: normalizedBalances,
    players,
    potTotal: toWholePoints(players.jay.totalCommitted || 0) + toWholePoints(players.kim.totalCommitted || 0),
    showdown: null,
    settlement: null,
    dealReadyBySeat: defaultDealReadyBySeat(),
    actionLog: [
      buildActionLogEntry({ handNumber: Number(previousHandNumber || 0) + 1, actionLog: [] }, smallBlindSeat, 'small_blind', players[smallBlindSeat].streetCommitted),
      buildActionLogEntry({ handNumber: Number(previousHandNumber || 0) + 1, actionLog: [{}] }, bigBlindSeat, 'big_blind', players[bigBlindSeat].streetCommitted),
    ],
    updatedAt: startedAt,
    completedAt: '',
  };
  return state;
};

const commitToTargetTotal = (player = {}, targetTotal = 0) => {
  const safeTargetTotal = Math.max(toWholePoints(player?.streetCommitted || 0), toWholePoints(targetTotal));
  const maxTarget = toWholePoints(player?.streetCommitted || 0) + toWholePoints(player?.stack || 0);
  const nextTarget = Math.min(safeTargetTotal, maxTarget);
  const added = nextTarget - toWholePoints(player?.streetCommitted || 0);
  const nextStack = toWholePoints(player?.stack || 0) - added;
  return {
    player: {
      ...player,
      stack: nextStack,
      streetCommitted: nextTarget,
      totalCommitted: toWholePoints(player?.totalCommitted || 0) + added,
      allIn: nextStack <= 0,
      lastActionAmount: added,
    },
    added,
    allIn: nextStack <= 0,
  };
};

const buildHandDescription = (evaluation = null) => {
  if (!evaluation) return 'No made hand';
  switch (evaluation.category) {
    case 'royal_flush':
      return 'Royal Flush';
    case 'straight_flush':
      return `Straight Flush, ${evaluation.tiebreakers?.[0] || 0} high`;
    case 'four_of_a_kind':
      return `Four of a Kind, ${evaluation.tiebreakers?.[0] || 0}s`;
    case 'full_house':
      return `Full House, ${evaluation.tiebreakers?.[0] || 0}s full of ${evaluation.tiebreakers?.[1] || 0}s`;
    case 'flush':
      return `Flush, ${evaluation.tiebreakers?.[0] || 0} high`;
    case 'straight':
      return `Straight, ${evaluation.tiebreakers?.[0] || 0} high`;
    case 'three_of_a_kind':
      return `Three of a Kind, ${evaluation.tiebreakers?.[0] || 0}s`;
    case 'two_pair':
      return `Two Pair, ${evaluation.tiebreakers?.[0] || 0}s and ${evaluation.tiebreakers?.[1] || 0}s`;
    case 'one_pair':
      return `Pair of ${evaluation.tiebreakers?.[0] || 0}s`;
    default:
      return `High Card, ${evaluation.tiebreakers?.[0] || 0}`;
  }
};

const revealRemainingCommunityCards = (state = {}) => ({
  ...state,
  communityCards: [...(state?.communityRunout || [])],
  phase: 'showdown',
});

export const resolveHoldemShowdown = (sourceState = {}) => {
  const state = revealRemainingCommunityCards({
    ...sourceState,
    players: clonePlayers(sourceState?.players || {}),
    actionLog: [...(sourceState?.actionLog || [])],
  });
  const contestants = getContestableSeats(state);
  const evaluations = Object.fromEntries(
    contestants.map((seat) => [
      seat,
      evaluateBestHoldemHand([...(state.players?.[seat]?.holeCards || []), ...(state.communityRunout || []).slice(0, 5)]),
    ]),
  );
  const pots = buildEligiblePotSegments(state.players);
  const payouts = { jay: 0, kim: 0 };
  const potResults = pots.map((pot, index) => {
    const bestEvaluation = pot.eligibleSeats
      .map((seat) => ({ seat, evaluation: evaluations[seat] }))
      .sort((left, right) => compareEvaluatedHands(right.evaluation, left.evaluation))[0]?.evaluation || null;
    const winners = pot.eligibleSeats.filter((seat) => compareEvaluatedHands(evaluations[seat], bestEvaluation) === 0);
    const distributed = distributePotAmount(pot.amount, winners, state.dealerSeat || 'jay');
    HOLDEM_SEATS.forEach((seat) => {
      payouts[seat] += distributed[seat] || 0;
    });
    return {
      id: `pot-${index + 1}`,
      amount: pot.amount,
      eligibleSeats: pot.eligibleSeats,
      winners,
      payouts: distributed,
    };
  });
  const nextPlayers = clonePlayers(state.players);
  HOLDEM_SEATS.forEach((seat) => {
    nextPlayers[seat].stack = toWholePoints(nextPlayers[seat].stack || 0) + toWholePoints(payouts[seat] || 0);
    nextPlayers[seat].lastAction = nextPlayers[seat].folded ? 'fold' : nextPlayers[seat].lastAction || 'showdown';
  });
  const netChanges = {
    jay: toWholePoints(nextPlayers.jay.stack || 0) - toWholePoints(state.startingBankrolls?.jay || 0),
    kim: toWholePoints(nextPlayers.kim.stack || 0) - toWholePoints(state.startingBankrolls?.kim || 0),
  };
  const showdown = {
    reason: 'showdown',
    evaluations: Object.fromEntries(
      HOLDEM_SEATS.map((seat) => [
        seat,
        evaluations[seat]
          ? {
              ...evaluations[seat],
              description: buildHandDescription(evaluations[seat]),
            }
          : null,
      ]),
    ),
    pots: potResults,
    payouts,
    netChanges,
    winningSeats: HOLDEM_SEATS.filter((seat) => payouts[seat] > 0).sort((left, right) => payouts[right] - payouts[left]),
  };
  return {
    ...state,
    players: nextPlayers,
    sessionStatus: 'hand_complete',
    phase: 'complete',
    actionSeat: '',
    pendingSeats: [],
    raiseDisabledSeats: [],
    showdown,
    settlement: showdown,
    dealReadyBySeat: defaultDealReadyBySeat(),
    statusMessage:
      showdown.winningSeats.length > 1
        ? 'Showdown complete. The pot was split.'
        : `${normalizeSeat(showdown.winningSeats[0] || 'jay')} wins at showdown.`,
    completedAt: new Date().toISOString(),
  };
};

const awardFoldWinner = (sourceState = {}, winnerSeat = 'jay') => {
  const state = {
    ...sourceState,
    players: clonePlayers(sourceState?.players || {}),
  };
  const totalPot = HOLDEM_SEATS.reduce((sum, seat) => sum + toWholePoints(state.players?.[seat]?.totalCommitted || 0), 0);
  state.players[winnerSeat].stack = toWholePoints(state.players[winnerSeat].stack || 0) + totalPot;
  const netChanges = {
    jay: toWholePoints(state.players.jay.stack || 0) - toWholePoints(state.startingBankrolls?.jay || 0),
    kim: toWholePoints(state.players.kim.stack || 0) - toWholePoints(state.startingBankrolls?.kim || 0),
  };
  return {
    ...state,
    sessionStatus: 'hand_complete',
    phase: 'complete',
    actionSeat: '',
    pendingSeats: [],
    raiseDisabledSeats: [],
    showdown: {
      reason: 'fold',
      evaluations: { jay: null, kim: null },
      pots: [
        {
          id: 'pot-1',
          amount: totalPot,
          eligibleSeats: [winnerSeat],
          winners: [winnerSeat],
          payouts: { jay: winnerSeat === 'jay' ? totalPot : 0, kim: winnerSeat === 'kim' ? totalPot : 0 },
        },
      ],
      payouts: { jay: winnerSeat === 'jay' ? totalPot : 0, kim: winnerSeat === 'kim' ? totalPot : 0 },
      netChanges,
      winningSeats: [winnerSeat],
    },
    settlement: {
      reason: 'fold',
      evaluations: { jay: null, kim: null },
      pots: [
        {
          id: 'pot-1',
          amount: totalPot,
          eligibleSeats: [winnerSeat],
          winners: [winnerSeat],
          payouts: { jay: winnerSeat === 'jay' ? totalPot : 0, kim: winnerSeat === 'kim' ? totalPot : 0 },
        },
      ],
      payouts: { jay: winnerSeat === 'jay' ? totalPot : 0, kim: winnerSeat === 'kim' ? totalPot : 0 },
      netChanges,
      winningSeats: [winnerSeat],
    },
    dealReadyBySeat: defaultDealReadyBySeat(),
    statusMessage: `${winnerSeat === 'jay' ? 'Jay' : 'Kim'} wins the pot after a fold.`,
    completedAt: new Date().toISOString(),
  };
};

const advanceHoldemStreet = (sourceState = {}) => {
  const state = {
    ...sourceState,
    players: clonePlayers(sourceState?.players || {}),
  };
  let nextPhase = '';
  let nextCommunityCards = [...(state.communityCards || [])];
  if (state.phase === 'preflop') {
    nextPhase = 'flop';
    nextCommunityCards = (state.communityRunout || []).slice(0, 3);
  } else if (state.phase === 'flop') {
    nextPhase = 'turn';
    nextCommunityCards = (state.communityRunout || []).slice(0, 4);
  } else if (state.phase === 'turn') {
    nextPhase = 'river';
    nextCommunityCards = (state.communityRunout || []).slice(0, 5);
  } else {
    return resolveHoldemShowdown(state);
  }
  HOLDEM_SEATS.forEach((seat) => {
    state.players[seat] = {
      ...state.players[seat],
      streetCommitted: 0,
      hasActedThisStreet: false,
    };
  });
  const pendingSeats = getActionOrder(getPostflopFirstSeat(state), getActionableSeats(state));
  const nextState = {
    ...state,
    phase: nextPhase,
    communityCards: nextCommunityCards,
    currentBet: 0,
    minRaiseTo: HOLDEM_BIG_BLIND,
    lastFullRaiseSize: HOLDEM_BIG_BLIND,
    pendingSeats,
    actionSeat: pendingSeats[0] || '',
    raiseDisabledSeats: [],
  };
  return pendingSeats.length ? nextState : resolveHoldemShowdown(nextState);
};

const settleAutomaticHoldemState = (sourceState = {}) => {
  const state = {
    ...sourceState,
    players: clonePlayers(sourceState?.players || {}),
    pendingSeats: [...(sourceState?.pendingSeats || [])].filter((seat) => !sourceState?.players?.[seat]?.folded && !sourceState?.players?.[seat]?.allIn),
    raiseDisabledSeats: [...(sourceState?.raiseDisabledSeats || [])],
  };
  const contestingSeats = getContestableSeats(state);
  if (contestingSeats.length === 1) return awardFoldWinner(state, contestingSeats[0]);
  if (state.pendingSeats.length > 0) {
    return {
      ...state,
      actionSeat: state.pendingSeats[0] || '',
    };
  }
  const actionableSeats = getActionableSeats(state);
  if (actionableSeats.length <= 1) {
    return resolveHoldemShowdown(state);
  }
  if (state.phase === 'river') return resolveHoldemShowdown(state);
  return advanceHoldemStreet(state);
};

export const getHoldemVisibleCommunityCards = (state = {}) => [...(state?.communityCards || [])];

export const getLegalHoldemActions = (state = {}, seat = '') => {
  const normalizedSeat = normalizeSeat(seat);
  if (state?.sessionStatus !== 'hand_live' || normalizeSeat(state?.actionSeat || '') !== normalizedSeat) {
    return {
      canAct: false,
      amountToCall: 0,
      maxTotal: 0,
      minBetTo: HOLDEM_BIG_BLIND,
      minRaiseTo: HOLDEM_BIG_BLIND,
      actions: {
        fold: false,
        check: false,
        call: false,
        bet: false,
        raise: false,
        allIn: false,
      },
    };
  }
  const player = state?.players?.[normalizedSeat];
  if (!player || player.folded || player.allIn) {
    return {
      canAct: false,
      amountToCall: 0,
      maxTotal: 0,
      minBetTo: HOLDEM_BIG_BLIND,
      minRaiseTo: HOLDEM_BIG_BLIND,
      actions: {
        fold: false,
        check: false,
        call: false,
        bet: false,
        raise: false,
        allIn: false,
      },
    };
  }
  const amountToCall = Math.max(0, toWholePoints(state?.currentBet || 0) - toWholePoints(player?.streetCommitted || 0));
  const maxTotal = toWholePoints(player?.streetCommitted || 0) + toWholePoints(player?.stack || 0);
  const minBetTo = Math.min(maxTotal, Math.max(HOLDEM_BIG_BLIND, toWholePoints(state?.currentBet || 0) || HOLDEM_BIG_BLIND));
  const minRaiseTo = Math.min(maxTotal, Math.max(toWholePoints(state?.minRaiseTo || HOLDEM_BIG_BLIND), toWholePoints(state?.currentBet || 0) + HOLDEM_BIG_BLIND));
  const raiseDisabled = (state?.raiseDisabledSeats || []).includes(normalizedSeat);
  return {
    canAct: true,
    amountToCall,
    maxTotal,
    minBetTo,
    minRaiseTo,
    actions: {
      fold: true,
      check: amountToCall === 0,
      call: amountToCall > 0 && player.stack > 0,
      bet: amountToCall === 0 && maxTotal > 0,
      raise: amountToCall > 0 && maxTotal > toWholePoints(state?.currentBet || 0) && !raiseDisabled,
      allIn: player.stack > 0,
    },
  };
};

export const getHoldemActionState = getLegalHoldemActions;

const applyStructuredBet = (state = {}, seat = '', action = 'bet', targetAmount = 0) => {
  const normalizedSeat = normalizeSeat(seat);
  const player = state.players[normalizedSeat];
  const legal = getLegalHoldemActions(state, normalizedSeat);
  const previousCurrentBet = toWholePoints(state.currentBet || 0);
  const previousMinRaiseTo = toWholePoints(state.minRaiseTo || HOLDEM_BIG_BLIND);
  const hadActedBeforeAction = Object.fromEntries(HOLDEM_SEATS.map((entrySeat) => [entrySeat, Boolean(state.players?.[entrySeat]?.hasActedThisStreet)]));
  if (action === 'bet' && !legal.actions.bet) throw new Error('Bet is not legal right now.');
  if (action === 'raise' && !legal.actions.raise) throw new Error('Raise is not legal right now.');
  const maxTotal = legal.maxTotal;
  const normalizedTarget = toWholePoints(targetAmount);
  const minimumTarget = action === 'bet' ? legal.minBetTo : legal.minRaiseTo;
  if (normalizedTarget <= previousCurrentBet) throw new Error(action === 'bet' ? 'Bet must add chips.' : 'Raise must move the bet higher.');
  if (normalizedTarget > maxTotal) throw new Error('That action is larger than the available stack.');
  const isAllInTarget = normalizedTarget === maxTotal;
  if (normalizedTarget < minimumTarget && !isAllInTarget) {
    throw new Error(action === 'bet' ? `Bet at least ${minimumTarget}.` : `Raise to at least ${minimumTarget}.`);
  }
  const committed = commitToTargetTotal(player, normalizedTarget);
  const updatedPlayers = clonePlayers(state.players);
  updatedPlayers[normalizedSeat] = {
    ...committed.player,
    hasActedThisStreet: true,
    lastAction: committed.allIn ? 'all-in' : action,
  };
  const raiseSize = updatedPlayers[normalizedSeat].streetCommitted - previousCurrentBet;
  const fullRaise = action === 'bet'
    ? normalizedTarget >= HOLDEM_BIG_BLIND
    : normalizedTarget >= previousMinRaiseTo;
  const eligibleResponders = getActionOrder(
    oppositeSeat(normalizedSeat),
    HOLDEM_SEATS.filter((entrySeat) => entrySeat !== normalizedSeat && !updatedPlayers[entrySeat].folded && !updatedPlayers[entrySeat].allIn),
  );
  return {
    ...state,
    players: updatedPlayers,
    currentBet: updatedPlayers[normalizedSeat].streetCommitted,
    minRaiseTo: updatedPlayers[normalizedSeat].streetCommitted + (fullRaise ? raiseSize : toWholePoints(state.lastFullRaiseSize || HOLDEM_BIG_BLIND)),
    lastFullRaiseSize: fullRaise ? raiseSize : toWholePoints(state.lastFullRaiseSize || HOLDEM_BIG_BLIND),
    pendingSeats: eligibleResponders,
    raiseDisabledSeats: fullRaise
      ? []
      : eligibleResponders.filter((entrySeat) => hadActedBeforeAction[entrySeat]),
    actionSeat: eligibleResponders[0] || '',
    potTotal: toWholePoints(state.potTotal || 0) + committed.added,
    actionLog: [
      ...(state.actionLog || []),
      buildActionLogEntry(state, normalizedSeat, committed.allIn ? 'all-in' : action, committed.added, { targetTotal: updatedPlayers[normalizedSeat].streetCommitted }),
    ],
    updatedAt: new Date().toISOString(),
  };
};

export const applyHoldemAction = (sourceState = {}, { seat = '', action = '', amount = 0 } = {}) => {
  const state = {
    ...sourceState,
    players: clonePlayers(sourceState?.players || {}),
    actionLog: [...(sourceState?.actionLog || [])],
    pendingSeats: [...(sourceState?.pendingSeats || [])],
    raiseDisabledSeats: [...(sourceState?.raiseDisabledSeats || [])],
  };
  const normalizedSeat = normalizeSeat(seat);
  const legal = getLegalHoldemActions(state, normalizedSeat);
  if (!legal.canAct) throw new Error('It is not your turn to act.');
  if (!action) throw new Error('Choose a valid Hold’em action.');
  const player = state.players[normalizedSeat];
  const amountToCall = legal.amountToCall;
  const nextStateBase = () => ({
    ...state,
    players: clonePlayers(state.players),
    actionLog: [...(state.actionLog || [])],
    pendingSeats: [...(state.pendingSeats || [])],
    raiseDisabledSeats: [...(state.raiseDisabledSeats || [])],
  });

  if (action === 'fold') {
    const nextState = nextStateBase();
    nextState.players[normalizedSeat] = {
      ...nextState.players[normalizedSeat],
      folded: true,
      hasActedThisStreet: true,
      lastAction: 'fold',
      lastActionAmount: 0,
    };
    nextState.pendingSeats = nextState.pendingSeats.filter((entrySeat) => entrySeat !== normalizedSeat);
    nextState.raiseDisabledSeats = nextState.raiseDisabledSeats.filter((entrySeat) => entrySeat !== normalizedSeat);
    nextState.actionLog = [...nextState.actionLog, buildActionLogEntry(state, normalizedSeat, 'fold', 0)];
    nextState.updatedAt = new Date().toISOString();
    return settleAutomaticHoldemState(nextState);
  }

  if (action === 'check') {
    if (!legal.actions.check) throw new Error('Check is not legal right now.');
    const nextState = nextStateBase();
    nextState.players[normalizedSeat] = {
      ...nextState.players[normalizedSeat],
      hasActedThisStreet: true,
      lastAction: 'check',
      lastActionAmount: 0,
    };
    nextState.pendingSeats = nextState.pendingSeats.filter((entrySeat) => entrySeat !== normalizedSeat);
    nextState.raiseDisabledSeats = nextState.raiseDisabledSeats.filter((entrySeat) => entrySeat !== normalizedSeat);
    nextState.actionLog = [...nextState.actionLog, buildActionLogEntry(state, normalizedSeat, 'check', 0)];
    nextState.updatedAt = new Date().toISOString();
    return settleAutomaticHoldemState(nextState);
  }

  if (action === 'call') {
    if (!legal.actions.call) throw new Error('Call is not legal right now.');
    const nextState = nextStateBase();
    const committed = commitToTargetTotal(nextState.players[normalizedSeat], toWholePoints(nextState.currentBet || 0));
    nextState.players[normalizedSeat] = {
      ...committed.player,
      hasActedThisStreet: true,
      lastAction: committed.allIn ? 'all-in' : 'call',
    };
    nextState.potTotal = toWholePoints(nextState.potTotal || 0) + committed.added;
    nextState.pendingSeats = nextState.pendingSeats.filter((entrySeat) => entrySeat !== normalizedSeat);
    nextState.raiseDisabledSeats = nextState.raiseDisabledSeats.filter((entrySeat) => entrySeat !== normalizedSeat);
    nextState.actionLog = [
      ...nextState.actionLog,
      buildActionLogEntry(state, normalizedSeat, committed.allIn ? 'all-in' : 'call', committed.added, { targetTotal: nextState.players[normalizedSeat].streetCommitted }),
    ];
    nextState.updatedAt = new Date().toISOString();
    return settleAutomaticHoldemState(nextState);
  }

  if (action === 'bet') return settleAutomaticHoldemState(applyStructuredBet(state, normalizedSeat, 'bet', amount));
  if (action === 'raise') return settleAutomaticHoldemState(applyStructuredBet(state, normalizedSeat, 'raise', amount));

  if (action === 'all-in') {
    if (!legal.actions.allIn) throw new Error('All-in is not legal right now.');
    const allInTotal = toWholePoints(player.streetCommitted || 0) + toWholePoints(player.stack || 0);
    if (amountToCall === 0) return settleAutomaticHoldemState(applyStructuredBet(state, normalizedSeat, 'bet', allInTotal));
    if (allInTotal <= toWholePoints(state.currentBet || 0)) {
      const nextState = nextStateBase();
      const committed = commitToTargetTotal(nextState.players[normalizedSeat], allInTotal);
      nextState.players[normalizedSeat] = {
        ...committed.player,
        hasActedThisStreet: true,
        lastAction: 'all-in',
      };
      nextState.potTotal = toWholePoints(nextState.potTotal || 0) + committed.added;
      nextState.pendingSeats = nextState.pendingSeats.filter((entrySeat) => entrySeat !== normalizedSeat);
      nextState.raiseDisabledSeats = nextState.raiseDisabledSeats.filter((entrySeat) => entrySeat !== normalizedSeat);
      nextState.actionLog = [
        ...nextState.actionLog,
        buildActionLogEntry(state, normalizedSeat, 'all-in', committed.added, { targetTotal: nextState.players[normalizedSeat].streetCommitted }),
      ];
      nextState.updatedAt = new Date().toISOString();
      return settleAutomaticHoldemState(nextState);
    }
    return settleAutomaticHoldemState(applyStructuredBet(state, normalizedSeat, 'raise', allInTotal));
  }

  throw new Error('Unsupported Hold’em action.');
};

export const buildNextHoldemHandState = (state = {}, balances = {}, bothPlayersJoined = false) => {
  const normalizedBalances = defaultBalances(balances);
  if (!bothPlayersJoined || normalizedBalances.jay <= 0 || normalizedBalances.kim <= 0) {
    return updateSessionStatusForBalances(state, normalizedBalances, bothPlayersJoined);
  }
  return createLiveHandState({
    balances: normalizedBalances,
    nextDealerSeat: state?.nextDealerSeat || 'jay',
    previousHandNumber: state?.handNumber || 0,
  });
};

export const getHoldemStatDelta = (state = {}) => {
  const settlement = state?.settlement || null;
  const winningSeats = settlement?.winningSeats || [];
  const pointsWagered = toWholePoints(state?.potTotal || 0);
  const allInOccurred = Boolean((state?.actionLog || []).some((entry) => entry?.action === 'all-in'));
  return {
    handsPlayed: settlement ? 1 : 0,
    handsWonJay: settlement && winningSeats.length === 1 && winningSeats[0] === 'jay' ? 1 : 0,
    handsWonKim: settlement && winningSeats.length === 1 && winningSeats[0] === 'kim' ? 1 : 0,
    handsSplit: settlement && winningSeats.length > 1 ? 1 : 0,
    totalPointsWagered: pointsWagered,
    biggestPot: pointsWagered,
    foldWins: settlement?.reason === 'fold' ? 1 : 0,
    showdownWins: settlement?.reason === 'showdown' && winningSeats.length === 1 ? 1 : 0,
    allIns: allInOccurred ? 1 : 0,
    netMovementJay: Number(settlement?.netChanges?.jay || 0),
    netMovementKim: Number(settlement?.netChanges?.kim || 0),
  };
};

export const mergeHoldemStats = (current = {}, delta = {}) => ({
  handsPlayed: Number(current?.handsPlayed || 0) + Number(delta?.handsPlayed || 0),
  handsWonJay: Number(current?.handsWonJay || 0) + Number(delta?.handsWonJay || 0),
  handsWonKim: Number(current?.handsWonKim || 0) + Number(delta?.handsWonKim || 0),
  handsSplit: Number(current?.handsSplit || 0) + Number(delta?.handsSplit || 0),
  totalPointsWagered: Number(current?.totalPointsWagered || 0) + Number(delta?.totalPointsWagered || 0),
  biggestPot: Math.max(Number(current?.biggestPot || 0), Number(delta?.biggestPot || 0)),
  foldWins: Number(current?.foldWins || 0) + Number(delta?.foldWins || 0),
  showdownWins: Number(current?.showdownWins || 0) + Number(delta?.showdownWins || 0),
  allIns: Number(current?.allIns || 0) + Number(delta?.allIns || 0),
  netMovementJay: Number(current?.netMovementJay || 0) + Number(delta?.netMovementJay || 0),
  netMovementKim: Number(current?.netMovementKim || 0) + Number(delta?.netMovementKim || 0),
});

export const defaultHoldemStats = () => ({
  handsPlayed: 0,
  handsWonJay: 0,
  handsWonKim: 0,
  handsSplit: 0,
  totalPointsWagered: 0,
  biggestPot: 0,
  foldWins: 0,
  showdownWins: 0,
  allIns: 0,
  netMovementJay: 0,
  netMovementKim: 0,
});

export const runHoldemSelfTests = () => {
  const tests = [];
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
    tests.push(message);
  };

  const royalFlush = evaluateBestHoldemHand(['As', 'Ks', 'Qs', 'Js', 'Ts', '2d', '3c']);
  assert(royalFlush?.category === 'royal_flush', 'royal flush ranks highest');

  const quadAces = evaluateBestHoldemHand(['Ah', 'Ad', 'Ac', 'As', 'Kd', '3c', '2h']);
  const quadKings = evaluateBestHoldemHand(['Kh', 'Kd', 'Kc', 'Ks', 'Ad', '3c', '2h']);
  assert(compareEvaluatedHands(quadAces, quadKings) > 0, 'four aces beats four kings');

  const wheelStraight = evaluateBestHoldemHand(['Ah', '2d', '3c', '4s', '5h', 'Kd', 'Qd']);
  assert(wheelStraight?.category === 'straight' && wheelStraight?.tiebreakers?.[0] === 5, 'wheel straight is evaluated correctly');

  const pairWithAceKicker = evaluateBestHoldemHand(['Ah', 'Ad', 'Kc', '7s', '5h', '3d', '2c']);
  const pairWithQueenKicker = evaluateBestHoldemHand(['Ah', 'Ad', 'Qc', '7s', '5h', '3d', '2c']);
  assert(compareEvaluatedHands(pairWithAceKicker, pairWithQueenKicker) > 0, 'pair kicker comparison is correct');

  const splitState = {
    dealerSeat: 'jay',
    players: {
      jay: { ...defaultHoldemPlayerState('jay', 0), totalCommitted: 15, holeCards: ['Ah', 'Kd'] },
      kim: { ...defaultHoldemPlayerState('kim', 0), totalCommitted: 15, holeCards: ['Ac', 'Kh'] },
    },
    startingBankrolls: { jay: 100, kim: 100 },
    communityRunout: ['Qs', 'Js', 'Ts', '2d', '3c'],
    communityCards: ['Qs', 'Js', 'Ts', '2d', '3c'],
    potTotal: 30,
    settlement: null,
    showdown: null,
    actionLog: [],
  };
  const splitResult = resolveHoldemShowdown(splitState);
  assert(splitResult?.settlement?.winningSeats?.length === 2, 'exactly tied best hands split the pot');
  assert(Number(splitResult?.settlement?.payouts?.jay || 0) === 15 && Number(splitResult?.settlement?.payouts?.kim || 0) === 15, 'split pot distributes evenly');

  return tests;
};
