# Firebase Storage Rules Deployment Guide

## Problem
Getting Firebase permission errors when trying to upload PDFs or images.

## Solution
You need to update your Firebase Storage security rules to allow authenticated users to upload files.

## Method 1: Deploy Rules via Firebase CLI (Recommended)

### Step 1: Install Firebase CLI (if not already installed)
```bash
npm install -g firebase-tools
```

### Step 2: Login to Firebase
```bash
firebase login
```

### Step 3: Initialize Firebase in your project (if not done)
```bash
firebase init storage
```
- Select your Firebase project: `fatmar1-2eb73`
- Accept the default storage rules file: `storage.rules`

### Step 4: Deploy the Storage Rules
```bash
firebase deploy --only storage
```

This will upload the `storage.rules` file to your Firebase project.

---

## Method 2: Update Rules via Firebase Console (Quick Fix)

If you don't have Firebase CLI or prefer the web interface:

### Step 1: Go to Firebase Console
1. Open: https://console.firebase.google.com/
2. Select your project: **fatmar1-2eb73**

### Step 2: Navigate to Storage Rules
1. Click on **Storage** in the left sidebar
2. Click on the **Rules** tab at the top

### Step 3: Replace the Rules
Copy and paste these rules (replace everything):

```
rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {
    
    // Helper function to check if user is authenticated
    function isAuthenticated() {
      return request.auth != null;
    }
    
    // Employee photos
    match /employee_photos/{userId}/{employeeId}/{fileName} {
      allow read: if isAuthenticated();
      allow write: if isAuthenticated();
      allow delete: if isAuthenticated();
    }
    
    // Employee documents
    match /employee_docs/{userId}/{employeeId}/{fileName} {
      allow read: if isAuthenticated();
      allow write: if isAuthenticated();
      allow delete: if isAuthenticated();
    }
    
    // Documents & Credentials files
    match /docs_creds/{collectionPrefix}/{docId}/{fileName} {
      allow read: if isAuthenticated();
      allow write: if isAuthenticated();
      allow delete: if isAuthenticated();
    }
    
    // Generic fallback for all paths
    match /{allPaths=**} {
      allow read: if isAuthenticated();
      allow write: if isAuthenticated();
      allow delete: if isAuthenticated();
    }
  }
}
```

### Step 4: Publish the Rules
Click the **Publish** button to save and deploy the rules.

---

## Method 3: Temporary Testing Rules (Not Recommended for Production)

⚠️ **For testing only** - allows anyone to upload without authentication:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if true;
    }
  }
}
```

**Important:** Remove these open rules after testing!

---

## Verification

After deploying the rules:

1. Wait 30-60 seconds for propagation
2. Refresh your dashboard application
3. Try uploading a PDF to Documents or Credentials
4. Try uploading a photo to an Employee

The uploads should now work without permission errors.

---

## Common Issues

### Issue: "Permission denied" error persists
- **Solution**: Make sure you're logged in (check if user is authenticated)
- Clear browser cache and refresh the page
- Wait a few minutes for rules to propagate

### Issue: Firebase CLI not recognizing project
- **Solution**: Run `firebase use fatmar1-2eb73` to select your project

### Issue: Rules validation error
- **Solution**: Check that you copied the complete rules without any syntax errors

---

## Storage Paths Used in Dashboard

The dashboard uses these storage paths:

1. **Employee Photos**: `employee_photos/{userId}/{employeeId}/{timestamp}_filename.jpg`
2. **Employee Documents**: `employee_docs/{userId}/{employeeId}/{docType}_{timestamp}.pdf`
3. **Docs & Creds Files**: `docs_creds/{collectionPrefix}/{docId}/{timestamp}_filename.pdf`

All paths require user authentication to upload, view, or delete files.
