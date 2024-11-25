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
                // Keep `_link_step` consistent and skip appending `_step${stepIndex}` to other headers
                if (key.startsWith('_link_step')) {
                    mergedRow[key] = newData[index][key];
                } else {
                    mergedRow[key] = newData[index][key];
                }
            }
        }
        return mergedRow;
    });
}

// Scrape handler
app.post('/scrape', upload.single('htmlFile'), async (req, res) => {
    let steps;
    const errorLog = [];
    try {
        steps = JSON.parse(req.body.steps);
    } catch (e) {
        logMessage('Error parsing steps: Invalid steps format.', true);
        return res.status(400).json({ error: 'Invalid steps format.', logs: errorLog });
    }

    if (!req.file || !steps || steps.length === 0) {
        logMessage('Missing required parameters or steps.', true);
        return res.status(400).json({ error: 'Missing required parameters or steps.', logs: errorLog });
    }

    const maxData = parseInt(req.body.maxData, 10) || 100;

    try {
        logMessage('Starting scraping process.');
        const filePath = req.file.path;
        const fileContent = fs.readFileSync(filePath, 'utf8');
        let $ = cheerio.load(fileContent);

        let scrapedData = [];
        const dynamicReferer = req.body.referer || 'https://lpse.pu.go.id/eproc4/lelang';

        // Recursive scraping for each step
        for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
            const step = steps[stepIndex];
            const { headers, selectors, innerLinkSelector } = step;

            let links = [];
            if (stepIndex === 0 && innerLinkSelector) {
                // Collect initial links from the uploaded file
                logMessage(`Step ${stepIndex + 1}: Collecting initial links using selector '${innerLinkSelector}'.`);
                links = $(innerLinkSelector)
                    .map((i, el) => $(el).attr('href'))
                    .get()
                    .filter(Boolean)
                    .map(link => (!link.startsWith('http') ? new URL(link, dynamicReferer).toString() : link));
                logMessage(`Step ${stepIndex + 1}: Found ${links.length} links.`);
            } else if (stepIndex > 0 && innerLinkSelector) {
                // Collect links from previous step's data
                const previousLinks = scrapedData.map(d => d[`_link_step${stepIndex}`] || d._link).filter(Boolean);
                logMessage(`Step ${stepIndex + 1}: Processing ${previousLinks.length} previous links.`);
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
                        logMessage(`Step ${stepIndex + 1}: Found ${links.length} links from page ${prevLink}.`);
                    } catch (err) {
                        logMessage(`Error fetching link (${prevLink}): ${err.message}`, true);
                    }
                }
            }

            const stepData = [];
            for (const link of links) {
                try {
                    logMessage(`Fetching link: ${link}`);
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
                        const extractedData = $$(selectors[index]).text().trim();
                        if (!extractedData) {
                            const pageSnippet = $$('body').html().substring(0, 500);
                            logMessage(
                                `Warning: No data found for header '${header}' using selector '${selectors[index]}' on page ${link}`,
                                true
                            );
                            logMessage(`Page snippet: ${pageSnippet}`, true);
                        }
                        pageData[header] = extractedData || 'N/A';
                    });
            
                    stepData.push(pageData);
            
                    if (stepData.length >= maxData) break;
                } catch (err) {
                    logMessage(`Error fetching link (${link}): ${err.message}`, true);
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

        logMessage('Scraping completed successfully.');
        res.json({ status: 'completed', message: 'Scraping completed successfully', logs: errorLog });

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
        logMessage(`Scraping error: ${error.message}`, true);
        res.status(500).json({ error: 'Scraping failed.', logs: errorLog });
    }

    // Helper function for logging
    function logMessage(message, isError = false) {
        const timestamp = new Date().toISOString();
        const formattedMessage = `${timestamp} - ${isError ? '[ERROR]' : '[INFO]'}: ${message}`;
        console.log(formattedMessage);
        errorLog.push(formattedMessage);
    }
});


// Start server
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
