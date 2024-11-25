import express from 'express';
import bodyParser from 'body-parser';
import puppeteer from 'puppeteer';
import * as XLSX from 'xlsx';
import * as cheerio from 'cheerio';
import fs from 'fs';

const app = express();
const PORT = 3000;

// Middleware
app.use(bodyParser.json());
app.use(express.static('public')); // Serve static files like index.html

// Scrape handler
app.post('/scrape', async (req, res) => {
    const { url, goToInnerLinks, innerLinkSelector, dataSelectors } = req.body;

    if (!url || !dataSelectors) {
        return res.status(400).json({ error: 'Missing required parameters.' });
    }

    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        let scrapedData = [];

        if (goToInnerLinks) {
            const links = await page.$$eval(innerLinkSelector, els =>
                els.map(el => el.href).filter(Boolean)
            );

            for (let link of links) {
                try {
                    await page.goto(link, { waitUntil: 'domcontentloaded' });
                    const pageData = await scrapePageData(page, dataSelectors);
                    scrapedData.push(pageData);
                } catch (innerError) {
                    console.error(`Error navigating to inner link (${link}):`, innerError);
                }
            }
        } else {
            const pageData = await scrapePageData(page, dataSelectors);
            scrapedData.push(pageData);
        }

        await browser.close();

        if (scrapedData.length === 0) {
            return res.status(500).json({ error: 'No data scraped. Check your selectors.' });
        }

        // Save data to Excel
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(scrapedData);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Scraped Data');
        const outputFilename = `scraped_data_${Date.now()}.xlsx`;
        XLSX.writeFile(workbook, outputFilename);

        return res.json({ filename: outputFilename });
    } catch (error) {
        console.error('Error during scraping:', error);
        return res.status(500).json({ error: 'An error occurred during scraping.' });
    }
});

// Helper to scrape page data
async function scrapePageData(page, dataSelectors) {
    const pageData = {};
    const content = await page.content();
    const $ = cheerio.load(content);

    for (let [name, selector] of Object.entries(dataSelectors)) {
        pageData[name] = $(selector).text().trim() || 'N/A';
    }

    return pageData;
}

// Start server
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
