<script setup lang="ts">
import { Head, Link, usePage } from '@inertiajs/vue3';
import {
    BellRing,
    CalendarDays,
    CloudOff,
    Link2,
    NotebookPen,
    Repeat2,
    Sparkles,
    Users,
} from '@lucide/vue';
import { computed } from 'vue';
import AppLogoIcon from '@/components/AppLogoIcon.vue';
import { dashboard, login, register } from '@/routes';

const page = usePage();
const dashboardUrl = computed(() =>
    page.props.currentTeam ? dashboard(page.props.currentTeam.slug).url : '/',
);

const features = [
    {
        icon: NotebookPen,
        title: 'Everything is markdown',
        text: 'Notes, projects, and plans live in plain text you can read anywhere. Tasks sit inside your notes, right next to their context.',
    },
    {
        icon: CalendarDays,
        title: 'Plan on any horizon',
        text: 'Daily, weekly, monthly, quarterly, and yearly notes. Schedule a task to a day, a week, or a whole quarter with a single token.',
    },
    {
        icon: Repeat2,
        title: 'Repeats that think ahead',
        text: 'Recurring tasks reschedule themselves when you complete them — fixed cadence, from completion, weekdays, or a day of the month.',
    },
    {
        icon: BellRing,
        title: 'Reminders in place',
        text: 'Type @9am on a task and get nudged at nine. Snoozing rewrites the note, so the note stays the source of truth.',
    },
    {
        icon: Link2,
        title: 'Connected thinking',
        text: 'Wiki links, backlinks with full context, synced lines that edit everywhere at once, and a graph of how your notes relate.',
    },
    {
        icon: CloudOff,
        title: 'Offline-first',
        text: 'Your whole workspace lives on your device and syncs when a connection is available. No spinners between you and your notes.',
    },
    {
        icon: Users,
        title: 'Built for teams',
        text: 'Shared team workspaces with instant full-text search, plus your Google Calendar alongside your daily note.',
    },
    {
        icon: Sparkles,
        title: 'Works with Claude',
        text: 'A built-in MCP server lets AI assistants capture ideas, file notes, and update your task lists on your behalf.',
    },
];
</script>

