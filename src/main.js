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

log.info('=== Instagram Comment Sentiment Analyzer ===');
log.info(`Posts to analyze: ${postUrls.length}`);
log.info(`Max comments per post: ${maxComments || 'All'}`);
log.info(`Sentiment engine: ${sentimentEngine}`);
log.info(`Include replies: ${includeReplies}`);

const dataset = await Actor.openDataset();
let totalCommentsAnalyzed = 0;

for (const postUrl of postUrls) {
    const shortcode = extractShortcode(postUrl);
    if (!shortcode) {
        log.warning(`Could not extract shortcode from URL: ${postUrl}`);
        continue;
    }

    log.info(`\n--- Processing post: ${shortcode} ---`);

    // Step 1: Fetch comments using Apify's official Instagram Comment Scraper
    let comments = [];

    try {
        const scraperInput = {
            directUrls: [postUrl],
            resultsLimit: maxComments > 0 ? maxComments : 500,
            includeNestedComments: includeReplies,
        };

        log.info(`Calling apify/instagram-comment-scraper with input: ${JSON.stringify(scraperInput)}`);

        const run = await Actor.call('apify/instagram-comment-scraper', scraperInput);

        log.info(`Scraper run finished. Status: ${run.status}, Dataset ID: ${run.defaultDatasetId}`);

        if (run.status !== 'SUCCEEDED') {
            log.error(`Scraper run did not succeed. Status: ${run.status}`);
            continue;
        }

        // Fetch results using Apify REST API via got-scraping (built into SDK)
        const { gotScraping } = await import('got-scraping');
        const token = process.env.APIFY_TOKEN;

        const datasetUrl = `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${token}`;
        log.info(`Fetching results from dataset...`);

        const response = await gotScraping({
            url: datasetUrl,
            responseType: 'json',
            timeout: { request: 30000 },
        });

        comments = response.body || [];
        log.info(`Fetched ${comments.length} comments from scraper dataset`);

    } catch (error) {
        log.error(`Failed to fetch comments for ${postUrl}: ${error.message}`);
        log.error(`Error details: ${error.stack || 'No stack trace'}`);
        continue;
    }

    if (comments.length === 0) {
        log.warning(`No comments found for post: ${postUrl}`);
        continue;
    }

    // Step 2: Run sentiment analysis on each comment
    log.info(`Running sentiment analysis on ${comments.length} comments...`);

    let analyzedCount = 0;

    for (const comment of comments) {
        if (maxComments > 0 && analyzedCount >= maxComments) break;

        // Map fields from apify/instagram-comment-scraper output
        const commentText = comment.text || '';
        const commentLikes = comment.likesCount ?? 0;
        const commentAuthor = comment.ownerUsername || 'unknown';
        const commentTimestamp = comment.timestamp || null;
        const commentId = comment.id || `comment_${analyzedCount}`;

        // Apply filters
        if (commentLikes < minLikes) continue;
        if (!commentText.trim()) continue;

        // Analyze sentiment
        const sentiment = analyzeSentiment(commentText, sentimentEngine, language);

        const result = {
            postUrl,
            postShortcode: shortcode,
            commentId,
            commentText,
            commentAuthor,
            commentLikes,
            commentTimestamp,
            isReply: false,
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

        // Also process replies if they exist in the comment object
        if (includeReplies && comment.replies && Array.isArray(comment.replies)) {
            for (const reply of comment.replies) {
                if (maxComments > 0 && analyzedCount >= maxComments) break;

                const replyText = reply.text || '';
                const replyLikes = reply.likesCount ?? 0;
                if (replyLikes < minLikes || !replyText.trim()) continue;

                const replySentiment = analyzeSentiment(replyText, sentimentEngine, language);

                await dataset.pushData({
                    postUrl,
                    postShortcode: shortcode,
                    commentId: reply.id || `reply_${analyzedCount}`,
                    commentText: replyText,
                    commentAuthor: reply.ownerUsername || 'unknown',
                    commentLikes: replyLikes,
                    commentTimestamp: reply.timestamp || null,
                    isReply: true,
                    parentCommentId: commentId,
                    sentimentScore: replySentiment.score,
                    sentimentLabel: replySentiment.label,
                    sentimentComparative: replySentiment.comparative,
                    positiveWords: replySentiment.positive,
                    negativeWords: replySentiment.negative,
                    emotionTags: replySentiment.emotions,
                    language,
                    analyzedAt: new Date().toISOString(),
                });

                analyzedCount++;
                totalCommentsAnalyzed++;
                await Actor.charge({ eventName: 'comment-analyzed', count: 1 });
            }
        }
    }

    log.info(`Post ${shortcode}: analyzed ${analyzedCount} comments`);

    // Push post summary
    await dataset.pushData({
        _type: 'POST_SUMMARY',
        postUrl,
        postShortcode: shortcode,
        totalCommentsAnalyzed: analyzedCount,
        totalScrapedComments: comments.length,
        analyzedAt: new Date().toISOString(),
    });
}

log.info(`\n=== Finished! Total comments analyzed: ${totalCommentsAnalyzed} ===`);
await Actor.exit();
