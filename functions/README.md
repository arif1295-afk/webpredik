Deployment notes for Cloud Functions (scheduled ML predictions)

Prerequisites
- Install Node.js 18+ and npm
- Install Firebase CLI: `npm install -g firebase-tools`
- Ensure your Firebase project has Realtime Database enabled
- Note: Cloud Scheduler (used by scheduled functions) requires a Blaze (pay-as-you-go) project

Steps
1. Install dependencies
   cd functions
   npm install

2. Initialize functions in your Firebase project (if not already)
   firebase login
   firebase init functions
   # choose existing project

3. Deploy functions
   firebase deploy --only functions:scheduledPredict

4. Confirm scheduled function is active in Firebase Console > Functions > Scheduled

Local testing
- You can test locally by invoking the function with the emulator or by running a small node script that requires `index.js` and calls the exported function with a mocked context.

Notes
- The function uses `@tensorflow/tfjs-node` which may increase cold-start times and bundle size.
- Adjust the schedule interval in `index.js` if you need more/less frequent runs.
- The function checks `control/predEnabled` in Realtime Database. Toggle the control from the website to enable/disable server-side predictions.
 - The function uses `@tensorflow/tfjs` (pure JavaScript) to avoid native build issues on Windows. This avoids needing Python/Visual C++ build tools during `npm install`.
 - If you prefer native performance (`@tensorflow/tfjs-node`) deploy from Linux/CI or install required build tools on Windows.
 - Adjust the schedule interval in `index.js` if you need more/less frequent runs.
 - The function checks `control/predEnabled` in Realtime Database. Toggle the control from the website to enable/disable server-side predictions.

GitHub Actions (recommended free scheduler)
-----------------------------------------
If you prefer not to enable Blaze billing, you can run the predictions on a schedule using GitHub Actions. This repository contains a workflow `/.github/workflows/predict.yml` that runs every 30 minutes and executes `functions/scripts/predict.js`.

Setup steps:
1. Create a Firebase service account key with permission to write to Realtime Database:
   - In Google Cloud Console > IAM & Admin > Service Accounts, create a new service account.
   - Grant the service account `Firebase Admin` or a least-privileged role that allows writing to your RTDB.
   - Create & download a JSON key.
2. Add the JSON contents as a GitHub repository secret named `FIREBASE_SERVICE_ACCOUNT`.
   - In GitHub: Settings > Secrets > Actions > New repository secret.
   - Set the name to `FIREBASE_SERVICE_ACCOUNT` and paste the entire JSON content.
3. Commit & push this repo. The workflow will run on its schedule and write predictions to `predictions` node in your RTDB when `control/predEnabled` is true.

Notes:
- The action installs dependencies inside the `functions` folder and runs the Node script with Node 18.
- The script reads the service account JSON from the secret (`FIREBASE_SERVICE_ACCOUNT`) and initializes the Admin SDK.
- You can trigger the workflow manually from the Actions tab (`workflow_dispatch`) for testing.
