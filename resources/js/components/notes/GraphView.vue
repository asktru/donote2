<script setup lang="ts">
import { AtSign, Hash, Minus, Plus, Waypoints, X } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { Button } from '@/components/ui/button';
import { humanizeKey } from '@/core/dates';
import { cn } from '@/lib/utils';
import {
    getNote,
    liveNotes,
    parsedNote,
    resolveWikiTarget,
} from '@/stores/workspace';

const props = defineProps<{
    noteId: string;
}>();

const emit = defineEmits<{
    'open-note': [id: string];
    'open-tag': [tag: string];
    'open-mention': [mention: string];
    close: [];
}>();

const depth = ref(2);
const showTags = ref(true);
const showMentions = ref(true);

const MAX_NODES = 130;
const EXPANSION_CAP = 16;

type NodeType = 'center' | 'note' | 'tag' | 'mention';

interface GraphNode {
    key: string;
    type: NodeType;
    label: string;
    /** Note id for note nodes, tag/mention name otherwise. */
    ref: string;
    dist: number;
}

interface GraphEdge {
    source: string;
    target: string;
}

function noteLabel(id: string): string {
    const note = getNote(id);

    if (!note) {
        return 'Unknown';
    }

    if (note.type !== 'note' && note.dateKey !== null) {
        return humanizeKey(note.dateKey);
    }

    return note.title || 'Untitled';
}

/**
 * Adjacency indexes over the whole workspace: wiki-link edges (both
 * directions) plus tag/mention memberships.
 */
const indexes = computed(() => {
    const links = new Map<string, Set<string>>();
    const tagNotes = new Map<string, Set<string>>();
    const mentionNotes = new Map<string, Set<string>>();

    const connect = (a: string, b: string): void => {
        (links.get(a) ?? links.set(a, new Set()).get(a)!).add(b);
        (links.get(b) ?? links.set(b, new Set()).get(b)!).add(a);
    };

    for (const note of liveNotes.value) {
        for (const line of parsedNote(note.id)) {
            for (const link of line.wikiLinks) {
                const resolved = resolveWikiTarget(link.target);

                if (resolved.note && resolved.note.id !== note.id) {
                    connect(note.id, resolved.note.id);
                }
            }

            for (const tag of line.tags) {
                (
                    tagNotes.get(tag) ?? tagNotes.set(tag, new Set()).get(tag)!
                ).add(note.id);
            }

            for (const mention of line.mentions) {
                (
                    mentionNotes.get(mention) ??
                    mentionNotes.set(mention, new Set()).get(mention)!
                ).add(note.id);
            }
        }
    }

    return { links, tagNotes, mentionNotes };
});

