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
app.use(express.static('public')); // Serve static files like index.html

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Scrape handler
app.post('/scrape', upload.single('htmlFile'), async (req, res) => {
    const { goToInnerLinks, innerLinkSelector } = req.body;

    let dataSelectors;
    try {
        dataSelectors = JSON.parse(req.body.dataSelectors);
    } catch (e) {
        return res.status(400).json({ error: 'Invalid data selectors format.' });
    }

    if (!req.file || !dataSelectors) {
        return res.status(400).json({ error: 'Missing required parameters.' });
    }

    try {
        const filePath = req.file.path;
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const $ = cheerio.load(fileContent);

        let scrapedData = [];

        if (goToInnerLinks === 'true' || goToInnerLinks === true) {
            const links = $(innerLinkSelector)
                .map((i, el) => $(el).attr('href'))
                .get()
                .filter(Boolean);

            for (let link of links) {
                try {
                    let pageContent;

                    if (link.startsWith('http')) {
                        const response = await axios.get(link);
                        pageContent = response.data;
                    } else {
                        console.warn(`Skipping relative URL: ${link}`);
                        continue;
                    }

                    const $$ = cheerio.load(pageContent);
                    const pageData = {};

                    for (let [name, selector] of Object.entries(dataSelectors)) {
                        pageData[name] = $$(selector).text().trim() || 'N/A';
                    }
                    scrapedData.push(pageData);
                } catch (innerError) {
                    console.error(`Error processing inner link (${link}):`, innerError);
                }
            }
        } else {
            const pageData = {};

            for (let [name, selector] of Object.entries(dataSelectors)) {
                pageData[name] = $(selector).text().trim() || 'N/A';
            }
            scrapedData.push(pageData);
        }

        if (scrapedData.length === 0) {
            return res.status(500).json({ error: 'No data scraped. Check your selectors.' });
        }

        // Save data to Excel
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(scrapedData);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Scraped Data');
        const outputFilename = `scraped_data_${Date.now()}.xlsx`;
        XLSX.writeFile(workbook, path.join('public', outputFilename));

        // Clean up the uploaded file
        fs.unlinkSync(filePath);

        return res.json({ filename: outputFilename });
    } catch (error) {
        console.error('Error during scraping:', error);
        return res.status(500).json({ error: 'An error occurred during scraping.' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
