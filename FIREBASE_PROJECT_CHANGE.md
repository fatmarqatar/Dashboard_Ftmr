# 🔥 Firebase Project Change & Cleanup Guide

## Part 1: Switching to a New Firebase Project

### ✅ What You Need to Change

**ONLY ONE FILE:** `src/firebase.js`

### Step-by-Step Instructions

#### Step 1: Create New Firebase Project (if needed)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" or use existing project
3. Follow the setup wizard

#### Step 2: Get New Project Configuration

1. In Firebase Console, go to: **Project Settings** (⚙️ icon)
2. Scroll to "Your apps" section
3. Click the **Web app** icon `</>`
4. Copy the `firebaseConfig` object

It looks like this:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456"
};
```

#### Step 3: Update `src/firebase.js`

**Option A: Replace HARDCODED_CONFIG (Quick - For Testing)**

```javascript
// In src/firebase.js, find HARDCODED_CONFIG and replace:
const HARDCODED_CONFIG = {
  apiKey: "YOUR_NEW_API_KEY",
  authDomain: "YOUR_NEW_PROJECT.firebaseapp.com",
  projectId: "YOUR_NEW_PROJECT_ID",
  storageBucket: "YOUR_NEW_PROJECT.appspot.com",
  messagingSenderId: "YOUR_NEW_SENDER_ID",
  appId: "YOUR_NEW_APP_ID"
}
```

**Option B: Use Environment Variables (Production - Recommended)**

1. Create `.env` file in project root:
```env
VITE_FIREBASE_API_KEY=your_new_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=your-new-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-new-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-new-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abcdef
```

2. Add to `.gitignore`:
```
.env
.env.local
.env.*.local
```

3. For Netlify deployment:
   - Site Settings → Environment Variables
   - Add each `VITE_FIREBASE_*` variable

#### Step 4: Enable Services in New Project

⚠️ **CRITICAL:** Enable these in your new Firebase project:

**Authentication:**
1. Firebase Console → Authentication → Sign-in method
2. Enable "Email/Password"

**Firestore Database:**
1. Firebase Console → Firestore Database
2. Click "Create database"
3. Choose "Start in production mode" (or test mode temporarily)
4. Select a region (closest to your users)

**Storage:**
1. Firebase Console → Storage
2. Click "Get started"
3. Start in production mode

#### Step 5: Set Up Security Rules

**Firestore Rules:**
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Whitelist
    match /authorized_users/whitelist {
      allow read: if true;
      allow write: if false;
    }
    
    // User data
    match /artifacts/{appId}/users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

**Storage Rules:**
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /employee_docs/{allPaths=**} {
      allow read, write, delete: if request.auth != null;
    }
    match /profile_photos/{allPaths=**} {
      allow read, write, delete: if request.auth != null;
    }
  }
}
```

#### Step 6: Create Whitelist Document

**Important:** You must create the whitelist in the new project:

1. Firestore Database → Start collection
2. Collection ID: `authorized_users`
3. Document ID: `whitelist`
4. Add field:
   - **Field name:** `emails`
   - **Type:** array
   - **Values:** Add your authorized emails (e.g., `admin@foodworld.com`)

#### Step 7: Test the Connection

```bash
# Restart dev server
npm run dev

# Open browser, try to login
# Check browser console for errors
```

### ✅ That's It!

**No other code changes needed!** Your app will automatically use the new Firebase project.

---

## Part 2: Cleaning Up Firestore Collections

### Current Structure in Your Old Project

Based on your code, you probably have collections like:
```
artifacts/
  └── default-app-id/
      └── users/
          └── {userId}/
              ├── employees/
              ├── vehicles/
              ├── statements/
              ├── debts_credits/
              ├── visa_entries/
              ├── visa_pnl/
              ├── alMarriEmployees/
              ├── alMarriVehicles/
              ├── alMarriDocuments/
              ├── alMarriReminders/
              ├── alMarriCredentials/
              ├── foodworldEmployees/
              ├── foodworldVehicles/
              ├── settings/
              └── ... (many more)
```