/** BFS around the center note up to `depth` hops. */
const graph = computed<{ nodes: GraphNode[]; edges: GraphEdge[] }>(() => {
    const { links, tagNotes, mentionNotes } = indexes.value;
    const nodes = new Map<string, GraphNode>();
    const edges = new Set<string>();
    const edgeList: GraphEdge[] = [];

    const noteTags = new Map<string, Set<string>>();
    const noteMentions = new Map<string, Set<string>>();

    for (const [tag, ids] of tagNotes) {
        for (const id of ids) {
            (noteTags.get(id) ?? noteTags.set(id, new Set()).get(id)!).add(tag);
        }
    }

    for (const [mention, ids] of mentionNotes) {
        for (const id of ids) {
            (
                noteMentions.get(id) ?? noteMentions.set(id, new Set()).get(id)!
            ).add(mention);
        }
    }

    const centerKey = `note:${props.noteId}`;
    nodes.set(centerKey, {
        key: centerKey,
        type: 'center',
        label: noteLabel(props.noteId),
        ref: props.noteId,
        dist: 0,
    });

    const addEdge = (a: string, b: string): void => {
        const id = a < b ? `${a}|${b}` : `${b}|${a}`;

        if (!edges.has(id)) {
            edges.add(id);
            edgeList.push({ source: a, target: b });
        }
    };

    const addNode = (
        key: string,
        type: NodeType,
        label: string,
        reference: string,
        dist: number,
    ): boolean => {
        if (nodes.has(key)) {
            return true;
        }

        if (nodes.size >= MAX_NODES) {
            return false;
        }

        nodes.set(key, { key, type, label, ref: reference, dist });

        return true;
    };

    let frontier = [centerKey];

    for (let dist = 1; dist <= depth.value && frontier.length > 0; dist++) {
        const next: string[] = [];

        for (const key of frontier) {
            const node = nodes.get(key)!;
            const neighbors: {
                key: string;
                type: NodeType;
                label: string;
                ref: string;
            }[] = [];

            if (node.type === 'tag') {
                for (const id of tagNotes.get(node.ref) ?? []) {
                    neighbors.push({
                        key: `note:${id}`,
                        type: 'note',
                        label: noteLabel(id),
                        ref: id,
                    });
                }
            } else if (node.type === 'mention') {
                for (const id of mentionNotes.get(node.ref) ?? []) {
                    neighbors.push({
                        key: `note:${id}`,
                        type: 'note',
                        label: noteLabel(id),
                        ref: id,
                    });
                }
            } else {
                for (const id of links.get(node.ref) ?? []) {
                    neighbors.push({
                        key: `note:${id}`,
                        type: 'note',
                        label: noteLabel(id),
                        ref: id,
                    });
                }

                if (showTags.value) {
                    for (const tag of noteTags.get(node.ref) ?? []) {
                        neighbors.push({
                            key: `tag:${tag}`,
                            type: 'tag',
                            label: `#${tag}`,
                            ref: tag,
                        });
                    }
                }

                if (showMentions.value) {
                    for (const mention of noteMentions.get(node.ref) ?? []) {
                        neighbors.push({
                            key: `mention:${mention}`,
                            type: 'mention',
                            label: `@${mention}`,
                            ref: mention,
                        });
                    }
                }
            }

            for (const neighbor of neighbors.slice(0, EXPANSION_CAP)) {
                const existed = nodes.has(neighbor.key);

                if (
                    addNode(
                        neighbor.key,
                        neighbor.type,
                        neighbor.label,
                        neighbor.ref,
                        dist,
                    )
                ) {
                    addEdge(key, neighbor.key);

                    if (!existed) {
                        next.push(neighbor.key);
                    }
                }
            }
        }

        frontier = next;
    }

    return { nodes: [...nodes.values()], edges: edgeList };
});

/* ------------------------- force simulation ------------------------- */

interface SimNode extends GraphNode {
    x: number;
    y: number;
    vx: number;
    vy: number;
    dragged: boolean;
}

const simNodes = ref<SimNode[]>([]);
const width = ref(800);
const height = ref(600);
const container = ref<HTMLDivElement | null>(null);

let raf = 0;
let alpha = 1;
let resizeObserver: ResizeObserver | null = null;

const nodeByKey = computed(() => {
    const map = new Map<string, SimNode>();

    for (const node of simNodes.value) {
        map.set(node.key, node);
    }

    return map;
});

function seedSimulation(): void {
    const previous = new Map(simNodes.value.map((node) => [node.key, node]));
    const cx = width.value / 2;
    const cy = height.value / 2;

    simNodes.value = graph.value.nodes.map((node, index) => {
        const kept = previous.get(node.key);

        if (kept) {
            return { ...kept, ...node };
        }

        const angle =
            (index / Math.max(1, graph.value.nodes.length)) * Math.PI * 2;
        const radius = node.dist === 0 ? 0 : 60 + node.dist * 70;

        return {
            ...node,
            x: cx + Math.cos(angle) * radius + (Math.random() - 0.5) * 20,
            y: cy + Math.sin(angle) * radius + (Math.random() - 0.5) * 20,
            vx: 0,
            vy: 0,
            dragged: false,
        };
    });

    alpha = 1;
    startLoop();
}

