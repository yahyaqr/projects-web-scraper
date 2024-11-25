import puppeteer from 'puppeteer';
import inquirer from 'inquirer';
import * as XLSX from 'xlsx';
import * as cheerio from 'cheerio';

async function scrapeWebsite(url, goToInnerLinks, innerLinkSelector, dataSelectors) {
  const browser = await puppeteer.launch({
    headless: true, // Set to false if you want to debug by seeing the browser
    args: ['--no-sandbox', '--disable-setuid-sandbox'], // For compatibility with some environments
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    let scrapedData = [];

    if (goToInnerLinks) {
      try {
        const links = await page.$$eval(innerLinkSelector, els =>
          els.map(el => el.href).filter(Boolean) // Ensure valid hrefs only
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
      } catch (linkError) {
        console.error('Error fetching inner links:', linkError);
      }
    } else {
      const pageData = await scrapePageData(page, dataSelectors);
      scrapedData.push(pageData);
    }

    return scrapedData;
  } catch (error) {
    console.error('Error scraping website:', error);
    return [];
  } finally {
    await browser.close();
  }
}

async function scrapePageData(page, dataSelectors) {
  const pageData = {};

  try {
    const content = await page.content();
    const $ = cheerio.load(content);

    for (let [name, selector] of Object.entries(dataSelectors)) {
      pageData[name] = $(selector).text().trim() || 'N/A'; // Gracefully handle missing elements
    }
  } catch (error) {
    console.error('Error scraping page data:', error);
  }

  return pageData;
}

async function main() {
  try {
    const { url } = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: 'Enter the URL to scrape:',
        validate: input => input.startsWith('http') || 'Please enter a valid URL',
      },
    ]);

    const { goToInnerLinks } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'goToInnerLinks',
        message: 'Do you need to go to links inside the given link?',
        default: false,
      },
    ]);

    let innerLinkSelector = '';
    if (goToInnerLinks) {
      const response = await inquirer.prompt([
        {
          type: 'input',
          name: 'innerLinkSelector',
          message: 'Enter the selector for the inner links:',
          validate: input => input.trim() !== '' || 'Selector cannot be empty',
        },
      ]);
      innerLinkSelector = response.innerLinkSelector;
    }

    const dataSelectors = {};
    let addMoreSelectors = true;

    while (addMoreSelectors) {
      const { name, selector } = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Enter a name for the data you want to scrape:',
          validate: input => input.trim() !== '' || 'Name cannot be empty',
        },
        {
          type: 'input',
          name: 'selector',
          message: 'Enter the selector for this data:',
          validate: input => input.trim() !== '' || 'Selector cannot be empty',
        },
      ]);

      dataSelectors[name] = selector;

      const { more } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'more',
          message: 'Do you want to add more selectors?',
          default: false,
        },
      ]);

      addMoreSelectors = more;
    }

    console.log('Starting web scraping...');
    const scrapedData = await scrapeWebsite(url, goToInnerLinks, innerLinkSelector, dataSelectors);
    console.log('Web scraping completed.');

    if (scrapedData.length === 0) {
      console.error('No data scraped. Please check your selectors and URL.');
      return;
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(scrapedData);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Scraped Data');

    const outputFilename = 'scraped_data.xlsx';
    XLSX.writeFile(workbook, outputFilename);
    console.log(`Data saved to ${outputFilename}`);
  } catch (error) {
    console.error('An error occurred in the main function:', error);
  }
}

main();
