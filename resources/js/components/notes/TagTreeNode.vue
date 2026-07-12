<script setup lang="ts">
import { AtSign, ChevronRight, Hash, ListChecks, Pencil } from '@lucide/vue';
import { ref } from 'vue';

import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { promptText } from '@/stores/prompt';
import { renameMention, renameTag } from '@/stores/workspace';

export interface TagNode {
    name: string;
    full: string;
    total: number;
    children: TagNode[];
}

const props = defineProps<{
    node: TagNode;
    sigil: '#' | '@';
    depth: number;
}>();

const emit = defineEmits<{
    open: [full: string];
}>();

const expanded = ref(false);

async function renamePrompt(): Promise<void> {
    const next = (
        await promptText({
            title: `Rename ${props.sigil}${props.node.full}`,
            label: 'Nested tags are renamed too.',
            initialValue: props.node.full,
            confirmLabel: 'Rename',
        })
    )?.replace(/\s+/g, '-');

    if (!next || next === props.node.full) {
        return;
    }

    if (props.sigil === '#') {
        await renameTag(props.node.full, next);
    } else {
        await renameMention(props.node.full, next);
    }
}
</script>

<template>
    <div>
        <ContextMenu>
            <ContextMenuTrigger as-child>
                <div
                    :class="
                        cn(
                            'flex w-full items-center gap-1 rounded-md py-1 pr-2 text-sm text-foreground/80 hover:bg-muted/70',
                        )
                    "
                    :style="{ paddingLeft: `${depth * 14 + 8}px` }"
                >
                    <button
                        v-if="node.children.length > 0"
                        type="button"
                        class="-ml-1 flex size-4 shrink-0 items-center justify-center"
                        :aria-label="expanded ? 'Collapse' : 'Expand'"
                        @click.stop="expanded = !expanded"
                    >
                        <ChevronRight
                            :class="
                                cn(
                                    'size-3 text-muted-foreground transition-transform',
                                    expanded && 'rotate-90',
                                )
                            "
                        />
                    </button>
                    <span v-else class="-ml-1 size-4 shrink-0" />

                    <button
                        type="button"
                        class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        @click="emit('open', node.full)"
                    >
                        <Hash
                            v-if="sigil === '#'"
                            class="size-3.5 shrink-0 text-muted-foreground"
                        />
                        <AtSign
                            v-else
                            class="size-3.5 shrink-0 text-muted-foreground"
                        />
                        <span class="truncate">{{ node.name }}</span>
                        <span class="ml-auto text-xs text-muted-foreground">
                            {{ node.total }}
                        </span>
                    </button>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuItem @select="emit('open', node.full)">
                    <ListChecks /> Show tasks
                </ContextMenuItem>
                <ContextMenuItem @select="renamePrompt">
                    <Pencil /> Rename everywhere…
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>

        <template v-if="expanded">
            <TagTreeNode
                v-for="child in node.children"
                :key="child.full"
                :node="child"
                :sigil="sigil"
                :depth="depth + 1"
                @open="(full) => emit('open', full)"
            />
        </template>
    </div>
</template>
