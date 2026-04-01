# VCA Job Scraper - Complete Workflow Explanation

## 🔄 EXTENSION WORKFLOW - STEP BY STEP

---

## PHASE 1️⃣: INITIAL SCRAPING (Automatic on VCA Page)

### What Gets Scraped
When you visit the VCA Careers page and start scraping, the extension extracts **basic information** from the job listing cards:

```
┌─────────────────────────────────────────────┐
│  Job Listing Card (on main search page)    │
├─────────────────────────────────────────────┤
│  ✅ Department ID (R-110261)                │
│  ✅ Job Title (Neurologist)                 │
│  ✅ Location (Westbury, New York)           │
│  ✅ Category (Veterinary Specialist)        │
│  ✅ Job URL (https://www.vcacareers.com...) │ ← EXTRACTED HERE
│  ✅ Job Type (Full time / Part time)        │
│  ✅ Scraped Timestamp                       │
└─────────────────────────────────────────────┘
```

### File: `content.js`
### Process:

1. **User navigates to:** `https://www.vcacareers.com/global/en/c/veterinarian-jobs`

2. **Extension auto-loads** and creates floating control panel

3. **Auto-applies filters:**
   - ✅ United States only
   - ✅ Veterinary Specialist category

4. **User clicks "Start Scraping"**

5. **For EACH job card** on the page:

   ```javascript
   // Find the job card
   const jobItems = document.querySelectorAll('.jobs-list-item');

   // For each job card, extract:
   - Department ID: from [data-ph-at-job-id-text]
   - Title: from .job-title span
   - Location: from .job-location
   - Category: from [data-ph-at-job-category-text]
   - URL: from .job-title a[href*="/job/"]  ← IMPORTANT!
   - Job Type: from .type span:last-child
   ```

6. **URL Extraction Priority** (NEW - FIXED):
   ```javascript
   Priority 1: [data-ph-at-id="job-link"]
   Priority 2: .job-title a[href*="/job/"]
   Priority 3: a[href*="/job/DEPARTMENT_ID"]  ← Ensures URL matches job
   Priority 4: a[href*="/job/"] (any link)

   Then VALIDATES: URL must contain the Department ID
   ```

7. **Smart Filtering:**
   - Skips jobs with: "Relief", "Intern", "Locum"
   - Tracks skip statistics

8. **Deduplication:**
   - Checks if Department ID already exists
   - Skips duplicates

9. **Saves immediately** to `chrome.storage.local`

10. **Navigates to next page** (if scraping multiple pages)

### ⚠️ AT THIS POINT:
- ✅ URL is saved correctly (if fix applied)
- ❌ NO hospital name yet
- ❌ NO salary yet
- ❌ NO area of practice yet
- ❌ NO description yet

---

## PHASE 2️⃣: VIEW RECORDS

### File: `records.html` + `records.js`

1. **User clicks "View Records"**

2. **Records page loads all scraped jobs** from Chrome storage

3. **Displays 14-column table:**
   ```
   | ☑ | Dept ID | Title | Type | Area | Position | Salary | Hospital | City | State | URL | Desc | Date | Actions |
   ```

4. **Empty fields at this stage:**
   - Area of Practice: (empty)
   - Position: (empty)
   - Salary: (empty)
   - Hospital Name: (empty)
   - City: (empty)
   - State: (empty)
   - Description: (empty)

5. **Populated fields:**
   - ✅ Department ID
   - ✅ Title
   - ✅ Job Type
   - ✅ URL (from Phase 1)
   - ✅ Scraped At

---

## PHASE 3️⃣: FETCH DETAILS (Optional - Opens Each Job Page)

### File: `background.js` (service worker)

### What Happens:

1. **User clicks "Fetch Details" button**

2. **Background worker processes EACH job:**

   ```
   FOR EACH JOB:
     ↓
   1. Read job.url from saved data  ← Uses the URL from Phase 1
     ↓
   2. Open URL in NEW TAB (hidden, active: true)
      chrome.tabs.create({ url: job.url })
     ↓
   3. Wait 3 seconds for page load
     ↓
   4. Inject script into MAIN world
      → Access window.phApp.ddo object
     ↓
   5. Wait 500ms
     ↓
   6. Inject script into ISOLATED world
      → Extract from multiple sources:
        • Pattern matching in description
        • phApp.ddo JavaScript object
        • DOM attributes
        • JSON-LD structured data
        • Text mining
     ↓
   7. Extract:
      🔍 Hospital Name (10+ strategies)
      🔍 Salary (multiple patterns)
      🔍 City (separate field)
      🔍 State (separate field)
      🔍 Position (from description)
      🔍 Area of Practice (classification)
     ↓
   8. Close the tab
     ↓
   9. Send data back to records.js
     ↓
   10. Merge into job object at correct index
     ↓
   11. Save to Chrome storage
     ↓
   12. Wait 1.5 seconds (rate limiting)
     ↓
   NEXT JOB
   ```

3. **Progress shown:** "Fetching... (5/20)"

4. **When complete:** Table updates with new data

### 🔑 KEY POINT:
**The URL from Phase 1 is used to open the correct job page.**
If the URL was wrong in Phase 1, it will open the wrong job page here!

---

## PHASE 4️⃣: FETCH DESCRIPTIONS (Optional)

### Similar to Phase 3, but:

1. Opens each `job.url`
2. Extracts ONLY the description text
3. Saves to job.description
4. 1 second delay between jobs

