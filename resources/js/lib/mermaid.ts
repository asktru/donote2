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
