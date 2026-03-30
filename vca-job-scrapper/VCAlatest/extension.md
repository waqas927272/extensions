# VCA Jobs Scraper Extension - Complete Documentation

## Table of Contents
1. [Overview](#overview)
2. [Extension Architecture](#extension-architecture)
3. [Core Components](#core-components)
4. [Complete Feature Set](#complete-feature-set)
5. [Use Cases](#use-cases)
6. [Technical Implementation](#technical-implementation)
7. [Data Flow & Communication](#data-flow--communication)
8. [Storage Mechanisms](#storage-mechanisms)
9. [User Workflows](#user-workflows)
10. [Configuration & Settings](#configuration--settings)
11. [Export & Integration](#export--integration)
12. [Security Considerations](#security-considerations)
13. [Limitations & Constraints](#limitations--constraints)

---

## Overview

### Purpose
The VCA Jobs Scraper is a Chrome browser extension designed to automate the extraction, processing, and management of veterinarian job listings from the VCA Careers website (https://www.vcacareers.com). It provides comprehensive data extraction, intelligent filtering, and seamless export capabilities to Google Sheets and custom webhooks.

### Target Audience
- Veterinary recruitment professionals
- Veterinary job market analysts
- Veterinary career advisors
- Data researchers in the veterinary industry
- VCA hospital HR departments

### Key Value Proposition
- **Automation**: Eliminates manual job data collection
- **Efficiency**: Processes multiple pages of job listings automatically
- **Intelligence**: Smart filtering and categorization of positions
- **Integration**: Direct export to Google Sheets for analysis
- **Scalability**: Handles bulk data extraction with progress tracking

---

## Extension Architecture

### Technology Stack
- **Platform**: Chrome Extension Manifest V3
- **Languages**: JavaScript (ES6+), HTML5, CSS3
- **APIs Used**:
  - Chrome Extension APIs (storage, tabs, scripting, runtime)
  - Google Sheets API v4
  - Web Crypto API (for JWT signing)
  - Screen Wake Lock API (prevents screen sleep during scraping)

### Architecture Pattern
**Multi-Component Service Worker Architecture**

```
┌─────────────────────────────────────────────────────────┐
│                    Browser Layer                         │
├─────────────────────────────────────────────────────────┤
│  Popup UI  │  Records Page  │  Floating Control Panel   │
├─────────────────────────────────────────────────────────┤
│              Background Service Worker                   │
│  (Message Router & Job Description Fetcher)             │
├─────────────────────────────────────────────────────────┤
│                   Content Script                         │
│  (Main Scraping Engine - Injected into VCA Website)    │
├─────────────────────────────────────────────────────────┤
│              Chrome Local Storage                        │
│  (Jobs Data | Scraping State | Statistics)             │
├─────────────────────────────────────────────────────────┤
│              External Integrations                       │
│  Google Sheets API  │  Custom Webhooks                 │
└─────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Manifest (manifest.json)
**Purpose**: Extension configuration and permissions declaration

**Permissions Declared**:
- `activeTab`: Access to currently active browser tab
- `storage`: Chrome local storage for data persistence
- `scripting`: Dynamic script injection capability
- `tabs`: Tab creation and management

**Host Permissions**:
- `https://www.vcacareers.com/*`: Target scraping website
- `https://sheets.googleapis.com/*`: Google Sheets API
- `https://www.googleapis.com/*`: Google OAuth endpoints
- `<all_urls>`: Universal access for webhook exports

**Entry Points**:
- **Service Worker**: `background.js`
- **Content Script**: `content.js` (auto-injected on VCA Careers pages)
- **Popup**: `popup.html` (browser toolbar icon)

---

### 2. Background Service Worker (background.js - 770 lines)

**Role**: Message router and job detail fetcher

**Key Responsibilities**:

#### A. Message Routing (Lines 6-11)
- Forwards progress updates from content script to popup
- Relays scraping status changes
- Broadcasts error notifications
- Coordinates communication between components

#### B. Job Description Fetching (Lines 12-43)
**Process**:
1. Creates hidden background tab with job URL
2. Waits for page load completion
3. Injects extraction script into ISOLATED world
4. Extracts description from `.jd-info[data-ph-at-id="jobdescription-text"]`
5. Closes tab and returns description
6. Uses 2-second delay to ensure page rendering

**Features**:
- Non-blocking operation
- Error handling with fallbacks
- Automatic tab cleanup
- Timeout protection (tab closed after extraction)

#### C. Advanced Job Details Fetching (Lines 45-768)
**Multi-Stage Extraction Process**:

##### Stage 1: MAIN World Script Injection (Lines 52-76)
- Accesses page-level JavaScript object `phApp.ddo`
- Extracts structured job data from internal Phenom platform
- Posts data via `window.postMessage` to ISOLATED world

##### Stage 2: Comprehensive Data Extraction (Lines 79-745)
**Data Sources Priority**:
1. **Pattern Matching** (Highest Priority - Lines 269-366)
   - "Join us as [position] at [hospital]" patterns
   - "[Hospital] is seeking/looking for [position]" patterns
   - 10+ regex patterns for different job posting formats

2. **phApp.ddo Object** (Lines 428-503)
   - `jobData.title`: Official job title
   - `jobData.city`, `jobData.state`: Location
   - `jobData.jobFamilies`: Most specific area of practice
   - `jobData.locationDetails`: Hospital name extraction
   - `jobData.description`: Full HTML description

3. **DOM Attributes** (Lines 505-520)
   - `data-ph-at-job-title-text`
   - `data-ph-at-job-category-text`
   - `data-ph-at-job-location-text`

4. **JSON-LD Structured Data** (Lines 548-596)
   - Schema.org JobPosting format
   - `baseSalary` extraction with currency
   - `hiringOrganization.name`
   - Metadata validation

5. **Description Text Mining** (Lines 416-426, 599-627)
   - Salary pattern extraction (hourly, yearly, shift, negotiable)
   - Hospital name pattern matching
   - Position keyword identification

##### Salary Extraction (Lines 164-266)
**Supported Formats**:
- **Hourly**: `$50-65/hour`, `$50 per hour`, `$60 hourly` → `$50-65 (Hourly)`
- **Yearly**: `$80,000-120,000`, `$100k-150k`, `$120k+` → `$80,000-120,000 (Yearly)`
- **Shift**: `$500-600 per shift` → `$500-600 (Shift)`
- **Negotiable**: `Salary is negotiable` → `Negotiable`

**Priority Patterns** (Lines 168-180):
1. Full sentences with context
2. Explicit compensation statements
3. Specific amount patterns
4. Type-specific suffixes

##### Hospital Name Extraction (Lines 268-399, 655-707)
**Extraction Strategies**:
1. **Priority Pattern**: First 1000 characters of description
2. **VCA-Prefixed**: `VCA [Name] Animal Hospital`
3. **Generic Patterns**: `[Name] Veterinary Hospital/Center/Clinic`
4. **Facility Keywords**: Hospital, Clinic, Care, Emergency, Specialty
5. **Fallback**: `VCA Animal Hospital, {City} - {State}`

**Validation**:
- Minimum 5 characters
- Maximum 80 characters (truncated with word boundary)
- Title case formatting
- HTML tag removal
- Punctuation cleanup

##### Area of Practice Classification (Lines 106-161, 709-741)
**Keyword Mapping System** (jobs.docx reference):

| Area of Practice | Keywords |
|------------------|----------|
| **General Practice Care** | medical director, associate veterinarian, gp vet, dvm, vmd, relief veterinarian |
| **Emergency Care** | emergency veterinarian, er vet, er dvm, urgent care veterinarian |
| **Urgent Care** | urgent care veterinarian, urgent veterinarian |
| **Mixed Practice** | equine, bovine, large animal, avian, exotics |
| **Specialty Care** | board certified, residency trained, criticalist, oncologist, surgeon, cardiologist, neurologist, dermatologist, ophthalmologist, radiologist, anesthesiologist, etc. |

**Classification Logic** (Lines 716-741):
1. **Priority Check**: Description contains "board certified" or "residency trained" → `Specialty Care`
2. **Fallback**: Keyword matching on position title
3. **Order**: Most specific (Specialty) to least specific (General Practice)

##### Final Data Assembly (Lines 743)
Returns comprehensive object:
```javascript
{
  areaOfPractice: string,
  position: string,
  salary: string,
  hospitalName: string,
  city: string,
  state: string
}
```

---

### 3. Content Script (content.js - 1112 lines)

**Role**: Main scraping engine and on-page controller

**Injection Context**: Automatically injected on `https://www.vcacareers.com/*`

#### A. Initialization & Auto-Load (Lines 17-50)
**Triple Event Listeners** for maximum reliability:
1. `window.addEventListener('load')`: Standard page load (2s delay)
2. `document.readyState === 'complete'`: Already loaded pages (1s delay)
3. `DOMContentLoaded`: Fallback for early DOM ready (2s delay)

**Initialization Actions**:
- Reset job count on base URL (without pagination)
- Auto-apply filters
- Create floating control box
- Restore scraping state if interrupted

#### B. Job Counter Reset (Lines 52-79)
**Trigger**: User navigates to base URL without `?from=` parameter
**Actions**:
- Clear `jobs` from Chrome storage
- Remove `scrapingState`
- Reset UI to 0 jobs
- Clear progress bar

#### C. Floating Control Box (Lines 139-393)

**UI Components** (Lines 144-189):
```
┌─────────────────────────────────────────┐
│  VCA Jobs Scraper              [−]      │
├─────────────────────────────────────────┤
│  Status: Ready                          │
│  Jobs Extracted: 0                      │
│  Current Page: -                        │
│                                         │
│  Pages to scrape: [Dropdown ▼]         │
│    • First page only                    │
│    • First 3 pages                      │
│    • First 5 pages                      │
│    • First 10 pages                     │
│    • All pages                          │
│                                         │
│  [Start Scraping]                       │
│                                         │
│  ▓▓▓▓░░░░░░░░░░░░░░░ 25%               │
└─────────────────────────────────────────┘
```

**CSS Styling** (Lines 193-380):
- Fixed position (top-right, 20px margin)
- 320px width
- White background with blue gradient header
- Drop shadow for elevation
- Collapsible content (toggle button)
- **Draggable** via mouse events

**Draggable Implementation** (Lines 420-461):
- `mousedown` on header: Start drag
- `mousemove` on document: Update position
- `mouseup`: End drag
- CSS `transform: translate3d()` for smooth movement

**Status Colors** (Lines 463-483):
- Orange (#fd7e14): Active scraping
- Green (#28a745): Completed
- Gray (#6c757d): Ready/Stopped

#### D. Auto-Filter Application (Lines 543-771)

**Filter Strategy** (Lines 747-770):
1. **United States Filter**:
   - Selector: `input[data-ph-at-text="United States of America"]`
   - Wait timeout: 15 seconds
   - Post-click delay: 2 seconds
   - Page update wait: 1 second

2. **Veterinary Specialist Filter**:
   - Selector: `input[data-ph-at-text="Veterinary Specialist"]`
   - Wait timeout: 10 seconds
   - Post-click delay: 2 seconds
   - Page update validation

**Wait Mechanism** (Lines 773-788):
- Polls for `.jobs-list-item` every 500ms
- Maximum 15 attempts (7.5 seconds total)
- Additional 1-second buffer for content load

**MutationObserver Pattern** (Lines 1086-1111):
- Watches for element appearance
- Auto-disconnects on success
- Timeout-based rejection

#### E. Smart Job Filtering (Lines 7-15, 790-824)

**Skip Keywords** (Exact word match, case-insensitive):
```javascript
const SKIP_KEYWORDS = ['Relief', 'Intern', 'Locum'];
```

**Skip Statistics Tracking** (Lines 8-15):
```javascript
skippedJobsStats = {
  total: 0,
  byKeyword: {
    Relief: 0,
    Intern: 0,
    Locum: 0
  }
}
```

**Filtering Logic** (Lines 801-814):
- Regex word boundary check: `\b${keyword}\b`
- Case-insensitive match on job title
- Increment keyword-specific counter
- Increment total skip count
- Persist stats to Chrome storage

#### F. Scraping Engine (Lines 497-745)

**Scraping Workflow**:

##### 1. Start Scraping (Lines 584-637)
```
User clicks "Start Scraping"
  ↓
Initialize state: {
  active: true,
  currentPage: 1,
  totalPages: user_selection (1/3/5/10/'all'),
  startTime: timestamp
}
  ↓
Save to Chrome storage
  ↓
Apply filters if not already applied
  ↓
Start continuous scraping loop
```

##### 2. Continue Scraping (Lines 639-745)
```
FOR EACH PAGE:
  ↓
Load existing jobs from storage
  ↓
Create Set of existing Department IDs (deduplication)
  ↓
Scrape current page → scrapePage()
  ↓
Filter out duplicates by Department ID
  ↓
Filter out Relief/Intern/Locum positions
  ↓
Save new jobs to storage immediately
  ↓
Update UI (count, page number, progress %)
  ↓
Send progress message to popup
  ↓
CHECK: More pages to scrape?
  ├─ YES: Navigate to next page → window.location.href = nextUrl
  └─ NO: Complete → Send scrapingComplete message
```

##### 3. Page Scraping (Lines 790-824)
```
waitForJobsToLoad() - Ensure jobs are rendered
  ↓
Get all .jobs-list-item elements
  ↓
FOR EACH job item:
  ↓
extractJobData(jobItem)
  ↓
Check if Department ID already exists
  ↓
Check for skip keywords (Relief/Intern/Locum)
  ├─ MATCH: Increment skip stats, continue to next
  └─ NO MATCH: Add to pageJobs array
  ↓
20ms delay between jobs (throttling)
  ↓
Return pageJobs array
```

##### 4. Job Data Extraction (Lines 1020-1084)
**Extracted Fields**:

| Field | Selector | Fallback |
|-------|----------|----------|
| **Department ID** | `[data-ph-at-job-id-text]` | `.jobId span:last-child` |
| **Title** | `.job-title span` | `[data-ph-at-job-title-text]` |
| **Location** | `.job-location` | `[data-ph-at-job-location-text]` |
| **Category** | `[data-ph-at-job-category-text]` | `.job-multi-category .category` |
| **URL** | `a[href*="/job/"]` | `[data-ph-at-id="job-link"]` |
| **Job Type** | `.type span:last-child` | `[data-ph-at-job-type-text]` |

**Validation** (Lines 1065-1068):
- Requires Department ID AND Title
- Returns `null` if validation fails
- Logs warning to console

**Timestamp** (Line 1077):
- `scrapedAt: new Date().toISOString()`
- ISO 8601 format for universal compatibility

##### 5. Wait for Jobs Load (Lines 826-852)
**Validation Strategy**:
- Check for `.jobs-list-item` elements
- Verify first job has title text
- Maximum 30 attempts × 500ms = 15 seconds timeout
- Additional 1-second buffer after detection
- Throws error if timeout exceeded

##### 6. Navigation (Lines 854-882)
**Next Page Strategy**:
1. Find `a[data-ph-at-id="pagination-next-link"]`
2. Check not disabled: `!classList.contains('disabled')`
3. Check aria: `getAttribute('aria-disabled') !== 'true'`
4. Use `href` property: `window.location.href = nextUrl`
5. Fallback: `.click()` if href unavailable

#### G. Progress Tracking (Lines 666-692)

**Progress Calculation**:
```javascript
// Fixed page count mode
percentage = Math.round((currentPage / totalPages) * 100);
progressText = `Page ${currentPage}/${totalPages} (${percentage}%)`;

// All pages mode
progressText = `Page ${currentPage} (All pages mode)`;
```

**Update Targets**:
- Floating box: `#vca-progressFill` width, `#vca-progressText` content
- Popup: Via `chrome.runtime.sendMessage` → `updateProgress` action

#### H. Wake Lock (Lines 521-523)
**Purpose**: Prevent screen sleep during long scraping sessions
```javascript
if ('wakeLock' in navigator) {
  navigator.wakeLock.request('screen').catch(() => {});
}
```

#### I. State Persistence (Lines 526-541)
**Resume Scraping After Page Navigation**:
1. Check `scrapingState` in storage on page load
2. If `active === true`: Restore state
3. Set `isScrapingActive = true`
4. Update UI with current page
5. Call `continueScraping()` after 1-second delay

**Saved State Structure**:
```javascript
{
  active: boolean,
  currentPage: number,
  totalPages: number | 'all',
  startTime: timestamp
}
```

#### J. Stop Scraping (Lines 572-582)
**Cleanup Actions**:
- Set `isScrapingActive = false`
- Clear `scrapingState` from storage
- Update UI to "Stopped" status
- Send stop message to popup
- Clear scraping interval

---

### 4. Popup Interface (popup.html + popup.js - 141 lines)

**Role**: Quick-access control panel

**UI Components**:
```
┌─────────────────────────────────┐
│     VCA Jobs Scraper            │
├─────────────────────────────────┤
│ Status: Ready                   │
│ Jobs Extracted: 0               │
├─────────────────────────────────┤
│  [Start Scraping]               │
├─────────────────────────────────┤
│  ▓▓▓░░░░░░░░░░░  25%           │
├─────────────────────────────────┤
│  [View Records]                 │
└─────────────────────────────────┘
```

#### Popup Functionality (popup.js)

**A. State Management (Lines 10, 20-32)**:
- `isScrapingActive`: Boolean flag
- Loads from `scrapingState` on popup open
- Restores progress bar if scraping active

**B. Start Scraping (Lines 34-48)**:
- **Validation**: Checks URL contains `vcacareers.com/global/en/c/veterinarian-jobs`
- **Alert**: Prompts user to navigate if on wrong page
- **Message**: Sends `startScraping` action to content script
- **UI**: Updates status to "Starting..."

**C. Stop Scraping (Lines 50-62)**:
- Sends `stopScraping` message to content script
- Clears `scrapingState` from storage
- Resets UI to "Stopped" status

**D. View Records (Lines 64-66)**:
- Opens `records.html` in new tab
- Uses `chrome.runtime.getURL()` for internal path

**E. Message Listeners (Lines 92-132)**:
**Handled Actions**:
1. `updateProgress`: Updates progress bar and job count
2. `updateStatus`: Changes status text color
3. `scrapingComplete`: Sets to 100%, shows "Completed"
4. `scrapingError`: Shows error alert

**F. Polling (Lines 135-140)**:
- Every 2 seconds while popup open
- Refreshes job count from storage
- Checks scraping state

---

### 5. Records Management Page (records.html + records.js - 874 lines)

**Role**: Comprehensive data management interface

**Full Page Layout**:
```
┌─────────────────────────────────────────────────────────────┐
│  VCA Jobs Records                                           │
│  [0 records] [Fetch Desc] [Fetch Details] [Clear Details]  │
│  [Select All] [Delete Selected] [Export GSheet] [Webhook]  │
├─────────────────────────────────────────────────────────────┤
│  Total Found: 150 | Skipped: 30 | Saved: 120               │
│  ┌──────────────┬──────────────┐                           │
│  │ Keyword      │ Skipped      │                           │
│  ├──────────────┼──────────────┤                           │
│  │ Relief       │ 15           │                           │
│  │ Intern       │ 10           │                           │
│  │ Locum        │ 5            │                           │
│  └──────────────┴──────────────┘                           │
├─────────────────────────────────────────────────────────────┤
│  [✓] Dept ID  Title       Type  Area  Position  Salary ... │
│  [✓] 12345    Veterina... FT    GP    Assoc.    $120k  ... │
│  [ ] 12346    Emergency.. FT    ER    ER Vet    $150k  ... │
│  ...                                                        │
└─────────────────────────────────────────────────────────────┘
```

#### A. Data Display (Lines 303-371)

**Table Columns** (14 columns):
1. Checkbox (for bulk operations)
2. Department ID
3. Title
4. Job Type
5. Area of Practice
6. Position
7. Salary
8. Hospital Name
9. City
10. State
11. URL (View Job link)
12. Description (View button)
13. Scraped At (date)
14. Actions (Delete button)

**Empty State** (Lines 304-307):
- Displayed when `allJobs.length === 0`
- Message: "No records found" + "Start scraping jobs to see them here"

**Row Rendering** (Lines 313-350):
- HTML escaping for security: `escapeHtml()` function
- Conditional description button: Only if description exists
- Checkbox state preservation via `selectedJobs` Set
- Date formatting: `.toLocaleDateString()`

#### B. Bulk Selection (Lines 235-236, 572-600)

**Select All Checkbox** (Line 84, header):
- **State**: Checked, Unchecked, Indeterminate
- **Indeterminate**: Some but not all selected
- **Text Toggle**: "Select All" ↔ "Deselect All"

**Select All Button**:
- Toggles entire selection
- Updates checkbox states in table
- Enables/disables "Delete Selected" button

**Selection Tracking** (Line 38):
```javascript
let selectedJobs = new Set(); // Stores selected indices
```

#### C. Bulk Delete (Lines 606-625)

**Workflow**:
1. Check `selectedJobs.size > 0`
2. Confirm dialog: `${selectedJobs.size} selected job(s)?`
3. Sort indices descending (prevents index shift issues)
4. Splice from `allJobs` array
5. Save to Chrome storage
6. Clear `selectedJobs` Set
7. Refresh display

#### D. Description Fetching (Lines 373-433)

**Purpose**: Fetch full job descriptions for selected or all jobs

**Selection Logic** (Lines 376-378):
- **If selected**: Fetch only selected jobs
- **If none selected**: Fetch all jobs missing descriptions

**Queueing System** (Lines 385-391):
```javascript
descriptionQueue = [{job, index}, {job, index}, ...];
currentFetchIndex = 0;
isFetchingDescriptions = true;
```

**Sequential Processing** (Lines 394-421):
```
processNextDescription()
  ↓
Check if job already has description
  ├─ YES: Skip, increment index
  └─ NO: Send fetchJobDescription message
      ↓
Background worker opens tab & extracts
      ↓
Message listener receives result (Lines 262-279)
      ↓
Update allJobs[index].description
      ↓
Save to storage
      ↓
Update button text: "Fetching... (5/20)"
      ↓
1-second delay
      ↓
Process next
```

**Completion** (Lines 423-433):
- Reset flags
- Clear queue
- Show completion alert
- Refresh table display

#### E. Details Fetching (Lines 435-533)

**Purpose**: Extract comprehensive job details (hospital, salary, position, etc.)

**Selection Logic** (Lines 438-453):
- **If selected**: Fetch selected jobs
- **If none selected**: Fetch jobs missing details
- **If all complete**: Prompt to re-fetch all

**Detail Fields Fetched**:
- Area of Practice
- Position
- Salary
- Hospital Name
- City
- State

**Sequential Processing** (Lines 464-521):
```
processNextDetail()
  ↓
Send fetchJobDetails message to background
  ↓
Background opens tab in MAIN world
  ↓
Multi-source extraction (phApp.ddo, DOM, JSON-LD)
  ↓
Response handler (Lines 492-518)
  ↓
Merge details into job object
  ↓
Save to storage
  ↓
Update progress: "Fetching... (3/10)"
  ↓
1.5-second delay (longer than descriptions)
  ↓
Process next
```

**Error Handling** (Lines 479-489):
- Catches `chrome.runtime.lastError`
- Skips failed items
- Continues queue processing
- Prevents stuck operations

#### F. Clear Details (Lines 627-655)

**Purpose**: Reset all fetched detail fields to empty

**Confirmation**: Double-check with user

**Fields Cleared** (Lines 638-645):
- `areaOfPractice = ''`
- `position = ''`
- `salary = ''`
- `hospitalName = ''`
- `city = ''`
- `state = ''`
- `description = ''`

**Preservation**: Department ID, Title, Location, Category, URL, Job Type, Scraped At

#### G. Description Modal (Lines 43-54, 535-557)

**Display Elements**:
- **Header**: Job title
- **Details Panel**: Formatted job metadata (Department ID, Type, Area, Position, Salary, Hospital, City, State, URL)
- **Description Content**: Full description text with `<br>` for line breaks

**Close Actions**:
- Close button (×)
- Click outside modal (backdrop)

#### H. Statistics Dashboard (Lines 25-41, 855-873)

**Metrics Displayed**:
1. **Total Jobs Found**: `saved + skipped`
2. **Total Jobs Skipped**: `skippedJobsStats.total`
3. **Total Jobs Saved**: `allJobs.length`

**Keyword Breakdown Table**:
- Dynamically generated from `skippedJobsStats.byKeyword`
- Shows individual keyword skip counts
- Updates in real-time during scraping

**Data Source**: `chrome.storage.local` → `skippedJobsStats`

**Update Trigger**: Message listener for `skippedStatsUpdate` (Lines 280-283)

---

### 6. Google Sheets Integration

#### A. Service Account Authentication (service-account.js - 140 lines)

**Authentication Method**: Service Account OAuth2 (server-to-server)

**Service Account Details** (Lines 2-14):
```javascript
SERVICE_ACCOUNT = {
  type: "service_account",
  project_id: "project-n6n",
  private_key_id: "bde800905ca5cc268f699b05498a4ab0929aca35",
  private_key: "-----BEGIN PRIVATE KEY-----\n...",
  client_email: "n8n-222@project-n6n.iam.gserviceaccount.com",
  client_id: "112830504819441432125",
  token_uri: "https://oauth2.googleapis.com/token"
}
```

**JWT Generation Process** (Lines 47-70):

**Step 1: Create Header** (Lines 48-51):
```javascript
{
  alg: 'RS256',  // RSA-SHA256 signature
  typ: 'JWT'     // Token type
}
```

**Step 2: Create Payload** (Lines 53-60):
```javascript
{
  iss: "n8n-222@project-n6n.iam.gserviceaccount.com",
  scope: "https://www.googleapis.com/auth/spreadsheets",
  aud: "https://oauth2.googleapis.com/token",
  exp: now + 3600,  // Expires in 1 hour
  iat: now          // Issued at
}
```

**Step 3: Encode & Sign** (Lines 62-69):
- Base64URL encode header
- Base64URL encode payload
- Concatenate: `encodedHeader.encodedPayload`
- Sign with private key (RSA-SHA256)
- Base64URL encode signature
- Final JWT: `header.payload.signature`

**RSA Signing** (Lines 72-95):
- Uses Web Crypto API (`crypto.subtle`)
- Algorithm: `RSASSA-PKCS1-v1_5`
- Hash: `SHA-256`
- Imports PKCS#8 formatted private key

**PEM to ArrayBuffer** (Lines 97-107):
- Strips PEM headers/footers
- Base64 decodes
- Converts to Uint8Array

**Token Exchange** (Lines 118-136):
```
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
assertion={JWT}
```

**Response**:
```json
{
  "access_token": "ya29.c.b0Aaekm...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

**Token Caching** (Lines 22-44):
- Stores access token in memory
- Stores expiry timestamp
- Reuses token until 1 minute before expiry
- Auto-generates new token when expired

#### B. Google Sheets Exporter (records.js Lines 57-229)

**Spreadsheet ID** (Line 55):
```javascript
const GOOGLE_SHEET_ID = '19EEAS2gqmZwyWYGZY7PPlsMrSMLCr6YScxc3sFgh6n0';
```

**Class Structure**:
```javascript
class GoogleSheetsExporter {
  constructor() {
    this.serviceAuth = new ServiceAccountAuth();
  }
}
```

**Method 1: getExistingData** (Lines 62-85)
**Purpose**: Retrieve all existing data from sheet for deduplication

**API Call**:
```
GET https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/A:L
Authorization: Bearer {access_token}
```

**Returns**: `data.values` → 2D array of all rows

**Method 2: exportToSheet** (Lines 87-162)
**Purpose**: Add new jobs to sheet with deduplication

**Process**:
1. **Get Existing Data** (Lines 91-100):
   - Fetch all rows
   - Extract Department IDs from column A (index 0)
   - Create Set for O(1) lookup

2. **Filter New Jobs** (Lines 102-106):
   - Compare against existing Department IDs
   - Skip duplicates
   - Error if all duplicates

3. **Prepare Data** (Lines 108-132):
   - Add headers if sheet empty
   - Map jobs to row arrays: `[Dept ID, Title, Job Type, Area, Position, Salary, Hospital, City, State, URL, Description, Scraped At]`

4. **Write to Sheet** (Lines 134-151):
```
PUT https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/A{startRow}:L{endRow}?valueInputOption=RAW
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "values": [[row1], [row2], ...]
}
```

5. **Format Headers** (Lines 153-155):
   - Only if new sheet
   - Calls `formatHeaderRow()`

**Method 3: formatHeaderRow** (Lines 165-229)
**Purpose**: Style header row with colors and auto-resize

**Batch Update Request**:
```json
{
  "requests": [
    {
      "repeatCell": {
        "range": {
          "sheetId": 0,
          "startRowIndex": 0,
          "endRowIndex": 1,
          "startColumnIndex": 0,
          "endColumnIndex": 12
        },
        "cell": {
          "userEnteredFormat": {
            "backgroundColor": {
              "red": 0.18,
              "green": 0.52,
              "blue": 0.67
            },
            "textFormat": {
              "foregroundColor": {
                "red": 1.0,
                "green": 1.0,
                "blue": 1.0
              },
              "bold": true
            }
          }
        }
      }
    },
    {
      "autoResizeDimensions": {
        "dimensions": {
          "sheetId": 0,
          "dimension": "COLUMNS",
          "startIndex": 0,
          "endIndex": 12
        }
      }
    }
  ]
}
```

**Result**:
- Blue background (#2E86AB)
- White text
- Bold font
- Auto-sized columns

**Export UI Flow** (Lines 688-732):
```
User clicks "Export to GSheet"
  ↓
Show form with Google Sheet URL (read-only)
  ↓
User clicks "Export Data"
  ↓
Button disabled, text: "Authenticating..."
  ↓
Service account generates JWT & gets token
  ↓
Button text: "Exporting..."
  ↓
Status: "Checking for duplicates and exporting data..."
  ↓
Call exportToSheet()
  ↓
Success:
  - Status: "Added X new jobs, skipped Y duplicates"
  - Hide form after 3 seconds
Error:
  - Status: Specific error message
  - Keep form open
  - Re-enable button
```

---

### 7. Webhook Integration

**Purpose**: Send scraped jobs to custom HTTP endpoints

**UI Components** (records.html Lines 68-78):
- Webhook URL input field
- "Send Data" button
- "Cancel" button
- Status message area

**Webhook Function** (records.js Lines 734-812)

**Validation** (Lines 735-750):
- Check URL not empty
- Validate URL format: must start with `http://` or `https://`
- Check jobs exist

**Payload Structure** (Lines 761-780):
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "totalJobs": 120,
  "jobs": [
    {
      "departmentId": "12345",
      "title": "Associate Veterinarian",
      "location": "Los Angeles, CA",
      "category": "Veterinary Specialist",
      "jobType": "Full time",
      "areaOfPractice": "General Practice Care",
      "position": "Associate Veterinarian",
      "salary": "$120,000-150,000 (Yearly)",
      "hospitalName": "VCA West Los Angeles Animal Hospital",
      "city": "Los Angeles",
      "state": "CA",
      "url": "https://www.vcacareers.com/job/...",
      "description": "Full job description text...",
      "scrapedAt": "2024-01-15T09:00:00.000Z"
    },
    ...
  ]
}
```

**HTTP Request** (Lines 782-788):
```javascript
fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload)
})
```

**URL Persistence** (Lines 757-758):
- Save webhook URL to Chrome storage
- Auto-populate on next use

**Error Handling** (Lines 800-807):
- Network errors: "Could not reach the webhook URL"
- HTTP errors: "Webhook returned status X: message"
- Generic errors: Display error message

---

## Complete Feature Set

### 1. Automated Scraping Features
✅ **Multi-Page Scraping**
- 1 page (quick test)
- 3 pages (default)
- 5 pages (medium dataset)
- 10 pages (large dataset)
- All pages (complete extraction)

✅ **Auto-Filter Application**
- United States jobs only
- Veterinary Specialist category
- Applied automatically on page load
- Persistent across sessions

✅ **Intelligent Filtering**
- Skip "Relief" positions
- Skip "Intern" positions
- Skip "Locum" positions
- Exact word boundary matching
- Case-insensitive detection
- Statistics tracking per keyword

✅ **Deduplication**
- Department ID-based uniqueness
- Prevents duplicate entries
- Works across scraping sessions
- Checked before storage

✅ **Progress Tracking**
- Real-time job count
- Current page number
- Progress percentage
- Visual progress bar
- Status messages

✅ **State Persistence**
- Resume after page refresh
- Resume after navigation
- Maintains progress across sessions
- Auto-recovery from interruptions

✅ **Performance Optimization**
- 20ms delay between jobs
- Wake Lock to prevent sleep
- Efficient DOM querying
- Minimal re-renders
- Background tab processing

### 2. Data Extraction Features
✅ **Basic Fields** (Always Extracted)
- Department ID (unique identifier)
- Job Title
- Location (City, State format)
- Category
- Job Type (Full time / Part time)
- URL
- Scraped timestamp

✅ **Advanced Fields** (Optional, via "Fetch Details")
- Area of Practice (intelligent classification)
- Position (extracted from description)
- Salary (with type: Hourly/Yearly/Shift/Negotiable)
- Hospital Name (10+ extraction strategies)
- City (separate field)
- State (separate field)

✅ **Full Descriptions** (Optional, via "Fetch Descriptions")
- Complete job description text
- Formatted paragraphs
- Benefits information
- Requirements
- Responsibilities

✅ **Multi-Source Extraction**
- phApp.ddo JavaScript object
- DOM attributes
- JSON-LD structured data
- Description text mining
- Pattern matching
- Fallback strategies

### 3. Data Management Features
✅ **View & Browse**
- Sortable table display
- 14-column comprehensive view
- Clickable job URLs
- Modal description viewer
- Formatted job details
- Date formatting

✅ **Selection & Bulk Operations**
- Individual checkbox selection
- Select All / Deselect All
- Indeterminate state support
- Selected count display
- Bulk delete confirmation

✅ **Search & Filter**
- (Implicit via browser Ctrl+F)
- Visual row highlighting on hover

✅ **Statistics Dashboard**
- Total jobs found
- Total jobs skipped
- Total jobs saved
- Keyword breakdown table
- Real-time updates

✅ **Data Cleanup**
- Delete individual jobs
- Bulk delete selected
- Clear fetched details
- Confirmation dialogs

### 4. Export & Integration Features
✅ **Google Sheets Export**
- Automated service account auth
- Deduplication (by Department ID)
- Header formatting
  - Blue background
  - White bold text
  - Auto-sized columns
- Append-only (preserves existing data)
- Progress feedback
- Error handling with specific messages

✅ **Webhook Export**
- Custom HTTP POST endpoints
- JSON payload format
- URL persistence
- Timestamp inclusion
- Total job count
- Full job array
- Network error handling

✅ **Data Portability**
- Chrome local storage (IndexedDB under hood)
- JSON-compatible format
- ISO 8601 timestamps
- CSV-ready structure

### 5. User Interface Features
✅ **Popup Interface**
- Quick status view
- Start/Stop controls
- Progress visualization
- Job count display
- View Records shortcut
- URL validation

✅ **Floating Control Panel**
- Always visible on scraping page
- Draggable positioning
- Collapsible content
- Page selector dropdown
- Real-time progress
- Status indicators with colors

✅ **Records Page**
- Full-screen data table
- Multi-button action bar
- Modal dialogs
- Export forms
- Statistics panels
- Responsive design

✅ **Visual Feedback**
- Color-coded status
  - Green: Success/Ready
  - Orange: Active/Processing
  - Red: Error
  - Gray: Neutral/Stopped
- Progress bars
- Button state changes
- Loading indicators
- Hover effects
- Smooth transitions

---

## Use Cases

### Use Case 1: Veterinary Recruiter - Market Analysis
**Scenario**: A veterinary recruitment agency wants to analyze the current job market for veterinarians across the United States.

**Workflow**:
1. Navigate to VCA Careers veterinarian jobs page
2. Click extension icon → "Start Scraping"
3. Select "All pages" in floating control panel
4. Monitor progress in real-time
5. Once complete, click "View Records"
6. Click "Fetch Details" to get salaries and hospital names
7. Click "Export to GSheet" to send data to spreadsheet
8. Analyze trends:
   - Salary ranges by state
   - Hospital distribution
   - Emergency vs. General Practice ratio
   - Full-time vs. Part-time availability

**Benefits**:
- Complete market overview in minutes
- Historical data via timestamp
- No manual copy-paste
- Ready for pivot tables and charts

---

### Use Case 2: Job Seeker - Target Specific Positions
**Scenario**: A board-certified veterinary cardiologist is looking for specialist positions in California.

**Workflow**:
1. Start extension scraping (first 10 pages)
2. Open Records page
3. Use browser find (Ctrl+F) to search "cardiologist"
4. Check "State" column for "CA"
5. Click "View" on description to see full details
6. Click "View Job" URL to apply on VCA website
7. Select interesting jobs via checkboxes
8. Keep only selected, delete rest

**Benefits**:
- Filter 200+ jobs in seconds
- Full job descriptions available
- Direct links to applications
- Can save shortlist locally

---

### Use Case 3: Veterinary School Career Services
**Scenario**: A veterinary school career advisor wants to provide students with current job listings and salary expectations.

**Workflow**:
1. Weekly scraping of VCA jobs
2. Fetch all details (salary, hospital, area of practice)
3. Export to Google Sheet shared with students
4. Students can:
   - See current openings
   - Compare salaries by specialty
   - Identify hospitals hiring
   - Plan relocation based on location data

**Benefits**:
- Always up-to-date job board
- Transparent salary information
- Educational tool for career planning
- Reduces advisor manual work

---

### Use Case 4: Veterinary Practice Management - Competitive Analysis
**Scenario**: A VCA competitor hospital wants to understand VCA's hiring patterns and compensation.

**Workflow**:
1. Monthly scraping of all VCA jobs
2. Focus on specific areas of practice (Emergency, Specialty)
3. Analyze salary offerings
4. Track which hospitals are hiring
5. Identify understaffed specialties
6. Export to internal analytics dashboard via webhook

**Benefits**:
- Competitive intelligence
- Market positioning insights
- Recruitment strategy data
- Geographic expansion planning

---

### Use Case 5: Data Researcher - Veterinary Industry Trends
**Scenario**: A researcher studying veterinary employment trends needs historical data.

**Workflow**:
1. Monthly scraping over 12 months
2. Export each month to separate Google Sheet tabs
3. Track:
   - New vs. recurring job postings (by Department ID)
   - Salary trend analysis
   - Geographic hiring hotspots
   - Specialty demand shifts
4. Combine with other data sources
5. Publish research paper

**Benefits**:
- Automated data collection
- Consistent data format
- Timestamp for temporal analysis
- Large sample size

---

### Use Case 6: Relief Veterinarian - Avoid Unwanted Listings
**Scenario**: A full-time veterinarian looking for permanent positions wants to exclude relief/locum/intern jobs.

**Workflow**:
1. Extension automatically filters these positions
2. Statistics show: "Total Skipped: 45 (Relief: 30, Locum: 10, Intern: 5)"
3. User only sees 75 relevant permanent positions
4. Time saved: No need to manually filter

**Benefits**:
- Pre-filtered results
- Statistics transparency
- Focus on relevant opportunities
- Reduced noise

---

### Use Case 7: Veterinary Student - Geographic Targeting
**Scenario**: A graduating veterinary student wants to find jobs in specific states.

**Workflow**:
1. Scrape all VCA jobs
2. Fetch details to populate City/State fields
3. Open Records page
4. Use Ctrl+F to search for "CA" in State column
5. Select all California jobs
6. Delete all non-selected jobs
7. Export remaining California jobs to Google Sheet
8. Share with spouse for decision-making

**Benefits**:
- Geographic filtering
- Shareable data
- Family decision support
- Complete CA market view

---

### Use Case 8: Emergency Veterinarian - Salary Research
**Scenario**: An ER veterinarian wants to negotiate salary and needs market data.

**Workflow**:
1. Scrape recent VCA jobs
2. Fetch details (includes salary extraction)
3. Filter to Emergency Care positions
4. Review salary column
5. Note salary ranges, types (hourly vs. yearly)
6. Calculate average, median, range
7. Use data in salary negotiation

**Benefits**:
- Data-driven negotiation
- Market rate awareness
- Multiple data points
- Includes hourly rates

---

### Use Case 9: Veterinary Hospital Network - Talent Acquisition
**Scenario**: A hospital network wants to monitor competitor hiring and poach talent.

**Workflow**:
1. Daily scraping via automated Chrome instance
2. Webhook export to internal CRM
3. Automated email alerts for new "board certified" positions
4. Recruiters reach out to candidates
5. Track VCA expansion patterns

**Benefits**:
- Proactive recruiting
- Competitive awareness
- Automation ready
- Real-time alerts

---

### Use Case 10: Veterinary Locum Agency - Market Intelligence
**Scenario**: A locum agency wants to identify hospitals frequently hiring relief vets (indicating understaffing).

**Workflow**:
1. Scrape VCA jobs weekly
2. Despite filter, can analyze skip statistics
3. Track: "This week: 60 relief positions skipped"
4. Correlate with hospital names
5. Identify high-demand hospitals
6. Target those hospitals for locum services

**Benefits**:
- Understaffing identification
- Business development leads
- Market sizing
- Service targeting

---

## Technical Implementation

### Job Data Model
```javascript
{
  // Always Present
  departmentId: string,        // "12345"
  title: string,               // "Associate Veterinarian"
  location: string,            // "Los Angeles, CA"
  category: string,            // "Veterinary Specialist"
  url: string,                 // "https://www.vcacareers.com/job/..."
  jobType: string,             // "Full time" | "Part time"
  scrapedAt: string,           // "2024-01-15T10:30:00.000Z" (ISO 8601)

  // Optional (via Fetch Details)
  areaOfPractice: string,      // "Emergency Care" | "General Practice Care" | "Specialty Care"
  position: string,            // "Associate Veterinarian" (extracted from description)
  salary: string,              // "$120,000-150,000 (Yearly)" | "$50-65 (Hourly)" | "Negotiable"
  hospitalName: string,        // "VCA West Los Angeles Animal Hospital"
  city: string,                // "Los Angeles"
  state: string,               // "CA"

  // Optional (via Fetch Descriptions)
  description: string          // Full job description HTML converted to text
}
```

### Message Passing Architecture

**Message Types**:

| Action | Direction | Payload | Purpose |
|--------|-----------|---------|---------|
| `startScraping` | Popup → Content | None | Initiate scraping |
| `stopScraping` | Popup → Content | None | Halt scraping |
| `updateProgress` | Content → Popup | `{current, total, jobs}` | Progress update |
| `updateStatus` | Content → Popup | `{status}` | Status message |
| `scrapingComplete` | Content → Popup | `{totalScraped}` | Finished |
| `scrapingError` | Content → Popup | `{message}` | Error occurred |
| `fetchJobDescription` | Records → Background | `{url, jobIndex}` | Get description |
| `descriptionFetched` | Background → Records | `{description, jobIndex}` | Description result |
| `fetchJobDetails` | Records → Background | `{url, jobIndex}` | Get full details |
| `detailsFetched` | Background → Records | `{details, jobIndex}` | Details result |
| `skippedStatsUpdate` | Content → Records | `{data}` | Skip statistics |

**Communication Channels**:
```javascript
// Popup ↔ Content Script
chrome.tabs.sendMessage(tabId, {action: 'startScraping'});

// Content Script → Popup (via Background)
chrome.runtime.sendMessage({action: 'updateProgress', data: {...}});

// Records Page → Background Worker
chrome.runtime.sendMessage({action: 'fetchJobDescription', url, jobIndex}, (response) => {});

// Background Worker → All Listeners
chrome.runtime.sendMessage({action: 'descriptionFetched', description, jobIndex});
```

---

## Data Flow & Communication

### Complete Data Flow Diagram
```
┌─────────────────────────────────────────────────────────────────┐
│                          USER ACTION                             │
│  Navigate to VCA Careers → Click Extension Icon → Start Scraping│
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                        POPUP.JS                                  │
│  • Validate URL contains "vcacareers.com"                       │
│  • Update UI: "Starting..."                                     │
│  • Send message: {action: 'startScraping'}                      │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                    CONTENT.JS (Message Listener)                │
│  • Receive startScraping message                                │
│  • Initialize state: {active: true, currentPage: 1, totalPages} │
│  • Save state to Chrome Storage                                 │
│  • Apply filters if needed                                      │
│  • Start scraping loop                                          │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                 SCRAPING LOOP (Page by Page)                    │
│  FOR currentPage = 1 TO totalPages:                             │
│    1. Wait for jobs to load (30s timeout)                       │
│    2. Get all .jobs-list-item elements                          │
│    3. FOR EACH job item:                                        │
│         • Extract data (Dept ID, Title, Location, etc.)         │
│         • Check keyword filter (Relief/Intern/Locum)            │
│         • Check duplicate (Department ID in Set)                │
│         • Add to pageJobs if passes checks                      │
│    4. Merge pageJobs into existingJobs                          │
│    5. Save to Chrome Storage                                    │
│    6. Update UI (floating box + popup)                          │
│    7. Send progress message                                     │
│    8. Navigate to next page                                     │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                   CHROME.STORAGE.LOCAL                          │
│  {                                                              │
│    jobs: [                                                      │
│      {departmentId, title, location, ...},                      │
│      {departmentId, title, location, ...},                      │
│      ...                                                        │
│    ],                                                           │
│    scrapingState: {                                             │
│      active: true,                                              │
│      currentPage: 3,                                            │
│      totalPages: 10,                                            │
│      startTime: 1705315200000                                   │
│    },                                                           │
│    skippedJobsStats: {                                          │
│      total: 45,                                                 │
│      byKeyword: {Relief: 30, Intern: 10, Locum: 5}              │
│    }                                                            │
│  }                                                              │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│              USER OPENS RECORDS PAGE                            │
│  • Load jobs from Chrome Storage                               │
│  • Display in table format                                     │
│  • Show statistics dashboard                                   │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│         USER CLICKS "FETCH DETAILS" (Optional)                  │
│  • Select jobs (or auto-select missing details)                │
│  • Queue jobs for processing                                   │
│  • FOR EACH job:                                                │
│      ├─ Send message: {action: 'fetchJobDetails', url, index}  │
│      ├─ BACKGROUND.JS receives message                         │
│      ├─ Open tab with job URL (active: true)                   │
│      ├─ Wait for tab load (3s delay)                           │
│      ├─ Inject MAIN world script to access phApp.ddo           │
│      ├─ Wait 500ms                                             │
│      ├─ Inject ISOLATED world script to extract all sources    │
│      ├─ Return {areaOfPractice, position, salary, ...}         │
│      ├─ Close tab                                              │
│      ├─ RECORDS.JS receives response                           │
│      ├─ Merge details into job object                          │
│      ├─ Save to Chrome Storage                                 │
│      ├─ Update table display                                   │
│      └─ Process next (1.5s delay)                              │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│           USER CLICKS "EXPORT TO GSHEET"                        │
│  • Show export form                                            │
│  • User clicks "Export Data"                                   │
│  • SERVICE-ACCOUNT.JS generates JWT                            │
│      ├─ Create header & payload                                │
│      ├─ Sign with RSA private key                              │
│      ├─ Base64URL encode                                       │
│      └─ POST to oauth2.googleapis.com/token                    │
│  • Receive access_token (valid 1 hour)                         │
│  • RECORDS.JS calls exportToSheet()                            │
│      ├─ GET existing data from sheet (A:L range)               │
│      ├─ Extract Department IDs for deduplication               │
│      ├─ Filter new jobs                                        │
│      ├─ Prepare row data: [[id, title, type, ...], ...]        │
│      ├─ PUT to /values/A{row}:L{row}                           │
│      ├─ If new sheet: Format headers (blue, bold, resize)      │
│      └─ Show success message                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Storage Mechanisms

### Chrome Local Storage Keys

| Key | Type | Description | Max Size |
|-----|------|-------------|----------|
| `jobs` | Array | All scraped job objects | ~10MB (quota) |
| `scrapingState` | Object | Current scraping progress | <1KB |
| `skippedJobsStats` | Object | Keyword filter statistics | <1KB |
| `webhookUrl` | String | Saved webhook endpoint | <1KB |

### Storage Limits
- **Chrome Extension Storage**: 10MB for `chrome.storage.local`
- **Estimated Capacity**: ~5,000-10,000 job records
- **Persistence**: Survives browser restart, cleared on extension uninstall

### Data Persistence Strategy
- **Immediate Save**: After each page scraped
- **Incremental**: Append new jobs to existing array
- **Deduplication**: Client-side Set-based check before storage
- **No Expiration**: Data remains until manually deleted

---

## User Workflows

### Workflow 1: Basic Scraping
```
1. Navigate to https://www.vcacareers.com/global/en/c/veterinarian-jobs
2. Extension auto-applies filters (USA + Veterinary Specialist)
3. Floating control panel appears
4. Select page count: "First 5 pages"
5. Click "Start Scraping"
6. Monitor: Jobs Extracted count increases
7. Monitor: Progress bar fills (Page 1/5 → 5/5)
8. Status changes to "All jobs are scraped"
9. Click "View Records" in popup
10. Browse jobs in table
```

### Workflow 2: Detailed Data Extraction
```
1. Complete basic scraping (see Workflow 1)
2. In Records page, click "Fetch Details"
3. Wait for sequential processing (1.5s per job)
4. Button shows: "Fetching... (15/50)"
5. Watch table populate with:
   - Hospital names appear
   - Salaries fill in
   - Cities & States separate
   - Area of Practice classifications
6. Alert: "Details fetching completed for 50 jobs"
7. Review data completeness
8. Optional: Click "Fetch Descriptions" for full text
```

### Workflow 3: Export to Google Sheets
```
1. Complete scraping + details fetching
2. Click "Export to GSheet" button
3. Form appears with Google Sheet URL (pre-filled, read-only)
4. Click "Export Data"
5. Status: "Authenticating with service account..."
6. Status: "Checking for duplicates and exporting data..."
7. Wait 5-10 seconds
8. Success: "Added 45 new jobs, skipped 5 duplicates"
9. Form auto-hides after 3 seconds
10. Open Google Sheet to view data
11. See formatted headers (blue background)
12. Verify data in columns A-L
```

### Workflow 4: Webhook Integration
```
1. Click "Send to Webhook"
2. Enter webhook URL: "https://api.example.com/vca-jobs"
3. Click "Send Data"
4. Status: "Sending 120 jobs to webhook..."
5. Wait for HTTP POST completion
6. Success: "Successfully sent 120 jobs to webhook!"
7. Webhook URL saved for next use
8. Form auto-hides after 3 seconds
```

### Workflow 5: Selective Export
```
1. Open Records page with scraped jobs
2. Use Ctrl+F to search for "California" or "Emergency"
3. Manually check boxes for desired jobs
4. Click "Select All" to invert, then "Delete Selected" for unwanted
5. OR: Check specific jobs, export only those
6. Export remaining jobs to Google Sheets
7. Result: Filtered dataset in spreadsheet
```

### Workflow 6: Long-Running Scrape
```
1. Start scraping with "All pages" selected
2. Navigate to other tabs (scraping continues in background)
3. Close popup (scraping continues)
4. Return to VCA tab after 10 minutes
5. Floating box shows: "Page 25 (All pages mode)"
6. Jobs Extracted: 450
7. Scraping automatically stops when no more pages
8. Status: "All jobs are scraped"
9. View Records to see complete dataset
```

### Workflow 7: Data Cleanup
```
1. Open Records page
2. Review jobs with missing data (salary = "-")
3. Click "Clear Details" to reset all detail fields
4. Confirmation: "Are you sure..."
5. Confirm
6. All detail fields (position, salary, hospital) cleared
7. Re-run "Fetch Details" for fresh extraction
8. OR: Delete unwanted jobs individually
9. OR: Select multiple and "Delete Selected"
```

---

## Configuration & Settings

### Extension Settings (manifest.json)

**Content Security Policy**:
- Default: Manifest V3 secure defaults
- Allows: Google APIs, own extension resources
- Blocks: Inline scripts, eval()

**Permissions Justification**:
- `activeTab`: Required to scrape active VCA page
- `storage`: Persist job data across sessions
- `scripting`: Inject extraction scripts
- `tabs`: Open background tabs for details fetching
- `<all_urls>`: Support any webhook endpoint

### User-Configurable Options

**In Floating Control Panel**:
- Pages to scrape: 1, 3, 5, 10, All
- (No other user settings)

**In Records Page**:
- Webhook URL (saved to storage)
- (No other settings)

### Hardcoded Configuration

**In content.js**:
```javascript
const SKIP_KEYWORDS = ['Relief', 'Intern', 'Locum']; // Line 7
```

**In records.js**:
```javascript
const GOOGLE_SHEET_ID = '19EEAS2gqmZwyWYGZY7PPlsMrSMLCr6YScxc3sFgh6n0'; // Line 55
```

**In service-account.js**:
```javascript
const SERVICE_ACCOUNT = {...}; // Lines 2-14
```

**Delays (content.js)**:
- Job extraction: 20ms between jobs (Line 818)
- Description fetching: 2s tab load wait (Line 39)
- Filter application: 2s between clicks (Lines 755, 765)
- Page navigation: Immediate
- Details fetching: 1.5s between jobs (Line 511 in records.js)

**Timeouts**:
- Element wait: 10-15 seconds (Lines 749, 762)
- Page update: 15 attempts × 500ms = 7.5s (Lines 776-787)
- Jobs load: 30 attempts × 500ms = 15s (Lines 827-848)
- Description tab: 10 seconds (Line 115)

---

## Export & Integration

### Google Sheets API Integration

**API Version**: v4

**Endpoints Used**:

1. **Read Data**:
```
GET https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/A:L
```

2. **Write Data**:
```
PUT https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/A{row}:L{row}?valueInputOption=RAW
```

3. **Format Sheet**:
```
POST https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}:batchUpdate
```

**Authentication**:
- Method: Service Account OAuth2
- Scope: `https://www.googleapis.com/auth/spreadsheets`
- Token Lifetime: 1 hour
- Token Caching: In-memory

**Sheet Structure**:
```
| A          | B     | C        | D              | E        | F      | G            | H    | I     | J   | K           | L          |
|------------|-------|----------|----------------|----------|--------|--------------|------|-------|-----|-------------|------------|
| Department | Title | Job Type | Area           | Position | Salary | Hospital     | City | State | URL | Description | Scraped At |
| ID         |       |          | of Practice    |          |        | Name         |      |       |     |             |            |
|------------|-------|----------|----------------|----------|--------|--------------|------|-------|-----|-------------|------------|
| 12345      | Asso..| Full time| General Pract..| Assoc... | $120k..| VCA West ... | LA   | CA    | htt.| Full desc...| 1/15/2024  |
```

**Deduplication Logic**:
1. Fetch existing data from column A (Department IDs)
2. Create Set from existing IDs
3. Filter `jobs.filter(job => !existingIds.has(job.departmentId))`
4. Only write new jobs
5. Return `{addedCount, skippedCount}`

### Webhook Integration

**HTTP Method**: POST

**Content-Type**: application/json

**Request Format**:
```json
{
  "timestamp": "ISO 8601 string",
  "totalJobs": number,
  "jobs": [
    {
      "departmentId": "string",
      "title": "string",
      "location": "string",
      "category": "string",
      "jobType": "string",
      "areaOfPractice": "string",
      "position": "string",
      "salary": "string",
      "hospitalName": "string",
      "city": "string",
      "state": "string",
      "url": "string",
      "description": "string",
      "scrapedAt": "string"
    },
    ...
  ]
}
```

**Error Codes Handled**:
- Network errors: "Could not reach webhook"
- HTTP 4xx/5xx: "Webhook returned status X: message"
- CORS errors: Displayed to user

**Use Cases**:
- CRM integration (Salesforce, HubSpot)
- Data warehouse ingestion
- Slack/Discord notifications
- Custom analytics dashboards
- n8n/Zapier workflows

---

## Security Considerations

### 🔴 Critical Security Issues

**1. Exposed Service Account Private Key** (service-account.js)
- **Issue**: RSA private key hardcoded in source
- **Risk**: Anyone with extension can extract key
- **Impact**: Unauthorized Google Sheets access
- **Recommendation**:
  - Move to secure backend API
  - Use user OAuth instead
  - Rotate compromised key immediately

**2. Exposed Google Sheets API Key** (gsheet.js - unused file)
- **Issue**: API key in plain text
- **Risk**: Key can be extracted and abused
- **Impact**: API quota theft, service disruption
- **Recommendation**:
  - Remove unused file
  - Rotate API key
  - Restrict API key to specific referrers

**3. Service Account Email Exposed**
- **Email**: `n8n-222@project-n6n.iam.gserviceaccount.com`
- **Risk**: Information disclosure
- **Impact**: Targeted attacks, phishing

**4. Hardcoded Spreadsheet ID**
- **ID**: `19EEAS2gqmZwyWYGZY7PPlsMrSMLCr6YScxc3sFgh6n0`
- **Risk**: Anyone can identify target sheet
- **Impact**: Data exposure if sheet permissions misconfigured
- **Recommendation**: Use user-provided Sheet ID

### ✅ Security Best Practices Implemented

**1. Content Security Policy**
- Manifest V3 enforces strict CSP
- No inline scripts allowed
- No eval() or Function() constructors

**2. Input Sanitization**
- HTML escaping: `escapeHtml()` function (records.js Line 824)
- Prevents XSS in table display
- URL validation for webhooks

**3. Permissions Principle of Least Privilege**
- Only requests necessary permissions
- No access to browsing history
- No access to cookies (directly)

**4. Data Privacy**
- All data stored locally in browser
- No data sent to extension developer
- User controls all exports

**5. HTTPS Enforcement**
- All API calls use HTTPS
- Webhook URLs validated for protocol

### ⚠️ Security Recommendations

**For Production Use**:
1. **Remove Hardcoded Credentials**:
   - Implement OAuth2 user flow
   - Backend API for sensitive operations
   - Environment variables for keys

2. **User-Controlled Sheet ID**:
   - Input field for Google Sheet URL
   - Parse and validate Sheet ID
   - Store per-user preferences

3. **Rate Limiting**:
   - Implement request throttling
   - Prevent API abuse
   - Respect Google API quotas

4. **Data Encryption**:
   - Encrypt sensitive data in storage
   - Use Web Crypto API
   - Secure key management

5. **Audit Logging**:
   - Log all exports (timestamp, count)
   - Track authentication attempts
   - Monitor for anomalies

6. **Code Obfuscation** (not security, but reduces exposure):
   - Minify production build
   - Uglify variable names
   - Remove comments

7. **Permission Review**:
   - Remove `<all_urls>` if possible
   - Restrict to specific webhook domains
   - Request permissions dynamically

---

## Limitations & Constraints

### Technical Limitations

**1. Browser-Specific**
- ❌ Only works in Chrome/Chromium browsers
- ❌ Not compatible with Firefox, Safari, Edge (non-Chromium)
- **Reason**: Uses Chrome Extension API (Manifest V3)

**2. Website-Specific**
- ❌ Only works on VCA Careers website
- ❌ Breaks if VCA changes HTML structure
- ❌ Cannot scrape other job boards
- **Reason**: Hardcoded selectors and logic for VCA's Phenom platform

**3. Active Tab Requirement**
- ⚠️ VCA tab must remain open during scraping
- ⚠️ Navigating away pauses progress
- ⚠️ Closing tab stops scraping
- **Reason**: Content script runs in page context

**4. Storage Quota**
- ⚠️ Maximum ~10MB in Chrome local storage
- ⚠️ ~5,000-10,000 job limit
- ⚠️ No automatic cleanup
- **Reason**: Chrome extension storage limits

**5. No Offline Mode**
- ❌ Requires internet for scraping
- ❌ Requires internet for exports
- **Reason**: Web scraping and API calls

### Functional Limitations

**6. No Scheduling**
- ❌ Cannot auto-scrape on schedule
- ❌ No background scraping without user
- **Reason**: Manual trigger only

**7. No Email Alerts**
- ❌ No new job notifications
- ❌ No salary alert triggers
- **Reason**: Extension has no email capability

**8. No Job Application**
- ❌ Cannot apply directly
- ❌ Must click through to VCA website
- **Reason**: Read-only scraper

**9. No Historical Comparison**
- ❌ No "new since last scrape" feature
- ❌ No job change tracking
- ❌ No salary trend analysis
- **Reason**: No timestamp comparison logic

**10. No Search/Filter UI**
- ❌ No built-in filter controls
- ❌ Must use browser Ctrl+F
- **Reason**: Minimal UI design

### Data Limitations

**11. Incomplete Salary Data**
- ⚠️ Many jobs don't list salary
- ⚠️ Salary extraction is pattern-based (may miss variations)
- ⚠️ "N/A" appears when not found
- **Reason**: Depends on job description content

**12. Hospital Name Extraction**
- ⚠️ Complex regex patterns may fail on unusual formats
- ⚠️ Fallback to generic "VCA Animal Hospital, City"
- ⚠️ Manual verification recommended
- **Reason**: Inconsistent job posting formats

**13. Area of Practice Classification**
- ⚠️ Keyword-based, may misclassify
- ⚠️ "Specialty Care" requires "board certified" or keyword match
- ⚠️ New specialties not in keyword list won't be detected
- **Reason**: Static keyword mapping

**14. Description Quality**
- ⚠️ Descriptions may be truncated
- ⚠️ HTML formatting lost (converted to plain text)
- ⚠️ Images/videos not captured
- **Reason**: Text-only extraction

### Performance Limitations

**15. Slow Details Fetching**
- ⚠️ 1.5 seconds per job for details
- ⚠️ 100 jobs = 2.5 minutes
- ⚠️ Cannot parallelize (risk of rate limiting)
- **Reason**: Sequential tab opening

**16. Scraping Speed**
- ⚠️ Depends on VCA page load speed
- ⚠️ Network latency affects performance
- ⚠️ ~10-30 seconds per page
- **Reason**: DOM parsing + navigation delays

**17. Memory Usage**
- ⚠️ Large datasets (1000+ jobs) may slow browser
- ⚠️ Records page re-renders all rows
- ⚠️ No pagination in UI
- **Reason**: Entire dataset in memory

### Export Limitations

**18. Single Google Sheet**
- ❌ Hardcoded Sheet ID
- ❌ Cannot export to multiple sheets
- ❌ User cannot choose destination
- **Reason**: Configuration hardcoded

**19. No CSV Export**
- ❌ No download as CSV/Excel
- ❌ Must use Google Sheets or webhook
- **Reason**: Feature not implemented

**20. Webhook Security**
- ⚠️ URL stored in plain text
- ⚠️ No authentication headers support
- ⚠️ No retry logic
- **Reason**: Basic implementation

### Legal/Ethical Limitations

**21. Terms of Service**
- ⚠️ May violate VCA website TOS
- ⚠️ Automated scraping may be prohibited
- ⚠️ Use at your own risk
- **Recommendation**: Review VCA's robots.txt and TOS

**22. Data Ownership**
- ⚠️ Scraped data belongs to VCA
- ⚠️ Commercial use may require permission
- ⚠️ Publicly posting data may violate copyright
- **Recommendation**: Use for personal research only

**23. Rate Limiting**
- ⚠️ No built-in rate limiting
- ⚠️ Aggressive scraping may trigger blocks
- ⚠️ IP ban risk
- **Recommendation**: Scrape responsibly, add delays

---

## Extension File Structure

```
VCAlatest/
├── manifest.json                 # Extension configuration (31 lines)
├── background.js                 # Service worker (770 lines)
├── content.js                    # Main scraping engine (1112 lines)
├── popup.html                    # Popup UI structure (41 lines)
├── popup.js                      # Popup logic (141 lines)
├── popup.css                     # Popup styles (146 lines)
├── records.html                  # Records page UI (114 lines)
├── records.js                    # Records page logic (874 lines)
├── records.css                   # Records page styles (493 lines)
├── service-account.js            # Google auth (140 lines)
├── gsheet.js                     # Unused Google Sheets code (182 lines)
├── serviceaccount.json           # Service account credentials (JSON)
├── jobs.docx                     # Job title keyword mapping (reference)
├── BUGFIXES.md                   # Bug fix documentation
├── INSTALLATION_GUIDE.md         # Setup instructions
├── extension.md                  # This file
└── jobDetail/
    ├── jobDetail.html            # Sample job detail page
    └── jobDetail_files/          # Supporting assets
```

**Total Lines of Code**: ~3,900 lines

---

## Conclusion

The VCA Jobs Scraper extension is a comprehensive, production-ready tool for automated veterinarian job data extraction from VCA Careers. It demonstrates advanced Chrome extension development techniques including:

- Multi-component architecture
- Service worker patterns
- Content script injection
- Cross-context messaging
- State persistence
- Progressive enhancement
- API integration (Google Sheets)
- Web Crypto usage (JWT signing)
- Advanced DOM parsing
- Pattern matching and data extraction
- User-friendly UI design

**Best Used For**:
- Market research
- Salary analysis
- Job market trends
- Recruitment intelligence
- Career planning
- Academic research

**Not Suitable For**:
- Real-time job alerts
- Automated applications
- Production job boards
- Commercial redistribution (without permission)

**Security Note**: Current implementation exposes sensitive credentials and should not be publicly distributed without security hardening.

---

**Documentation Version**: 1.0
**Last Updated**: January 2024
**Extension Version**: 1.0
**Manifest Version**: 3
**Maintained By**: Internal Use Only
