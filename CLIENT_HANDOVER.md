# Client Handover — Inventory Manager

## 1. What this app does

This app replaces the daily back-and-forth of editing two master Excel files by hand. Your team adds stock, marks units sold, receives supplier deliveries, and edits listings — all through simple forms. At the end of every day you download two Excel files in exactly the same shape you have today.

## 2. Daily workflow

1. **Sign in** at the login page with your team email and password.
2. **Import the two master files** the first time you use the app: go to **Admin → Master Data**, choose your INVENTORY and SALES Excel files, click Import. This is a one-off step — you only re-import if you ever want to reset to a known-good state.
3. **Operate during the day** — add new stock from the **Buy** page, mark units sold from the **Sell** page, handle returns from the **Returns** page, and edit marketplace listings inline.
4. **Download the two master files** at the end of the day: **Admin → Reports → Download Master Excel**. You get back `INVENTORY_REPORT_YYYY_M.xlsx` and `SALES_REPORT_YYYY.xlsx` — the same two files your team has always worked with, refreshed with everything that happened today.
5. **That's it.** Save those two files somewhere safe (Google Drive, OneDrive, email-to-self) and you're set for tomorrow.

## 3. Who has access

- The owner account is **admin@inventorymanager.com** — yours.
- To add a teammate, open the Firebase Console (firebase.google.com), pick this project, go to **Authentication → Add user**, enter their email + a starter password, and share it with them. They can sign in immediately.
- To remove a teammate, delete their entry from the same Authentication screen.
- No one outside that list can sign in.

## 4. When something goes wrong

- **You see an error message** — read it, then try the same action again. Most errors are connection blips that clear up on a retry.
- **The numbers look wrong** — re-import the master Excel files via **Admin → Master Data**. The app rebuilds itself from those files exactly.
- **Total failure (the app won't load, or data is corrupted)** — open the last day's `INVENTORY_REPORT_*.xlsx` and `SALES_REPORT_*.xlsx` you downloaded. Those are your source of truth — re-import them via Master Data and you're back to where you left off.

## 5. Support contact

For app help: __________________________________________

(Fill in your preferred support email — this is where your team will write when they're stuck.)
