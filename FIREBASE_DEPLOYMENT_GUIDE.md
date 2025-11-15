# 🔥 Firebase Deployment & Data Management Guide

## Issues You're Facing & Solutions

### 1. ❌ Data Clearing After Restart

**Problem:** Data disappears when you restart the dashboard on Netlify.

**Root Causes & Solutions:**

#### A. **Different User IDs Between Environments**
- **Issue:** Each Firebase Auth user has a unique UID. If you created data with one account (local) and log in with different account (production), you won't see the data.
- **Solution:** 
  - Use the **same email account** in both local and production
  - Check Firebase Console → Authentication → Users to see all user IDs
  - Data is stored at: `artifacts/{appId}/users/{userId}/...`
  - Each userId sees only their own data

#### B. **AppId Mismatch**
- **Issue:** Your code uses `appId = 'default-app-id'` which might differ between environments
- **Check:** In `App.jsx` line ~3649: `if (typeof __app_id !== 'undefined') { setAppId(__app_id); }`
- **Solution:** Keep using the same appId consistently

#### C. **Firebase Project Mismatch**
- **Issue:** Different `firebase.js` configs between local and Netlify
- **Critical:** You MUST use the **same Firebase project** for both environments
- **Verify:** Compare your local `src/firebase.js` with what's deployed on Netlify

---

### 2. ❌ Deleted PDFs Still in Firebase Storage

**Problem:** You deleted a PDF from the dashboard, but it's still in Firebase Storage.

**Root Cause:** This **shouldn't happen** if the delete code works properly. Let me explain what should occur:

**How PDF Deletion Works:**
```javascript
// When you click the delete button:
1. Gets the storage path from Firestore document
2. Deletes file from Storage: deleteObject(storageRef)
3. Updates Firestore: removes the URL and path fields
```

**Why It Might Fail:**
- ❌ Network error during deletion
- ❌ Insufficient Storage permissions
- ❌ Delete button didn't execute fully (page refresh/crash)
- ❌ Wrong Storage Rules

**How to Verify:**
1. Go to Firebase Console → Storage
2. Check the file path: `employee_docs/{collectionPath}/{employeeId}/{filename}.pdf`
3. If file exists but Firestore doc shows no URL → Manual cleanup needed

**Prevention:**
- Always wait for "success" confirmation after deleting
- Check Firebase Console logs for errors
- Update Storage Rules (see below)

---

## 📋 Firebase Setup Checklist for Production

### Do You Need a New Firebase Project?

**Short Answer:** **NO** - Use the same project for both local and production.

**Why:**
- ✅ Single source of truth for all data
- ✅ One billing account
- ✅ Consistent authentication
- ✅ Same security rules

**When You WOULD Need Separate Projects:**
- Multiple clients/companies (different databases)
- Strict dev/staging/production separation
- Different billing/permissions per environment

---

## 🔐 Required Firebase Configuration

### 1. **Authentication Setup**

Enable in Firebase Console → Authentication → Sign-in method:
- ✅ Email/Password ← **Already done**

### 2. **Firestore Database Rules**

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Whitelist document - anyone can read (for login check)
    match /authorized_users/whitelist {
      allow read: if true;
      allow write: if false; // Only Firebase Console
    }
    
    // User-specific data - each user sees only their own
    match /artifacts/{appId}/users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Deny all other access
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

**Apply these rules:**
1. Firebase Console → Firestore Database → Rules tab
2. Copy the rules above
3. Click "Publish"

---

### 3. **Storage Rules** (For PDF Uploads)

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    
    // Employee documents - user-specific
    match /employee_docs/{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
      allow delete: if request.auth != null;
    }
    
    // Profile photos
    match /profile_photos/{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
      allow delete: if request.auth != null;
    }
    
    // Deny all other access
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

**Apply these rules:**
1. Firebase Console → Storage → Rules tab
2. Copy the rules above
3. Click "Publish"

---

### 4. **Firebase Config in Netlify**

**Critical:** Your deployed app must use the **same** Firebase config as local.

