<script setup lang="ts">
import { PanelLeft } from '@lucide/vue';

import { Button } from '@/components/ui/button';
import { mobileSidebarOpen } from '@/stores/ui';
</script>

<template>
    <Button
        variant="ghost"
        size="icon"
        class="app-region-no-drag -ml-1.5 size-7 shrink-0 md:hidden"
        aria-label="Open sidebar"
        @click="mobileSidebarOpen = true"
    >
        <PanelLeft class="size-4" />
    </Button>
</template>
