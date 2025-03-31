// Import required modules
import express from 'express';
import winston from 'winston';
import { YoutubeTranscript } from 'youtube-transcript';
import { decode } from 'html-entities';

// Configure logging
const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()]
});

// Initialize Express app
const app = express();
const PORT = 3002;

// Middleware
app.use(express.json());

// Single API endpoint for transcripts
app.get('/api/transcript', async (req, res) => {
    const videoId = req.query.video_id || '';
    const language = req.query.language || 'en';

    // Validate video_id
    if (!videoId) {
        return res.status(400).json({ error: 'Please provide a valid YouTube video ID' });
    }

    try {
        let transcript;
        let transcriptLanguage = language;

        // Try to get transcript in requested language
        try {
            transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: language });
        } catch (error) {
            // If English was requested but not found, try Polish
            if (language === 'en') {
                try {
                    logger.info(`English transcript not found for ${videoId}, trying Polish...`);
                    transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'pl' });
                    transcriptLanguage = 'pl';
                } catch (plError) {
                    // Try any available language
                    try {
                        logger.info(`Trying any available language...`);
                        transcript = await YoutubeTranscript.fetchTranscript(videoId);
                        transcriptLanguage = 'auto-detected';
                    } catch (autoError) {
                        throw new Error('No transcript found for this video');
                    }
                }
            } else {
                // Try any available language
                try {
                    transcript = await YoutubeTranscript.fetchTranscript(videoId);
                    transcriptLanguage = 'auto-detected';
                } catch (anyError) {
                    throw new Error('No transcript found for this video');
                }
            }
        }

        // Convert transcript to a single text string
        const rawText = transcript.map(entry => entry.text).join(' ');
        const fullText = decode(decode(rawText));

        // Return the transcript as JSON
        return res.json({
            success: true,
            video_id: videoId,
            language: transcriptLanguage,
            transcript: fullText,
        });
    } catch (error) {
        logger.error(`Error fetching transcript: ${error.message}`);

        if (error.message.includes('unavailable')) {
            return res.status(404).json({ error: 'The video is unavailable' });
        } else if (error.message.includes('No transcript found')) {
            return res.status(404).json({ error: 'No transcript found for this video' });
        } else if (error.message.includes('disabled')) {
            return res.status(403).json({ error: 'Transcripts are disabled for this video' });
        } else {
            return res.status(500).json({ error: `An error occurred: ${error.message}` });
        }
    }
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
    logger.info(`YouTube Transcript API running on port ${PORT}`);
});

export default app;