/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * Cutting embedding input to a token limit.
 *
 * Counts with the tokenizer the OpenAI embedding models use (cl100k_base)
 * rather than estimating from characters: dense JSON, URLs, and code run
 * well under four characters per token, so a character budget either wastes
 * the model's window on prose or still overruns it on tool output — the case
 * that failed in production. For a provider with its own tokenizer, cl100k
 * is an approximation; set MEILISEARCH_EMBEDDING_MAX_INPUT_TOKENS below that
 * provider's limit if it tokenizes more densely.
 *
 * The work is bounded by the budget, not by the message. Text is tokenized
 * in slices, and tokenizing stops once the budget is spent, so the tail of a
 * long message is never encoded. A BPE tokenizer's cost grows with the length
 * of a single pre-tokenizer piece — a run with no whitespace, letters, or
 * digits, such as a page of emoji — and a slice caps that length; encoding
 * 64 KiB of one such run took seconds with the first implementation tried.
 */

import { decode, encode as encodeWithOptions } from 'gpt-tokenizer/encoding/cl100k_base';

/** Special-token strings such as `<|endoftext|>` are encoded as ordinary text: tool output can contain anything. */
const ENCODE_OPTIONS = { disallowedSpecial: new Set<string>() };

const encode = (text: string): number[] => encodeWithOptions(text, ENCODE_OPTIONS);

/**
 * Longest slice tokenized at once, in UTF-16 code units. A slice is cut just
 * before a whitespace character when the window holds one: BPE merges never
 * cross whitespace, so such a slice counts exactly what the whole text would.
 * A window with no whitespace is cut at its end instead; the split can only
 * lose merges, so the count is at or above the whole text's and the cut
 * lands at or before the limit.
 */
const SLICE_CHARS = 2048;
const WHITESPACE = /\s/u;
/** A cut can leave a replacement character (a split multi-byte character) or a dangling joiner. */
const TRAILING_FRAGMENTS = /[�‍]+$/u;

const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff;

/** Where the slice starting at `start` ends, never inside a surrogate pair. */
const sliceEnd = (text: string, start: number): number => {
    const windowEnd = Math.min(text.length, start + SLICE_CHARS);
    if (windowEnd === text.length) {
        return windowEnd;
    }
    for (let index = windowEnd - 1; index > start; index -= 1) {
        if (WHITESPACE.test(text[index])) {
            return index;
        }
    }
    return isHighSurrogate(text.charCodeAt(windowEnd - 1)) ? windowEnd - 1 : windowEnd;
};

/** `text` without its last code point and any fragment that leaves behind. */
const dropLastCodePoint = (text: string): string => {
    const units = isLowSurrogate(text.charCodeAt(text.length - 1)) ? 2 : 1;
    return text.slice(0, text.length - units).replace(TRAILING_FRAGMENTS, '');
};

export interface TruncatedEmbeddingInput {
    /** The text to embed: the original, or its longest prefix within the limit. */
    text: string;
    /** Tokens in `text`. */
    tokens: number;
    truncated: boolean;
}

/**
 * The longest prefix of `text` that fits in `maxTokens` tokens.
 *
 * Whole slices are kept while they fit. The slice that would overrun is cut
 * by decoding the tokens that still fit; a cut can land inside a multi-byte
 * character, which decodes to U+FFFD, or after a zero-width joiner, and those
 * are dropped so the result is a clean prefix. Re-encoding a prefix can
 * tokenize differently by a token, so it is shortened until its own count
 * fits.
 */
export function truncateToTokenLimit(text: string, maxTokens: number): TruncatedEmbeddingInput {
    if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
        throw new Error(`Embedding input token limit must be a positive integer, got ${maxTokens}`);
    }

    let kept = '';
    let tokens = 0;
    let position = 0;
    while (position < text.length) {
        const end = sliceEnd(text, position);
        const slice = text.slice(position, end);
        const sliceTokens = encode(slice);
        if (tokens + sliceTokens.length <= maxTokens) {
            kept += slice;
            tokens += sliceTokens.length;
            position = end;
            continue;
        }

        const room = maxTokens - tokens;
        let prefix = decode(sliceTokens.slice(0, room)).replace(TRAILING_FRAGMENTS, '');
        let count = encode(prefix).length;
        while (count > room && prefix.length > 0) {
            prefix = dropLastCodePoint(prefix);
            count = encode(prefix).length;
        }
        return { text: kept + prefix, tokens: tokens + count, truncated: true };
    }

    return { text: kept, tokens, truncated: false };
}
