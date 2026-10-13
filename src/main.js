import { Actor, log } from 'apify';
import { CheerioCrawler, ProxyConfiguration } from 'crawlee';
import { analyzeSentiment } from './sentiment.js';
import { extractShortcode, buildGraphQLUrl, parseCommentsFromResponse } from './utils.js';

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
const proxy = await Actor.createProxyConfiguration(proxyConfiguration);

// Track event usage for pay-per-event billing
let totalCommentsAnalyzed = 0;

// Instagram GraphQL endpoint for comments
const INSTAGRAM_GRAPHQL_URL = 'https://www.instagram.com/graphql/query/';
const COMMENTS_QUERY_HASH = 'bc3296d1ce80a24b1b6e40b1e72903f5'; // Public comments query

const dataset = await Actor.openDataset();

// Process each post URL
for (const postUrl of postUrls) {
    try {
        const shortcode = extractShortcode(postUrl);
        if (!shortcode) {
            log.warning(`Could not extract shortcode from URL: ${postUrl}`);
            continue;
        }

        log.info(`Processing post: ${shortcode}`);

        // First, get post info and initial comments via the post page
        const postData = await scrapePostData(shortcode, proxy);

        if (!postData) {
            log.warning(`Could not fetch data for post: ${postUrl}`);
            continue;
        }

        const { postInfo, comments } = postData;

        // Analyze sentiment for each comment
        let analyzedCount = 0;
        for (const comment of comments) {
            if (maxComments > 0 && analyzedCount >= maxComments) break;
            if (comment.likes < minLikes) continue;

            const sentiment = analyzeSentiment(comment.text, sentimentEngine, language);

            const result = {
                // Post context
                postUrl,
                postShortcode: shortcode,
                postOwner: postInfo.owner,
                postCaption: postInfo.caption?.substring(0, 200) || '',
                postLikes: postInfo.likes,
                postCommentCount: postInfo.commentCount,

                // Comment data
                commentId: comment.id,
                commentText: comment.text,
                commentAuthor: comment.author,
                commentLikes: comment.likes,
                commentTimestamp: comment.timestamp,
                isReply: comment.isReply || false,
                parentCommentId: comment.parentId || null,

                // Sentiment analysis
                sentimentScore: sentiment.score,
                sentimentLabel: sentiment.label,
                sentimentComparative: sentiment.comparative,
                positiveWords: sentiment.positive,
                negativeWords: sentiment.negative,
                emotionTags: sentiment.emotions,

                // Metadata
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

        // Generate post-level summary
        const postSummary = generatePostSummary(shortcode, postUrl, postInfo, analyzedCount);
        await dataset.pushData(postSummary);

    } catch (error) {
        log.error(`Error processing ${postUrl}: ${error.message}`);
    }
}

log.info(`Finished! Total comments analyzed: ${totalCommentsAnalyzed}`);

await Actor.exit();

// ---- Core scraping functions ----

async function scrapePostData(shortcode, proxyConfig) {
    try {
        // Use Instagram's public embed endpoint + GraphQL for comments
        const postPageUrl = `https://www.instagram.com/p/${shortcode}/`;

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConfig,
            maxRequestRetries: 3,
            requestHandlerTimeoutSecs: 60,
            additionalMimeTypes: ['application/json'],
            prepareRequestFunction: ({ request }) => {
                request.headers = {
                    ...request.headers,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'X-IG-App-ID': '936619743392459',
                };
            },
        });

        let postInfo = null;
        let comments = [];

        // Method 1: Try the public API endpoint
        try {
            const apiUrl = `https://www.instagram.com/api/v1/media/${shortcode}/comments/?can_support_threading=true&min_id=&max_id=&sort_order=popular`;
            const response = await fetchWithProxy(apiUrl, proxyConfig);

            if (response) {
                comments = parseCommentsFromAPI(response);
                postInfo = await fetchPostInfo(shortcode, proxyConfig);
            }
        } catch (e) {
            log.debug(`API method failed, trying GraphQL: ${e.message}`);
        }

        // Method 2: Try GraphQL query
        if (comments.length === 0) {
            try {
                const mediaId = await getMediaId(shortcode, proxyConfig);
                if (mediaId) {
                    const graphqlComments = await fetchCommentsGraphQL(mediaId, proxyConfig);
                    comments = graphqlComments;

                    if (!postInfo) {
                        postInfo = await fetchPostInfo(shortcode, proxyConfig);
                    }
                }
            } catch (e) {
                log.debug(`GraphQL method failed: ${e.message}`);
            }
        }

        // Method 3: Scrape from the HTML page as fallback
        if (comments.length === 0) {
            try {
                const pageData = await scrapeFromPage(shortcode, proxyConfig);
                if (pageData) {
                    comments = pageData.comments;
                    postInfo = postInfo || pageData.postInfo;
                }
            } catch (e) {
                log.debug(`Page scrape method failed: ${e.message}`);
            }
        }

        if (!postInfo) {
            postInfo = {
                owner: 'unknown',
                caption: '',
                likes: 0,
                commentCount: comments.length,
            };
        }

        return { postInfo, comments };
    } catch (error) {
        log.error(`Failed to scrape post ${shortcode}: ${error.message}`);
        return null;
    }
}

