# Mission Pet Health Job Scraper Extension

Chrome extension to scrape job listings from Mission Pet Health careers page.

## Installation Instructions

### Step 1: Create Icon Files
You need to create 3 icon files. Here are two easy options:

**Option A: Use Online Tool (Easiest)**
1. Go to https://favicon.io/favicon-generator/
2. Create a simple icon (choose any design)
3. Download and extract the ZIP file
4. Copy these files to the extension folder:
   - Rename `favicon-16x16.png` to `icon16.png`
   - Rename `favicon-32x32.png` to `icon48.png` (you can upscale it)
   - Rename `android-chrome-192x192.png` to `icon128.png` (you can downscale it)

**Option B: Use Any PNG Files**
- Just use any 3 PNG image files and rename them to `icon16.png`, `icon48.png`, and `icon128.png`
- Place them in the `job-scraper-extension` folder

### Step 2: Load Extension in Chrome
1. Open Chrome browser
2. Go to `chrome://extensions/`
3. Enable **Developer mode** (toggle switch in top-right corner)
4. Click **Load unpacked** button
5. Navigate to `C:\Users\saadb\Desktop\MPH\job-scraper-extension`
6. Click **Select Folder**

### Step 3: Use the Extension
1. Go to the Mission Pet Health job search page:
   https://missionpethealth.avature.net/careersmarketplace/SearchJobs
2. Click the extension icon in Chrome toolbar (top-right)
3. Click **Scrape Jobs** button
4. Click **View Results in Table** to see the scraped data
5. Use **Export to CSV** or **Export to JSON** to download the data

## Features

- ✅ Scrapes Job Title, Location, City, State, and Link
- ✅ Displays data in a beautiful table
- ✅ Export to CSV format
- ✅ Export to JSON format
- ✅ Clear data option
- ✅ Responsive design

## Troubleshooting

**Extension doesn't appear:**
- Make sure Developer mode is enabled
- Try reloading the extension on chrome://extensions/

**No jobs scraped:**
- Make sure you're on the correct page (Mission Pet Health job search)
- Check if the page has loaded completely
- Try refreshing the page and scraping again

**Icons not showing:**
- Create the icon files as described in Step 1
- Make sure they are named exactly: icon16.png, icon48.png, icon128.png

## Files Included

- `manifest.json` - Extension configuration
- `popup.html` - Main popup interface
- `popup.css` - Popup styling
- `popup.js` - Scraping logic
- `results.html` - Results table page
- `results.css` - Results table styling
- `results.js` - Results page functionality