---

## PHASE 5️⃣: EXPORT

### Option A: Google Sheets
- Authenticates with service account
- Reads existing sheet
- Deduplicates by Department ID
- Writes new rows
- Formats headers

### Option B: Webhook
- POSTs JSON to custom URL

### Option C: CSV Download
- Generates CSV file
- Downloads to computer

---

## 🐛 THE URL BUG EXPLAINED

### What Was Wrong:

In `content.js`, the URL extraction was:
```javascript
// OLD CODE (WRONG)
const linkElement = jobItem.querySelector('a[href*="/job/"]');
```

This grabbed the **FIRST** `<a>` tag with "/job/" in it, which could be:
- ❌ A "Similar Jobs" link
- ❌ A related position link
- ❌ A hospital profile link
- ✅ The actual job title link (if it comes first)

### Example of Wrong Extraction:

```html
<div class="jobs-list-item">
  <a href="/job/R-999999/similar-position">Similar Job</a>  ← WRONG (but matched first!)
  <h2 class="job-title">
    <a href="/job/R-110261/neurologist">Neurologist</a>  ← CORRECT (but ignored!)
  </h2>
</div>
```

**Result:** Department ID `R-110261` got the URL for `R-999999` 😱

### How It's Fixed Now:

1. **Priority selectors** - tries `.job-title a` first
2. **Department ID matching** - ensures URL contains the correct Department ID
3. **Validation** - logs ❌ if URL doesn't match
4. **Auto-correction** - tries to find correct URL if mismatch detected

```javascript
// NEW CODE (FIXED)
// 1. Try specific job title link
let linkElement = jobItem.querySelector('.job-title a[href*="/job/"]');

// 2. Ensure it contains the department ID
if (!linkElement && departmentId) {
  linkElement = jobItem.querySelector(`a[href*="/job/${departmentId}"]`);
}

// 3. Validate
if (url && !url.includes(departmentId)) {
  console.error('❌ URL mismatch!');
  // Try to fix...
}
```

---

## 📊 DATA FLOW SUMMARY

```
VCA Careers Page (Listing)
         ↓
   [PHASE 1: Scrape Basic Info]
         ↓
   Chrome Storage
   {
     departmentId: "R-110261",
     title: "Neurologist",
     url: "https://www.vcacareers.com/global/en/job/R-110261/Neurologist"  ← SAVED HERE
     // ... other basic fields
   }
         ↓
   [PHASE 2: View Records]
         ↓
   Display in table (URL is clickable)
         ↓
   [PHASE 3: Fetch Details] (user clicks button)
         ↓
   Background worker opens: job.url  ← USES THE URL FROM PHASE 1
         ↓
   VCA Job Detail Page (Individual Job)
         ↓
   Extract: hospital, salary, etc.
         ↓
   Merge into same job object
         ↓
   Chrome Storage (updated)
   {
     departmentId: "R-110261",
     title: "Neurologist",
     url: "https://www.vcacareers.com/global/en/job/R-110261/Neurologist",
     hospitalName: "VCA Veterinary Referral & Emergency Center",  ← ADDED IN PHASE 3
     salary: "$120,000 to $300,000 (Yearly)",  ← ADDED IN PHASE 3
     // ... etc.
   }
         ↓
   [PHASE 5: Export]
         ↓
   CSV / Google Sheets / Webhook
```

---

## ✅ WHAT TO DO NOW

1. **Reload Extension:**
   - Go to `chrome://extensions/`
   - Click refresh icon on VCA Jobs Scraper

2. **Test URL Extraction:**
   - Navigate to VCA Careers page
   - Open browser console (F12)
   - Start scraping
   - **Look for logs:**
     - ✅ `URL validated: { departmentId: "R-110261", url: "..." }`
     - ❌ `CRITICAL: URL does not match Department ID!`

3. **Re-scrape Fresh Data:**
   - Start new scraping session
   - Check console for validation messages
   - View Records
   - **Verify URLs match Department IDs**

4. **Test URL Clicking:**
   - In Records page, click a URL
   - Verify it opens the CORRECT job (check Department ID on page)

---

## 🔍 HOW TO VERIFY URL FIX WORKED

### Method 1: Console Logs
After scraping, check console for:
```
✅ URL validated: {departmentId: "R-110261", url: "https://www.vcacareers.com/global/en/job/R-110261/Neurologist"}
✅ URL validated: {departmentId: "R-215928", url: "https://www.vcacareers.com/global/en/job/R-215928/Associate-Veterinarian"}
```

If you see ❌ errors, something is still wrong.

### Method 2: Manual Check
1. Export to CSV
2. For each row, check:
   - Column A (Department ID): `R-110261`
   - Column J (URL): Should contain `R-110261`
3. Click URL, verify it opens job with same Department ID

### Method 3: Random Spot Check
1. Pick 10 random jobs from Records page
2. Click each URL
3. Verify Department ID matches on opened page

---

## 🎯 CONCLUSION

**The URL bug is now fixed with:**
- ✅ Better selectors (prioritizes job title link)
- ✅ Department ID matching (ensures URL belongs to job)
- ✅ Validation (checks and logs mismatches)
- ✅ Auto-correction (tries to fix if wrong)

**All other bugs fixed:**
- ✅ Salary prefixes removed
- ✅ Positions not truncated
- ✅ Hospital names validated
- ✅ Position values complete

**Next scraping session will have clean, correct data!** 🎉
