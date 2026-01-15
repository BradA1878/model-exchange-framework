/**
 * Property-based tests for MessageSchemas
 * Uses fast-check to generate random inputs and verify invariants
 */

import fc from 'fast-check';
import {
    createMessageMetadata,
    createChannelMessage,
    createAgentMessage,
    standardizeMessage,
    determineContentFormat,
    createContentWrapper,
    wrapBinaryContent,
    ContentFormat
} from '@mxf/shared/schemas/MessageSchemas';

describe('MessageSchemas Property Tests', () => {
    describe('createMessageMetadata', () => {
        it('always generates unique message IDs', () => {
            fc.assert(
                fc.property(fc.integer({ min: 10, max: 100 }), (count) => {
                    const ids = new Set<string>();
                    for (let i = 0; i < count; i++) {
                        const meta = createMessageMetadata();
                        ids.add(meta.messageId);
                    }
                    return ids.size === count;
                }),
                { numRuns: 50 }
            );
        });

        it('timestamp is always a positive number', () => {
            fc.assert(
                fc.property(fc.constant(null), () => {
                    const meta = createMessageMetadata();
                    return typeof meta.timestamp === 'number' &&
                           meta.timestamp > 0 &&
                           !Number.isNaN(meta.timestamp);
                }),
                { numRuns: 100 }
            );
        });

        it('preserves messageId and timestamp overrides', () => {
            fc.assert(
                fc.property(
                    fc.record({
                        // Use truthy strings only (createMessageMetadata uses || which treats falsy as default)
                        messageId: fc.string({ minLength: 1 }).filter(s => !!s),
                        timestamp: fc.integer({ min: 1 }) // Positive timestamps only
                    }),
                    (overrides) => {
                        const meta = createMessageMetadata(overrides);

                        return meta.messageId === overrides.messageId &&
                               meta.timestamp === overrides.timestamp;
                    }
                )
            );
        });

        it('preserves optional field overrides when provided', () => {
            fc.assert(
                fc.property(
                    fc.integer({ min: 1, max: 100 }),
                    fc.nat({ max: 100000 }),
                    fc.string({ minLength: 1 }),
                    (priority, ttl, correlationId) => {
                        const meta = createMessageMetadata({ priority, ttl, correlationId });

                        return meta.priority === priority &&
                               meta.ttl === ttl &&
                               meta.correlationId === correlationId;
                    }
                )
            );
        });
    });

    describe('determineContentFormat', () => {
        it('is idempotent - same input always gives same output', () => {
            fc.assert(
                fc.property(
                    fc.oneof(
                        fc.string(),
                        fc.object(),
                        fc.array(fc.anything())
                    ),
                    (content) => {
                        const format1 = determineContentFormat(content);
                        const format2 = determineContentFormat(content);
                        return format1 === format2;
                    }
                )
            );
        });

        it('strings always return TEXT or JSON', () => {
            fc.assert(
                fc.property(fc.string(), (content) => {
                    const format = determineContentFormat(content);
                    return format === ContentFormat.TEXT || format === ContentFormat.JSON;
                })
            );
        });

        it('objects always return JSON', () => {
            fc.assert(
                fc.property(
                    fc.object({ maxDepth: 3 }),
                    (content) => {
                        const format = determineContentFormat(content);
                        return format === ContentFormat.JSON;
                    }
                )
            );
        });

        it('arrays always return JSON', () => {
            fc.assert(
                fc.property(
                    fc.array(fc.anything(), { maxLength: 10 }),
                    (content) => {
                        const format = determineContentFormat(content);
                        return format === ContentFormat.JSON;
                    }
                )
            );
        });

        it('valid JSON strings return JSON format', () => {
            fc.assert(
                fc.property(
                    fc.jsonValue(),
                    (value) => {
                        const jsonString = JSON.stringify(value);
                        const format = determineContentFormat(jsonString);
                        return format === ContentFormat.JSON;
                    }
                )
            );
        });
    });

    describe('createChannelMessage', () => {
        // Arbitrary for valid IDs (non-empty strings)
        const validIdArb = fc.string({ minLength: 1 }).filter(s => s.trim().length > 0);

        it('always creates messages with required fields', () => {
            fc.assert(
                fc.property(
                    validIdArb,
                    validIdArb,
                    fc.oneof(fc.string(), fc.object()),
                    (channelId, senderId, content) => {
                        const msg = createChannelMessage(channelId, senderId, content);

                        return msg.toolType === 'channelMessage' &&
                               msg.senderId === senderId &&
                               msg.context.channelId === channelId &&
                               msg.content.data === content &&
                               msg.metadata.messageId !== undefined &&
                               msg.metadata.timestamp !== undefined;
                    }
                )
            );
        });

        it('content format matches content type', () => {
            fc.assert(
                fc.property(
                    validIdArb,
                    validIdArb,
                    fc.oneof(
                        fc.string().map(s => ({ content: s, expectedFormat: ContentFormat.TEXT })),
                        fc.object().map(o => ({ content: o, expectedFormat: ContentFormat.JSON }))
                    ),
                    (channelId, senderId, { content, expectedFormat }) => {
                        const msg = createChannelMessage(channelId, senderId, content);
                        return msg.content.format === expectedFormat;
                    }
                )
            );
        });

        it('explicit format override is respected', () => {
            fc.assert(
                fc.property(
                    validIdArb,
                    validIdArb,
                    fc.string(),
                    fc.constantFrom(ContentFormat.TEXT, ContentFormat.JSON),
                    (channelId, senderId, content, format) => {
                        const msg = createChannelMessage(channelId, senderId, content, { format });
                        return msg.content.format === format;
                    }
                )
            );
        });

        it('metadata overrides are preserved', () => {
            fc.assert(
                fc.property(
                    validIdArb,
                    validIdArb,
                    fc.string(),
                    fc.record({
                        priority: fc.integer({ min: 1, max: 100 }),
                        ttl: fc.nat({ max: 1000000 })
                    }),
                    (channelId, senderId, content, metaOverrides) => {
                        const msg = createChannelMessage(channelId, senderId, content, {
                            metadata: metaOverrides
                        });
                        return msg.metadata.priority === metaOverrides.priority &&
                               msg.metadata.ttl === metaOverrides.ttl;
                    }
                )
            );
        });
    });

    describe('createAgentMessage', () => {
        const validIdArb = fc.string({ minLength: 1 }).filter(s => s.trim().length > 0);

        it('always includes required fields', () => {
            fc.assert(
                fc.property(
                    validIdArb,
                    validIdArb,
                    fc.oneof(fc.string(), fc.object()),
                    (senderId, receiverId, content) => {
                        const msg = createAgentMessage(senderId, receiverId, content);

                        return msg.toolType === 'agentMessage' &&
                               msg.senderId === senderId &&
                               msg.receiverId === receiverId &&
                               msg.content.data === content &&
                               msg.metadata.messageId !== undefined;
                    }
                )
            );
        });
    });

    describe('standardizeMessage', () => {
        const validIdArb = fc.string({ minLength: 1 }).filter(s => s.trim().length > 0);

        it('always preserves content', () => {
            fc.assert(
                fc.property(
                    fc.oneof(fc.string(), fc.object()),
                    validIdArb,
                    (content, senderId) => {
                        const msg = standardizeMessage(content, senderId);
                        return JSON.stringify(msg.content.data) === JSON.stringify(content);
                    }
                )
            );
        });

        it('auto-detects format correctly', () => {
            fc.assert(
                fc.property(
                    fc.oneof(
                        fc.string().filter(s => {
                            try { JSON.parse(s); return false; } catch { return true; }
                        }).map(s => ({ content: s, format: ContentFormat.TEXT })),
                        fc.object().map(o => ({ content: o, format: ContentFormat.JSON }))
                    ),
                    validIdArb,
                    ({ content, format }, senderId) => {
                        const msg = standardizeMessage(content, senderId);
                        return msg.content.format === format;
                    }
                )
            );
        });
    });

    describe('createContentWrapper', () => {
        it('wraps any content without throwing', () => {
            fc.assert(
                fc.property(
                    fc.oneof(
                        fc.string(),
                        fc.object(),
                        fc.array(fc.anything())
                    ),
                    (content) => {
                        const wrapper = createContentWrapper(content);
                        return wrapper.data === content &&
                               typeof wrapper.format === 'string';
                    }
                )
            );
        });
    });

    describe('wrapBinaryContent', () => {
        it('base64 encoding preserves data integrity', () => {
            fc.assert(
                fc.property(
                    fc.uint8Array({ minLength: 0, maxLength: 1000 }),
                    (data) => {
                        const buffer = Buffer.from(data);
                        const wrapper = wrapBinaryContent(buffer, ContentFormat.BASE64);
                        const restored = Buffer.from(wrapper.data as string, 'base64');

                        return buffer.equals(restored);
                    }
                )
            );
        });

        it('always sets compression to false', () => {
            fc.assert(
                fc.property(
                    fc.uint8Array({ minLength: 0, maxLength: 100 }),
                    (data) => {
                        const buffer = Buffer.from(data);
                        const wrapper = wrapBinaryContent(buffer);
                        return wrapper.compression === false;
                    }
                )
            );
        });

        it('format matches requested format', () => {
            fc.assert(
                fc.property(
                    fc.uint8Array({ minLength: 1, maxLength: 100 }),
                    fc.constantFrom(ContentFormat.BINARY, ContentFormat.BASE64),
                    (data, format) => {
                        const buffer = Buffer.from(data);
                        const wrapper = wrapBinaryContent(buffer, format);
                        return wrapper.format === format;
                    }
                )
            );
        });
    });
});
