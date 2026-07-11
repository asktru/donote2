<script setup lang="ts">
import { computed } from 'vue';

import TagTreeNode from '@/components/notes/TagTreeNode.vue';
import type { TagNode } from '@/components/notes/TagTreeNode.vue';

const props = defineProps<{
    counts: Map<string, number>;
    sigil: '#' | '@';
}>();

const emit = defineEmits<{
    open: [full: string];
}>();

interface BuildNode extends TagNode {
    childMap: Map<string, BuildNode>;
}

/** Fold flat "a/b/c" names into a tree with aggregated counts. */
const roots = computed<TagNode[]>(() => {
    const rootBuild = new Map<string, BuildNode>();

    for (const [full, count] of props.counts) {
        const segments = full.split('/');
        let level = rootBuild;
        let path = '';

        for (const segment of segments) {
            path = path === '' ? segment : `${path}/${segment}`;
            let node = level.get(segment);

            if (!node) {
                node = {
                    name: segment,
                    full: path,
                    total: 0,
                    children: [],
                    childMap: new Map(),
                };
                level.set(segment, node);
            }

            node.total += count;
            level = node.childMap;
        }
    }

    const finalize = (map: Map<string, BuildNode>): TagNode[] =>
        [...map.values()]
            .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
            .map((node) => ({
                name: node.name,
                full: node.full,
                total: node.total,
                children: finalize(node.childMap),
            }));

    return finalize(rootBuild);
});
</script>

<template>
    <div>
        <TagTreeNode
            v-for="node in roots"
            :key="node.full"
            :node="node"
            :sigil="sigil"
            :depth="0"
            @open="(full) => emit('open', full)"
        />
    </div>
</template>
