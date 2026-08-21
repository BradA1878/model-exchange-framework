/**
 * Glob matching for relative file paths without regular expressions.
 *
 * Supported syntax:
 * - `*`  any run of characters inside one path segment (never crosses `/`)
 * - `?`  exactly one character inside a path segment
 * - `**` as a whole segment: zero or more whole directories. A `**` that
 *        is part of a larger segment behaves like `*`.
 * Every other character is literal, including regex metacharacters.
 *
 * The matcher walks the pattern and the candidate with a single backtrack
 * point per wildcard, so cost is bounded by pattern length × candidate
 * length. A compiled regular expression is not used because patterns such
 * as `*a*a*a*b` made the engine backtrack for seconds per file name, and
 * the filesystem walk runs the matcher once per directory entry on the
 * server's event loop.
 */

/** Upper bound on `*` runs plus `?` characters in one pattern. */
export const MAX_GLOB_WILDCARDS = 32;

export interface GlobMatcher {
    /**
     * True when the pattern contains a path separator. Such a pattern must
     * be tested against a relative path; a pattern without one addresses a
     * bare file name.
     */
    readonly matchesPath: boolean;
    /** Return true when `candidate` (segments separated by `/`) matches the whole pattern. */
    test(candidate: string): boolean;
}

type PatternSegment =
    | { readonly kind: 'globstar' }
    | { readonly kind: 'segment'; readonly text: string };

const countWildcards = (pattern: string): number => {
    let wildcards = 0;
    for (let index = 0; index < pattern.length; index += 1) {
        const character = pattern[index];
        if (character === '?') {
            wildcards += 1;
        } else if (character === '*' && pattern[index - 1] !== '*') {
            wildcards += 1;
        }
    }
    return wildcards;
};

/**
 * Match one path segment against a segment pattern containing `*` and `?`.
 * Classic greedy wildcard matching with one backtrack point: O(p × t).
 */
const matchSegment = (pattern: string, text: string): boolean => {
    let patternIndex = 0;
    let textIndex = 0;
    let starIndex = -1;
    let starTextIndex = -1;

    while (textIndex < text.length) {
        const patternCharacter = pattern[patternIndex];
        if (patternIndex < pattern.length &&
            (patternCharacter === '?' || patternCharacter === text[textIndex])) {
            patternIndex += 1;
            textIndex += 1;
        } else if (patternIndex < pattern.length && patternCharacter === '*') {
            starIndex = patternIndex;
            starTextIndex = textIndex;
            patternIndex += 1;
        } else if (starIndex !== -1) {
            patternIndex = starIndex + 1;
            starTextIndex += 1;
            textIndex = starTextIndex;
        } else {
            return false;
        }
    }

    while (patternIndex < pattern.length && pattern[patternIndex] === '*') {
        patternIndex += 1;
    }
    return patternIndex === pattern.length;
};

/**
 * Match path segments against pattern segments. A `globstar` pattern
 * segment plays the role `*` plays inside a segment: it absorbs zero or
 * more whole path segments, with one backtrack point.
 */
const matchSegments = (
    patternSegments: readonly PatternSegment[],
    pathSegments: readonly string[]
): boolean => {
    let patternIndex = 0;
    let pathIndex = 0;
    let globstarIndex = -1;
    let globstarPathIndex = -1;

    while (pathIndex < pathSegments.length) {
        const patternSegment = patternSegments[patternIndex];
        if (patternIndex < patternSegments.length && patternSegment.kind === 'globstar') {
            globstarIndex = patternIndex;
            globstarPathIndex = pathIndex;
            patternIndex += 1;
        } else if (patternIndex < patternSegments.length &&
            patternSegment.kind === 'segment' &&
            matchSegment(patternSegment.text, pathSegments[pathIndex])) {
            patternIndex += 1;
            pathIndex += 1;
        } else if (globstarIndex !== -1) {
            patternIndex = globstarIndex + 1;
            globstarPathIndex += 1;
            pathIndex = globstarPathIndex;
        } else {
            return false;
        }
    }

    while (patternIndex < patternSegments.length &&
        patternSegments[patternIndex].kind === 'globstar') {
        patternIndex += 1;
    }
    return patternIndex === patternSegments.length;
};

/**
 * Compile a glob pattern into a matcher.
 *
 * @throws Error when the pattern is empty or uses more than
 *         {@link MAX_GLOB_WILDCARDS} wildcards.
 */
export function createGlobMatcher(pattern: string, caseSensitive: boolean): GlobMatcher {
    if (typeof pattern !== 'string' || pattern.length === 0) {
        throw new Error('Glob pattern must be a non-empty string');
    }

    const wildcards = countWildcards(pattern);
    if (wildcards > MAX_GLOB_WILDCARDS) {
        throw new Error(
            `Glob pattern uses ${wildcards} wildcards; at most ${MAX_GLOB_WILDCARDS} are supported`
        );
    }

    const normalizedPattern = caseSensitive ? pattern : pattern.toLowerCase();
    const patternSegments: PatternSegment[] = normalizedPattern.split('/').map(segment => (
        segment === '**' ? { kind: 'globstar' } : { kind: 'segment', text: segment }
    ));
    const matchesPath = pattern.includes('/');

    return {
        matchesPath,
        test(candidate: string): boolean {
            const normalizedCandidate = caseSensitive ? candidate : candidate.toLowerCase();
            return matchSegments(patternSegments, normalizedCandidate.split('/'));
        }
    };
}