<template>
    <Head title="Notes, tasks, and plans in markdown" />
    <div class="min-h-screen bg-background text-foreground">
        <header class="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
            <div class="flex items-center gap-2.5">
                <AppLogoIcon class="size-8" />
                <span class="text-lg font-semibold tracking-tight">Donote</span>
            </div>
            <nav class="flex items-center gap-2 text-sm">
                <Link
                    v-if="$page.props.auth.user"
                    :href="dashboardUrl"
                    class="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                    Open Donote
                </Link>
                <template v-else>
                    <Link
                        :href="login()"
                        class="rounded-lg px-4 py-2 text-muted-foreground transition-colors hover:text-foreground"
                    >
                        Log in
                    </Link>
                    <Link
                        :href="register()"
                        class="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    >
                        Register
                    </Link>
                </template>
            </nav>
        </header>

        <main
            class="mx-auto w-full max-w-5xl px-6 pb-20 opacity-100 transition-opacity duration-750 starting:opacity-0"
        >
            <section class="pt-14 pb-12 text-center lg:pt-20">
                <h1
                    class="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-balance lg:text-5xl"
                >
                    Your team's notes, tasks, and plans — in plain markdown
                </h1>
                <p class="mx-auto mt-5 max-w-2xl text-lg text-balance text-muted-foreground">
                    Donote is an offline-first workspace where tasks live inside
                    your notes, days roll up into weeks and quarters, and
                    everything stays connected.
                </p>
                <div class="mt-8 flex items-center justify-center gap-3">
                    <Link
                        v-if="$page.props.auth.user"
                        :href="dashboardUrl"
                        class="rounded-lg bg-primary px-6 py-2.5 font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    >
                        Open your workspace
                    </Link>
                    <template v-else>
                        <Link
                            :href="register()"
                            class="rounded-lg bg-primary px-6 py-2.5 font-medium text-primary-foreground transition-opacity hover:opacity-90"
                        >
                            Get started
                        </Link>
                        <Link
                            :href="login()"
                            class="rounded-lg border border-border px-6 py-2.5 font-medium transition-colors hover:bg-muted"
                        >
                            Log in
                        </Link>
                    </template>
                </div>
            </section>

            <!-- A static rendering of a Donote daily note, styled with the
                 same token colors the real editor uses. -->
            <section
                class="mx-auto max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-lg shadow-black/5"
            >
                <div class="flex items-center gap-2 border-b border-border px-4 py-2.5">
                    <span class="size-2.5 rounded-full bg-[#dc4c3e]/80" />
                    <span class="size-2.5 rounded-full bg-[#eb8909]/80" />
                    <span class="size-2.5 rounded-full bg-[#5cb85c]/80" />
                    <span class="ml-3 text-xs text-muted-foreground">Friday, July 11 · Daily note</span>
                </div>
                <div class="space-y-1.5 p-6 font-mono text-[13px] leading-6">
                    <p class="pb-1 text-base font-semibold">Friday, July 11</p>
                    <p class="flex items-start gap-2">
                        <span class="mt-1.5 inline-block size-3 shrink-0 rounded-full border-2 border-[#dc4c3e]" />
                        <span>
                            Finish launch checklist for
                            <span class="rounded px-1 py-0.5" style="color: var(--token-link); background: var(--token-link-bg)">[[Website relaunch]]</span>
                            <span class="text-muted-foreground">@due(2026-07-14)</span>
                        </span>
                    </p>
                    <p class="flex items-start gap-2 pl-6">
                        <span class="mt-2.5 inline-block size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                        <span class="text-muted-foreground">copy is done, waiting on the hero image</span>
                    </p>
                    <p class="flex items-start gap-2">
                        <span class="mt-1.5 inline-block size-3 shrink-0 rounded-full border-2 border-[#246fe0]" />
                        <span>
                            Prep 1:1 agenda with
                            <span class="rounded px-1 py-0.5" style="color: var(--token-mention); background: var(--token-mention-bg)">@irene</span>
                            <span class="rounded px-1 py-0.5" style="color: var(--token-tag); background: var(--token-tag-bg)">#hiring</span>
                            <span class="text-muted-foreground">@2pm</span>
                        </span>
                    </p>
                    <p class="flex items-start gap-2">
                        <span class="mt-1.5 inline-block size-3 shrink-0 rounded-full border-2 border-muted-foreground/50" />
                        <span>
                            Water the office plants
                            <span class="text-muted-foreground">@repeat(Tue,Fri)</span>
                        </span>
                    </p>
                    <p class="flex items-start gap-2">
                        <span class="mt-1.5 inline-block size-3 shrink-0 rounded-full border-2 border-muted-foreground/50" />
                        <span>
                            Draft Q3 goals
                            <span class="rounded px-1 py-0.5" style="color: var(--token-link); background: var(--token-link-bg)">&gt;2026-Q3</span>
                        </span>
                    </p>
                    <p class="flex items-start gap-2">
                        <svg viewBox="0 0 16 16" class="mt-1.5 size-3 shrink-0 text-[#5cb85c]" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="8" cy="8" r="7" fill="currentColor" stroke="none" opacity="0.15" />
                            <path d="M4.5 8.5 7 11l4.5-5.5" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                        <span class="text-muted-foreground line-through decoration-muted-foreground/60">
                            Ship the sync fix
                        </span>
                        <span class="font-sans text-xs text-muted-foreground/70 no-underline">✓ done</span>
                    </p>
                </div>
            </section>

            <section class="mt-16 grid gap-x-10 gap-y-8 sm:grid-cols-2">
                <div v-for="feature in features" :key="feature.title" class="flex gap-3.5">
                    <span
                        class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50"
                    >
                        <component :is="feature.icon" class="size-4.5 text-muted-foreground" />
                    </span>
                    <div>
                        <h2 class="font-medium">{{ feature.title }}</h2>
                        <p class="mt-1 text-sm leading-relaxed text-muted-foreground">
                            {{ feature.text }}
                        </p>
                    </div>
                </div>
            </section>

            <footer
                class="mt-20 border-t border-border pt-6 text-center text-sm text-muted-foreground"
            >
                Donote — web, macOS, and iOS
            </footer>
        </main>
    </div>
</template>
