// Service Account Configuration
const SERVICE_ACCOUNT = {
  "type": "service_account",
  "project_id": "project-n6n",
  "private_key_id": "bde800905ca5cc268f699b05498a4ab0929aca35",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC80aRG5sTCjj57\nWIQY7MAKymSkrXZzGEHzuplyqjT5vlXX2pwJubcSF+VFREO3xkAB+E4ecYvRRh44\nCIli5ZbQFHEZlAPexei1wl7OftVvlMGdBgrLAT4n0n8CBqJRTdXmK/SPHYK+Aam/\nogH5Z/Vznj374ufN2i6sPQEg9M5cv6NrCODPak7rsRb0aIn4bDb3KI+jWzjGieJ5\nwvbQJz7d6F51PKI+AeJ/gHEvQvYPrIJaN195FbSE5gJk41/BxPgV++HfmT0B6kr6\nLGbG+en+01s3Y2ZGBgtodJ02Ju9Lbm+FB3P+dGcNUdV0o6hTzGbD0Rs24kVsqSef\nHdgVzdeLAgMBAAECggEAHzG2pVIIYqi+W4FhqCkrhvzYng4xpKJ2zuMz6P+EAK3j\nH7tJjnUZ8Ml1grkxmNcOCbqcfqdn9SXTkJKfI/Fl4Nrns9VCGG1I3LJlGFIC7/a6\n+ovzf4X6ifiwK++tpFIAIGaAS56RVCkRLWGAralw9xjHCRSmaC9Us6GLzLE1C0RY\nEQqPcrUWtB3dWrtwDmFBNSqC4CRwcbxLvkvFJZkvUVFlpkL1QpgT9Z+9uYw7EPuL\nlOhhorNwLjfdGQjP+bpLl+gtd8Y83Osix4cbuvXhtfKaDESKupU8/hls4cFeVgPe\n1p3PSDLI7ePWfnuiS7+6+5MgNCEEHdpoO5L2qgzklQKBgQD1PhEVDHFt7TFo0+bF\njGitcENG5+Hun5Tjl2zklah50n0Cb2qS1MfjKvPZpUriQo9faDgMCB+AXlhyDhA/\nP0S8bQL1j5DfEXU4XJZu/6Lkbh1EwzIFcjUHUFNVbxQq6mN7De1suaQEQ3bKu/01\npqz7UnNT1NGV8wGsJtDOzWgnhwKBgQDFGfiDbniFOd0lgSBGejVxtQ5KQ/vzFgeq\nzZaM5NgRbFwM8+NG0O0T1z7smqKl5tkRM5BNrpOsUpffhKlCveGEe8IYV9+vDhRi\nAk8WlN9jxJZTY10r3ogyp1FETDM9g+CvvFgf3dJ1qg5DD9TQyXi263lwoFnHm3P9\ns+lIk/yI3QKBgBM92W1DWqr7T0MgTRz21Ue2ZTDtBKcKUk5BFUQiEePtBe3o+/2l\nQEGsnxFWjLeP7VvY+3zGLmKOBHZ+b/vmZOg7zV2i9ATsg7v2V79Bw3AUy6sXfZc7\nzLlULhWn73cmiMOg5h3/usSy3mEtusI4352gbHgJXKBdPqZZLUzshN2FAoGAXoNf\nmZalkCz5EHzkvybm7cmGOrJy5FPSBWNkJ9esjF5LnaJtf427wWHbuJVGHQufVxJE\nxhtKkL1iOjpg97IZq++0WPv6NPUpbP3ycr+chzjDZOUmzlx9LtzwqTFo+Lx+R4an\nM1CpFOcgw6OZxyx1CDHOH+WkZ4Txj9xvpu/fjrkCgYBZRGb3UV1zLl7Edz7SmP9Z\nkdqVda9tUM9rm1rrCSFzm72wbWrFLBPPyTzQa6ARBMXGgvdfZVr1CEsB7j8I+0HO\n3F0VpWNpYymNOb+dAKJVPbvxE108AwObkJkU9Mw9H7pPSyhsUeyyFHR7hgTKfi1C\nEd4AA1XQtxFSAcZeU1E/vw==\n-----END PRIVATE KEY-----\n",
  "client_email": "n8n-222@project-n6n.iam.gserviceaccount.com",
  "client_id": "112830504819441432125",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/n8n-222%40project-n6n.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
};

class ServiceAccountAuth {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async getAccessToken() {
    // Check if we have a valid cached token
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      console.log('Using cached access token');
      return this.accessToken;
    }

    console.log('Generating new access token...');
    console.log('Service account email:', SERVICE_ACCOUNT.client_email);
    console.log('Project ID:', SERVICE_ACCOUNT.project_id);

    // Generate new JWT and get access token
    const jwt = await this.createJWT();
    console.log('JWT created successfully');
    
    const token = await this.exchangeJWTForToken(jwt);
    console.log('Token exchange successful');
    
    this.accessToken = token.access_token;
    this.tokenExpiry = Date.now() + (token.expires_in * 1000) - 60000; // Subtract 1 minute for safety
    
    console.log('Access token obtained and cached');
    return this.accessToken;
  }

  async createJWT() {
    const header = {
      alg: 'RS256',
      typ: 'JWT'
    };

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: SERVICE_ACCOUNT.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };

    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;

    const signature = await this.signWithPrivateKey(unsignedToken, SERVICE_ACCOUNT.private_key);
    const encodedSignature = this.base64UrlEncode(signature);

    return `${unsignedToken}.${encodedSignature}`;
  }

  async signWithPrivateKey(data, privateKey) {
    // Import the private key
    const keyData = this.pemToArrayBuffer(privateKey);
    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      keyData,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256'
      },
      false,
      ['sign']
    );

    // Sign the data
    const encoder = new TextEncoder();
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      encoder.encode(data)
    );

    return new Uint8Array(signature);
  }

  pemToArrayBuffer(pem) {
    const b64Lines = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
    const byteString = atob(b64Lines);
    const byteArray = new Uint8Array(byteString.length);
    
    for (let i = 0; i < byteString.length; i++) {
      byteArray[i] = byteString.charCodeAt(i);
    }
    
    return byteArray.buffer;
  }

  base64UrlEncode(data) {
    if (typeof data === 'string') {
      data = new TextEncoder().encode(data);
    }
    
    const base64 = btoa(String.fromCharCode(...new Uint8Array(data)));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  async exchangeJWTForToken(jwt) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json();
  }
}

// Export for use in other files
window.ServiceAccountAuth = ServiceAccountAuth;