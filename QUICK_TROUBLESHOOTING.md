# 🚨 Quick Troubleshooting Card

## Problem: Data Disappears After Restart

### ✅ Checklist:
1. **Same Email Account?**
   - Local test: `admin@foodworld.com`
   - Production: `admin@foodworld.com` ← **Must match!**

2. **Check Firebase Console:**
   - Go to: Authentication → Users
   - Note the User UID
   - Go to: Firestore → `artifacts/default-app-id/users/[YOUR_UID]`
   - Is your data there?

3. **Same Firebase Project?**
   - Local: Check `src/firebase.js` → `projectId`
   - Netlify: Verify same project deployed

### 🔍 Quick Test:
```bash
# Add this to App.jsx temporarily (line ~3665):
console.log('🔍 Debug Info:', {
  userId: user?.uid,
  email: user?.email,
  appId: appId,
  dataPath: `artifacts/${appId}/users/${user?.uid}/employees`
});
```

---

## Problem: PDF Still in Storage After Delete

### Why This Happens:
- Delete button clicked but network failed
- Storage Rules block deletion
- Code crashed before completing

### ✅ Fix:
1. **Check Firebase Console:**
   - Storage → Browse files
   - Find: `employee_docs/`
   - Delete manually if needed

2. **Improve Logging:**
```javascript
// I can add this to your delete handlers:
try {
  console.log('🗑️ Deleting:', storagePath);
  await deleteObject(storageRef);
  console.log('✅ Storage deleted');
  await updateDoc(docRef, {...});
  console.log('✅ Firestore updated');
  alert('✅ Document deleted successfully!');
} catch (error) {
  console.error('❌ Error:', error);
  alert('❌ Delete failed: ' + error.message);
}
```

### 📋 Storage Rules (Must Have):
```javascript
// Firebase Console → Storage → Rules
match /employee_docs/{allPaths=**} {
  allow read: if request.auth != null;
  allow write: if request.auth != null;
  allow delete: if request.auth != null;  // ← This is critical!
}
```

---

## Do I Need a New Firebase Project?

### ❌ NO - Keep the same project if:
- Single business/company
- Same data for all users
- Dev and Production = same app

### ✅ YES - Create new project if:
- Multiple clients (different databases)
- Completely separate environments
- Different billing accounts

### 🎯 Recommended: **Use same project, different users**
```
Firebase Project: foodworld-dashboard
├── User 1: admin@foodworld.com (you)
├── User 2: manager@foodworld.com
└── User 3: supervisor@foodworld.com

Data Structure:
artifacts/
  └── default-app-id/
      └── users/
          ├── [user1_uid]/
          │   ├── employees/
          │   ├── vehicles/
          │   └── ...
          ├── [user2_uid]/
          │   └── ...
```

---

## 🔧 Immediate Actions Required

### 1. Verify Firebase Rules (2 minutes)

**Firestore Rules:**
```javascript
// Firebase Console → Firestore → Rules → Publish this:
match /artifacts/{appId}/users/{userId}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

**Storage Rules:**
```javascript
// Firebase Console → Storage → Rules → Publish this:
match /employee_docs/{allPaths=**} {
  allow read, write, delete: if request.auth != null;
}
```

### 2. Use Same Account Everywhere

- Local: Login with `your-email@example.com`
- Netlify: Login with `your-email@example.com`
- **Never switch accounts between environments!**

### 3. Check Deployed Config

```bash
# Verify your Netlify build uses correct Firebase config
# Check: Site settings → Environment variables
# Should have:
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_AUTH_DOMAIN=...
# etc.
```

---

## 🚀 Quick Commands

### View Current User Info
Open browser console (F12) and type:
```javascript
// Check logged in user
console.log(firebase.auth().currentUser);
```

### Check Firestore Path
```javascript
// Verify your data location
console.log('Data path:', `artifacts/default-app-id/users/${firebase.auth().currentUser.uid}`);
```

### Test Storage Delete
```javascript
// Add to delete handler temporarily:
console.log('🗑️ Attempting delete:', storagePath);
await deleteObject(storageRef);
console.log('✅ Delete successful!');
```

---

## 📞 Need More Help?

Reply with:
- "Show me a cleanup script" → I'll create a tool to remove orphaned files
- "Add better error logging" → I'll improve delete error messages
- "Setup environment variables" → I'll update firebase.js with env vars
- "Create migration tool" → I'll help you move data between accounts

---

**Bottom Line:**
1. ✅ Use **same Firebase project** everywhere
2. ✅ Login with **same email** in local & production
3. ✅ Verify **Storage Rules** allow delete
4. ✅ Check **browser console** for errors when deleting
5. ✅ Manually cleanup orphaned files in Firebase Console

Your current code is solid - the issue is likely configuration or account mismatch, not code bugs! 🎯
