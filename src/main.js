import { Actor, log } from 'apify';
import { analyzeSentiment } from './sentiment.js';
import { extractShortcode } from './utils.js';

await Actor.init();

const input = await Actor.getInput();
const {
    postUrls = [],
    maxComments = 100,
    includeReplies = false,
    sentimentEngine = 'enhanced',
    language = 'en',
    minLikes = 0,
    proxyConfiguration = { useApifyProxy: true },
} = input;

if (!postUrls.length) {
    throw new Error('Please provide at least one Instagram post URL in the "postUrls" input field.');
}

log.info(`Starting Instagram Comment Sentiment Analyzer`);
log.info(`Posts to analyze: ${postUrls.length}`);
log.info(`Max comments per post: ${maxComments || 'All'}`);
log.info(`Sentiment engine: ${sentimentEngine}`);

// Set up proxy
const proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);

// Track event usage for pay-per-event billing
let totalCommentsAnalyzed = 0;

const dataset = await Actor.openDataset();

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-IG-App-ID': '936619743392459',
    'X-Requested-With': 'XMLHttpRequest',
};

// Process each post URL
for (const postUrl of postUrls) {
    try {
        const shortcode = extractShortcode(postUrl);
        if (!shortcode) {
            log.warning(`Could not extract shortcode from URL: ${postUrl}`);
            continue;
        }

        log.info(`Processing post: ${shortcode}`);

        const { postInfo, comments } = await scrapePostData(shortcode, proxyConfig);

        if (comments.length === 0) {
            log.warning(`No comments found for post: ${postUrl}`);
            continue;
        }

        // Analyze sentiment for each comment
        let analyzedCount = 0;
        for (const comment of comments) {
            if (maxComments > 0 && analyzedCount >= maxComments) break;
            if (comment.likes < minLikes) continue;

            const sentiment = analyzeSentiment(comment.text, sentimentEngine, language);

            const result = {
                postUrl,
                postShortcode: shortcode,
                postOwner: postInfo.owner,
                postCaption: postInfo.caption?.substring(0, 200) || '',
                postLikes: postInfo.likes,
                postCommentCount: postInfo.commentCount,
                commentId: comment.id,
                commentText: comment.text,
                commentAuthor: comment.author,
                commentLikes: comment.likes,
                commentTimestamp: comment.timestamp,
                isReply: comment.isReply || false,
                parentCommentId: comment.parentId || null,
                sentimentScore: sentiment.score,
                sentimentLabel: sentiment.label,
                sentimentComparative: sentiment.comparative,
                positiveWords: sentiment.positive,
                negativeWords: sentiment.negative,
                emotionTags: sentiment.emotions,
                language,
                analyzedAt: new Date().toISOString(),
            };

            await dataset.pushData(result);
            analyzedCount++;
            totalCommentsAnalyzed++;

            // Charge per event (per comment analyzed)
            await Actor.charge({ eventName: 'comment-analyzed', count: 1 });
        }

        log.info(`Post ${shortcode}: analyzed ${analyzedCount} comments`);

        const postSummary = generatePostSummary(shortcode, postUrl, postInfo, analyzedCount);
        await dataset.pushData(postSummary);

    } catch (error) {
        log.error(`Error processing ${postUrl}: ${error.message}`);
    }
}

log.info(`Finished! Total comments analyzed: ${totalCommentsAnalyzed}`);
await Actor.exit();

// ---- Scraping functions using got-scraping (built into Apify SDK) ----

async function fetchJSON(url, proxyConfig) {
    const proxyUrl = proxyConfig ? await proxyConfig.newUrl() : undefined;

    const { gotScraping } = await import('got-scraping');

    const response = await gotScraping({
        url,
        proxyUrl,
        headers: {
            ...HEADERS,
            'Accept': 'application/json',
        },
        responseType: 'json',
        timeout: { request: 30000 },
        retry: { limit: 3 },
    });

    return response.body;
}

async function fetchHTML(url, proxyConfig) {
    const proxyUrl = proxyConfig ? await proxyConfig.newUrl() : undefined;

    const { gotScraping } = await import('got-scraping');

    const response = await gotScraping({
        url,
        proxyUrl,
        headers: HEADERS,
        timeout: { request: 30000 },
        retry: { limit: 3 },
    });

    return response.body;
}