async function fetchWithProxy(url, proxyConfig) {
    const proxyUrl = proxyConfig ? await proxyConfig.newUrl() : null;
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-IG-App-ID': '936619743392459',
        'Accept': 'application/json',
    };

    const fetchOptions = { headers };
    if (proxyUrl) {
        // Crawlee handles proxy configuration internally
    }

    const response = await fetch(url, fetchOptions);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function getMediaId(shortcode, proxyConfig) {
    try {
        const url = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
        const data = await fetchWithProxy(url, proxyConfig);
        return data?.graphql?.shortcode_media?.id || data?.items?.[0]?.pk;
    } catch (e) {
        log.debug(`Could not get media ID: ${e.message}`);
        return null;
    }
}

async function fetchCommentsGraphQL(mediaId, proxyConfig, cursor = null) {
    const comments = [];
    let hasNext = true;
    let afterCursor = cursor;
    let fetched = 0;

    while (hasNext && (maxComments === 0 || fetched < maxComments)) {
        const variables = {
            media_id: mediaId,
            first: 50,
            ...(afterCursor ? { after: afterCursor } : {}),
        };

        const url = `${INSTAGRAM_GRAPHQL_URL}?query_hash=${COMMENTS_QUERY_HASH}&variables=${encodeURIComponent(JSON.stringify(variables))}`;

        try {
            const data = await fetchWithProxy(url, proxyConfig);
            const edges = data?.data?.shortcode_media?.edge_media_to_parent_comment?.edges || [];

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
                fetched++;

                // Include replies if requested
                if (includeReplies && node.edge_threaded_comments?.edges) {
                    for (const reply of node.edge_threaded_comments.edges) {
                        const replyNode = reply.node;
                        comments.push({
                            id: replyNode.id,
                            text: replyNode.text,
                            author: replyNode.owner?.username || 'unknown',
                            likes: replyNode.edge_liked_by?.count || 0,
                            timestamp: replyNode.created_at ? new Date(replyNode.created_at * 1000).toISOString() : null,
                            isReply: true,
                            parentId: node.id,
                        });
                        fetched++;
                    }
                }
            }

            const pageInfo = data?.data?.shortcode_media?.edge_media_to_parent_comment?.page_info;
            hasNext = pageInfo?.has_next_page || false;
            afterCursor = pageInfo?.end_cursor || null;

            // Rate limiting
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
        } catch (e) {
            log.warning(`GraphQL pagination error: ${e.message}`);
            hasNext = false;
        }
    }

    return comments;
}

async function fetchPostInfo(shortcode, proxyConfig) {
    try {
        const url = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
        const data = await fetchWithProxy(url, proxyConfig);
        const media = data?.graphql?.shortcode_media || data?.items?.[0];

        return {
            owner: media?.owner?.username || media?.user?.username || 'unknown',
            caption: media?.edge_media_to_caption?.edges?.[0]?.node?.text || media?.caption?.text || '',
            likes: media?.edge_media_preview_like?.count || media?.like_count || 0,
            commentCount: media?.edge_media_to_parent_comment?.count || media?.comment_count || 0,
        };
    } catch (e) {
        return null;
    }
}

