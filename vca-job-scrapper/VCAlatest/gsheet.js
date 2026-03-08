class GoogleSheetsExporter {
  constructor() {
    this.accessToken = null;
    this.apiKey = 'AIzaSyARmow4i2QpMgeGuET-LJ4_iHDb9Wn9e-M'; 
  }

  async authenticate() {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          this.accessToken = token;
          resolve(token);
        }
      });
    });
  }

  async exportToSheet(spreadsheetId, jobs) {
    try {
      if (!this.accessToken) {
        await this.authenticate();
      }

      // Prepare data for Google Sheets
      const headers = [
        ['Department ID', 'Title', 'Location', 'Category', 'Job Type', 'URL', 'Scraped At']
      ];

      const data = jobs.map(job => [
        job.departmentId || '',
        job.title || '',
        job.location || '',
        job.category || '',
        job.jobType || '',
        job.url || '',
        new Date(job.scrapedAt).toLocaleString()
      ]);

      const allData = [...headers, ...data];

      // Clear existing data first
      await this.clearSheet(spreadsheetId);

      // Add new data
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:G${allData.length}?valueInputOption=RAW`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: allData
          })
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Google Sheets API error: ${error.error?.message || response.statusText}`);
      }

      // Format the header row
      await this.formatHeaderRow(spreadsheetId);

      return await response.json();

    } catch (error) {
      console.error('Error exporting to Google Sheets:', error);
      throw error;
    }
  }

  async clearSheet(spreadsheetId) {
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:G:clear`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to clear sheet: ${response.statusText}`);
    }
  }

  async formatHeaderRow(spreadsheetId) {
    try {
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [
              {
                repeatCell: {
                  range: {
                    sheetId: 0,
                    startRowIndex: 0,
                    endRowIndex: 1,
                    startColumnIndex: 0,
                    endColumnIndex: 7
                  },
                  cell: {
                    userEnteredFormat: {
                      backgroundColor: {
                        red: 0.18,
                        green: 0.52,
                        blue: 0.67
                      },
                      textFormat: {
                        foregroundColor: {
                          red: 1.0,
                          green: 1.0,
                          blue: 1.0
                        },
                        bold: true
                      }
                    }
                  },
                  fields: 'userEnteredFormat(backgroundColor,textFormat)'
                }
              },
              {
                autoResizeDimensions: {
                  dimensions: {
                    sheetId: 0,
                    dimension: 'COLUMNS',
                    startIndex: 0,
                    endIndex: 7
                  }
                }
              }
            ]
          })
        }
      );

      if (!response.ok) {
        console.warn('Failed to format header row:', response.statusText);
      }
    } catch (error) {
      console.warn('Error formatting header row:', error);
    }
  }

  extractSpreadsheetId(url) {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  }

  async testSheetAccess(spreadsheetId) {
    try {
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          }
        }
      );

      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

// Export for use in other files
window.GoogleSheetsExporter = GoogleSheetsExporter;