<script setup lang="ts">
import { ref, watch } from 'vue';

import { searchDirectory } from '@/stores/calendar';
import type { DirectoryPerson } from '@/stores/calendar';

withDefaults(defineProps<{ placeholder?: string }>(), {
    placeholder: 'Search colleagues by name or email…',
});

const emit = defineEmits<{ add: [email: string, name: string] }>();

const root = ref<HTMLElement>();
const query = ref('');
const suggestions = ref<DirectoryPerson[]>([]);
const open = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
// Flip the panel above the input when there isn't room below (the Meet-with
// picker docks at the bottom of the window, so "down" would overflow it).
const dropUp = ref(false);

let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

/** Roughly the tallest the popover gets (max-h-56 list + a little chrome). */
const POPOVER_PX = 240;

function updateDirection(): void {
    const rect = root.value?.getBoundingClientRect();

    if (rect) {
        dropUp.value = window.innerHeight - rect.bottom < POPOVER_PX;
    }
}

function reveal(): void {
    updateDirection();
    open.value = true;
}

watch(query, (value) => {
    const q = value.trim();

    if (timer !== null) {
        clearTimeout(timer);
    }

    if (q.length < 2) {
        suggestions.value = [];
        open.value = false;
        error.value = null;

        return;
    }

    loading.value = true;
    timer = setTimeout(async () => {
        const current = ++seq;
        const result = await searchDirectory(q);

        if (current === seq) {
            suggestions.value = result.people;
            error.value = result.error;
            loading.value = false;
            reveal();
        }
    }, 250);
});

function pick(person: DirectoryPerson): void {
    emit('add', person.email, person.name);
    reset();
}

/** Enter: accept the top suggestion, or a raw email if one was typed. */
function onEnter(): void {
    if (suggestions.value.length > 0) {
        pick(suggestions.value[0]);

        return;
    }

    const raw = query.value.trim().toLowerCase();

    if (raw.includes('@')) {
        emit('add', raw, raw);
        reset();
    }
}

function reset(): void {
    query.value = '';
    suggestions.value = [];
    open.value = false;
    loading.value = false;
    error.value = null;
}

/** Delay close so a suggestion click (mousedown) registers first. */
function onBlur(): void {
    setTimeout(() => {
        open.value = false;
    }, 150);
}
</script>

<template>
    <div ref="root" class="relative">
        <input
            v-model="query"
            type="text"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            :placeholder="placeholder"
            class="h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
            @keydown.enter.prevent="onEnter"
            @keydown.esc="open = false"
            @focus="suggestions.length > 0 && reveal()"
            @blur="onBlur"
        />

        <ul
            v-if="open && suggestions.length > 0"
            :class="[
                'absolute z-50 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg',
                dropUp ? 'bottom-full mb-1' : 'top-full mt-1',
            ]"
        >
            <li v-for="person in suggestions" :key="person.email">
                <button
                    type="button"
                    class="flex w-full flex-col items-start px-2.5 py-1.5 text-left hover:bg-muted/60"
                    @mousedown.prevent="pick(person)"
                >
                    <span class="text-sm">{{ person.name }}</span>
                    <span class="text-xs text-muted-foreground">{{
                        person.email
                    }}</span>
                </button>
            </li>
        </ul>

        <p
            v-else-if="open && !loading && error"
            :class="[
                'absolute z-50 w-full rounded-md border border-amber-500/40 bg-popover px-2.5 py-2 text-xs text-amber-600 shadow-lg dark:text-amber-400',
                dropUp ? 'bottom-full mb-1' : 'top-full mt-1',
            ]"
        >
            Directory search unavailable: {{ error }} — you can still press
            Enter to add a full email.
        </p>
        <p
            v-else-if="open && !loading && query.trim().length >= 2"
            :class="[
                'absolute z-50 w-full rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-muted-foreground shadow-lg',
                dropUp ? 'bottom-full mb-1' : 'top-full mt-1',
            ]"
        >
            No matches. Press Enter to add a full email.
        </p>
    </div>
</template>