**Verify your `src/firebase.js`:**
```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

**Best Practice - Use Environment Variables:**

Instead of hardcoding, use Netlify environment variables:

1. **Update `src/firebase.js`:**
```javascript
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};
```

2. **Create `.env` file locally:**
```env
VITE_FIREBASE_API_KEY=your_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef
```

3. **Add to `.gitignore`:**
```
.env
.env.local
```

4. **Set in Netlify Dashboard:**
   - Site settings → Environment variables
   - Add each `VITE_FIREBASE_*` variable

---

## 🗑️ Manual Cleanup: Remove Orphaned Files

If you have PDFs in Storage but not in Firestore:

### Option 1: Firebase Console (Manual)
1. Go to Firebase Console → Storage
2. Navigate to `employee_docs/` folder
3. Find orphaned files
4. Right-click → Delete

### Option 2: Create a Cleanup Script

I can create a script that:
- Scans all Firestore employee documents
- Gets list of valid Storage paths
- Deletes files in Storage that aren't referenced

**Let me know if you want this script.**

---

## 📊 Best Practices for Data Access & Deletion

### 1. **Always Use Transactions for Critical Operations**

For operations that modify both Firestore + Storage:

```javascript
// Good: Try-catch with cleanup
try {
  // 1. Upload to Storage
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  
  // 2. Save to Firestore
  await updateDoc(docRef, {
    url: url,
    storagePath: path
  });
} catch (error) {
  // Cleanup: delete uploaded file if Firestore fails
  try {
    await deleteObject(storageRef);
  } catch {}
  throw error;
}
```

### 2. **Verify Deletions**

Add confirmation logs:

```javascript
const handleDelete = async () => {
  try {
    // Delete from Storage
    await deleteObject(storageRef);
    console.log('✅ Deleted from Storage:', storagePath);
    
    // Delete from Firestore
    await updateDoc(docRef, { url: null, storagePath: null });
    console.log('✅ Deleted from Firestore');
    
    alert('Document deleted successfully');
  } catch (error) {
    console.error('❌ Delete failed:', error);
    alert('Delete failed: ' + error.message);
  }
};
```

### 3. **Use Cloud Functions for Automatic Cleanup** (Advanced)

Firebase Cloud Functions can automatically delete Storage files when Firestore docs are deleted:

```javascript
// functions/index.js
exports.cleanupStorage = functions.firestore
  .document('artifacts/{appId}/users/{userId}/employees/{docId}')
  .onDelete(async (snap) => {
    const data = snap.data();
    if (data.storagePath) {
      const file = admin.storage().bucket().file(data.storagePath);
      await file.delete();
      console.log('Auto-deleted:', data.storagePath);
    }
  });
```

**Benefits:**
- Automatic cleanup
- No orphaned files
- Consistent data

---

## 🚀 Deployment Checklist

Before deploying to Netlify:

- [ ] Same Firebase project in local and production
- [ ] Environment variables set in Netlify
- [ ] Firestore Rules published
- [ ] Storage Rules published
- [ ] Email/Password auth enabled
- [ ] Whitelist document created (`authorized_users/whitelist`)
- [ ] Test login with production account
- [ ] Verify data persists after logout/login
- [ ] Test file upload/delete cycle
- [ ] Check browser console for errors

---

## 🐛 Debugging Tips

### Check if Data Exists:
1. Firebase Console → Firestore Database
2. Navigate to: `artifacts/default-app-id/users/`
3. Find your userId (from Firebase Auth)
4. Check if collections exist

### Check Current User:
```javascript
// Add this temporarily in App.jsx useEffect
useEffect(() => {
  console.log('Current User:', user?.uid, user?.email);
  console.log('App ID:', appId);
}, [user, appId]);
```

### Verify Storage Deletion:
```javascript
// In delete handlers, add detailed logs
console.log('Attempting to delete:', storagePath);
await deleteObject(storageRef);
console.log('Successfully deleted from Storage');
```

---

## 🔄 Migration Plan (If Needed)

If you want to move from local to production cleanly:

1. **Export Data** (Firestore → JSON)
2. **Create production account** with whitelisted email
3. **Import data** to new userId path
4. **Test thoroughly**
5. **Delete old user data**

**I can create migration scripts if needed.**

---

## 📞 Quick Fixes

### Fix 1: Data Not Showing After Deploy
```bash
# Check deployed firebase.js matches local
# Compare: local src/firebase.js vs deployed version
# Verify same projectId
```

### Fix 2: PDFs Not Deleting
```bash
# Check browser console for errors
# Verify Storage Rules allow delete
# Check Firebase Console → Storage → Files
# Manually delete orphaned files
```

### Fix 3: Can't Login After Deploy
```bash
# Verify email is in whitelist
# Check Firebase Console → Authentication → Users
# Verify same Firebase project
```

---

## ❓ Summary: Your Questions Answered

| Question | Answer |
|----------|--------|
| **Why data clears after restart?** | Different user accounts between local/production, or wrong Firebase config |
| **Why PDF still in Storage?** | Deletion failed silently - check Storage Rules and add error logs |
| **Need new Firebase project?** | **NO** - use the same project for both environments |
| **How to prevent issues?** | Follow checklist above, verify Rules, use environment variables |

---

**Need Help?**
- I can create a cleanup script for orphaned files
- I can add better error logging to delete handlers
- I can create a migration tool for your data
- I can set up Cloud Functions for automatic cleanup

Just let me know what you need! 🚀
