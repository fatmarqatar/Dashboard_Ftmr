# QBG Dashboard

A comprehensive business management dashboard built with React, Vite, and Firebase.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Deploy to Firebase
firebase deploy --only hosting
```

## 📋 Features

### Core Modules
- **CO1/CO2** - Company management (Employees, Vehicles, WPS, Bank, Audit, Documents, Credentials)
- **RCRT** - Visa and recruitment management with P&L tracking
- **BS1** - Business sections and transactions
- **Ledger** - General ledger with Chart of Accounts
- **Financial Reports** - P&L, Balance Sheet, Trial Balance, Cash Flow
- **DB6** - Debts & Credits management with settlements
- **Statements** - Account statements and invoicing
- **Vision** - Business analytics, charts, and notes
- **Notifications** - Real-time expiry alerts and reminders

### Key Features
- 🔐 Firebase Authentication with whitelist system
- 📊 Real-time data synchronization
- 📈 Interactive charts and visualizations
- 📄 Excel & JSON bulk import/export
- 📱 Fully responsive design
- 🌓 Dark mode support
- �� Firebase Storage for document management
- 🔔 Smart notification system
- 💾 Persistent state management

## 🛠️ Technology Stack

- **Frontend**: React 18, Vite 5, Tailwind CSS
- **Backend**: Firebase (Auth, Firestore, Storage)
- **Charts**: Chart.js with react-chartjs-2
- **Icons**: Lucide React
- **Spreadsheets**: SheetJS (xlsx)

## 📚 Documentation

- [Firebase Deployment Guide](FIREBASE_DEPLOYMENT_GUIDE.md)
- [Firebase Project Change Guide](FIREBASE_PROJECT_CHANGE.md)
- [Storage Rules Deployment](STORAGE_RULES_DEPLOYMENT.md)

## 🌐 Live URL

https://fatmar1-2eb73.web.app

## 📝 Firebase Configuration

The app uses Firebase project: `fatmar1-2eb73`

Configuration is in `src/firebase.js` - ensure proper credentials are set.

## 🔒 Security

- Firestore rules enforce user-based data isolation
- Storage rules require authentication
- Whitelist system for authorized users
- CORS configured for storage access

## 📦 Project Structure

```
dashboard/
├── src/
│   ├── App.jsx              # Main application component
│   ├── AuthModal.jsx        # Authentication UI
│   ├── ErrorBoundary.jsx    # Error handling
│   ├── LandingPage.jsx      # Public landing page
│   ├── firebase.js          # Firebase configuration
│   └── main.jsx             # Application entry point
├── dist/                    # Production build output
├── firebase.json            # Firebase configuration
├── storage.rules            # Firebase Storage security rules
└── package.json             # Dependencies and scripts
```

## 🤝 Contributing

1. Make changes in a feature branch
2. Test locally with `npm run dev`
3. Build and verify with `npm run build`
4. Deploy with `firebase deploy`

## 📄 License

Private - All rights reserved
