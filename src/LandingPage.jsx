import React, { useState } from 'react';
import { Briefcase, Mail, Phone, MapPin, Clock, ArrowRight, LogIn } from 'lucide-react';
import AuthModal from './AuthModal';

const LandingPage = ({ onLoginSuccess, user, onDashboardClick }) => {
    const [showAuthModal, setShowAuthModal] = useState(false);

    const handleAuthClick = () => {
        setShowAuthModal(true);
    };

    const handleAuthSuccess = (authData) => {
        setShowAuthModal(false);
        onLoginSuccess(authData);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white">
            {/* Header */}
            <header className="border-b border-white/10 backdrop-blur-sm bg-black/20 sticky top-0 z-50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-lg flex items-center justify-center">
                                <Briefcase size={24} className="text-white" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                                    Fatmar Qatar
                                </h1>
                                <p className="text-xs text-gray-400">Management Solutions</p>
                            </div>
                        </div>
                        <div className="flex items-center space-x-4">
                            {user ? (
                                <button
                                    onClick={onDashboardClick}
                                    className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 rounded-lg font-semibold transition-all duration-300 shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 flex items-center space-x-2"
                                >
                                    <span>Go to Dashboard</span>
                                    <ArrowRight size={18} />
                                </button>
                            ) : (
                                <button
                                    onClick={handleAuthClick}
                                    className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 rounded-lg font-semibold transition-all duration-300 shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 flex items-center space-x-2"
                                >
                                    <span>Login</span>
                                    <ArrowRight size={18} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            {/* Hero Section */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="py-20 sm:py-32 text-center">
                    {/* Coming Soon Badge */}
                    <div className="inline-flex items-center px-4 py-2 bg-cyan-500/10 border border-cyan-500/20 rounded-full mb-8">
                        <Clock size={16} className="mr-2 text-cyan-400" />
                        <span className="text-sm font-medium text-cyan-300">Coming Soon</span>
                    </div>

                    {/* Main Heading */}
                    <h2 className="text-5xl sm:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
                        <span className="bg-gradient-to-r from-cyan-300 via-blue-400 to-purple-400 bg-clip-text text-transparent">
                            Streamline Your
                        </span>
                        <br />
                        <span className="text-white">Business Operations</span>
                    </h2>

                    {/* Subtitle */}
                    <p className="text-xl sm:text-2xl text-gray-300 mb-12 max-w-3xl mx-auto leading-relaxed">
                        A comprehensive management dashboard to handle Manpower, vehicles, finances, and more—all in one place.
                    </p>

                    {/* Features Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto mb-16">
                        {[
                            { title: 'Manpower Supply ', desc: 'Track and manage your workforce efficiently' },
                            { title: 'Financial Consulting', desc: 'Monitor ledgers, debts, and credits in real-time' },
                            { title: 'Vehicle Fleet', desc: 'Maintain comprehensive vehicle records' }
                        ].map((feature, idx) => (
                            <div key={idx} className="p-6 bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl hover:bg-white/10 transition-all duration-300">
                                <h3 className="text-lg font-semibold mb-2 text-cyan-300">{feature.title}</h3>
                                <p className="text-gray-400 text-sm">{feature.desc}</p>
                            </div>
                        ))}
                    </div>

                    {/* CTA Button */}
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        {user ? (
                            <button
                                onClick={onDashboardClick}
                                className="px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 rounded-xl font-bold text-lg transition-all duration-300 shadow-2xl shadow-cyan-500/30 hover:shadow-cyan-500/50 hover:scale-105 flex items-center space-x-2"
                            >
                                <span>Go to Dashboard</span>
                                <ArrowRight size={20} />
                            </button>
                        ) : (
                            <>
                                <button
                                    onClick={handleAuthClick}
                                    className="px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 rounded-xl font-bold text-lg transition-all duration-300 shadow-2xl shadow-cyan-500/30 hover:shadow-cyan-500/50 hover:scale-105"
                                >
                                    Get Started
                                </button>
                                <button className="px-8 py-4 bg-white/5 hover:bg-white/10 border border-white/20 rounded-xl font-semibold text-lg transition-all duration-300">
                                    Learn More
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Contact Section */}
                <div className="py-16 border-t border-white/10">
                    <div className="text-center mb-12">
                        <h3 className="text-3xl font-bold mb-3 bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent">
                            Get In Touch
                        </h3>
                        <p className="text-gray-400">Have questions? We'd love to hear from you.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
                        <div className="p-6 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl hover:bg-white/10 transition-all duration-300">
                            <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center mb-4">
                                <Mail size={24} />
                            </div>
                            <h4 className="font-semibold mb-2">Email</h4>
                            <a href="mailto:fatmarqatar@gmail.com" className="text-sm text-gray-400 hover:text-cyan-400 transition-colors">
                                fatmarqatar@gmail.com
                            </a>
                        </div>

                        <div className="p-6 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl hover:bg-white/10 transition-all duration-300">
                            <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center mb-4">
                                <Phone size={24} />
                            </div>
                            <h4 className="font-semibold mb-2">Phone</h4>
                            <a href="tel:+97455003371" className="text-sm text-gray-400 hover:text-cyan-400 transition-colors">
                                +974 55003371
                            </a>
                        </div>

                        <div className="p-6 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl hover:bg-white/10 transition-all duration-300">
                            <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center mb-4">
                                <MapPin size={24} />
                            </div>
                            <h4 className="font-semibold mb-2">Location</h4>
                            <p className="text-sm text-gray-400">
                                Doha, Qatar
                            </p>
                        </div>

                        <div className="p-6 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl hover:bg-white/10 transition-all duration-300">
                            <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center mb-4">
                                <Clock size={24} />
                            </div>
                            <h4 className="font-semibold mb-2">Business Hours</h4>
                            <p className="text-sm text-gray-400">
                                Sat - Thu: 8AM - 6PM
                            </p>
                        </div>
                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="border-t border-white/10 mt-20">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    <div className="flex flex-col md:flex-row items-center justify-between">
                        <div className="flex items-center space-x-3 mb-4 md:mb-0">
                            <div className="w-8 h-8 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-lg flex items-center justify-center">
                                <Briefcase size={18} className="text-white" />
                            </div>
                            <span className="text-sm text-gray-400">© 2025 Fatmar Qatar. All rights reserved.</span>
                        </div>
                        <div className="flex space-x-6 text-sm text-gray-400">
        
                            <a href="#" className="hover:text-cyan-400 transition-colors">Terms of Service</a>
                            <a href="#" className="hover:text-cyan-400 transition-colors">Contact</a>
                        </div>
                    </div>
                </div>
            </footer>

            {showAuthModal && (
                <AuthModal
                    onClose={() => setShowAuthModal(false)}
                    onAuthSuccess={handleAuthSuccess}
                    mode="login"
                />
            )}
        </div>
    );
};

export default LandingPage;
