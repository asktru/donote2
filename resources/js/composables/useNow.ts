import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { Ref } from 'vue';

/**
 * A reactive clock that ticks on an interval — for UI that must react to the
 * passage of time (dimming past calendar events, relative timestamps). The
 * default one-minute cadence is fine for minute-granularity UI; the timer is
 * torn down with the component.
 */
export function useNow(intervalMs = 60000): Ref<Date> {
    const now = ref(new Date());
    let timer: ReturnType<typeof setInterval> | null = null;

    onMounted(() => {
        timer = setInterval(() => {
            now.value = new Date();
        }, intervalMs);
    });

    onBeforeUnmount(() => {
        if (timer !== null) {
            clearInterval(timer);
        }
    });

    return now;
}
