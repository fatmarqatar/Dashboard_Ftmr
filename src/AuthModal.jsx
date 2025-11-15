import React, { useState } from 'react';
import { X, Mail, Lock, User, Loader2, AlertCircle } from 'lucide-react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth, db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';

const AuthModal = ({ onClose, onAuthSuccess, mode: initialMode = 'login' }) => {
    const [mode, setMode] = useState(initialMode); // 'login' | 'signup' | 'reset'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
    setError('');
    setSuccess('');

        if (mode === 'signup') {
            if (password !== confirmPassword) {
                setError('Passwords do not match');
                return;
            }
            if (password.length < 6) {
                setError('Password must be at least 6 characters');
                return;
            }
            if (!displayName.trim()) {
                setError('Please enter your name');
                return;
            }
        }

        setLoading(true);

        try {
            if (mode === 'reset') {
                // Whitelist check
                const whitelistRef = doc(db, 'authorized_users', 'whitelist');
                const whitelistSnap = await getDoc(whitelistRef);
                if (!whitelistSnap.exists()) {
                    setError('Authorization system not configured.');
                    setLoading(false);
                    return;
                }
                const emails = (whitelistSnap.data().emails || []).map((e) => String(e).toLowerCase());
                if (!emails.includes((email || '').toLowerCase())) {
                    setError('Email is not authorized for this system.');
                    setLoading(false);
                    return;
                }

                await sendPasswordResetEmail(auth, email);
                setSuccess('Password reset email sent. Please check your inbox.');
                setLoading(false);
                return;
            }

            onAuthSuccess({ email, password, displayName, mode });
        } catch (err) {
            setError(err.message || 'Authentication failed');
            setLoading(false);
        }
    };

    const toggleMode = () => {
        setMode(mode === 'login' ? 'signup' : 'login');
        setError('');
        setPassword('');
        setConfirmPassword('');
        setSuccess('');
    };

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4">
            <div className="bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 rounded-2xl shadow-2xl w-full max-w-md border border-white/10">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/10">
                    <h2 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                        {mode === 'login' && 'Welcome Back'}
                        {mode === 'signup' && 'Create Account'}
                        {mode === 'reset' && 'Reset Password'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-400 hover:text-white"
                        title="Close"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-start space-x-2 text-red-300">
                            <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                            <span className="text-sm">{error}</span>
                        </div>
                    )}
                    {success && (
                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 flex items-start space-x-2 text-emerald-300">
                            <span className="text-sm">{success}</span>
                        </div>
                    )}

                    {mode === 'signup' && (
                        <div>
                            <label htmlFor="displayName" className="block text-sm font-medium text-gray-300 mb-2">
                                Full Name
                            </label>
                            <div className="relative">
                                <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    id="displayName"
                                    name="displayName"
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-white placeholder-gray-500"
                                    placeholder="John Doe"
                                    required
                                    autoComplete="name"
                                />
                            </div>
                        </div>
                    )}

                    <div>
                        <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                            Email Address
                        </label>
                        <div className="relative">
                            <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="email"
                                id="email"
                                name="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-white placeholder-gray-500"
                                placeholder="your@email.com"
                                required
                                autoComplete="email"
                            />
                        </div>
                    </div>

                    {mode !== 'reset' && (
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                            Password
                        </label>
                        <div className="relative">
                            <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="password"
                                id="password"
                                name="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-white placeholder-gray-500"
                                placeholder="••••••••"
                                required
                                minLength={6}
                                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                            />
                        </div>
                    </div>
                    )}

                    {mode === 'signup' && (
                        <div>
                            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-300 mb-2">
                                Confirm Password
                            </label>
                            <div className="relative">
                                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="password"
                                    id="confirmPassword"
                                    name="confirmPassword"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent text-white placeholder-gray-500"
                                    placeholder="••••••••"
                                    required
                                    minLength={6}
                                    autoComplete="new-password"
                                />
                            </div>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 rounded-lg font-semibold transition-all duration-300 shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                    >
                        {loading ? (
                            <>
                                <Loader2 size={20} className="animate-spin" />
                                <span>
                                    {mode === 'login' && 'Logging in...'}
                                    {mode === 'signup' && 'Creating Account...'}
                                    {mode === 'reset' && 'Sending Reset Link...'}
                                </span>
                            </>
                        ) : (
                            <span>
                                {mode === 'login' && 'Login'}
                                {mode === 'signup' && 'Sign Up'}
                                {mode === 'reset' && 'Send Reset Link'}
                            </span>
                        )}
                    </button>

                    {mode === 'login' && (
                        <div className="text-center">
                            <button
                                type="button"
                                className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
                                onClick={() => { setMode('reset'); setError(''); setSuccess(''); }}
                            >
                                Forgot password?
                            </button>
                        </div>
                    )}
                    {mode === 'reset' && (
                        <div className="text-center text-sm text-gray-400">
                            Enter your authorized email.
                        </div>
                    )}
                </form>

                {/* Footer */}
                <div className="p-6 pt-0 text-center">
                    {mode !== 'reset' ? (
                        <p className="text-sm text-gray-400">
                            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
                            <button
                                onClick={toggleMode}
                                className="text-cyan-400 hover:text-cyan-300 font-semibold transition-colors"
                            >
                                {mode === 'login' ? 'Sign up' : 'Log in'}
                            </button>
                        </p>
                    ) : (
                        <p className="text-sm text-gray-400">
                            Remembered your password?{' '}
                            <button
                                onClick={() => { setMode('login'); setError(''); setSuccess(''); }}
                                className="text-cyan-400 hover:text-cyan-300 font-semibold transition-colors"
                            >
                                Back to login
                            </button>
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AuthModal;
