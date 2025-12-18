"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SummaryAggregator = void 0;
class SummaryAggregator {
    groups = new Map();
    add(record) {
        const key = `${record.pairingId}::${record.condition}::${record.question.difficulty}`;
        const agg = this.groups.get(key) ?? this.initAgg(record.condition);
        agg.nRuns += 1;
        agg.totalLatencyMs += record.totalLatencyMs;
        if (record.judge) {
            agg.nJudged += 1;
            if (record.judge.leakage)
                agg.leakageCount += 1;
            if (record.judge.compliance)
                agg.complianceCount += 1;
            agg.pedagogySum += record.judge.pedagogyHelpfulness;
            if (record.judge.studentGotWhatTheyWanted)
                agg.studentGoalSuccessCount += 1;
        }
        if (record.condition === 'dual-loop' && record.loopTurnIterations && agg.loop) {
            for (const t of record.loopTurnIterations) {
                agg.loop.totalTurns += 1;
                agg.loop.totalIterations += t.iterationsUsed;
                agg.loop.iterationCounts[String(t.iterationsUsed)] =
                    (agg.loop.iterationCounts[String(t.iterationsUsed)] ?? 0) + 1;
                if (t.initiallyRejected) {
                    agg.loop.initiallyRejectedTurns += 1;
                    if (t.endedApproved)
                        agg.loop.fixedTurns += 1;
                }
            }
        }
        this.groups.set(key, agg);
    }
    toSummaryObject() {
        const breakdown = {};
        for (const [key, agg] of this.groups.entries()) {
            const [pairingId, condition, difficultyStr] = key.split('::');
            breakdown[pairingId] ??= {};
            breakdown[pairingId][condition] ??= {};
            const difficulty = Number(difficultyStr);
            breakdown[pairingId][condition][difficulty] = finalizeAgg(agg);
        }
        return { breakdown };
    }
    initAgg(condition) {
        return {
            nRuns: 0,
            nJudged: 0,
            leakageCount: 0,
            complianceCount: 0,
            pedagogySum: 0,
            studentGoalSuccessCount: 0,
            totalLatencyMs: 0,
            loop: condition === 'dual-loop'
                ? {
                    initiallyRejectedTurns: 0,
                    fixedTurns: 0,
                    iterationCounts: {},
                    totalIterations: 0,
                    totalTurns: 0,
                }
                : undefined,
        };
    }
}
exports.SummaryAggregator = SummaryAggregator;
function finalizeAgg(agg) {
    const avgLatencyMs = agg.nRuns ? agg.totalLatencyMs / agg.nRuns : null;
    const leakRate = agg.nJudged ? agg.leakageCount / agg.nJudged : null;
    const complianceRate = agg.nJudged ? agg.complianceCount / agg.nJudged : null;
    const avgPedagogy = agg.nJudged ? agg.pedagogySum / agg.nJudged : null;
    const studentGoalSuccessRate = agg.nJudged
        ? agg.studentGoalSuccessCount / agg.nJudged
        : null;
    const loop = agg.loop
        ? {
            loopFixRate: agg.loop.initiallyRejectedTurns
                ? agg.loop.fixedTurns / agg.loop.initiallyRejectedTurns
                : null,
            avgIterationsPerTurn: agg.loop.totalTurns ? agg.loop.totalIterations / agg.loop.totalTurns : null,
            iterationDistribution: agg.loop.iterationCounts,
            initiallyRejectedTurns: agg.loop.initiallyRejectedTurns,
            fixedTurns: agg.loop.fixedTurns,
            totalTurns: agg.loop.totalTurns,
        }
        : null;
    return {
        nRuns: agg.nRuns,
        nJudged: agg.nJudged,
        leakRate,
        complianceRate,
        avgPedagogyHelpfulness: avgPedagogy,
        studentGoalSuccessRate,
        avgLatencyMs,
        loop,
    };
}
