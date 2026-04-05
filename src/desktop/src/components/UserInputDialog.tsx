/**
 * MXF Desktop — User Input Dialog Component
 *
 * Modal overlay for agent input requests. Supports all user_input types:
 * - confirm: Approve/Deny buttons
 * - text: Single-line or multi-line text input
 * - select: Radio button list (pick one)
 * - multi_select: Checkbox list (pick multiple)
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useAppState } from '../state/appState';

type UserInputResponseValue = string | string[] | boolean;

interface UserInputDialogProps {
    /** Callback to send the response back to the sidecar */
    onRespond: (requestId: string, value: UserInputResponseValue) => Promise<void>;
}

export const UserInputDialog: React.FC<UserInputDialogProps> = ({ onRespond }) => {
    const userInputQueue = useAppState((s) => s.userInputQueue);
    const resolveUserInput = useAppState((s) => s.resolveUserInput);

    const current = userInputQueue[0];
    if (!current) return null;

    return (
        <div style={styles.overlay}>
            <div style={styles.dialog}>
                {/* Header */}
                <div style={styles.header}>
                    <span style={{
                        ...styles.headerIcon,
                        backgroundColor: current.theme === 'warning' ? 'var(--warning)'
                            : current.theme === 'error' ? 'var(--error)'
                            : current.theme === 'success' ? 'var(--success)'
                            : 'var(--accent)',
                    }}>?</span>
                    <span style={styles.headerTitle}>{current.title}</span>
                </div>

                {/* Agent name */}
                <div style={styles.agentName}>
                    Agent: {current.agentName}
                </div>

                {/* Description */}
                {current.description && (
                    <div style={styles.description}>{current.description}</div>
                )}

                {/* Input body — render based on type */}
                {current.inputType === 'confirm' && (
                    <ConfirmInput
                        config={current.inputConfig}
                        onRespond={async (value) => {
                            await onRespond(current.id, value);
                            resolveUserInput(current.id);
                        }}
                    />
                )}
                {current.inputType === 'text' && (
                    <TextInput
                        config={current.inputConfig}
                        onRespond={async (value) => {
                            await onRespond(current.id, value);
                            resolveUserInput(current.id);
                        }}
                    />
                )}
                {current.inputType === 'select' && (
                    <SelectInput
                        config={current.inputConfig}
                        onRespond={async (value) => {
                            await onRespond(current.id, value);
                            resolveUserInput(current.id);
                        }}
                    />
                )}
                {current.inputType === 'multi_select' && (
                    <MultiSelectInput
                        config={current.inputConfig}
                        onRespond={async (value) => {
                            await onRespond(current.id, value);
                            resolveUserInput(current.id);
                        }}
                    />
                )}

                {/* Queue indicator */}
                {userInputQueue.length > 1 && (
                    <div style={styles.queueBadge}>
                        +{userInputQueue.length - 1} more pending
                    </div>
                )}
            </div>
        </div>
    );
};

// ── Confirm Input ────────────────────────────────────────────────

interface ConfirmInputProps {
    config: { confirmLabel?: string; denyLabel?: string };
    onRespond: (value: boolean) => Promise<void>;
}

const ConfirmInput: React.FC<ConfirmInputProps> = ({ config, onRespond }) => {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onRespond(true); }
            else if (e.key === 'Escape') { e.preventDefault(); onRespond(false); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onRespond]);

    return (
        <div style={styles.actions}>
            <button onClick={() => onRespond(false)} style={styles.denyButton}>
                {config.denyLabel || 'Deny'} (Esc)
            </button>
            <button onClick={() => onRespond(true)} style={styles.approveButton}>
                {config.confirmLabel || 'Approve'} (Enter)
            </button>
        </div>
    );
};

// ── Text Input ───────────────────────────────────────────────────

interface TextInputProps {
    config: { placeholder?: string; multiline?: boolean; minLength?: number; maxLength?: number };
    onRespond: (value: string) => Promise<void>;
}

