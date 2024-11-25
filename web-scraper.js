import express from 'express';
import bodyParser from 'body-parser';
import multer from 'multer';
import * as XLSX from 'xlsx';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

const app = express();
const PORT = 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

app.post('/scrape', upload.single('htmlFile'), async (req, res) => {
    const { goToInnerLinks, innerLinkSelector, maxData, dataPerFile, referer } = req.body;

    let dataSelectors;
    try {
        dataSelectors = JSON.parse(req.body.dataSelectors);
    } catch (e) {
        return res.status(400).json({ error: 'Invalid data selectors format.' });
    }

    if (!req.file || !dataSelectors) {
        return res.status(400).json({ error: 'Missing required parameters.' });
    }

    const maxEntries = parseInt(maxData, 10) || 100;
    const chunkSize = parseInt(dataPerFile, 10) || 50;
    const dynamicReferer = referer || 'https://lpse.pu.go.id/eproc4/lelang/';

    try {
        const filePath = req.file.path;
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const $ = cheerio.load(fileContent);

        let scrapedData = [];
        const links = [];

        // Collect links if goToInnerLinks is enabled
        if (goToInnerLinks === 'true' || goToInnerLinks === true) {
            $(innerLinkSelector)
                .map((i, el) => $(el).attr('href'))
                .get()
                .filter(Boolean)
                .forEach(link => {
                    // Convert relative links to absolute links using dynamic referer
                    if (!link.startsWith('http')) {
                        links.push(new URL(link, dynamicReferer).toString());
                    } else {
                        links.push(link);
                    }
                });
        }

        let progress = 0;

        // Stream progress updates
        res.setHeader('Content-Type', 'application/json');
        res.write(JSON.stringify({ progress: 0 }) + "\n");

        for (const [index, link] of links.entries()) {
            if (scrapedData.length >= maxEntries) break;

            try {
                // Make request with dynamic Referer and User-Agent headers
                const response = await axios.get(link, {
                    headers: {
                        'Referer': dynamicReferer,
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    },
                });

                const $$ = cheerio.load(response.data);
                const pageData = {};

                for (let [name, selector] of Object.entries(dataSelectors)) {
                    pageData[name] = $$(selector).text().trim() || 'N/A';
                }

                scrapedData.push(pageData);

                // Save chunk of data if chunkSize is reached
                if (scrapedData.length % chunkSize === 0) {
                    saveChunk(scrapedData, index);
                    scrapedData = [];
                }
            } catch (err) {
                console.error(`Failed to fetch link (${link}):`, err.message);
                continue;
            }

            // Update progress
            progress = Math.round(((index + 1) / links.length) * 100);
            res.write(JSON.stringify({ progress }) + "\n");
        }

        // Save remaining data
        if (scrapedData.length > 0) saveChunk(scrapedData);

        // End progress stream
        res.write(JSON.stringify({ progress: 100, status: 'completed' }) + "\n");
        res.end();

        // Save a chunk of data to a file
        function saveChunk(data, index = '') {
            const workbook = XLSX.utils.book_new();
            const worksheet = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Scraped Data');
            const filename = `scraped_data_chunk_${index}_${Date.now()}.xlsx`;
            XLSX.writeFile(workbook, path.join('public', filename));
        }

        // Cleanup the uploaded file
        fs.unlinkSync(filePath);
    } catch (error) {
        console.error('Scraping error:', error);
        return res.status(500).json({ error: 'Scraping failed.' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
