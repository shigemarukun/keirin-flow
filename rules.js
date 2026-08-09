// KEIRIN FLOW race-interaction thresholds.
// These are simulation tuning values, not official penalty distances.
// Official rules are represented as constraints (no inside overtake / no
// unlimited cross-cutting / no unlimited outward forcing); exact adjudication
// thresholds will be venue/rulebook-calibrated later.
export const INTERACTION_RULES = Object.freeze({
    follow: {
        secondGap: 8.8,
        thirdGap: 10.4,
        toleranceBehind: 2.0,
        toleranceAhead: 3.6,
        stretchedGap: 17,
        detachedGap: 27,
        switchAfterSeconds: 0.65,
        safetyGap: 5.8
    },
    threat: {
        detectBehind: 40,
        detectAhead: 4,
        maxLaneGap: 58,
        blockStartGap: 28,
        blockEndAhead: 6
    },
    block: {
        maxSeconds: 1.05,
        cooldownSeconds: 1.1,
        lateralTargetMargin: 7,
        maxOuterOffset: 42,
        speedCheck: 0.96,
        attackerSpeedLoss: 2.2,
        attackerExtraLoad: 0.42
    },
    switch: {
        leaderLostMargin: 8,
        candidateMinAhead: 4.5,
        candidateMaxAhead: 22,
        candidateMaxLaneGap: 34
    },
    banteMakuri: {
        remainingMax: 175,
        leaderEnergyMax: 0.48,
        riderEnergyMin: 0.46,
        maxGapToLeader: 13
    },
    finalSprint: {
        remainingMax: 72,
        energyMin: 0.18
    }
});
