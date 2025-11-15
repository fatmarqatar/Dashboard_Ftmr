# 🎯 Quick Start Guide - Creating Your First Account

## Step-by-Step Instructions

### 1️⃣ Open the Dashboard
- Run: `npm run dev`
- Open browser to the URL shown (usually `http://localhost:5173`)
- You'll see the **Landing Page** with blue gradient

---

### 2️⃣ Click Login Button
- Click either:
  - **"Get Started"** button (center of page)
  - **"Login"** button (top right)
- A modal window will pop up

---

### 3️⃣ Switch to Sign Up Mode
- Modal opens in "Login" mode by default
- At the bottom, you'll see: **"Don't have an account? Sign up"**
- Click **"Sign up"** link
- Modal changes to "Create Account" mode

---

### 4️⃣ Fill in the Sign Up Form

The form has **4 fields**:

**Full Name** 📝
- Example: `Admin User` or `John Doe`
- This is the display name shown in dashboard

**Email Address** 📧
- MUST be an email you added to Firebase whitelist
- Example: `admin@foodworld.com`
- **Important**: If not in whitelist → "Access denied" error

**Password** 🔐
- Create any password (minimum 6 characters)
- Example: `admin123456` or `MySecurePass2024!`
- You choose this password - remember it!

**Confirm Password** ✅
- Type the same password again
- Must match exactly

---

### 5️⃣ Click "Sign Up" Button
- Button shows loading spinner: "Creating Account..."
- If email is whitelisted ✅ → Account created → Auto login → Dashboard
- If email NOT whitelisted ❌ → "Access denied" error

---

### 6️⃣ Success! 🎉
- You're now logged into the dashboard
- Top right shows your name: "👤 Admin User"
- You can now use all features
- Click logout icon (red hover) to log out

---

## 📱 Example Walkthrough

**Scenario**: Creating account for `manager@foodworld.com`

1. ✅ **Add email to Firebase whitelist** (you already did this!)
   ```
   Firestore → authorized_users → whitelist → emails
   Add: "manager@foodworld.com"
   ```

2. ✅ **Open landing page** (`npm run dev`)

3. ✅ **Click "Get Started"**

4. ✅ **Click "Sign up" link** at bottom

5. ✅ **Fill form**:
   - Full Name: `Manager Name`
   - Email: `manager@foodworld.com`
   - Password: `Manager2024!`
   - Confirm Password: `Manager2024!`

6. ✅ **Click "Sign Up"** button

7. ✅ **Dashboard opens** - Account created!

---

## 🔄 For Next Logins

Once account is created, user can login normally:

1. Landing page → Click "Login"
2. Enter email + password (no name needed)
3. Click "Login" button
4. Dashboard opens

---

## ⚠️ Common Issues

### "Access denied"
- **Cause**: Email not in Firebase whitelist
- **Fix**: Add email to `authorized_users/whitelist/emails` in Firestore

### "Email already in use"
- **Cause**: Account already exists
- **Fix**: Use "Log in" instead of "Sign up"

### "Passwords do not match"
- **Cause**: Password and Confirm Password are different
- **Fix**: Type carefully, make sure both match

### "Password must be at least 6 characters"
- **Cause**: Password too short
- **Fix**: Use minimum 6 characters

---

## 🎯 Summary

**For First User (You):**
1. Whitelist your email in Firebase ✅ (Already done)
2. Go to landing page
3. Click "Sign up"
4. Create password yourself (choose any password 6+ chars)
5. Dashboard access granted!

**For Additional Users:**
1. Add their email to whitelist first
2. Share landing page URL
3. They click "Sign up"
4. They create their own password
5. Done!

---

## 🔐 Security Notes

- **Password is created by the user** during signup
- Each user creates their own unique password
- Passwords are stored securely by Firebase (encrypted)
- Only whitelisted emails can create accounts
- No default passwords - everyone chooses their own

---

**Ready to try?** Start with Step 1 above! 🚀
