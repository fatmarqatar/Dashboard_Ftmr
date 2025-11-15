# Email Authentication Setup Guide

## Overview
Your dashboard now uses **whitelist-based authentication** - only pre-approved email addresses can sign up and log in.

---

## Step 1: Enable Email Authentication in Firebase

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Navigate to **Authentication** → **Sign-in method**
4. Click on **Email/Password**
5. Toggle **Enable** to ON
6. Click **Save**

---

## Step 2: Add Authorized Emails to Whitelist

You need to create a document in Firestore to store authorized emails.

### Option A: Using Firebase Console (Recommended)

1. Go to **Firestore Database** in Firebase Console
2. Click **+ Start collection**
3. **Collection ID**: `authorized_users`
4. Click **Next**
5. **Document ID**: `whitelist`
6. Add field:
   - **Field**: `emails`
   - **Type**: `array`
   - **Value**: Add your authorized email addresses (one by one)
   
   Example:
   ```
   emails: [
     "admin@foodworld.com",
     "manager@foodworld.com"
   ]
   ```
7. Click **Save**

### Option B: Using Firebase Console - Quick Copy-Paste

1. Go to **Firestore Database**
2. Click the **three dots** (⋮) → **Import data**
3. Use this JSON structure:

```json
{
  "authorized_users": {
    "whitelist": {
      "emails": [
        "your-email@example.com",
        "another-admin@example.com"
      ]
    }
  }
}
```

---

## Step 3: Update Firestore Security Rules

Update your Firestore rules to secure user data:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow read access to whitelist for authentication check
    match /authorized_users/whitelist {
      allow read: if true;
      allow write: if false; // Only admins via Firebase Console
    }
    
    // User-specific data
    match /artifacts/{appId}/users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

## Step 4: Test the Authentication

1. **Start your dashboard**: `npm run dev`
2. Click **"Get Started"** or **"Login"** button
3. Try signing up with an **unauthorized email** → Should show "Access denied"
4. Try signing up with an **authorized email** → Should create account successfully
5. Try logging in with correct credentials → Should access dashboard
6. Test **Logout** button → Should return to landing page

---

## How It Works

### Authentication Flow:
1. User enters email and password
2. System checks if email exists in Firestore `authorized_users/whitelist`
3. If email is NOT in whitelist → **Access Denied**
4. If email IS in whitelist → Proceeds with Firebase Authentication
5. User can access dashboard

### Security Features:
- ✅ Only whitelisted emails can create accounts
- ✅ Only whitelisted emails can log in
- ✅ Unauthorized users see "Access denied" message
- ✅ Whitelist managed through Firebase Console (no code changes needed)
- ✅ Each user sees only their own data

---

## Managing Authorized Users

### Add a New User:
1. Go to Firebase Console → Firestore Database
2. Open collection: `authorized_users`
3. Open document: `whitelist`
4. Click on `emails` field
5. Click **"Add item"**
6. Enter the new email address
7. Click **Save**

### Remove a User:
1. Go to Firebase Console → Firestore Database
2. Open collection: `authorized_users`
3. Open document: `whitelist`
4. Click on `emails` field
5. Find the email to remove
6. Click the **trash icon** next to it
7. Click **Save**

### Important Notes:
- Emails are case-insensitive (admin@test.com = ADMIN@test.com)
- Removing email from whitelist doesn't delete their Firebase account
- To fully remove a user: Delete from whitelist + Delete from Firebase Authentication

---

## Troubleshooting

### "Authorization system not configured"
- Means the `authorized_users/whitelist` document doesn't exist
- Follow Step 2 to create it

### "Access denied" for authorized email
- Check spelling in Firestore whitelist
- Ensure email is lowercase in Firestore
- Verify document structure: `authorized_users/whitelist/emails`

### "Email already in use"
- User already has an account
- They should use **Login** instead of **Sign Up**

### User can't access dashboard after login
- Check Firestore security rules
- Verify user's UID matches in database path

---

## Example Whitelist Structure

In Firebase Console, your document should look like:

```
Collection: authorized_users
└── Document: whitelist
    └── Field: emails (array)
        ├── "admin@foodworld.com"
        ├── "manager@foodworld.com"
        └── "supervisor@foodworld.com"
```

---

## Security Best Practices

1. **Never commit Firebase config with real credentials to public repos**
2. **Use strong passwords** (min 6 characters, Firebase requirement)
3. **Regularly review authorized users list**
4. **Remove employees from whitelist when they leave**
5. **Enable 2FA in Firebase Console** for admin accounts
6. **Monitor authentication logs** in Firebase Console

---

## Next Steps

After setup is complete:
1. ✅ Test login with authorized email
2. ✅ Test login with unauthorized email (should fail)
3. ✅ Test logout functionality
4. ✅ Verify data access (users see only their data)
5. ✅ Add all admin/manager emails to whitelist

---

Need help? Check Firebase Console logs: **Authentication** → **Users** tab
