zeeschuimer.register_module(
    'Instagram (comments)',
    'instagram.com',
    function (response, source_platform_url, source_url) {
        let domain = source_platform_url.split("/")[2].toLowerCase().replace(/^www\./, '');

        if (!["instagram.com"].includes(domain)) {
            return [];
        }

        let data;
        try {
            data = JSON.parse(response);
        } catch (SyntaxError) {
            return [];
        }

        let comments = [];

        // Shared normaliser: validates and decorates a raw comment/reply object.
        // is_reply: true if this is a child comment (reply), false for top-level.
        // parent_pk: pk of the parent comment, for replies only.
        function normalise(item, is_reply, parent_pk) {
            if (typeof item !== 'object' || item === null) return null;
            if (!('pk' in item) || !('text' in item)) return null;
            return Object.assign({}, item, {
                id: item['pk'],
                _zs_is_reply: is_reply,
                _zs_parent_comment_id: is_reply ? (parent_pk || item['parent_comment_id'] || null) : null,
                _zs_media_id: item['media_id'] || data['media_id'] || null,
            });
        }

        // --- Path 1: REST API top-level comments ---
        // Endpoint: /api/v1/media/{id}/comments/
        // Response: { "comments": [ { pk, text, user, preview_child_comments, ... }, ... ] }
        if ('comments' in data && Array.isArray(data['comments'])) {
            for (const item of data['comments']) {
                const comment = normalise(item, false, null);
                if (comment) {
                    comments.push(Object.assign(comment, { _zs_source: 'rest' }));

                    // Extract preview replies embedded in the parent comment.
                    // These are a small subset (usually 2-3) loaded before "View replies" is clicked.
                    if (Array.isArray(item['preview_child_comments'])) {
                        for (const reply of item['preview_child_comments']) {
                            const r = normalise(reply, true, item['pk']);
                            if (r) comments.push(Object.assign(r, { _zs_source: 'rest_preview' }));
                        }
                    }
                }
            }
        }

        // --- Path 2: REST API replies ---
        // Endpoint: /api/v1/media/{id}/comments/{comment_id}/child_comments/
        // Fires when the user clicks "View replies" under a comment.
        // Response: { "child_comments": [ { pk, text, user, parent_comment_id, ... }, ... ] }
        if ('child_comments' in data && Array.isArray(data['child_comments'])) {
            for (const item of data['child_comments']) {
                // parent_comment_id is included on each reply item itself
                const reply = normalise(item, true, null);
                if (reply) comments.push(Object.assign(reply, { _zs_source: 'rest_reply' }));
            }
        }

        // --- Path 3: GraphQL comments (and their embedded preview replies) ---
        // Property: xdt_api__v1__media__comments__connection
        // Same edges/node structure as the post GraphQL responses.
        function extractGraphQLComments(obj) {
            if (typeof obj !== 'object' || obj === null) return;
            for (let property in obj) {
                if (!obj.hasOwnProperty(property)) continue;
                if (property === 'xdt_api__v1__media__comments__connection') {
                    const edges = obj[property]['edges'] || [];
                    for (const edge of edges) {
                        if (!edge || !('node' in edge)) continue;
                        const node = edge['node'];
                        const comment = normalise(node, false, null);
                        if (!comment) continue;
                        comments.push(Object.assign(comment, { _zs_source: 'graphql' }));

                        // preview replies can also appear in GraphQL comment nodes
                        if (Array.isArray(node['preview_child_comments'])) {
                            for (const reply of node['preview_child_comments']) {
                                const r = normalise(reply, true, node['pk']);
                                if (r) comments.push(Object.assign(r, { _zs_source: 'graphql_preview' }));
                            }
                        }
                    }
                } else if (typeof obj[property] === 'object') {
                    extractGraphQLComments(obj[property]);
                }
            }
        }
        extractGraphQLComments(data);

        return comments;
    },
    'instagram-comments'
);