const TextInput: React.FC<TextInputProps> = ({ config, onRespond }) => {
    const [text, setText] = useState('');
    const isValid = (!config.minLength || text.length >= config.minLength) &&
                    (!config.maxLength || text.length <= config.maxLength);

    const submit = useCallback(() => {
        if (isValid && text.length > 0) onRespond(text);
    }, [text, isValid, onRespond]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey && !config.multiline) {
                e.preventDefault();
                submit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                onRespond('');
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [submit, onRespond, config.multiline]);

    const InputTag = config.multiline ? 'textarea' : 'input';

    return (
        <div>
            <InputTag
                autoFocus
                value={text}
                onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value)}
                placeholder={config.placeholder || 'Type your response...'}
                style={{
                    ...styles.textInput,
                    ...(config.multiline ? { minHeight: '80px', resize: 'vertical' as const } : {}),
                }}
                maxLength={config.maxLength}
            />
            {config.maxLength && (
                <div style={styles.charCount}>{text.length}/{config.maxLength}</div>
            )}
            <div style={styles.actions}>
                <button onClick={() => onRespond('')} style={styles.denyButton}>
                    Cancel (Esc)
                </button>
                <button
                    onClick={submit}
                    disabled={!isValid || text.length === 0}
                    style={{
                        ...styles.approveButton,
                        opacity: isValid && text.length > 0 ? 1 : 0.5,
                    }}
                >
                    Submit (Enter)
                </button>
            </div>
        </div>
    );
};

// ── Select Input ─────────────────────────────────────────────────

interface SelectInputProps {
    config: { options?: Array<{ value: string; label: string; description?: string }> };
    onRespond: (value: string) => Promise<void>;
}

const SelectInput: React.FC<SelectInputProps> = ({ config, onRespond }) => {
    const [selected, setSelected] = useState<string | null>(null);
    const options = config.options || [];

    const submit = useCallback(() => {
        if (selected) onRespond(selected);
    }, [selected, onRespond]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Enter' && selected) { e.preventDefault(); submit(); }
            else if (e.key === 'Escape') { e.preventDefault(); onRespond(''); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [submit, selected, onRespond]);

    return (
        <div>
            <div style={styles.optionList}>
                {options.map((opt) => (
                    <label
                        key={opt.value}
                        style={{
                            ...styles.optionItem,
                            ...(selected === opt.value ? styles.optionSelected : {}),
                        }}
                        onClick={() => setSelected(opt.value)}
                    >
                        <input
                            type="radio"
                            name="select-input"
                            value={opt.value}
                            checked={selected === opt.value}
                            onChange={() => setSelected(opt.value)}
                            style={styles.radio}
                        />
                        <div>
                            <div style={styles.optionLabel}>{opt.label}</div>
                            {opt.description && (
                                <div style={styles.optionDesc}>{opt.description}</div>
                            )}
                        </div>
                    </label>
                ))}
            </div>
            <div style={styles.actions}>
                <button onClick={() => onRespond('')} style={styles.denyButton}>
                    Cancel (Esc)
                </button>
                <button
                    onClick={submit}
                    disabled={!selected}
                    style={{ ...styles.approveButton, opacity: selected ? 1 : 0.5 }}
                >
                    Select (Enter)
                </button>
            </div>
        </div>
    );
};

// ── Multi-Select Input ───────────────────────────────────────────

interface MultiSelectInputProps {
    config: {
        options?: Array<{ value: string; label: string; description?: string }>;
        minSelections?: number;
        maxSelections?: number;
    };
    onRespond: (value: string[]) => Promise<void>;
}

const MultiSelectInput: React.FC<MultiSelectInputProps> = ({ config, onRespond }) => {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const options = config.options || [];
    const min = config.minSelections || 0;
    const max = config.maxSelections || options.length;
    const isValid = selected.size >= min && selected.size <= max;

    const toggle = (value: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(value)) {
                next.delete(value);
            } else if (next.size < max) {
                next.add(value);
            }
            return next;
        });
    };

    const submit = useCallback(() => {
        if (isValid) onRespond(Array.from(selected));
    }, [selected, isValid, onRespond]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Enter' && isValid) { e.preventDefault(); submit(); }
            else if (e.key === 'Escape') { e.preventDefault(); onRespond([]); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [submit, isValid, onRespond]);

    return (
        <div>
            <div style={styles.optionList}>
                {options.map((opt) => (
                    <label
                        key={opt.value}
                        style={{
                            ...styles.optionItem,
                            ...(selected.has(opt.value) ? styles.optionSelected : {}),
                        }}
                        onClick={() => toggle(opt.value)}
                    >
                        <input
                            type="checkbox"
                            checked={selected.has(opt.value)}
                            onChange={() => toggle(opt.value)}
                            style={styles.radio}
                        />
                        <div>
                            <div style={styles.optionLabel}>{opt.label}</div>
                            {opt.description && (
                                <div style={styles.optionDesc}>{opt.description}</div>
                            )}
                        </div>
                    </label>
                ))}
            </div>
            {min > 0 && (
                <div style={styles.charCount}>
                    {selected.size} selected (min: {min}, max: {max})
                </div>
            )}
            <div style={styles.actions}>
                <button onClick={() => onRespond([])} style={styles.denyButton}>
                    Cancel (Esc)
                </button>
                <button
                    onClick={submit}
                    disabled={!isValid}
                    style={{ ...styles.approveButton, opacity: isValid ? 1 : 0.5 }}
                >
                    Submit (Enter)
                </button>
            </div>
        </div>
    );
};

