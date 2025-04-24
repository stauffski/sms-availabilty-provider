require("dotenv").config();
const express = require("express");
const twilio = require("twilio");
const { google } = require("googleapis");
const fs = require("fs").promises;
const path = require("path");
const http = require("http");
const url = require("url");

const app = express();
app.use(express.urlencoded({ extended: false })); // To parse Twilio webhook requests

// --- Configuration ---
const PORT = process.env.PORT || 8080;
const WHITELISTED_NUMBERS = (process.env.WHITELISTED_NUMBERS || "")
  .split(",")
  .map((num) => num.trim())
  .filter(Boolean);
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";

// Placeholder for location - replace with real logic if implemented
const IS_AT_HOME = process.env.HARDCODED_IS_AT_HOME === "true";

// Simple file-based token storage (Not ideal for production - see README)
const TOKEN_DIR = path.join(__dirname, "secrets");
const TOKEN_PATH = path.join(TOKEN_DIR, "google-calendar-token.json");

// --- Google Calendar Setup ---
const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];
let oauth2Client;

async function initializeGoogleClient() {
  oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );

  // Check if we have previously stored a token.
  try {
    await fs.access(TOKEN_DIR);
  } catch (error) {
    await fs.mkdir(TOKEN_DIR);
  }

  try {
    const token = await fs.readFile(TOKEN_PATH);
    oauth2Client.setCredentials(JSON.parse(token));
    console.log("Google credentials loaded from file.");
  } catch (err) {
    console.log("Google token not found. Need authorization.");
    // Later, the /authorize route will handle getting the token
  }

  // Refresh token if needed
  oauth2Client.on("tokens", (tokens) => {
    if (tokens.refresh_token) {
      // Store the refresh_token permanently
      console.log("Received new refresh token.");
      fs.writeFile(TOKEN_PATH, JSON.stringify(oauth2Client.credentials)).catch(
        console.error
      );
    } else {
      // Store the access token
      console.log("Refreshed access token.");
      fs.writeFile(TOKEN_PATH, JSON.stringify(oauth2Client.credentials)).catch(
        console.error
      );
    }
  });
}

// --- Twilio Setup ---
let twilioClient;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
} else {
  console.warn("Twilio credentials not found. SMS sending will be disabled.");
}

// --- Helper Functions ---

/**
 * Checks Google Calendar for events indicating "busy" status currently.
 */
async function isBusyOnCalendar() {
  if (
    !oauth2Client ||
    !oauth2Client.credentials ||
    !oauth2Client.credentials.access_token
  ) {
    console.error("Google client not authorized. Cannot check calendar.");
    // Decide how to handle this - maybe default to "Busy"?
    return true; // Default to busy if not authorized
  }
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });
  const now = new Date();
  // Check for events starting in the next minute to catch events that just started
  const timeMax = new Date(now.getTime() + 60 * 1000);

  try {
    const res = await calendar.events.list({
      calendarId: GOOGLE_CALENDAR_ID,
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(), // Only check events happening right now
      maxResults: 10,
      singleEvents: true,
      orderBy: "startTime",
      // Query for events where the user's status is 'busy'
      // Note: Free/busy information might be more reliable using freebusy.query
      // but events.list is simpler for checking explicit event titles/statuses.
      // We consider any event during this time as potentially making the user busy.
      // Refine this logic based on specific needs (e.g., ignore 'Tentative').
    });

    const events = res.data.items;
    if (!events || events.length === 0) {
      console.log("No upcoming events found. Assuming free.");
      return false; // Not busy
    }

    // Check if any event explicitly marks the user as busy or is not transparent
    for (const event of events) {
      // Consider busy if there's an event and it's not marked as transparent (free)
      // You might want to customize this based on event types or names.
      if (event.status !== "cancelled") {
        // Ignore cancelled events
        // Check if the event has a specific availability set
        if (event.transparency !== "transparent") {
          console.log(`Busy due to event: ${event.summary}`);
          return true; // Busy
        }
        // Optional: Add more checks here, e.g., based on event summary keywords
      }
    }

    console.log("Found events, but none indicate busy status.");
    return false; // Not busy if all events are transparent
  } catch (err) {
    console.error("Error fetching calendar events:", err);
    // Handle errors appropriately, maybe default to busy
    if (err.response && err.response.status === 401) {
      console.error(
        "Google Auth Error (401). Token might be invalid or expired. Need re-authorization."
      );
      // Clear the potentially invalid token
      try {
        await fs.unlink(TOKEN_PATH);
        console.log("Removed potentially invalid token file.");
        // Re-initialize client state (important)
        await initializeGoogleClient();
      } catch (unlinkErr) {
        console.error("Error removing token file:", unlinkErr);
      }
    }
    return true; // Default to busy on error
  }
}