function tick(): void {
    const nodes = simNodes.value;
    const cx = width.value / 2;
    const cy = height.value / 2;

    // Pairwise repulsion.
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i];
            const b = nodes[j];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let d2 = dx * dx + dy * dy;

            if (d2 === 0) {
                dx = Math.random() - 0.5;
                dy = Math.random() - 0.5;
                d2 = 1;
            }

            const force = Math.min(2200 / d2, 6) * alpha;
            const d = Math.sqrt(d2);
            const fx = (dx / d) * force;
            const fy = (dy / d) * force;

            a.vx -= fx;
            a.vy -= fy;
            b.vx += fx;
            b.vy += fy;
        }
    }

    // Springs along edges.
    const byKey = nodeByKey.value;

    for (const edge of graph.value.edges) {
        const a = byKey.get(edge.source);
        const b = byKey.get(edge.target);

        if (!a || !b) {
            continue;
        }

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const ideal = 90;
        const force = ((d - ideal) / d) * 0.05 * alpha;

        a.vx += dx * force;
        a.vy += dy * force;
        b.vx -= dx * force;
        b.vy -= dy * force;
    }

    // Gentle pull toward the center + integrate.
    for (const node of nodes) {
        if (node.type === 'center') {
            node.x += (cx - node.x) * 0.08;
            node.y += (cy - node.y) * 0.08;
            node.vx = 0;
            node.vy = 0;
            continue;
        }

        if (node.dragged) {
            node.vx = 0;
            node.vy = 0;
            continue;
        }

        node.vx += (cx - node.x) * 0.0015 * alpha;
        node.vy += (cy - node.y) * 0.0015 * alpha;
        node.vx *= 0.85;
        node.vy *= 0.85;
        node.x += node.vx;
        node.y += node.vy;

        node.x = Math.max(16, Math.min(width.value - 16, node.x));
        node.y = Math.max(16, Math.min(height.value - 16, node.y));
    }

    alpha *= 0.985;
}

function startLoop(): void {
    cancelAnimationFrame(raf);

    const step = (): void => {
        tick();

        if (alpha > 0.02) {
            raf = requestAnimationFrame(step);
        }
    };

    raf = requestAnimationFrame(step);
}

/* ------------------------------ dragging ---------------------------- */

let dragNode: SimNode | null = null;
let dragMoved = false;

function svgPoint(event: PointerEvent): { x: number; y: number } {
    const rect = container.value?.getBoundingClientRect();

    return {
        x: event.clientX - (rect?.left ?? 0),
        y: event.clientY - (rect?.top ?? 0),
    };
}

function onNodeDown(node: SimNode, event: PointerEvent): void {
    dragNode = node;
    dragMoved = false;
    node.dragged = true;
    (event.target as Element).setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
    if (!dragNode) {
        return;
    }

    const point = svgPoint(event);
    dragNode.x = point.x;
    dragNode.y = point.y;
    dragMoved = true;
    alpha = Math.max(alpha, 0.3);
    startLoop();
}

function onPointerUp(node: SimNode): void {
    if (dragNode) {
        dragNode.dragged = false;
        dragNode = null;
    }

    if (!dragMoved) {
        if (node.type === 'tag') {
            emit('open-tag', node.ref);
        } else if (node.type === 'mention') {
            emit('open-mention', node.ref);
        } else if (node.type === 'note') {
            emit('open-note', node.ref);
        }
    }
}

/* ------------------------------ chrome ------------------------------ */

const NODE_RADIUS: Record<NodeType, number> = {
    center: 10,
    note: 7,
    tag: 5,
    mention: 5,
};

const NODE_CLASS: Record<NodeType, string> = {
    center: 'fill-[var(--token-link)]',
    note: 'fill-muted-foreground',
    tag: 'fill-[var(--token-tag)]',
    mention: 'fill-[var(--token-mention)]',
};

function trimLabel(label: string): string {
    return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}

watch([graph, width, height], seedSimulation, { deep: false });

