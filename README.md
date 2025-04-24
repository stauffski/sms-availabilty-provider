# SMS Availability Provider

This Node.js application acts as a personal availability checker.

It receives SMS messages via Twilio from whitelisted numbers, checks the owner's Google Calendar status and a location indicator, and replies via Twilio SMS with "Available" or "Busy".

## Core Functionality

- Listens for incoming Twilio SMS webhooks on `/sms`.
- Authenticates requests by checking the sender's phone number against a configured whitelist.
- Uses Google Calendar API (OAuth 2.0) to check for current events indicating a "busy" status.
- Uses a simple environment variable (`HARDCODED_IS_AT_HOME`) as a placeholder for location status ("at home" vs. "not at home").
- Sends an SMS reply ("Available" if not busy on calendar AND at home, otherwise "Busy") using the Twilio API.
- Includes routes (`/authorize`, `/oauth2callback`) for the initial Google OAuth flow.

## Setup and Usage

1.  **Prerequisites:** Node.js, npm, Google Cloud Project, Twilio Account.
2.  **Clone:** Clone this repository.
3.  **Install:** `npm install`
4.  **Configure:**
    - Copy `.env.example` to `.env`.
    - Follow the setup steps in `README_DETAILED.md` to obtain Google OAuth credentials and Twilio credentials.
    - Fill in the `.env` file with your credentials, Twilio phone number, whitelisted sender numbers, and the desired `HARDCODED_IS_AT_HOME` value (`true` or `false`).
5.  **Authorize Google Account (First Run):**
    - Start the app: `npm start`
    - Visit `http://localhost:8080/authorize` in your browser and complete the Google login/consent flow.
6.  **Run:** `npm start`
7.  **Expose & Configure Webhook:** Use a tool like `ngrok` to expose your local `http://localhost:8080/sms` endpoint to the internet. Configure your Twilio number's incoming message webhook to point to this ngrok URL (using HTTP POST).
8.  **Test:** Send an SMS from a whitelisted number to your Twilio number.

## Deployment

This application includes a `Dockerfile` and is suitable for deployment on container platforms like Google Cloud Run. See `README_DETAILED.md` for detailed deployment instructions.

## Important Notes & Limitations

- **Location:** Real-time location tracking is **not** implemented. The `HARDCODED_IS_AT_HOME` variable is a placeholder.
- **Token Storage:** The default file-based Google OAuth token storage (`secrets/` directory) is simple but not robust for production, especially on stateless platforms like Cloud Run. Consider using Google Secret Manager or a database.
- **Security:** Implement Twilio request validation for production environments.
- **Detailed Instructions:** Refer to `README_DETAILED.md` for comprehensive setup and deployment guidance.
