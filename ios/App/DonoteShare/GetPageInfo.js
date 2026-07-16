/**
 * Safari preprocessing for the Donote share extension: grabs the page URL,
 * title, and meta description so a shared page becomes a well-titled note.
 * Results arrive in ShareViewController via the property-list item.
 */
var ExtensionPreprocessingJS = {
    run: function (args) {
        var meta = document.querySelector(
            'meta[name="description"], meta[property="og:description"]',
        );

        args.completionFunction({
            url: document.URL || '',
            title: document.title || '',
            description: (meta && meta.getAttribute('content')) || '',
        });
    },
};
