import { v4 as uuidv4 } from 'uuid';
import type { ConversationMessageInput } from '../managers/MxfMemoryManager.js';
import type { MessageActivationTrigger } from './MxfEventHandlerService.js';

/** One admitted turn, including the message that caused its admission. */
export interface MessageActivation extends MessageActivationTrigger {
    activationId: string;
}

interface IncomingMessage {
    trigger: MessageActivationTrigger;
    ready: Promise<{ ok: true } | { ok: false; error: unknown }>;
}

/**
 * Serializes message turns while allowing incoming dialogue to be stored during
 * a running turn. All arrivals during a turn become one subsequent activation.
 */
export class MessageActivationQueue {
    private epoch = 0;
    private stopped = false;
    private current: MessageActivation | undefined;
    private pending: IncomingMessage[] = [];
    private worker: Promise<void> | undefined;

    constructor(
        private readonly store: (message: ConversationMessageInput) => Promise<void>,
        private readonly run: (activation: MessageActivation) => Promise<void>,
        private readonly onError: (error: unknown, activation: MessageActivation) => void
    ) {}

    /** Admission is synchronous; even a reentrant store cannot start a second turn. */
    public accept(
        trigger: MessageActivationTrigger,
        message: ConversationMessageInput | (() => Promise<ConversationMessageInput>)
    ): Promise<void> {
        if (this.stopped) return Promise.resolve();
        const epoch = this.epoch;
        const first = this.current === undefined;
        if (first) this.current = { ...trigger, activationId: uuidv4() };

        // Schedule persistence only after the turn is reserved. A rejected save
        // is observed immediately and is then reported by the owning worker.
        const persisted = Promise.resolve().then(async () => {
            const prepared = typeof message === 'function' ? await message() : message;
            if (epoch !== this.epoch || this.stopped) return;
            await this.store(prepared);
        });
        const entry: IncomingMessage = {
            trigger,
            ready: persisted.then(
                () => ({ ok: true as const }),
                error => ({ ok: false as const, error })
            )
        };

        if (first) {
            const activation = this.current!;
            const worker = this.drain(activation, [entry], epoch);
            this.worker = worker;
            void worker.then(() => { if (this.worker === worker) this.worker = undefined; });
        } else {
            // Store a nonrejecting settled promise until the next turn owns it.
            this.pending.push(entry);
        }
        return persisted;
    }

    public isCurrent(activation: MessageActivation): boolean {
        return !this.stopped && this.current === activation;
    }

    /** Invalidate work before transport cleanup; old responses cannot revive it. */
    public stop(): void {
        this.stopped = true;
        this.epoch++;
        this.current = undefined;
        this.pending = [];
    }

    public resume(): void {
        this.stop();
        this.stopped = false;
    }

    public async waitForIdle(): Promise<void> {
        await this.worker;
    }

    private async drain(
        first: MessageActivation,
        firstMessages: IncomingMessage[],
        epoch: number
    ): Promise<void> {
        let activation = first;
        let messages = firstMessages;
        while (epoch === this.epoch && !this.stopped) {
            try {
                const results = await Promise.all(messages.map(message => message.ready));
                if (!this.isCurrent(activation)) return;
                // A failed save must not consume another successfully stored
                // message's pending turn. Report every failure and run once for
                // the successful members of this coalesced batch.
                for (const result of results) if (!result.ok) this.onError(result.error, activation);
                const firstSaved = results.findIndex(result => result.ok);
                if (firstSaved !== -1) {
                    activation = { ...messages[firstSaved].trigger, activationId: activation.activationId };
                    this.current = activation;
                    await this.run(activation);
                }
            } catch (error) {
                if (this.isCurrent(activation)) this.onError(error, activation);
            }
            if (epoch !== this.epoch || this.stopped) return;
            const pending = this.pending;
            this.pending = [];
            if (pending.length === 0) {
                this.current = undefined;
                return;
            }
            activation = { ...pending[0].trigger, activationId: uuidv4() };
            this.current = activation;
            messages = pending;
        }
    }
}