### 🎯 What to Keep for Production

**Essential Collections (Keep These):**

```
✅ authorized_users/whitelist  ← Required for login

✅ artifacts/default-app-id/users/{YOUR_PRODUCTION_USERID}/
   ├── employees/           ← Your actual employees
   ├── vehicles/            ← Your actual vehicles
   ├── statements/          ← Financial records
   ├── debts_credits/       ← Credit/debt tracking
   ├── settings/            ← App settings
   └── ... (only collections you actually use)
```

**Collections to Delete (Test Data):**

```
❌ artifacts/default-app-id/users/{TEST_USER_IDS}/  ← All test user data
❌ Any collection with test/dummy data
❌ Old user accounts you don't need
```

### 🚨 SAFE Deletion Process

#### Option 1: Manual Cleanup (Safest)

**Step 1: Export Your Data First (Backup)**

```bash
# Install Firebase CLI if not installed
npm install -g firebase-tools

# Login
firebase login

# Export Firestore (BACKUP!)
firebase firestore:export gs://your-project.appspot.com/backups/$(date +%Y%m%d)
```

**Step 2: Identify What to Keep**

1. Firebase Console → Authentication → Users
2. Find your production user's UID (the one you'll use in production)
3. Note it down: `PRODUCTION_USER_UID = abc123...`

**Step 3: Delete Test Users**

1. Firebase Console → Authentication → Users
2. For each test user:
   - Click the user
   - Click "Delete account"
   - Confirm deletion

**When you delete a user from Authentication:**
- Their data stays in Firestore (must delete manually)
- They can't log in anymore

**Step 4: Delete Test User Data from Firestore**

1. Firebase Console → Firestore Database
2. Navigate to: `artifacts/default-app-id/users/`
3. Find test user UIDs (not your production UID)
4. Click the three dots → Delete document (with subcollections)
5. Confirm deletion

**Step 5: Clean Up Top-Level Collections**

If you have any test collections at root level:
```
❌ test_employees/     ← Delete
❌ old_data/          ← Delete
❌ temp_collection/   ← Delete
```

1. Click the collection name
2. Three dots → Delete collection
3. Confirm

#### Option 2: Fresh Start (Cleanest)

If your old project is mostly test data:

**Instead of cleaning, just:**

