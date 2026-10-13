# Instagram Comment Sentiment Analyzer 💬📊

Automatically scrape comments from any public Instagram post and get **AI-powered sentiment analysis** for each comment. Perfect for brand monitoring, influencer analysis, campaign performance tracking, and social listening.

## What does it do?

This actor takes Instagram post URLs and:

1. **Scrapes all comments** (and optionally replies) from each post
2. **Analyzes sentiment** of every comment using NLP
3. **Detects emotions** (joy, anger, sadness, surprise, trust, etc.)
4. **Understands social media slang** — recognizes "fire 🔥", "slay", "mid", "cap" and 100+ Gen-Z/social media terms
5. **Outputs structured JSON** with scores, labels, and engagement metrics

No Instagram login required — works with public posts only.

## Why use this instead of a basic scraper?

| Feature | Basic Scrapers | This Actor |
|---------|---------------|------------|
| Scrape comments | ✅ | ✅ |
| Sentiment scores | ❌ | ✅ |
| Emotion detection | ❌ | ✅ |
| Social media slang | ❌ | ✅ |
| Emoji analysis | ❌ | ✅ |
| Post-level summaries | ❌ | ✅ |
| Pay-per-use pricing | ❌ | ✅ |

## Input

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `postUrls` | Array of strings | Instagram post URLs to analyze | Required |
| `maxComments` | Integer | Max comments per post (0 = all) | 100 |
| `includeReplies` | Boolean | Also analyze reply comments | false |
| `sentimentEngine` | String | `basic` (fast) or `enhanced` (deeper NLP) | enhanced |
| `language` | String | Comment language (ISO 639-1) | en |
| `minLikes` | Integer | Only analyze comments with ≥ this many likes | 0 |
| `proxyConfiguration` | Object | Proxy settings | Apify Proxy |

### Example Input

```json
{
    "postUrls": [
        "https://www.instagram.com/p/ABC123/",
        "https://www.instagram.com/reel/XYZ789/"
    ],
    "maxComments": 50,
    "includeReplies": true,
    "sentimentEngine": "enhanced",
    "language": "en"
}
```

## Output

Each comment produces a structured JSON object:

```json
{
    "postUrl": "https://www.instagram.com/p/ABC123/",
    "postShortcode": "ABC123",
    "postOwner": "brandname",
    "postCaption": "Check out our new product! 🚀",
    "postLikes": 15420,
    "postCommentCount": 342,
    "commentId": "17890012345678",
    "commentText": "This is absolutely amazing! Love it 😍🔥",
    "commentAuthor": "user123",
    "commentLikes": 45,
    "commentTimestamp": "2024-01-15T14:30:00.000Z",
    "isReply": false,
    "parentCommentId": null,
    "sentimentScore": 8.25,
    "sentimentLabel": "very_positive",
    "sentimentComparative": 1.178,
    "positiveWords": ["amazing", "love"],
    "negativeWords": [],
    "emotionTags": ["joy", "trust"],
    "language": "en",
    "analyzedAt": "2024-01-16T10:00:00.000Z"
}
```

### Sentiment Labels

| Label | Score Range | Meaning |
|-------|-----------|---------|
| `very_positive` | > 2 | Strong positive sentiment |
| `positive` | > 0 | Mild positive sentiment |
| `neutral` | 0 | No clear sentiment |
| `negative` | > -2 | Mild negative sentiment |
| `very_negative` | ≤ -2 | Strong negative sentiment |

### Emotion Tags

The analyzer detects these emotions: `joy`, `anger`, `sadness`, `surprise`, `fear`, `disgust`, `trust`, `anticipation`

## Use Cases

- **Brand Monitoring**: Track how people feel about your brand mentions
- **Campaign Analysis**: Measure sentiment before/after a campaign launch
- **Influencer Vetting**: Analyze the quality and tone of an influencer's audience
- **Competitor Research**: Compare sentiment across competitor posts
- **Crisis Detection**: Spot negative sentiment spikes early
- **Product Feedback**: Extract customer opinions from product posts
- **Content Strategy**: Identify what content types generate the most positive reactions

## Pricing

This actor uses **pay-per-event** pricing:

- **$0.01 per comment analyzed**
- Example: Analyzing 100 comments = $1.00
- You only pay for what you use — no monthly fees

## Tips for Best Results

1. **Use residential proxies** for best success rates with Instagram
2. **Start with smaller batches** (50-100 comments) to test before scaling
3. **Use `enhanced` engine** for social media content — it understands slang and emojis
4. **Filter by likes** (`minLikes`) to focus on the most engaged comments
5. **Monitor rate limits** — the actor includes built-in delays to avoid Instagram blocks

## Limitations

- Only works with **public** Instagram posts (no private accounts)
- Instagram may rate-limit requests — the actor handles this with automatic retries
- Very old posts may have limited comment availability
- Sentiment analysis works best for English; other languages have basic support

## Support

Having issues? Check these common solutions:

1. **No comments returned**: Verify the post URL is correct and the account is public
2. **Timeout errors**: Reduce `maxComments` or try again later
3. **Proxy errors**: Use Apify residential proxies for best results

Built by [Growwstacks](https://growwstacks.com) — AI automation experts.
