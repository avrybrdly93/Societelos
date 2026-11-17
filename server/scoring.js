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

module.exports = { MAX_ROUND_POINTS, scoreRound, personalFit, groupFit };
