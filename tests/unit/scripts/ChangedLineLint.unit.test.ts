import {
    lintMessageTouchesRanges,
    mergeLineRanges,
    parseAddedLineRanges
} from '../../../scripts/lib/ChangedLineLint';

describe('changed-line lint range selection', () => {
    it('extracts only non-empty ranges from zero-context unified diffs', () => {
        const ranges = parseAddedLineRanges([
            '@@ -4,0 +5,2 @@',
            '+first',
            '+second',
            '@@ -10 +12 @@',
            '+replacement',
            '@@ -20,2 +21,0 @@',
            '-deleted'
        ].join('\n'));

        expect(ranges).toEqual([[5, 6], [12, 12]]);
    });

    it('merges adjacent and overlapping ranges from committed and working diffs', () => {
        expect(mergeLineRanges([
            [8, 10],
            [2, 3],
            [4, 7],
            [20, 21],
            [20, 24]
        ])).toEqual([[2, 10], [20, 24]]);
    });

    it('selects diagnostics whose full span overlaps an added range', () => {
        const ranges = [[10, 12], [20, 20]] as const;

        expect(lintMessageTouchesRanges({ line: 9, endLine: 10 }, [...ranges])).toBe(true);
        expect(lintMessageTouchesRanges({ line: 12 }, [...ranges])).toBe(true);
        expect(lintMessageTouchesRanges({ line: 13, endLine: 19 }, [...ranges])).toBe(false);
        expect(lintMessageTouchesRanges({}, [...ranges])).toBe(false);
    });
});
