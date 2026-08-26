/**
 * Copyright 2024 Brad Anderson
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for details
 * @author Brad Anderson <BradA1878@pm.me>
 */
/**
 * Bounds on how long an SDK memory or search-index request waits for the
 * server's answer.
 *
 * Such a request settles when the server answers it, when the agent's socket
 * drops, or when the SDK cancels it. While the socket stays up and the server
 * stays silent, nothing else settles it — and disconnect() waits for queued
 * saves and index requests before closing the socket, so a server that had
 * stopped answering held disconnect() open for as long as the socket lived.
 * Past its bound a request ends with an error that is reported like any other
 * failed request; it is not retried.
 *
 * A backfill batch has a bound of its own: the server indexes a batch one
 * message at a time, with an embedding call and a Meilisearch task wait for
 * each, so a full batch legitimately takes far longer than one live request.
 */
import { readPositiveIntEnv } from '../utils/env.js';

/** Overrides the bound on a memory operation or a live index request, in milliseconds. */
export const MEMORY_REQUEST_TIMEOUT_ENV = 'MXF_MEMORY_REQUEST_TIMEOUT_MS';

/** Bound on a memory operation or a live index request when the variable is not set. */
export const DEFAULT_MEMORY_REQUEST_TIMEOUT_MS = 60_000;

/** Overrides the bound on one backfill batch, in milliseconds. */
export const MEMORY_BACKFILL_TIMEOUT_ENV = 'MXF_MEMORY_BACKFILL_TIMEOUT_MS';

/** Bound on one backfill batch when the variable is not set. */
export const DEFAULT_MEMORY_BACKFILL_TIMEOUT_MS = 300_000;

/**
 * Reads the per-request bound. Read per request rather than once at load, so
 * a bad value fails the first request loudly instead of being cached as a
 * silent default. Throws when the variable is set to anything but a positive
 * integer.
 */
export const readMemoryRequestTimeoutMs = (): number =>
    readPositiveIntEnv(MEMORY_REQUEST_TIMEOUT_ENV, DEFAULT_MEMORY_REQUEST_TIMEOUT_MS);

/** Reads the per-batch backfill bound; same rules as readMemoryRequestTimeoutMs(). */
export const readMemoryBackfillTimeoutMs = (): number =>
    readPositiveIntEnv(MEMORY_BACKFILL_TIMEOUT_ENV, DEFAULT_MEMORY_BACKFILL_TIMEOUT_MS);
