# SMS Availability Provider

This application checks the owner's Google Calendar status and location (via a placeholder mechanism) when receiving an SMS from a whitelisted number via Twilio, and replies whether they are "Available" or "Busy".

## Features

- Receives SMS via Twilio webhook.
- Validates sender against a whitelist.
- Connects to Google Calendar API to check for current events.
- Uses a placeholder to determine if the user is "at home".
- Sends replies ("Available" or "Busy") via Twilio.
- Designed for deployment on Google Cloud (e.g., Cloud Run).

## Setup

### 1. Prerequisites

- Node.js and npm installed.
- Google Cloud SDK (`gcloud`) installed and configured.
- A Google Cloud Project.
- A Twilio Account.

### 2. Configuration

- Copy `.env.example` to `.env`.
- Fill in the required values in `.env`:
  - **Google Calendar:**
    - Enable the Google Calendar API in your Google Cloud project.
    - Create OAuth 2.0 Credentials (Web application type): [https://console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
      - Add an Authorized JavaScript origin (e.g., `http://localhost:8080` for local testing, and your deployed app's URL).
      - Add an Authorized redirect URI (e.g., `http://localhost:8080/oauth2callback`, and your deployed app's callback URL). This must match `GOOGLE_REDIRECT_URI`.
      - Copy the Client ID and Client Secret into `.env`.
    - `GOOGLE_CALENDAR_ID`: Usually `primary`. Find others in your Google Calendar settings.
  - **Twilio:**
    - Get a Twilio phone number.
    - Find your Account SID and Auth Token in the Twilio Console.
    - Configure the Twilio number's webhook for incoming messages to point to your deployed application's `/sms` endpoint (e.g., `https://your-app-url.a.run.app/sms`, METHOD: `HTTP POST`).
  - **Application:**
    - `WHITELISTED_NUMBERS`: Add phone numbers (in E.164 format, e.g., `+12223334444`) allowed to query your status, separated by commas.
    - `PORT`: The port the application will listen on (Cloud Run typically expects `8080`).
  - **Location Placeholder:**
    - `HARDCODED_IS_AT_HOME`: Set to `true` or `false`. **IMPORTANT:** This is a placeholder. Real-time location requires a different approach (see Limitations).

### 3. Google Authentication (First Run)

The first time you run the application (locally or deployed), you'll need to authorize it to access your Google Calendar:

1.  Start the application (`npm start`).
2.  Open your browser and navigate to `http://localhost:PORT/authorize` (replace `PORT` if you changed it).
3.  You will be redirected to Google to grant permission.
4.  After granting permission, Google will redirect you back to the `oauth2callback` URI.
5.  The application will capture the authorization code and exchange it for tokens, storing them (e.g., in a local `secrets/` directory - **ensure this is in `.gitignore!**). Subsequent runs should use the stored refresh token.

### 4. Installation

```bash
npm install
```

### 5. Running Locally

```bash
# Make sure you have filled .env
npm start
```

Use a tool like `ngrok` to expose your local `/sms` endpoint to Twilio for testing if needed.

## Deployment (Google Cloud Run)

1.  **Enable APIs:** Ensure Cloud Run API and Cloud Build API are enabled in your Google Cloud project.
2.  **Build Container:**

    ```bash
    gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/sms-availability
    ```

    (Replace `YOUR_PROJECT_ID`)

3.  **Deploy Service:**

    ```bash
    gcloud run deploy sms-availability-service \
        --image gcr.io/YOUR_PROJECT_ID/sms-availability \
        --platform managed \
        --region YOUR_REGION \
        --allow-unauthenticated \
        --set-env-vars "NODE_ENV=production" \
        --set-env-vars "GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID" \
        --set-env-vars "GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET" \
        --set-env-vars "GOOGLE_REDIRECT_URI=YOUR_DEPLOYED_APP_URL/oauth2callback" \
        --set-env-vars "GOOGLE_CALENDAR_ID=primary" \
        --set-env-vars "TWILIO_ACCOUNT_SID=YOUR_TWILIO_ACCOUNT_SID" \
        --set-env-vars "TWILIO_AUTH_TOKEN=YOUR_TWILIO_AUTH_TOKEN" \
        --set-env-vars "TWILIO_PHONE_NUMBER=YOUR_TWILIO_PHONE_NUMBER" \
        --set-env-vars "WHITELISTED_NUMBERS=+1xxxxxxxxxx,+1yyyyyyyyyy" \
        --set-env-vars "HARDCODED_IS_AT_HOME=true" # Or false
    ```

    - Replace placeholders (`YOUR_PROJECT_ID`, `YOUR_REGION`, credentials, `YOUR_DEPLOYED_APP_URL`).
    - The deployed URL will be shown after successful deployment. Use this for the `GOOGLE_REDIRECT_URI` and the Twilio webhook.
    - `--allow-unauthenticated` is needed for the Twilio webhook. Secure this further if necessary (e.g., using Twilio request validation).

4.  **Google Authentication (Deployed):** Access `YOUR_DEPLOYED_APP_URL/authorize` once to perform the OAuth flow for the deployed instance. _Note:_ Cloud Run instances are ephemeral. Storing tokens requires a persistent solution (like Secret Manager or Firestore) for robust production use. The included file-based token storage works for simple cases but might require re-auth if instances restart frequently without shared storage.

## Limitations

- **Location:** Querying real-time phone location directly isn't feasible via a simple public API. This app uses a hardcoded `HARDCODED_IS_AT_HOME` environment variable as a placeholder. True location awareness would require:
  - A companion app on the Pixel phone using Geofencing APIs to report entering/leaving "home".
  - Or integration with services like IFTTT or Home Assistant that can track location.
- **Token Storage:** The default file-based token storage for Google Auth is not ideal for stateless environments like Cloud Run. Consider using Google Secret Manager or Firestore for storing OAuth tokens in production.
- **Error Handling:** Basic error handling is included, but production applications would need more robust logging and error management.
- **Security:** Twilio request validation should be implemented to ensure requests genuinely come from Twilio.
