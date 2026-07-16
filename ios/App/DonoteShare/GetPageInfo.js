/**
 * Safari preprocessing for the Donote share extension: grabs the page URL,
 * title, meta description, and readable text (for the AI summary the app
 * generates while ingesting). Results arrive in ShareViewController via the
 * property-list item.
 */
var ExtensionPreprocessingJS = {
    run: function (args) {
        var meta = document.querySelector(
            'meta[name="description"], meta[property="og:description"]',
        );
        var text = '';

        try {
            text = (document.body && document.body.innerText) || '';
        } catch (e) {
            // Cross-origin frame or exotic page — summary is optional.
        }

        args.completionFunction({
            url: document.URL || '',
            title: document.title || '',
            description: (meta && meta.getAttribute('content')) || '',
            pageText: text.replace(/\s+/g, ' ').slice(0, 15000),
        });
    },
};
