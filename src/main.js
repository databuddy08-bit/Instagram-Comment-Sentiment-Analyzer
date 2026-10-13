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
} = input;

if (!postUrls.length) {
    throw new Error('Please provide at least one Instagram post URL in the "postUrls" input field.');
}

log.info('Starting Instagram Comment Sentiment Analyzer');
log.info(`Posts to analyze: ${postUrls.length}`);
log.info(`Max comments per post: ${maxComments || 'All'}`);
log.info(`Sentiment engine: ${sentimentEngine}`);

const dataset = await Actor.openDataset();
let totalCommentsAnalyzed = 0;

// Import ApifyClient to read results from the scraper's dataset
const { ApifyClient } = await import('apify-client');
const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

for (const postUrl of postUrls) {
    try {
        const shortcode = extractShortcode(postUrl);
        if (!shortcode) {
            log.warning(`Could not extract shortcode from URL: ${postUrl}`);
            continue;
        }

        log.info(`Processing post: ${shortcode}`);

        // ---- Step 1: Get comments using a proven Instagram scraper ----
        // We call Apify's Instagram scraper actor which handles all the
        // authentication, proxy rotation, and anti-bot measures reliably.
        const scraperInput = {
            directUrls: [postUrl],
            resultsType: 'comments',
            resultsLimit: maxComments > 0 ? maxComments : 500,
            addParentData: true,
        };

        log.info(`Calling apify/instagram-scraper to fetch comments for ${shortcode}...`);

        let comments = [];

        try {
            const run = await Actor.call('apify/instagram-scraper', scraperInput, {
                memoryMbytes: 1024,
                timeoutSecs: 300,
            });

            if (run && run.status === 'SUCCEEDED') {
                const { items } = await client.dataset(run.defaultDatasetId).listItems();
                comments = items || [];
                log.info(`apify/instagram-scraper returned ${comments.length} comments`);
            } else {
                log.warning(`apify/instagram-scraper run status: ${run?.status || 'unknown'}`);
            }
        } catch (scraperError) {
            log.warning(`apify/instagram-scraper failed: ${scraperError.message}`);
            log.info('Trying fallback scraper: apify/instagram-comment-scraper...');

            try {
                const fallbackInput = {
                    directUrls: [postUrl],
                    resultsLimit: maxComments > 0 ? maxComments : 500,
                };
                const run2 = await Actor.call('apify/instagram-comment-scraper', fallbackInput, {
                    memoryMbytes: 512,
                    timeoutSecs: 300,
                });

                if (run2 && run2.status === 'SUCCEEDED') {
                    const { items } = await client.dataset(run2.defaultDatasetId).listItems();
                    comments = items || [];
                    log.info(`Fallback scraper returned ${comments.length} comments`);
                }
            } catch (fallbackError) {
                log.warning(`Fallback scraper also failed: ${fallbackError.message}`);
            }
        }

        if (comments.length === 0) {
            log.warning(`No comments retrieved for post: ${postUrl}. The post may have comments disabled or the scraper may need different configuration.`);
            continue;
        }

        // ---- Step 2: Run sentiment analysis on each comment ----
        log.info(`Analyzing sentiment for ${comments.length} comments...`);

        // Try to extract post info from the first comment's parent data
        const sampleComment = comments[0];
        const postOwner = sampleComment?.ownerUsername
            || sampleComment?.postOwnerUsername
            || sampleComment?.owner?.username
            || 'unknown';

        let analyzedCount = 0;
        for (const comment of comments) {
            if (maxComments > 0 && analyzedCount >= maxComments) break;

            // Get comment likes (handle different field names from different scrapers)
            const commentLikes = comment.likesCount
                ?? comment.likes
                ?? comment.commentLikesCount
                ?? comment.edge_liked_by?.count
                ?? 0;

            if (commentLikes < minLikes) continue;

            // Skip replies if not requested
            const isReply = comment.isReply || comment.parentCommentId != null || false;
            if (!includeReplies && isReply) continue;

            // Get comment text (handle different field names)
            const commentText = comment.text || comment.body || comment.comment || '';
            if (!commentText.trim()) continue;

            // Get comment author
            const commentAuthor = comment.ownerUsername
                || comment.username
                || comment.author
                || comment.owner?.username
                || 'unknown';

            // Run sentiment analysis
            const sentiment = analyzeSentiment(commentText, sentimentEngine, language);

            const result = {
                postUrl,
                postShortcode: shortcode,
                postOwner,
                commentId: comment.id || comment.pk || `comment_${analyzedCount}`,
                commentText,
                commentAuthor,
                commentLikes,
                commentTimestamp: comment.timestamp || comment.createdAt || comment.created_at || null,
                isReply,
                parentCommentId: comment.parentCommentId || null,
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

            // Charge per event (pay-per-event billing)
            await Actor.charge({ eventName: 'comment-analyzed', count: 1 });
        }

        log.info(`Post ${shortcode}: analyzed ${analyzedCount} out of ${comments.length} comments`);

        // Push a summary record for this post
        await dataset.pushData({
            _type: 'POST_SUMMARY',
            postUrl,
            postShortcode: shortcode,
            postOwner,
            totalCommentsAnalyzed: analyzedCount,
            totalScrapedComments: comments.length,
            analyzedAt: new Date().toISOString(),
        });

    } catch (error) {
        log.error(`Error processing ${postUrl}: ${error.message}`);
    }
}

log.info(`Finished! Total comments analyzed: ${totalCommentsAnalyzed}`);
await Actor.exit();