async function scrapePostData(shortcode, proxyConfig) {
    let postInfo = { owner: 'unknown', caption: '', likes: 0, commentCount: 0 };
    let comments = [];

    // Method 1: Try Instagram's public API (?__a=1&__d=dis)
    try {
        log.info(`Method 1: Trying public API for ${shortcode}`);
        const url = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
        const data = await fetchJSON(url, proxyConfig);

        const media = data?.graphql?.shortcode_media || data?.items?.[0];
        if (media) {
            postInfo = {
                owner: media.owner?.username || media.user?.username || 'unknown',
                caption: media.edge_media_to_caption?.edges?.[0]?.node?.text || media.caption?.text || '',
                likes: media.edge_media_preview_like?.count || media.like_count || 0,
                commentCount: media.edge_media_to_parent_comment?.count || media.comment_count || 0,
            };

            // Extract comments from the response
            const edges = media.edge_media_to_parent_comment?.edges || [];
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

                if (includeReplies && node.edge_threaded_comments?.edges) {
                    for (const reply of node.edge_threaded_comments.edges) {
                        const r = reply.node;
                        comments.push({
                            id: r.id,
                            text: r.text,
                            author: r.owner?.username || 'unknown',
                            likes: r.edge_liked_by?.count || 0,
                            timestamp: r.created_at ? new Date(r.created_at * 1000).toISOString() : null,
                            isReply: true,
                            parentId: node.id,
                        });
                    }
                }
            }
            log.info(`Method 1: Got ${comments.length} comments`);
        }
    } catch (e) {
        log.debug(`Method 1 failed: ${e.message}`);
    }

    // Method 2: Try v1 API comments endpoint
    if (comments.length === 0) {
        try {
            log.info(`Method 2: Trying v1 comments API for ${shortcode}`);
            // First get the media ID
            const infoUrl = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
            let mediaId = null;

            try {
                const infoData = await fetchJSON(infoUrl, proxyConfig);
                mediaId = infoData?.graphql?.shortcode_media?.id || infoData?.items?.[0]?.pk;
            } catch (e) {
                log.debug(`Could not get media ID: ${e.message}`);
            }

            if (mediaId) {
                const commentsUrl = `https://www.instagram.com/api/v1/media/${mediaId}/comments/?can_support_threading=true&min_id=&max_id=&sort_order=popular`;
                const data = await fetchJSON(commentsUrl, proxyConfig);

                const rawComments = data?.comments || [];
                for (const comment of rawComments) {
                    comments.push({
                        id: String(comment.pk || comment.id),
                        text: comment.text,
                        author: comment.user?.username || 'unknown',
                        likes: comment.comment_like_count || 0,
                        timestamp: comment.created_at ? new Date(comment.created_at * 1000).toISOString() : null,
                        isReply: false,
                    });

                    if (includeReplies && comment.preview_child_comments) {
                        for (const reply of comment.preview_child_comments) {
                            comments.push({
                                id: String(reply.pk || reply.id),
                                text: reply.text,
                                author: reply.user?.username || 'unknown',
                                likes: reply.comment_like_count || 0,
                                timestamp: reply.created_at ? new Date(reply.created_at * 1000).toISOString() : null,
                                isReply: true,
                                parentId: String(comment.pk || comment.id),
                            });
                        }
                    }
                }

                if (postInfo.owner === 'unknown') {
                    postInfo.commentCount = data?.comment_count || comments.length;
                }
                log.info(`Method 2: Got ${comments.length} comments`);
            }
        } catch (e) {
            log.debug(`Method 2 failed: ${e.message}`);
        }
    }

    // Method 3: Scrape from HTML page (embedded JSON)
    if (comments.length === 0) {
        try {
            log.info(`Method 3: Trying HTML page scrape for ${shortcode}`);
            const html = await fetchHTML(`https://www.instagram.com/p/${shortcode}/`, proxyConfig);

            // Try to find shared data in page
            const sharedDataMatch = html.match(/window\._sharedData\s*=\s*({.+?});\s*<\/script>/);
            if (sharedDataMatch) {
                const sharedData = JSON.parse(sharedDataMatch[1]);
                const media = sharedData?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media;

                if (media) {
                    postInfo = {
                        owner: media.owner?.username || 'unknown',
                        caption: media.edge_media_to_caption?.edges?.[0]?.node?.text || '',
                        likes: media.edge_media_preview_like?.count || 0,
                        commentCount: media.edge_media_to_parent_comment?.count || 0,
                    };

                    const edges = media.edge_media_to_parent_comment?.edges || [];
                    for (const edge of edges) {
                        comments.push({
                            id: edge.node.id,
                            text: edge.node.text,
                            author: edge.node.owner?.username || 'unknown',
                            likes: edge.node.edge_liked_by?.count || 0,
                            timestamp: edge.node.created_at ? new Date(edge.node.created_at * 1000).toISOString() : null,
                            isReply: false,
                        });
                    }
                }
            }

            // Try additional data script
            if (comments.length === 0) {
                const additionalMatch = html.match(/window\.__additionalDataLoaded\s*\(\s*['"][^'"]*['"]\s*,\s*({.+?})\s*\)\s*;/);
                if (additionalMatch) {
                    const addData = JSON.parse(additionalMatch[1]);
                    const media = addData?.graphql?.shortcode_media;

                    if (media) {
                        postInfo = {
                            owner: media.owner?.username || 'unknown',
                            caption: media.edge_media_to_caption?.edges?.[0]?.node?.text || '',
                            likes: media.edge_media_preview_like?.count || 0,
                            commentCount: media.edge_media_to_parent_comment?.count || 0,
                        };

                        const edges = media.edge_media_to_parent_comment?.edges || [];
                        for (const edge of edges) {
                            comments.push({
                                id: edge.node.id,
                                text: edge.node.text,
                                author: edge.node.owner?.username || 'unknown',
                                likes: edge.node.edge_liked_by?.count || 0,
                                timestamp: edge.node.created_at ? new Date(edge.node.created_at * 1000).toISOString() : null,
                                isReply: false,
                            });
                        }
                    }
                }
            }

            log.info(`Method 3: Got ${comments.length} comments`);
        } catch (e) {
            log.debug(`Method 3 failed: ${e.message}`);
        }
    }

    // Method 4: Try the embed page
    if (comments.length === 0) {
        try {
            log.info(`Method 4: Trying embed page for ${shortcode}`);
            const embedHtml = await fetchHTML(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, proxyConfig);

            // Extract data from embed
            const embedDataMatch = embedHtml.match(/window\.__additionalDataLoaded\s*\(\s*['"][^'"]*['"]\s*,\s*({.+?})\s*\)\s*;/);
            if (embedDataMatch) {
                const embedData = JSON.parse(embedDataMatch[1]);
                const media = embedData?.shortcode_media;

                if (media) {
                    postInfo = {
                        owner: media.owner?.username || 'unknown',
                        caption: media.edge_media_to_caption?.edges?.[0]?.node?.text || '',
                        likes: media.edge_media_preview_like?.count || 0,
                        commentCount: media.edge_media_to_parent_comment?.count || 0,
                    };

                    const edges = media.edge_media_to_parent_comment?.edges || [];
                    for (const edge of edges) {
                        comments.push({
                            id: edge.node.id,
                            text: edge.node.text,
                            author: edge.node.owner?.username || 'unknown',
                            likes: edge.node.edge_liked_by?.count || 0,
                            timestamp: edge.node.created_at ? new Date(edge.node.created_at * 1000).toISOString() : null,
                            isReply: false,
                        });
                    }
                }
            }

            // Also try extracting caption from embed HTML directly
            if (postInfo.owner === 'unknown') {
                const usernameMatch = embedHtml.match(/"username"\s*:\s*"([^"]+)"/);
                if (usernameMatch) postInfo.owner = usernameMatch[1];
            }

            log.info(`Method 4: Got ${comments.length} comments`);
        } catch (e) {
            log.debug(`Method 4 failed: ${e.message}`);
        }
    }

    return { postInfo, comments };
}

function generatePostSummary(shortcode, postUrl, postInfo, analyzedCount) {
    return {
        _type: 'POST_SUMMARY',
        postUrl,
        postShortcode: shortcode,
        postOwner: postInfo.owner,
        totalCommentsAnalyzed: analyzedCount,
        totalPostComments: postInfo.commentCount,
        postLikes: postInfo.likes,
        analyzedAt: new Date().toISOString(),
    };
}
