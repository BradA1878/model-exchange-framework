/**
 * Unit tests for VimModeService
 *
 * Tests the vim keybinding state machine: mode switching, key handling
 * in normal/insert modes, multi-key sequences (dd), and toggle behavior.
 */

import { VimModeService } from '@mxf/cli/tui/services/VimMode';

describe('VimModeService Unit Tests', () => {
    let vim: VimModeService;

    beforeEach(() => {
        // Reset singleton state between tests
        vim = VimModeService.getInstance();
        // Ensure clean state: disable vim, then re-enable for tests that need it
        if (vim.isEnabled()) {
            vim.toggle();
        }
    });

    describe('Singleton', () => {
        it('should return the same instance', () => {
            const a = VimModeService.getInstance();
            const b = VimModeService.getInstance();
            expect(a).toBe(b);
        });
    });

    describe('Initial State', () => {
        it('should be disabled by default', () => {
            expect(vim.isEnabled()).toBe(false);
        });

        it('should pass through all keys when disabled', () => {
            const result = vim.handleKey('j', {});
            expect(result.consumed).toBe(false);
            expect(result.action).toBe('passthrough');
        });
    });

    describe('Toggle', () => {
        it('should enable vim mode on first toggle', () => {
            vim.toggle();
            expect(vim.isEnabled()).toBe(true);
        });

        it('should disable vim mode on second toggle', () => {
            vim.toggle();
            vim.toggle();
            expect(vim.isEnabled()).toBe(false);
        });

        it('should start in insert mode when enabled', () => {
            vim.toggle();
            expect(vim.getMode()).toBe('insert');
        });

        it('should reset to insert mode when re-enabled', () => {
            vim.toggle(); // enable
            vim.setMode('normal');
            expect(vim.getMode()).toBe('normal');
            vim.toggle(); // disable
            vim.toggle(); // re-enable
            expect(vim.getMode()).toBe('insert');
        });
    });

    describe('Insert Mode', () => {
        beforeEach(() => {
            vim.toggle(); // enable in insert mode
        });

        it('should pass through regular keys', () => {
            const result = vim.handleKey('a', {});
            expect(result.consumed).toBe(false);
            expect(result.action).toBe('passthrough');
        });

        it('should pass through special keys', () => {
            const result = vim.handleKey('return', {});
            expect(result.consumed).toBe(false);
        });

        it('should switch to normal mode on Escape', () => {
            const result = vim.handleKey('escape', {});
            expect(result.consumed).toBe(true);
            expect(result.action).toBe('enter-normal');
            expect(vim.getMode()).toBe('normal');
        });
    });

    describe('Normal Mode — Mode Switching', () => {
        beforeEach(() => {
            vim.toggle();
            vim.setMode('normal');
        });

        it('should switch to insert mode on "i"', () => {
            const result = vim.handleKey('i', {});
            expect(result.consumed).toBe(true);
            expect(result.action).toBe('enter-insert');
            expect(vim.getMode()).toBe('insert');
        });

        it('should switch to insert mode (append) on "a"', () => {
            const result = vim.handleKey('a', {});
            expect(result.consumed).toBe(true);
            expect(result.action).toBe('enter-insert-after');
            expect(vim.getMode()).toBe('insert');
        });

        it('should switch to insert mode (beginning) on "I"', () => {
            const result = vim.handleKey('I', {});
            expect(result.consumed).toBe(true);
            expect(result.action).toBe('enter-insert-home');
            expect(vim.getMode()).toBe('insert');
        });

        it('should switch to insert mode (end) on "A"', () => {
            const result = vim.handleKey('A', {});
            expect(result.consumed).toBe(true);
            expect(result.action).toBe('enter-insert-end');
            expect(vim.getMode()).toBe('insert');
        });
    });

    describe('Normal Mode — Movement', () => {
        beforeEach(() => {
            vim.toggle();
            vim.setMode('normal');
        });

        it('should emit move-left on "h"', () => {
            const result = vim.handleKey('h', {});
            expect(result).toEqual({ action: 'move-left', consumed: true });
        });

        it('should emit move-right on "l"', () => {
            const result = vim.handleKey('l', {});
            expect(result).toEqual({ action: 'move-right', consumed: true });
        });

        it('should emit move-home on "0"', () => {
            const result = vim.handleKey('0', {});
            expect(result).toEqual({ action: 'move-home', consumed: true });
        });

        it('should emit move-end on "$"', () => {
            const result = vim.handleKey('$', {});
            expect(result).toEqual({ action: 'move-end', consumed: true });
        });
    });

    describe('Normal Mode — Editing', () => {
        beforeEach(() => {
            vim.toggle();
            vim.setMode('normal');
        });

        it('should emit delete-char on "x"', () => {
            const result = vim.handleKey('x', {});
            expect(result).toEqual({ action: 'delete-char', consumed: true });
        });

        it('should emit delete-line on "dd"', () => {
            const first = vim.handleKey('d', {});
            expect(first.action).toBe('pending');
            expect(first.consumed).toBe(true);

            const second = vim.handleKey('d', {});
            expect(second).toEqual({ action: 'delete-line', consumed: true });
        });

        it('should cancel pending "d" on non-d key', () => {
            vim.handleKey('d', {}); // start pending
            const result = vim.handleKey('w', {}); // invalid sequence
            expect(result.action).toBe('noop');
            expect(result.consumed).toBe(true);
        });
    });

    describe('Normal Mode — Key Swallowing', () => {
        beforeEach(() => {
            vim.toggle();
            vim.setMode('normal');
        });

        it('should swallow unrecognized keys', () => {
            const result = vim.handleKey('z', {});
            expect(result.consumed).toBe(true);
            expect(result.action).toBe('noop');
        });

        it('should swallow number keys other than 0', () => {
            const result = vim.handleKey('5', {});
            expect(result.consumed).toBe(true);
            expect(result.action).toBe('noop');
        });
    });

    describe('setMode', () => {
        beforeEach(() => {
            vim.toggle();
        });

        it('should explicitly set the mode', () => {
            vim.setMode('normal');
            expect(vim.getMode()).toBe('normal');
            vim.setMode('insert');
            expect(vim.getMode()).toBe('insert');
        });

        it('should clear pending key state on mode change', () => {
            vim.setMode('normal');
            vim.handleKey('d', {}); // start pending
            vim.setMode('insert'); // should clear pending
            vim.setMode('normal');
            // A single 'd' should start a new pending, not complete 'dd'
            const result = vim.handleKey('d', {});
            expect(result.action).toBe('pending');
        });
    });
});
