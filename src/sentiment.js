import Sentiment from 'sentiment';
import natural from 'natural';

const sentimentAnalyzer = new Sentiment();

// Emotion keyword mappings for enhanced analysis
const EMOTION_KEYWORDS = {
    joy: ['love', 'amazing', 'wonderful', 'fantastic', 'beautiful', 'awesome', 'happy', 'great', 'perfect', 'best', 'excellent', 'brilliant', 'gorgeous', 'stunning', 'incredible', 'blessed', 'grateful', 'thankful', 'excited', 'yay', '❤️', '😍', '🥰', '😊', '🔥', '💯', '👏', '✨', '💕'],
    anger: ['hate', 'terrible', 'awful', 'worst', 'disgusting', 'pathetic', 'trash', 'garbage', 'stupid', 'idiot', 'scam', 'fraud', 'angry', 'furious', 'rage', '😡', '🤬', '💢'],
    sadness: ['sad', 'crying', 'miss', 'sorry', 'unfortunately', 'disappointed', 'heartbreaking', 'depressing', 'painful', 'lonely', 'lost', '😢', '😭', '💔'],
    surprise: ['wow', 'omg', 'what', 'shocked', 'unbelievable', 'insane', 'crazy', 'unexpected', 'speechless', 'mind-blowing', '😱', '🤯', '😮', '😲'],
    fear: ['scary', 'worried', 'afraid', 'terrifying', 'creepy', 'nervous', 'anxious', 'frightening', '😨', '😰'],
    disgust: ['gross', 'yuck', 'eww', 'nasty', 'cringe', 'cringy', 'revolting', '🤢', '🤮'],
    trust: ['reliable', 'honest', 'genuine', 'authentic', 'real', 'trustworthy', 'legit', 'recommend', 'worth', '👍', '🙏'],
    anticipation: ['can\'t wait', 'excited', 'looking forward', 'soon', 'when', 'coming', 'drop', 'release', 'launch', '🙌', '🤞'],
};

// Social media slang sentiment overrides
const SOCIAL_MEDIA_EXTRA = {
    'fire': 3,
    'lit': 3,
    'goat': 4,
    'slay': 3,
    'slaying': 3,
    'bussin': 3,
    'valid': 2,
    'vibe': 2,
    'vibes': 2,
    'iconic': 3,
    'queen': 2,
    'king': 2,
    'goals': 3,
    'cap': -2,
    'nocap': 2,
    'sus': -2,
    'mid': -1,
    'basic': -1,
    'ratio': -2,
    'L': -2,
    'W': 3,
    'W!': 3,
    'based': 2,
    'cringe': -3,
    'ick': -2,
    'periodt': 2,
    'snatched': 3,
    'ate': 3,
    'served': 3,
    'understood': 2,
    'assignment': 2,
    'chef\'s kiss': 4,
    'no cap': 3,
    'bet': 1,
    'dead': 2, // "I'm dead" = funny
    'dying': 2, // "I'm dying" = funny
    'bruh': -1,
    'fr': 1,
    'ngl': 1,
    'ong': 1,
    'tbh': 0,
    'idk': 0,
    'smh': -2,
    'fml': -3,
    'oof': -1,
    'yikes': -2,
};

/**
 * Analyze sentiment of a comment text
 * @param {string} text - Comment text to analyze
 * @param {string} engine - 'basic' or 'enhanced'
 * @param {string} language - Language code
 * @returns {object} Sentiment analysis result
 */
export function analyzeSentiment(text, engine = 'enhanced', language = 'en') {
    if (!text || text.trim().length === 0) {
        return {
            score: 0,
            comparative: 0,
            label: 'neutral',
            positive: [],
            negative: [],
            emotions: [],
        };
    }

    if (engine === 'basic') {
        return basicAnalysis(text);
    }

    return enhancedAnalysis(text, language);
}

function basicAnalysis(text) {
    const result = sentimentAnalyzer.analyze(text, { extras: SOCIAL_MEDIA_EXTRA });

    return {
        score: result.score,
        comparative: Math.round(result.comparative * 1000) / 1000,
        label: getLabel(result.score),
        positive: result.positive || [],
        negative: result.negative || [],
        emotions: detectEmotions(text),
    };
}

function enhancedAnalysis(text, language) {
    // Base sentiment from Sentiment library with social media extras
    const baseResult = sentimentAnalyzer.analyze(text, { extras: SOCIAL_MEDIA_EXTRA });

    // Natural NLP tokenization
    const tokenizer = new natural.WordTokenizer();
    const tokens = tokenizer.tokenize(text.toLowerCase());

    // Emoji sentiment boost
    const emojiScore = analyzeEmojis(text);

    // Detect emphasis (caps, exclamation marks, repeated letters)
    const emphasisMultiplier = detectEmphasis(text);

    // Combined score
    let finalScore = (baseResult.score + emojiScore) * emphasisMultiplier;
    finalScore = Math.round(finalScore * 100) / 100;

    const comparative = tokens.length > 0
        ? Math.round((finalScore / tokens.length) * 1000) / 1000
        : 0;

    return {
        score: finalScore,
        comparative,
        label: getLabel(finalScore),
        positive: baseResult.positive || [],
        negative: baseResult.negative || [],
        emotions: detectEmotions(text),
    };
}

function getLabel(score) {
    if (score > 2) return 'very_positive';
    if (score > 0) return 'positive';
    if (score === 0) return 'neutral';
    if (score > -2) return 'negative';
    return 'very_negative';
}

function detectEmotions(text) {
    const lowerText = text.toLowerCase();
    const detected = [];

    for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
        for (const keyword of keywords) {
            if (lowerText.includes(keyword.toLowerCase())) {
                if (!detected.includes(emotion)) {
                    detected.push(emotion);
                }
                break;
            }
        }
    }

    return detected;
}

function analyzeEmojis(text) {
    const positiveEmojis = ['❤️', '😍', '🥰', '😊', '🔥', '💯', '👏', '✨', '💕', '😘', '🙏', '👍', '🎉', '💪', '😂', '🤣', '💖', '💗', '♥️', '🌟', '⭐', '👑', '🙌', '💫'];
    const negativeEmojis = ['😡', '🤬', '💢', '😢', '😭', '💔', '😱', '🤢', '🤮', '😨', '😰', '👎', '😤', '🖕', '😠', '😒', '🙄'];

    let score = 0;
    for (const emoji of positiveEmojis) {
        const count = (text.match(new RegExp(emoji, 'g')) || []).length;
        score += count * 1;
    }
    for (const emoji of negativeEmojis) {
        const count = (text.match(new RegExp(emoji, 'g')) || []).length;
        score -= count * 1;
    }
    return score;
}

function detectEmphasis(text) {
    let multiplier = 1;

    // ALL CAPS words boost
    const capsWords = text.match(/\b[A-Z]{2,}\b/g);
    if (capsWords && capsWords.length > 0) {
        multiplier += 0.1 * Math.min(capsWords.length, 3);
    }

    // Exclamation marks boost
    const exclamations = (text.match(/!/g) || []).length;
    if (exclamations > 0) {
        multiplier += 0.05 * Math.min(exclamations, 5);
    }

    // Repeated letters (e.g., "amaziiing", "sooo")
    const repeats = text.match(/(.)\1{2,}/g);
    if (repeats && repeats.length > 0) {
        multiplier += 0.1 * Math.min(repeats.length, 3);
    }

    return Math.min(multiplier, 1.5); // Cap at 1.5x
}
