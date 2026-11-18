'use strict';

/**
 * Council scoring: every round each council member earns 0-100 points.
 *
 *   points = 100 * ( groupWeight * groupFit + (1 - groupWeight) * personalFit )
 *
 * personalFit (0..1): how well the enacted policy's effect vector matches the
 *   character's idea vector (cosine similarity mapped from [-1, 1] to [0, 1]).
 * groupFit (0..1): the council's shared goal, half from the change in
 *   Societal Satisfaction (+10 points or more = 1, -10 or worse = 0) and half
 *   from the share of the 500 citizens who approve of the policy.
 * groupWeight comes from the character: the Pragmatist lives for the group
 *   goal (0.75), the Radical for their own ideals (0.25).
 *
 * A shutdown round (satisfaction reaches 0) is worth 0 for everyone.
 * Five rounds: up to 500 points.
 */

const { cosine, toVector } = require('./citizens');

const MAX_ROUND_POINTS = 100;
const SWING_FOR_FULL_MARKS = 10;

const clamp01 = (x) => Math.max(0, Math.min(1, x));

function personalFit(character, effects) {
  const ideas = toVector(character && character.ideas);
  const e = toVector(effects);
  if (e.every((x) => x === 0)) return 0.5;
  return clamp01((cosine(ideas, e) + 1) / 2);
}

function groupFit(satisfactionDelta, approvalShare) {
  const swing = clamp01(0.5 + (Number(satisfactionDelta) || 0) / (2 * SWING_FOR_FULL_MARKS));
  const share = clamp01(Number(approvalShare) || 0);
  return (swing + share) / 2;
}

/**
 * Score one council member for one round.
 * @returns {{ points, personal, group, groupWeight }} points 0-100; the fits in 0..1
 */
function scoreRound(character, effects, { satisfactionDelta = 0, approvalShare = 0, shutdown = false } = {}) {
  const gw = clamp01(character && Number.isFinite(character.groupWeight) ? character.groupWeight : 0.5);
  const personal = personalFit(character, effects);
  const group = groupFit(satisfactionDelta, approvalShare);
  const points = shutdown ? 0 : Math.round(MAX_ROUND_POINTS * (gw * group + (1 - gw) * personal));
  return {
    points,
    personal: Math.round(personal * 100) / 100,
    group: Math.round(group * 100) / 100,
    groupWeight: gw
  };
}

/**
 * Vote scoring for a binary round (A vs B). Every council member earns up to
 * 100 points:
 *
 *   agenda vote  50  you voted for the option closer to your character's
 *                    ideals (10 for voting the other way, 0 for no vote),
 *                    whether or not it passed
 *   it passed    30  the enacted policy is the one closer to your ideals
 *   the council  20  the shared goal (groupFit: satisfaction swing + approval)
 *
 * "Closer to your ideals" is personalFit (cosine of the option's effects
 * against the character's idea vector). Options within AGENDA_TIE of each
 * other both count as on-agenda. A shutdown round is worth 0 for everyone.
 */
const VOTE_POINTS = 50;
const OFF_AGENDA_VOTE_POINTS = 10;
const PASSED_POINTS = 30;
const COUNCIL_POINTS = 20;
const AGENDA_TIE = 0.02;

/** 'A' | 'B' | 'either': the option that best fits a character's ideals. */
function agendaOption(character, effectsA, effectsB) {
  const a = personalFit(character, effectsA);
  const b = personalFit(character, effectsB);
  if (Math.abs(a - b) <= AGENDA_TIE) return 'either';
  return a > b ? 'A' : 'B';
}

/**
 * @param character  role with `ideas`
 * @param options    { A: effects, B: effects }
 * @param context    { vote: 'A'|'B'|null, winner: 'A'|'B', satisfactionDelta, approvalShare, shutdown }
 * @returns {{ points, vote, passed, council, agenda, votedWithAgenda, personal, group }}
 */
function scoreVote(character, options, { vote = null, winner = 'A', satisfactionDelta = 0, approvalShare = 0, shutdown = false } = {}) {
  const agenda = agendaOption(character, options && options.A, options && options.B);
  const onAgenda = (key) => key === 'A' || key === 'B' ? (agenda === 'either' || agenda === key) : false;
  const votedWithAgenda = onAgenda(vote);
  const group = groupFit(satisfactionDelta, approvalShare);
  const parts = {
    vote: !vote ? 0 : votedWithAgenda ? VOTE_POINTS : OFF_AGENDA_VOTE_POINTS,
    passed: onAgenda(winner) ? PASSED_POINTS : 0,
    council: Math.round(COUNCIL_POINTS * group)
  };
  const points = shutdown ? 0 : Math.min(MAX_ROUND_POINTS, parts.vote + parts.passed + parts.council);
  return {
    points,
    ...(shutdown ? { vote: 0, passed: 0, council: 0 } : parts),
    agenda,
    votedWithAgenda,
    personal: Math.round(personalFit(character, options && options[winner]) * 100) / 100,
    group: Math.round(group * 100) / 100
  };
}

module.exports = {
  MAX_ROUND_POINTS, VOTE_POINTS, OFF_AGENDA_VOTE_POINTS, PASSED_POINTS, COUNCIL_POINTS,
  scoreRound, scoreVote, agendaOption, personalFit, groupFit
};
