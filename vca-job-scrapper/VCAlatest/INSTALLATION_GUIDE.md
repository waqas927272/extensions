# VCA Job Scraper - Installation & Troubleshooting Guide

## Installation Steps

1. **Open Chrome Extensions Page**
   - Navigate to `chrome://extensions/` in your Chrome browser
   - OR click the three dots menu → More Tools → Extensions

2. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top-right corner

3. **Load the Extension**
   - Click "Load unpacked" button
   - Navigate to and select this folder: `C:\wamp64\www\extensions\vca-job-scrapper\VCAlatest`
   - Click "Select Folder"

4. **Verify Installation**
   - You should see "VCA Jobs Scraper" in your extensions list
   - Check that there are no errors displayed under the extension name
   - The extension icon should appear in your Chrome toolbar

## Troubleshooting

### Error: "Service worker registration failed. Status code: 15"

**Cause:** JavaScript syntax errors or missing files

**Solutions:**
1. **Check Console for Errors:**
   - On the extensions page (`chrome://extensions/`), find VCA Jobs Scraper
   - Click "Errors" button if it appears
   - Review and fix any JavaScript errors shown

2. **Reload the Extension:**
   - Click the refresh icon on the extension card
   - OR remove and re-add the extension

3. **Clear Extension Data:**
   ```
   - Right-click the extension → Remove
   - Close all Chrome windows
   - Reopen Chrome and load the extension again
   ```

### Error: "Cannot read properties of undefined (reading 'local')"

**Cause:** Extension not properly loaded or APIs not available

**Solutions:**
1. Ensure you're on the VCA Careers website: `https://www.vcacareers.com/global/en/c/veterinarian-jobs`
2. Reload the extension from `chrome://extensions/`
3. Refresh the VCA Careers page after reloading the extension
4. Check that all required permissions are granted

### Error: "Invalid regular expression"

**Cause:** Regex syntax errors (FIXED in latest version)

**Solution:** Ensure you're using the latest fixed version of the files

## How to Use

1. **Navigate to VCA Careers:**
   - Go to: https://www.vcacareers.com/global/en/c/veterinarian-jobs

2. **Open the Extension:**
   - Click the VCA Jobs Scraper icon in your toolbar
   - OR click the puzzle piece icon and select "VCA Jobs Scraper"

3. **Start Scraping:**
   - The floating control panel will appear on the page automatically
   - Select how many pages to scrape (1, 3, 5, 10, or all)
   - Click "Start Scraping"
   - Monitor progress in the floating panel

4. **View Results:**
   - Click "View Records" in the popup
   - OR right-click the extension icon → "View Records"

5. **Fetch Additional Details:**
   - In the Records page, click "Fetch Details" to get hospital names, salaries, etc.
   - Click "Fetch Descriptions" to get full job descriptions

6. **Export Data:**
   - Click "Export to GSheet" to send data to Google Sheets
   - OR click "Send to Webhook" to send to a custom endpoint

## Files Overview

- `manifest.json` - Extension configuration
- `background.js` - Background service worker
- `content.js` - Main scraping logic (runs on VCA website)
- `popup.html/js` - Extension popup interface
- `records.html/js` - Data management page
- `service-account.js` - Google Sheets authentication
- `popup.css`, `records.css` - Styling

## Permissions Required

- `activeTab` - Access current tab
- `storage` - Store scraped data locally
- `scripting` - Inject scraping scripts
- `tabs` - Manage browser tabs
- Host permissions for:
  - `https://www.vcacareers.com/*`
  - `https://sheets.googleapis.com/*`
  - `https://www.googleapis.com/*`

## Known Limitations

1. Works only on VCA Careers veterinarian jobs page
2. Requires active internet connection for Google Sheets export
3. May be affected by website layout changes
4. Service account credentials are embedded (security consideration)

## Support

If you encounter issues:
1. Check the browser console (F12) for errors
2. Verify you're on the correct VCA Careers URL
3. Ensure all files are present in the extension folder
4. Try removing and re-adding the extension
