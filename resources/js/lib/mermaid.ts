import type { Mermaid } from 'mermaid';

/**
 * Mermaid is ~500 KB, so load it lazily and only once — shared by the editor's
 * inline diagram widget and the full-screen preview. `securityLevel: strict`
 * because diagrams come from untrusted note content.
 */
let mermaidLoader: Promise<Mermaid> | null = null;
let renderSeq = 0;

export function loadMermaid(): Promise<Mermaid> {
    if (mermaidLoader === null) {
        mermaidLoader = import('mermaid').then((module) => {
            const mermaid = module.default;
            mermaid.initialize({
                startOnLoad: false,
                securityLevel: 'strict',
                theme: document.documentElement.classList.contains('dark')
                    ? 'dark'
                    : 'default',
                fontFamily: 'inherit',
            });

            return mermaid;
        });
    }

    return mermaidLoader;
}

/** Render mermaid source to an SVG string (unique id per call). */
export async function renderMermaid(code: string): Promise<string> {
    const mermaid = await loadMermaid();
    const { svg } = await mermaid.render(
        `donote-mermaid-${(renderSeq += 1)}`,
        code,
    );

    return svg;
}

/** Resolve a CSS custom property to a concrete, canvas-safe color. */
function resolvedColor(cssValue: string, fallback: string): string {
    const probe = document.createElement('div');
    probe.style.cssText = `background:${cssValue};display:none`;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();

    return color || fallback;
}

/**
 * Rasterize a mermaid diagram to a PNG and trigger a download. Draws the
 * rendered SVG onto a canvas at 2×–4× for crisp output, on a solid background
 * matching the current theme so themed text stays readable. All client-side —
 * no server round-trip.
 */
export async function downloadMermaidPng(
    code: string,
    filename = 'diagram.png',
): Promise<void> {
    const svgText = await renderMermaid(code);
    const svg = new DOMParser().parseFromString(svgText, 'image/svg+xml')
        .documentElement as unknown as SVGSVGElement;

    const viewBox = (svg.getAttribute('viewBox') ?? '')
        .split(/[\s,]+/)
        .map(Number);
    const width =
        viewBox.length === 4 && viewBox[2]
            ? viewBox[2]
            : Number.parseFloat(svg.getAttribute('width') ?? '') || 800;
    const height =
        viewBox.length === 4 && viewBox[3]
            ? viewBox[3]
            : Number.parseFloat(svg.getAttribute('height') ?? '') || 600;

    // Pin an explicit pixel size and drop mermaid's max-width so the raster is
    // full resolution rather than clamped to the inline display width.
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.style.maxWidth = 'none';

    if (!svg.getAttribute('xmlns')) {
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }

    const serialized = new XMLSerializer().serializeToString(svg);
    const url =
        'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(serialized);

    const img = new Image();
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('could not rasterize diagram'));
        img.src = url;
    });

    const scale = Math.min(4, 2 * (window.devicePixelRatio || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const ctx = canvas.getContext('2d');

    if (ctx === null) {
        return;
    }

    ctx.fillStyle = resolvedColor('var(--background)', '#ffffff');
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    await new Promise<void>((resolve) => {
        canvas.toBlob((blob) => {
            if (blob !== null) {
                const anchor = document.createElement('a');
                anchor.href = URL.createObjectURL(blob);
                anchor.download = filename;
                anchor.click();
                setTimeout(() => URL.revokeObjectURL(anchor.href), 10000);
            }

            resolve();
        }, 'image/png');
    });
}
