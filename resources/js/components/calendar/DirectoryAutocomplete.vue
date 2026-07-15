<script setup lang="ts">
import { ref, watch } from 'vue';

import { searchDirectory } from '@/stores/calendar';
import type { DirectoryPerson } from '@/stores/calendar';

withDefaults(defineProps<{ placeholder?: string }>(), {
    placeholder: 'Search colleagues by name or email…',
});

const emit = defineEmits<{ add: [email: string, name: string] }>();

const query = ref('');
const suggestions = ref<DirectoryPerson[]>([]);
const open = ref(false);
const loading = ref(false);

let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

watch(query, (value) => {
    const q = value.trim();

    if (timer !== null) {
        clearTimeout(timer);
    }

    if (q.length < 2) {
        suggestions.value = [];
        open.value = false;

        return;
    }

    loading.value = true;
    timer = setTimeout(async () => {
        const current = ++seq;
        const people = await searchDirectory(q);

        if (current === seq) {
            suggestions.value = people;
            open.value = true;
            loading.value = false;
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
}

/** Delay close so a suggestion click (mousedown) registers first. */
function onBlur(): void {
    setTimeout(() => {
        open.value = false;
    }, 150);
}
</script>

<template>
    <div class="relative">
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
            @focus="open = suggestions.length > 0"
            @blur="onBlur"
        />

        <ul
            v-if="open && suggestions.length > 0"
            class="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg"
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
            v-else-if="open && !loading && query.trim().length >= 2"
            class="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-muted-foreground shadow-lg"
        >
            No matches. Press Enter to add a full email.
        </p>
    </div>
</template>
