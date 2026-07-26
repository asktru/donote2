import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./resources/js', import.meta.url)),
        },
    },
    test: {
        include: ['resources/js/**/*.test.ts'],
        environment: 'node',
        // Off by default, which blanks out `?raw` stylesheet imports — tests
        // that assert on a hand-written CSS rule need the real text.
        css: true,
    },
});