// ── Styles ───────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
    overlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
    },
    dialog: {
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '24px',
        maxWidth: '500px',
        width: '90%',
        maxHeight: '80vh',
        overflow: 'auto',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '12px',
    },
    headerIcon: {
        width: '28px',
        height: '28px',
        borderRadius: '50%',
        backgroundColor: 'var(--accent)',
        color: 'var(--bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: '16px',
        flexShrink: 0,
    },
    headerTitle: {
        fontSize: '16px',
        fontWeight: 600,
        color: 'var(--text-primary)',
    },
    agentName: {
        fontSize: '13px',
        color: 'var(--accent)',
        fontFamily: 'var(--font-mono)',
        marginBottom: '12px',
    },
    description: {
        fontSize: '14px',
        color: 'var(--text-secondary)',
        lineHeight: '1.5',
        marginBottom: '16px',
        whiteSpace: 'pre-wrap',
    },
    actions: {
        display: 'flex',
        gap: '12px',
        justifyContent: 'flex-end',
        marginTop: '16px',
    },
    denyButton: {
        padding: '8px 20px',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        backgroundColor: 'transparent',
        color: 'var(--text-secondary)',
        fontSize: '13px',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
    },
    approveButton: {
        padding: '8px 20px',
        borderRadius: '6px',
        border: 'none',
        backgroundColor: 'var(--success)',
        color: 'var(--bg-primary)',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
    },
    textInput: {
        width: '100%',
        padding: '10px 12px',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        fontSize: '14px',
        fontFamily: 'var(--font-mono)',
        outline: 'none',
        boxSizing: 'border-box' as const,
    },
    charCount: {
        fontSize: '11px',
        color: 'var(--text-dim)',
        textAlign: 'right' as const,
        marginTop: '4px',
    },
    optionList: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '6px',
        maxHeight: '300px',
        overflow: 'auto',
    },
    optionItem: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        cursor: 'pointer',
        transition: 'background-color 0.15s',
    },
    optionSelected: {
        backgroundColor: 'rgba(var(--accent-rgb, 100, 180, 100), 0.1)',
        borderColor: 'var(--accent)',
    },
    radio: {
        marginTop: '2px',
        accentColor: 'var(--accent)',
    },
    optionLabel: {
        fontSize: '14px',
        color: 'var(--text-primary)',
        fontWeight: 500,
    },
    optionDesc: {
        fontSize: '12px',
        color: 'var(--text-dim)',
        marginTop: '2px',
    },
    queueBadge: {
        marginTop: '12px',
        textAlign: 'center' as const,
        fontSize: '12px',
        color: 'var(--text-dim)',
    },
};
