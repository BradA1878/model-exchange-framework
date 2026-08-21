export type LineRange = readonly [start: number, end: number];

export interface ChangedLineLintMessage {
    line?: number;
    endLine?: number;
}

/**
 * Extract the added-side line ranges from a zero-context unified diff.
 */
export const parseAddedLineRanges = (diff: string): LineRange[] => {
    const ranges: LineRange[] = [];

    for (const line of diff.split('\n')) {
        const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (!match) {
            continue;
        }

        const start = Number(match[1]);
        const count = match[2] === undefined ? 1 : Number(match[2]);
        if (count > 0) {
            ranges.push([start, start + count - 1]);
        }
    }

    return ranges;
};

/**
 * Coalesce overlapping or adjacent ranges produced by multiple diffs.
 */
export const mergeLineRanges = (ranges: LineRange[]): LineRange[] => {
    const sorted = [...ranges].sort((left, right) =>
        left[0] === right[0] ? left[1] - right[1] : left[0] - right[0]
    );
    const merged: Array<[number, number]> = [];

    for (const [start, end] of sorted) {
        const previous = merged[merged.length - 1];
        if (!previous || start > previous[1] + 1) {
            merged.push([start, end]);
            continue;
        }

        previous[1] = Math.max(previous[1], end);
    }

    return merged;
};

/**
 * Return whether an ESLint diagnostic overlaps code added by the change.
 */
export const lintMessageTouchesRanges = (
    message: ChangedLineLintMessage,
    ranges: LineRange[]
): boolean => {
    if (message.line === undefined) {
        return false;
    }

    const messageEnd = message.endLine ?? message.line;
    return ranges.some(([start, end]) => message.line! <= end && messageEnd >= start);
};
