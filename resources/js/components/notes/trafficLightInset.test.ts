import { describe, expect, it } from 'vitest';

import appCss from '@/../css/app.css?raw';
import notePane from '@/components/notes/NotePane.vue?raw';
import remindersView from '@/components/notes/RemindersView.vue?raw';
import tasksView from '@/components/notes/TasksView.vue?raw';
import trashView from '@/components/notes/TrashView.vue?raw';
import notesPage from '@/pages/notes/Index.vue?raw';

/**
 * Focus mode hides the sidebar whose top strip clears the macOS traffic
 * lights, so the leftmost pane's header insets itself instead. The wiring
 * spans three files and fails silently when one half drifts, so pin it: the
 * CSS rule, the class binding, and the hook on every header that can render
 * in that pane.
 */
describe('traffic-light inset in focus mode', () => {
    it('insets any pane header inside the marked pane', () => {
        expect(appCss).toMatch(
            /\.traffic-light-inset \[data-pane-header\] \{[^}]*padding-left/,
        );
    });

    it('marks the leftmost pane only in the macOS shell’s focus mode', () => {
        expect(notesPage).toMatch(
            /isMacDesktopShell &&\s*focusMode &&\s*'traffic-light-inset'/,
        );
    });

    it.each([
        ['NotePane', notePane],
        ['TasksView', tasksView],
        ['RemindersView', remindersView],
        ['TrashView', trashView],
    ])('gives %s’s header the inset hook', (_name, source) => {
        expect(source).toContain('data-pane-header');
    });
});