/**
 * Sends an SMS reply using Twilio.
 */
async function sendSmsReply(to, body) {
  if (!twilioClient) {
    console.error("Twilio client not configured. Cannot send SMS.");
    return;
  }
  try {
    await twilioClient.messages.create({
      body: body,
      from: TWILIO_PHONE_NUMBER,
      to: to,
    });
    console.log(`SMS reply sent to ${to}: "${body}"`);
  } catch (error) {
    console.error(`Error sending SMS to ${to}:`, error);
  }
}

// --- Express Routes ---

// Simple health check endpoint
app.get("/", (req, res) => {
  res.status(200).send("SMS Availability Provider is running.");
});

// Google OAuth Routes
app.get("/authorize", (req, res) => {
  if (!oauth2Client) {
    return res.status(500).send("OAuth2 client not initialized.");
  }
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // Force consent screen for refresh token
  });
  console.log("Redirecting for Google authorization...");
  res.redirect(authUrl);
});

app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send("Authorization code missing.");
  }
  if (!oauth2Client) {
    return res
      .status(500)
      .send("OAuth2 client not initialized after redirect.");
  }
  try {
    console.log("Exchanging authorization code for tokens...");
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    console.log("Tokens obtained successfully.");

    // Store the token
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
    console.log("Token stored to", TOKEN_PATH);

    res.send("Authorization successful! You can close this tab.");
  } catch (err) {
    console.error("Error retrieving access token", err);
    res.status(500).send("Failed to retrieve access token.");
  }
});

// Twilio SMS Webhook Endpoint
app.post("/sms", async (req, res) => {
  const fromNumber = req.body.From;
  const messageBody = req.body.Body;

  console.log(`Received SMS from ${fromNumber}: "${messageBody}"`);

  // 1. Check Whitelist
  if (!WHITELISTED_NUMBERS.includes(fromNumber)) {
    console.log(`Number ${fromNumber} is not whitelisted. Ignoring.`);
    // Optionally send a standard rejection message
    // await sendSmsReply(fromNumber, "Sorry, I can only respond to authorized numbers.");
    return res.status(204).send(); // Send No Content
  }

  console.log(`Number ${fromNumber} is whitelisted. Checking availability...`);

  // 2. Check Calendar Status
  let isBusy = true; // Default to busy
  try {
    isBusy = await isBusyOnCalendar();
  } catch (error) {
    console.error("Error checking calendar status:", error);
    // Keep isBusy = true
  }

  // 3. Check Location (Placeholder)
  const isAtHome = IS_AT_HOME; // Using the configured placeholder value
  console.log(`Calendar Busy: ${isBusy}, At Home: ${isAtHome}`);

  // 4. Determine Availability and Reply
  let replyMessage = "Busy";
  if (!isBusy && isAtHome) {
    replyMessage = "Available";
  }

  await sendSmsReply(fromNumber, replyMessage);

  // Respond to Twilio to acknowledge receipt
  const twiml = new twilio.twiml.MessagingResponse();
  // No message needed here as we send it asynchronously
  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end(twiml.toString());
});

// --- Server Start ---
async function startServer() {
  try {
    await initializeGoogleClient();
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
      console.log(`Whitelisted numbers: ${WHITELISTED_NUMBERS.join(", ")}`);
      console.log(`Twilio Number: ${TWILIO_PHONE_NUMBER}`);
      console.log(`Location Placeholder (Is At Home): ${IS_AT_HOME}`);
      if (
        !oauth2Client ||
        !oauth2Client.credentials ||
        !oauth2Client.credentials.access_token
      ) {
        console.log(
          `Google Calendar needs authorization. Visit /authorize in your browser.`
        );
      }
    });
  } catch (error) {
    console.error("Failed to initialize Google Client:", error);
    process.exit(1);
  }
}

startServer();