1. ✅ Create a NEW Firebase project
2. ✅ Update `firebase.js` with new config
3. ✅ Set up rules, authentication, whitelist
4. ✅ Start fresh with clean data
5. ✅ Keep old project as backup (don't delete it yet)

**Benefits:**
- Clean slate
- No risk of deleting wrong data
- Old project stays as backup
- Easy to switch back if needed

#### Option 3: Automated Cleanup Script (Advanced)

I can create a script that:
- Lists all user IDs
- Shows their email addresses
- Lets you select which to keep
- Deletes the rest safely

**Want this script? Let me know!**

---

## Part 3: Migration from Old to New Project

### If You Want to Move Real Data to New Project

**You have real production data in old project?**

Here's how to migrate safely:

#### Step 1: Export from Old Project

```bash
# Export specific collections
firebase firestore:export \
  --collection-ids=employees,vehicles,statements \
  gs://OLD-PROJECT.appspot.com/export/production
```

#### Step 2: Import to New Project

```bash
# Switch to new project
firebase use YOUR-NEW-PROJECT

# Import data
firebase firestore:import gs://OLD-PROJECT.appspot.com/export/production
```

#### Step 3: Update User IDs (if needed)

If user IDs changed between projects, you'll need to:
1. Update the path structure
2. Move data to new user UID

**I can create a migration script if you need this.**

---

## Part 4: Post-Cleanup Verification

### ✅ Checklist After Cleanup

- [ ] Old Firebase project is backed up (exported)
- [ ] New project has correct config in `firebase.js`
- [ ] Authentication enabled (Email/Password)
- [ ] Firestore Rules published
- [ ] Storage Rules published
- [ ] Whitelist document created with your email
- [ ] Test login works
- [ ] Can create/edit/delete data
- [ ] PDFs upload/delete successfully
- [ ] No console errors in browser

### 🧪 Testing Script

Add this temporarily to `App.jsx` to verify everything:

```javascript
useEffect(() => {
  console.log('🔍 Firebase Config Check:', {
    projectId: app.options.projectId,
    authDomain: app.options.authDomain,
    storageBucket: app.options.storageBucket,
    currentUser: user?.uid,
    currentEmail: user?.email,
    dataPath: `artifacts/default-app-id/users/${user?.uid}`
  });
}, [user]);
```

---

## Part 5: Code Changes Summary

### ✅ Files You Need to Edit

**For switching projects:**
1. `src/firebase.js` - Update config (ONLY file to change)
2. `.env` - Add environment variables (optional but recommended)
3. `.gitignore` - Add `.env` (if using env vars)

**For cleaning up:**
- ❌ No code changes needed
- ✅ All cleanup happens in Firebase Console

### ❌ Files You DON'T Need to Edit

- `src/App.jsx` ← No changes
- `src/LandingPage.jsx` ← No changes
- `src/AuthModal.jsx` ← No changes
- Any other `.jsx` files ← No changes

**Why?** Your code uses dynamic paths:
```javascript
`artifacts/${appId}/users/${userId}/...`
```

This works with ANY Firebase project automatically!

---

## 🎯 Recommended Approach for You

Based on your situation, here's what I recommend:

### Scenario A: Old Project is Mostly Test Data

**Do this:**
1. ✅ Create NEW Firebase project
2. ✅ Update `firebase.js` config
3. ✅ Set up rules and whitelist
4. ✅ Start fresh
5. ✅ Keep old project (don't delete) as backup

**Time:** 10 minutes
**Risk:** Zero (fresh start)

### Scenario B: Old Project Has Important Data

**Do this:**
1. ✅ Export/backup old project
2. ✅ Delete test users from Authentication
3. ✅ Delete test user data from Firestore
4. ✅ Keep only production user data
5. ✅ Continue using same project

**Time:** 20-30 minutes
**Risk:** Low (if you backup first)

---

## 🚀 Quick Start Commands

### Option 1: New Project, Fresh Start

```bash
# 1. Update firebase.js with new config
# (edit the HARDCODED_CONFIG section)

# 2. Restart dev server
npm run dev

# 3. Create whitelist in Firebase Console
# 4. Test login

# Done! ✅
```

### Option 2: Clean Current Project

```bash
# 1. Backup first
firebase login
firebase firestore:export gs://YOUR-PROJECT.appspot.com/backup-$(date +%Y%m%d)

# 2. Delete from Firebase Console:
#    - Authentication → Delete test users
#    - Firestore → Delete test user data

# 3. Verify
npm run dev

# Done! ✅
```

---

## ❓ Quick Answers

| Question | Answer |
|----------|--------|
| **Which file to edit?** | Only `src/firebase.js` |
| **Do I need new project?** | Recommended if old project is mostly test data |
| **Will my code break?** | No - code is Firebase-agnostic |
| **How to backup data?** | `firebase firestore:export` or manual export |
| **Can I switch back?** | Yes - just change config back |
| **What about Storage files?** | They stay in old project unless you migrate |

---

## 🆘 Need Help?

Let me know if you want:
- ✅ Automated cleanup script
- ✅ Data migration script (old → new project)
- ✅ Help setting up environment variables
- ✅ Step-by-step walkthrough for your specific case

**Tell me:**
1. Do you have important data in the old project? (Yes/No)
2. Do you want to clean current project or start fresh?
3. How many users/employees/vehicles do you have?

I'll give you exact commands to run! 🚀
