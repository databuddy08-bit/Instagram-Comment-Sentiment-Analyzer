/**
 * Extract the shortcode from various Instagram URL formats
 * Supports: /p/CODE/, /reel/CODE/, /tv/CODE/
 */
export function extractShortcode(url) {
    if (!url) return null;

    // Clean URL
    url = url.trim();

    // Match various Instagram URL patterns
    const patterns = [
        /instagram\.com\/p\/([A-Za-z0-9_-]+)/,
        /instagram\.com\/reel\/([A-Za-z0-9_-]+)/,
        /instagram\.com\/tv\/([A-Za-z0-9_-]+)/,
        /instagr\.am\/p\/([A-Za-z0-9_-]+)/,
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }

    // If it's just a shortcode without URL
    if (/^[A-Za-z0-9_-]{6,}$/.test(url)) {
        return url;
    }

    return null;
}

/**
 * Build Instagram GraphQL query URL
 */
export function buildGraphQLUrl(queryHash, variables) {
    const params = new URLSearchParams({
        query_hash: queryHash,
        variables: JSON.stringify(variables),
    });
    return `https://www.instagram.com/graphql/query/?${params.toString()}`;
}

/**
 * Parse comments from Instagram API response
 */
export function parseCommentsFromResponse(data) {
    const comments = [];

    // Handle GraphQL response
    if (data?.data?.shortcode_media?.edge_media_to_parent_comment?.edges) {
        const edges = data.data.shortcode_media.edge_media_to_parent_comment.edges;
        for (const edge of edges) {
            const node = edge.node;
            comments.push({
                id: node.id,
                text: node.text,
                author: node.owner?.username || 'unknown',
                likes: node.edge_liked_by?.count || 0,
                timestamp: node.created_at ? new Date(node.created_at * 1000).toISOString() : null,
                isReply: false,
            });
        }
    }

    // Handle v1 API response
    if (data?.comments) {
        for (const comment of data.comments) {
            comments.push({
                id: comment.pk?.toString() || comment.id,
                text: comment.text,
                author: comment.user?.username || 'unknown',
                likes: comment.comment_like_count || 0,
                timestamp: comment.created_at ? new Date(comment.created_at * 1000).toISOString() : null,
                isReply: false,
            });
        }
    }

    return comments;
}

/**
 * Delay helper for rate limiting
 */
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sanitize text for safe storage
 */
export function sanitizeText(text) {
    if (!text) return '';
    return text
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars
        .trim()
        .substring(0, 5000); // Cap at 5000 chars
}