onMounted(() => {
    if (container.value) {
        resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];

            if (entry) {
                width.value = Math.max(300, entry.contentRect.width);
                height.value = Math.max(300, entry.contentRect.height);
            }
        });
        resizeObserver.observe(container.value);
        width.value = Math.max(300, container.value.clientWidth);
        height.value = Math.max(300, container.value.clientHeight);
    }

    seedSimulation();
});

onBeforeUnmount(() => {
    cancelAnimationFrame(raf);
    resizeObserver?.disconnect();
});
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <header
            class="flex h-12 shrink-0 items-center gap-1.5 border-b border-border/60 bg-muted/30 px-4"
        >
            <Waypoints class="size-4 shrink-0 text-muted-foreground" />
            <h1 class="truncate text-base font-semibold">
                {{ noteLabel(noteId) }}
            </h1>

            <div class="ml-auto flex items-center gap-1">
                <div
                    class="flex items-center gap-0.5 rounded-md border border-border/70 px-1"
                >
                    <Button
                        variant="ghost"
                        size="icon"
                        class="size-6"
                        aria-label="Less depth"
                        :disabled="depth <= 1"
                        @click="depth--"
                    >
                        <Minus class="size-3.5" />
                    </Button>
                    <span
                        class="w-10 text-center text-xs text-muted-foreground"
                    >
                        {{ depth }} hop{{ depth === 1 ? '' : 's' }}
                    </span>
                    <Button
                        variant="ghost"
                        size="icon"
                        class="size-6"
                        aria-label="More depth"
                        :disabled="depth >= 4"
                        @click="depth++"
                    >
                        <Plus class="size-3.5" />
                    </Button>
                </div>

                <Button
                    :variant="showTags ? 'secondary' : 'ghost'"
                    size="sm"
                    class="h-7 gap-1 px-2 text-xs"
                    @click="showTags = !showTags"
                >
                    <Hash class="size-3.5" /> Tags
                </Button>
                <Button
                    :variant="showMentions ? 'secondary' : 'ghost'"
                    size="sm"
                    class="h-7 gap-1 px-2 text-xs"
                    @click="showMentions = !showMentions"
                >
                    <AtSign class="size-3.5" /> Mentions
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    class="ml-1 h-7 gap-1 px-2 text-xs text-muted-foreground"
                    title="Close split (Esc)"
                    @click="emit('close')"
                >
                    <X class="size-3.5" /> Close
                </Button>
            </div>
        </header>

        <div
            ref="container"
            class="min-h-0 flex-1 touch-none overflow-hidden select-none"
            @pointermove="onPointerMove"
        >
            <svg :width="width" :height="height" class="block">
                <line
                    v-for="edge in graph.edges"
                    :key="`${edge.source}|${edge.target}`"
                    :x1="nodeByKey.get(edge.source)?.x ?? 0"
                    :y1="nodeByKey.get(edge.source)?.y ?? 0"
                    :x2="nodeByKey.get(edge.target)?.x ?? 0"
                    :y2="nodeByKey.get(edge.target)?.y ?? 0"
                    class="stroke-border"
                    stroke-width="1"
                />

                <g
                    v-for="node in simNodes"
                    :key="node.key"
                    :transform="`translate(${node.x}, ${node.y})`"
                    class="cursor-pointer"
                    @pointerdown="(event) => onNodeDown(node, event)"
                    @pointerup="() => onPointerUp(node)"
                >
                    <circle
                        :r="NODE_RADIUS[node.type]"
                        :class="
                            cn(
                                NODE_CLASS[node.type],
                                node.type === 'center' &&
                                    'stroke-[var(--token-link)] stroke-2 [stroke-opacity:0.3]',
                            )
                        "
                    />
                    <text
                        :y="NODE_RADIUS[node.type] + 12"
                        text-anchor="middle"
                        :class="
                            cn(
                                'text-[10px]',
                                node.type === 'center'
                                    ? 'fill-foreground font-semibold'
                                    : 'fill-muted-foreground',
                            )
                        "
                    >
                        {{ trimLabel(node.label) }}
                    </text>
                </g>
            </svg>
        </div>
    </div>
</template>
