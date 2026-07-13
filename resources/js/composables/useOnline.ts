import { onBeforeUnmount, onMounted, ref } from 'vue';

/** A shared reactive flag tracking the browser's online/offline state. */
const online = ref(
    typeof navigator === 'undefined' ? true : navigator.onLine,
);

function setOnline(): void {
    online.value = true;
}

function setOffline(): void {
    online.value = false;
}

/** Reactive `navigator.onLine`, updated while the caller is mounted. */
export function useOnline(): typeof online {
    onMounted(() => {
        online.value = navigator.onLine;
        window.addEventListener('online', setOnline);
        window.addEventListener('offline', setOffline);
    });

    onBeforeUnmount(() => {
        window.removeEventListener('online', setOnline);
        window.removeEventListener('offline', setOffline);
    });

    return online;
}
