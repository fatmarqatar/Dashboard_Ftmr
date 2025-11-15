# 🔐 Auto-Logout Feature

## Overview
The dashboard now has **smart session management** that automatically logs you out after inactivity on the landing page, while keeping you logged in when actively using the dashboard.

---

## How It Works

### ✅ **Inside Dashboard** (Active Use)
- **No auto-logout** - You stay logged in indefinitely
- Full access to all features
- Session remains active as long as you're working

### ⏰ **On Landing Page** (Idle)
- **5-minute countdown timer** starts automatically
- Visible countdown display shows remaining time
- Auto-logout when timer reaches 0
- Warning confirmation before navigating to landing page

---

## User Flow Examples

### Scenario 1: Working in Dashboard
```
Login → Dashboard → (Working for hours) → Still logged in ✅
```

### Scenario 2: Leaving Dashboard Idle
```
Login → Dashboard → Click Home button → Confirmation dialog
  ↓
Confirm → Landing page → 5:00 countdown starts
  ↓
After 5 minutes → Auto logout → Must login again
```

### Scenario 3: Quick Return to Dashboard
```
Dashboard → Click Home → Landing page (countdown: 4:30)
  ↓
Click "Go to Dashboard" → Back to dashboard → Countdown stops ✅
```

---

## Visual Indicators

### On Landing Page (When Logged In)
1. **Header (Desktop)**:
   - Amber countdown badge: `⏱ Auto-logout: 4:35`
   - "Go to Dashboard" button (instead of "Login")

2. **Hero Section**:
   - "Go to Dashboard" button (instead of "Get Started")
   - Mobile countdown badge below button

3. **Countdown Colors**:
   - **Amber**: Normal (5:00 to 1:01)
   - Timer counts down every second

---

## Technical Details

### Auto-Logout Settings
- **Duration**: 5 minutes (300 seconds)
- **Trigger**: Only on landing page when logged in
- **Reset**: Timer clears when returning to dashboard
- **Action**: Automatic sign-out via Firebase Auth

### Confirmation Dialog
When clicking "Home" button from dashboard:
```
"You will be automatically logged out after 5 minutes 
of inactivity on the landing page.

Do you want to continue?"
[Cancel] [OK]
```

---

## Benefits

✅ **Security**: Prevents unauthorized access if you leave browser open  
✅ **Flexibility**: No interruption while actively working  
✅ **Awareness**: Clear countdown shows exact time remaining  
✅ **Control**: Warning before leaving dashboard  

---

## FAQ

**Q: Can I change the 5-minute duration?**  
A: Yes, edit `AUTO_LOGOUT_DURATION` in App.jsx line ~3669

**Q: What happens if I'm in the middle of work when it expires?**  
A: Auto-logout only happens on landing page, not in dashboard

**Q: Can I extend the timer?**  
A: Click "Go to Dashboard" to stop the timer and stay logged in

**Q: What if I close the browser?**  
A: Session persists - you'll still be logged in when you return (until landing page timeout)

---

## For Developers

### Code Location
File: `src/App.jsx`

**Auto-logout timer** (lines ~3661-3691):
```javascript
useEffect(() => {
    if (user && showLanding) {
        const AUTO_LOGOUT_DURATION = 5 * 60 * 1000; // 5 minutes
        autoLogoutTimerRef.current = setTimeout(async () => {
            await signOut(auth);
            setShowLanding(true);
        }, AUTO_LOGOUT_DURATION);
    }
    return () => clearTimeout(autoLogoutTimerRef.current);
}, [user, showLanding]);
```

**Confirmation dialog** (lines ~3843-3851):
```javascript
const handleReturnToLanding = () => {
    const confirmed = window.confirm('You will be automatically logged out...');
    if (confirmed) setShowLanding(true);
};
```

### Customization Options
Change duration:
```javascript
const AUTO_LOGOUT_DURATION = 10 * 60 * 1000; // 10 minutes
```

Disable confirmation:
```javascript
const handleReturnToLanding = () => setShowLanding(true);
```

---

## Testing Checklist

- [ ] Login and stay in dashboard for >5 minutes → Should NOT logout
- [ ] Login → Go to landing → Wait 5 minutes → Should auto-logout
- [ ] Login → Go to landing → Go back to dashboard → Timer should stop
- [ ] Click "Home" button → Should show confirmation dialog
- [ ] Countdown visible on landing page (desktop header + mobile hero)
- [ ] "Go to Dashboard" button works correctly

---

**Last Updated**: 15 November 2025
