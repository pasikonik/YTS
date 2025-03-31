// Import required modules
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { YoutubeTranscript } from 'youtube-transcript';
import winston from 'winston';

// Configure logging
const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ level, message, timestamp }) => {
            return `${timestamp} ${level}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console()
    ]
});

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3002;

// Set up __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// Configure view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session secret from environment variables
const SESSION_SECRET = process.env.SESSION_SECRET || 'default_secret_key';

// Routes
app.get('/', (req, res) => {
    res.render('index');
});

app.get('/api/docs', (req, res) => {
    res.render('api_docs');
});

// Helper function to fetch transcript
async function fetchTranscript(videoId, language = 'en') {
    try {
        // Try to get transcript in requested language
        const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: language });
        return { transcript, language };
    } catch (error) {
        // If English was requested but not found, try Polish
        if (language === 'en') {
            try {
                logger.info(`English transcript not found for ${videoId}, trying Polish...`);
                const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'pl' });
                return { transcript, language: 'pl' };
            } catch (plError) {
                // Try any available language
                try {
                    logger.info(`Polish transcript not found for ${videoId}, trying any available language...`);
                    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
                    const detectedLang = transcript && transcript.length > 0 ? 'auto-detected' : 'unknown';
                    return { transcript, language: detectedLang };
                } catch (autoError) {
                    throw new Error('No transcript found for this video');
                }
            }
        } else {
            // If the requested language is not English and not found, try any available language
            try {
                const transcript = await YoutubeTranscript.fetchTranscript(videoId);
                const detectedLang = transcript && transcript.length > 0 ? 'auto-detected' : 'unknown';
                return { transcript, language: detectedLang };
            } catch (anyError) {
                throw new Error('No transcript found for this video');
            }
        }
    }
}

app.post('/get_transcript', async (req, res) => {
    const videoId = req.body.video_id || '';
    const language = req.body.language || 'en';

    // Validate video_id
    if (!videoId) {
        return res.status(400).json({ error: 'Please provide a valid YouTube video ID' });
    }

    try {
        const { transcript, language: transcriptLanguage } = await fetchTranscript(videoId, language);

        // Format the transcript text with timestamps
        let formattedTranscript = '';
        for (const entry of transcript) {
            const minutes = Math.floor(entry.offset / 60000);
            const seconds = Math.floor((entry.offset % 60000) / 1000);
            const timestamp = `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}] `;

            formattedTranscript += `${timestamp}${entry.text}\n`;
        }

        // Also get the full text without timestamps
        const fullText = transcript.map(entry => entry.text).join(' ');

        return res.json({
            success: true,
            language: transcriptLanguage,
            transcript: formattedTranscript,
            full_text: fullText,
            raw_transcript: transcript
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

app.all('/api/transcript', async (req, res) => {
    /**
     * JSON API endpoint to fetch YouTube video transcript in pure JSON format.
     * 
     * This endpoint supports both GET and POST methods:
     * - GET: Use query parameter ?video_id=YOUR_VIDEO_ID&format=raw|full_text
     * - POST: Send JSON body with {"video_id": "YOUR_VIDEO_ID", "format": "raw|full_text"}
     * 
     * Parameters:
     *   - video_id: The YouTube video ID
     *   - format (optional): 
     *     - "raw" (default): Returns array of transcript entries with text, start time, and duration
     *     - "full_text": Returns the complete transcript as a single text string without timestamps
     *   - language (optional): 
     *     - Preferred language for transcript (default: 'en' for English)
     *     - If 'en' isn't available, 'pl' (Polish) will be tried automatically
     * 
     * Returns:
     *   JSON object with:
     *   - success: boolean indicating success
     *   - video_id: the requested video ID
     *   - transcript: array of transcript entries or single text string (depending on format)
     *   - language: language code of the returned transcript ('en', 'pl', etc.)
     */

    let videoId = '';
    let formatType = 'raw';  // Default format
    let language = 'en';     // Default language

    // Handle GET request
    if (req.method === 'GET') {
        videoId = req.query.video_id || '';
        formatType = req.query.format || 'raw';
        language = req.query.language || 'en';
    }
    // Handle POST request
    else if (req.method === 'POST') {
        // Check if request contains JSON
        if (!req.is('application/json')) {
            return res.status(400).json({ error: 'Request must be JSON' });
        }

        videoId = req.body.video_id || '';
        formatType = req.body.format || 'raw';
        language = req.body.language || 'en';
    }

    // Validate video_id
    if (!videoId) {
        return res.status(400).json({ error: 'Please provide a valid YouTube video ID' });
    }

    try {
        const { transcript, language: transcriptLanguage } = await fetchTranscript(videoId, language);

        // Process transcript based on requested format
        if (formatType === 'full_text') {
            // Combine all transcript segments into a single text string
            const fullText = transcript.map(entry => entry.text).join(' ');

            return res.json({
                success: true,
                video_id: videoId,
                format: 'full_text',
                language: transcriptLanguage,
                transcript: fullText
            });
        } else {
            // Return the raw transcript data as JSON (default)
            return res.json({
                success: true,
                video_id: videoId,
                format: 'raw',
                language: transcriptLanguage,
                transcript: transcript
            });
        }
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
    logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
});

export default app;