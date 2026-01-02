# AAH Job Scraper - Chrome Extension

A Chrome extension for scraping veterinary job listings from Alliance Animal Health's careers page on SmartRecruiters.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Features](#features)
- [Usage Guide](#usage-guide)
- [File Structure](#file-structure)
- [Webhook Configuration](#webhook-configuration)
- [Data Format](#data-format)
- [Troubleshooting](#troubleshooting)

---

## Overview

AAH Job Scraper automates the collection of DVM (Doctor of Veterinary Medicine) career opportunities from Alliance Animal Health's job portal. It extracts job details, fetches descriptions, detects duplicates, and can send data to external webhooks for further processing.

### Key Capabilities

- Scrapes job listings with pagination support
- Auto-applies "DVM Career Opportunities" filter
- Extracts job descriptions from detail pages
- Detects and separates duplicate records
- Exports data to CSV
- Sends data to configurable webhooks in batches

---

## Installation

### Developer Mode Installation

1. Download or clone the extension files to a local folder
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Select the `AllianceAnimal` folder
6. The extension icon will appear in your toolbar

### Updating the Extension

After modifying any files:
1. Go to `chrome://extensions/`
2. Find "AAH Job Scraper"
3. Click the **refresh icon** to reload

---

## Features

### 1. Job Scraping

- **Auto-filter**: Automatically applies "DVM Career Opportunities" filter before scraping
- **Pagination Support**: Scrapes all pages of results automatically
- **Data Extraction**: Captures job title, hospital name, city, state, and job link

### 2. Description Fetching

- **Get Descriptions**: Opens each job page in background tabs to extract full job descriptions
- **Progress Tracking**: Shows progress bar during description fetching
- **Auto-close Tabs**: Closes tabs after extracting descriptions

### 3. Duplicate Detection

- **Smart Detection**: Identifies duplicates based on: Job Title + Hospital Name + City + State
- **Separate Tables**: Displays unique records in main table, duplicates in separate table
- **Navigation**: "View Duplicates" button for quick navigation to duplicate section

### 4. Record Selection

- **Individual Selection**: Checkbox on each row for selecting specific records
- **Select All**: Header checkbox to select/deselect all records in a table
- **Selection Counter**: Shows number of selected records
- **Visual Feedback**: Selected rows are highlighted

### 5. Webhook Integration

- **Multiple Webhooks**: Configure and manage multiple webhook endpoints
- **Enable/Disable**: Toggle webhooks on/off without deleting
- **Batch Sending**: Sends data in batches of 50 records
- **Progress Bar**: Visual progress during webhook transmission
- **Detailed Results**: Copyable results with success/failure details

### 6. Data Export

- **CSV Download**: Export all records to CSV file
- **Full Data**: Includes all fields including descriptions

---

## Usage Guide

### Step 1: Navigate to Job Portal

1. Go to the Alliance Animal Health careers page on SmartRecruiters
2. Click the extension icon in your toolbar

### Step 2: Start Scraping

1. The popup shows current page stats
2. Click **Start Scraping** to begin
3. The extension will:
   - Auto-apply the DVM filter
   - Scrape the current page
   - Navigate through all pagination pages
   - Store all records

### Step 3: View Records

1. Click **View Scraped Records** to open the results page
2. Records are displayed in a table with:
   - Unique records in the main table
   - Duplicate records in a separate section below

### Step 4: Get Descriptions (Optional)

1. Click **Get Descriptions** in the sidebar
2. Confirm to start the process
3. The extension opens each job page to extract descriptions
4. Progress bar shows completion status

### Step 5: Select Records

**For Unique Records Table:**
- Click individual checkboxes to select specific records
- Click header checkbox to select all
- Selection count shows above the table

**For Duplicate Records Table:**
- Same selection options available
- Separate selection from unique records

### Step 6: Send to Webhook

**Option A - Send All Records (Sidebar button):**
1. Click **Send to Webhooks** in sidebar
2. Sends ALL stored records (unique + duplicates)

**Option B - Send Selected Records:**
1. Select desired records using checkboxes
2. Click **Send Selected to Webhook** above the respective table
3. Only selected records from that table are sent

### Step 7: Export to CSV

1. Click **Download CSV** in the sidebar
2. File `aah_job_records.csv` will download

---

## File Structure

```
AllianceAnimal/
├── manifest.json        # Extension configuration
├── background.js        # Service worker (handles tabs, webhooks)
├── content.js           # Content script (scraping logic)
├── popup.html           # Extension popup UI
├── popup.js             # Popup functionality
├── popup.css            # Popup styles
├── results.html         # Results page UI
├── results.js           # Results page functionality
├── results.css          # Results page styles
├── images/
│   ├── logo.webp        # AAH logo
│   └── faveicon.jpg     # Extension icon
└── README.md            # This documentation
```

### File Descriptions

| File | Purpose |
|------|---------|
| `manifest.json` | Chrome extension manifest (v3), permissions, icons |
| `background.js` | Service worker handling tab operations and webhook requests |
| `content.js` | Injected into job pages to scrape data from DataTables |
| `popup.html/js/css` | Extension popup with scraping controls and stats |
| `results.html/js/css` | Full-page results viewer with tables, modals, webhooks |

---

## Webhook Configuration

### Adding a Webhook

1. Open the results page
2. In the sidebar, find the **Webhooks** section
3. Click the **+** button
4. Enter:
   - **Name**: Friendly name for the webhook
   - **URL**: Full webhook endpoint URL
   - **Enabled**: Toggle to activate/deactivate
5. Click **Save Webhook**

### Managing Webhooks

- **Edit**: Click the pencil icon on a webhook
- **Delete**: Click the trash icon on a webhook
- **Toggle**: Edit webhook and change Enabled checkbox

### Webhook Requirements

Your webhook endpoint should:
- Accept POST requests
- Accept `Content-Type: application/json`
- Return HTTP 200 for success

---

## Data Format

### Scraped Job Record

```json
{
  "title": "Associate Veterinarian",
  "hospitalName": "ABC Animal Hospital",
  "city": "Austin",
  "state": "Texas",
  "link": "https://jobs.smartrecruiters.com/...",
  "description": "Full job description text..."
}
```

### Webhook Payload (All Records)

```json
{
  "source": "AAH Job Scraper",
  "parentClientName": "Alliance Animal Health (Parent Client)",
  "timestamp": "2025-12-18T12:00:00.000Z",
  "batchNumber": 1,
  "totalBatches": 4,
  "batchSize": 50,
  "totalRecords": 177,
  "data": [
    {
      "parentClientName": "Alliance Animal Health (Parent Client)",
      "title": "Associate Veterinarian",
      "hospitalName": "ABC Animal Hospital",
      "city": "Austin",
      "state": "Texas",
      "link": "https://...",
      "description": "..."
    }
  ]
}
```

### Webhook Payload (Selected Records)

```json
{
  "source": "AAH Job Scraper",
  "parentClientName": "Alliance Animal Health (Parent Client)",
  "recordType": "unique",
  "timestamp": "2025-12-18T12:00:00.000Z",
  "batchNumber": 1,
  "totalBatches": 1,
  "batchSize": 10,
  "totalRecords": 10,
  "data": [...]
}
```

**Note:** `recordType` is either `"unique"` or `"duplicate"` depending on which table the selection was made from.

### CSV Export Format

| Column | Description |
|--------|-------------|
| title | Job title |
| hospitalName | Name of the hospital/clinic |
| city | City location |
| state | State location |
| link | URL to job posting |
| description | Full job description |

---

## Troubleshooting

### Extension Not Working

1. Ensure you're on the correct SmartRecruiters page
2. Check that the extension is enabled in `chrome://extensions/`
3. Try reloading the extension (click refresh icon)

### Scraping Stops or Misses Records

1. Make sure the page fully loads before scraping
2. Check browser console for errors (F12 > Console)
3. The DataTable must be visible on the page

### Webhook Errors

**HTTP 403 Forbidden:**
- Check webhook URL is correct
- Verify server allows POST requests
- Check for required authentication headers

**No Response from Background Script:**
- Reload the extension
- Check service worker status in `chrome://extensions/`

**CORS Errors:**
- Webhooks are sent from the background script to bypass CORS
- Ensure the extension was reloaded after updates

### Descriptions Not Loading

1. Ensure `host_permissions` includes the job page domain
2. Check that tabs are opening (may need to allow popups)
3. Look for errors in the Service Worker console

### Duplicates Not Detected

Duplicates are detected when ALL of the following match (case-insensitive):
- Job Title
- Hospital Name
- City
- State

If any field differs, records are considered unique.

---

## Permissions

The extension requires these permissions:

| Permission | Purpose |
|------------|---------|
| `activeTab` | Access current tab for scraping |
| `storage` | Store scraped jobs and webhooks |
| `scripting` | Inject scripts into pages |
| `tabs` | Open tabs for description fetching |
| `<all_urls>` | Send webhook requests to any URL |

---

## Version History

### v1.0
- Initial release
- Job scraping with pagination
- Auto-filter for DVM opportunities
- Description fetching
- CSV export
- Webhook integration with batch sending
- Duplicate detection
- Record selection for targeted webhook sends

---

## Support

For issues or feature requests, please contact the development team.
