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

// Helper function to merge step data into a single row
function mergeStepData(currentData, newData, stepIndex) {
    return currentData.map((row, index) => {
        const mergedRow = { ...row };
        if (newData[index]) {
            for (const key in newData[index]) {
                mergedRow[`${key}_step${stepIndex}`] = newData[index][key];
            }
        }
        return mergedRow;
    });
}

// Scrape handler
app.post('/scrape', upload.single('htmlFile'), async (req, res) => {
    let steps;
    try {
        steps = JSON.parse(req.body.steps);
    } catch (e) {
        return res.status(400).json({ error: 'Invalid steps format.' });
    }

    if (!req.file || !steps || steps.length === 0) {
        return res.status(400).json({ error: 'Missing required parameters or steps.' });
    }

    const maxData = parseInt(req.body.maxData, 10) || 100;

    try {
        const filePath = req.file.path;
        const fileContent = fs.readFileSync(filePath, 'utf8');
        let $ = cheerio.load(fileContent);

        let scrapedData = [];
        const dynamicReferer = req.body.referer || 'https://lpse.pu.go.id/eproc4/lelang'; // Correct base referer

        // Recursive scraping for each step
        for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
            const step = steps[stepIndex];
            const { headers, selectors, innerLinkSelector } = step;

            let links = [];
            if (stepIndex === 0 && innerLinkSelector) {
                // Collect initial links from the uploaded file
                links = $(innerLinkSelector)
                    .map((i, el) => $(el).attr('href'))
                    .get()
                    .filter(Boolean)
                    .map(link => (!link.startsWith('http') ? new URL(link, dynamicReferer).toString() : link));
            } else if (stepIndex > 0 && innerLinkSelector) {
                // For subsequent steps, collect links from the previous scraped data
                const previousLinks = scrapedData.map(d => d[`_link_step${stepIndex}`] || d._link).filter(Boolean);
                links = [];
                for (const prevLink of previousLinks) {
                    try {
                        const response = await axios.get(prevLink, {
                            headers: {
                                'Referer': dynamicReferer,
                                'User-Agent':
                                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                            },
                        });
                        const $$ = cheerio.load(response.data);
                        links.push(
                            ...$$(`${innerLinkSelector}`)
                                .map((i, el) => $$(el).attr('href'))
                                .get()
                                .filter(Boolean)
                                .map(link => (!link.startsWith('http') ? new URL(link, dynamicReferer).toString() : link))
                        );
                    } catch (err) {
                        console.error(`Failed to fetch link (${prevLink}):`, err.message);
                    }
                }
            }

            const stepData = [];
            for (const link of links) {
                try {
                    const response = await axios.get(link, {
                        headers: {
                            'Referer': dynamicReferer,
                            'User-Agent':
                                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        },
                    });
                    const $$ = cheerio.load(response.data);
                    const pageData = { [`_link_step${stepIndex + 1}`]: link };

                    headers.forEach((header, index) => {
                        pageData[header] = $$(selectors[index]).text().trim() || 'N/A';
                    });

                    stepData.push(pageData);

                    if (stepData.length >= maxData) break;
                } catch (err) {
                    console.error(`Failed to fetch link (${link}):`, err.message);
                }
            }

            // Merge the current step's data with the previous data
            if (stepIndex === 0) {
                scrapedData = stepData;
            } else {
                scrapedData = mergeStepData(scrapedData, stepData, stepIndex + 1);
            }
        }

        // Save the final data
        saveChunk(scrapedData);

        res.json({ status: 'completed', message: 'Scraping completed successfully' });

        // Function to save data to a file
        function saveChunk(data) {
            const workbook = XLSX.utils.book_new();
            const worksheet = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Scraped Data');
            const filename = `scraped_data_${Date.now()}.xlsx`;
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