function parseCommentsFromAPI(data) {
    const comments = [];
    const rawComments = data?.comments || [];

    for (const comment of rawComments) {
        comments.push({
            id: comment.pk || comment.id,
            text: comment.text,
            author: comment.user?.username || 'unknown',
            likes: comment.comment_like_count || 0,
            timestamp: comment.created_at ? new Date(comment.created_at * 1000).toISOString() : null,
            isReply: false,
        });

        // Include replies
        if (includeReplies && comment.preview_child_comments) {
            for (const reply of comment.preview_child_comments) {
                comments.push({
                    id: reply.pk || reply.id,
                    text: reply.text,
                    author: reply.user?.username || 'unknown',
                    likes: reply.comment_like_count || 0,
                    timestamp: reply.created_at ? new Date(reply.created_at * 1000).toISOString() : null,
                    isReply: true,
                    parentId: comment.pk || comment.id,
                });
            }
        }
    }

    return comments;
}

async function scrapeFromPage(shortcode, proxyConfig) {
    return new Promise((resolve) => {
        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConfig,
            maxRequestRetries: 2,
            async requestHandler({ $, request }) {
                // Extract JSON-LD or shared data from the page
                const scripts = $('script[type="application/ld+json"]').toArray();
                let pageData = null;

                for (const script of scripts) {
                    try {
                        const json = JSON.parse($(script).html());
                        if (json.comment || json.commentCount) {
                            pageData = json;
                            break;
                        }
                    } catch (e) { /* skip */ }
                }

                // Try to extract from window._sharedData
                const sharedDataScript = $('script').toArray().find(s =>
                    $(s).html()?.includes('window._sharedData')
                );

                if (sharedDataScript) {
                    try {
                        const scriptContent = $(sharedDataScript).html();
                        const jsonStr = scriptContent.match(/window\._sharedData\s*=\s*({.+?});/)?.[1];
                        if (jsonStr) {
                            const sharedData = JSON.parse(jsonStr);
                            const media = sharedData?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media;

                            if (media) {
                                const comments = (media.edge_media_to_parent_comment?.edges || []).map(e => ({
                                    id: e.node.id,
                                    text: e.node.text,
                                    author: e.node.owner?.username || 'unknown',
                                    likes: e.node.edge_liked_by?.count || 0,
                                    timestamp: e.node.created_at ? new Date(e.node.created_at * 1000).toISOString() : null,
                                    isReply: false,
                                }));

                                resolve({
                                    postInfo: {
                                        owner: media.owner?.username || 'unknown',
                                        caption: media.edge_media_to_caption?.edges?.[0]?.node?.text || '',
                                        likes: media.edge_media_preview_like?.count || 0,
                                        commentCount: media.edge_media_to_parent_comment?.count || 0,
                                    },
                                    comments,
                                });
                                return;
                            }
                        }
                    } catch (e) { /* skip */ }
                }

                // Use JSON-LD data
                if (pageData?.comment) {
                    const comments = (Array.isArray(pageData.comment) ? pageData.comment : [pageData.comment]).map((c, i) => ({
                        id: `jsonld_${i}`,
                        text: c.text || '',
                        author: c.author?.name || 'unknown',
                        likes: 0,
                        timestamp: c.dateCreated || null,
                        isReply: false,
                    }));

                    resolve({
                        postInfo: {
                            owner: pageData.author?.name || 'unknown',
                            caption: pageData.articleBody || pageData.caption || '',
                            likes: pageData.interactionStatistic?.userInteractionCount || 0,
                            commentCount: pageData.commentCount || comments.length,
                        },
                        comments,
                    });
                    return;
                }

                resolve(null);
            },
            failedRequestHandler({ request }) {
                log.warning(`Failed to scrape page: ${request.url}`);
                resolve(null);
            },
        });

        crawler.run([`https://www.instagram.com/p/${shortcode}/`]);
    });
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
