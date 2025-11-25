import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ErrorBoundary from './ErrorBoundary';
import LandingPage from './LandingPage';
// Consolidated lucide-react import
import { Undo, Download, Upload, Edit, Trash2, PlusCircle, X, FileText, Briefcase, BookOpen, Target, TrendingUp, Sun, Moon, HandCoins, AlertTriangle, Loader2, Building2, CheckCircle, Save, Search, UserPlus, Users, Eye, Filter, Car, Banknote, FileCheck2, MoreHorizontal, KeyRound, Truck, ShieldCheck, TrendingDown, Carrot, BookUser, IdCard, Settings, SearchCode, Bell, FileUp, Copy, Pin, PinOff, Home, LogOut, User } from 'lucide-react';
// Consolidated Chart.js imports, register first
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, Title, BarElement, Filler } from 'chart.js';
import { Pie, Bar, Line, Doughnut } from 'react-chartjs-2'; // Import react-chartjs-2 components after registration

import { doc, setDoc, getDoc, collection, onSnapshot, addDoc, deleteDoc, updateDoc, writeBatch, getDocs, arrayUnion, arrayRemove, query, where, or, orderBy, limit } from 'firebase/firestore';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { app, db, auth, storage } from './firebase.js';

// Register Chart.js components
ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, Title, BarElement, Filler);

// --- Passcode Obfuscation ---
const PASSCODE_SALT = "qbg-dashboard-salt-2024";
const hashPasscode = (passcode) => {
    try {
        // A simple obfuscation, not a true cryptographic hash.
        return btoa(`${PASSCODE_SALT}${passcode}${PASSCODE_SALT}`);
    } catch (e) {
        console.error("Failed to hash passcode:", e);
        // Fallback for environments where btoa might not be available
        return `${PASSCODE_SALT}${passcode}${PASSCODE_SALT}`;
    }
};

// --- Helper Functions ---
const formatCurrency = (amount, currency = 'QAR') => `${currency} ${parseFloat(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatAmount = (amount) => parseFloat(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatNumber = (amount) => parseFloat(amount || 0).toFixed(2);
const formatDate = (dateInput) => {
    if (!dateInput) return '';
    const date = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
    if (isNaN(date.getTime())) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
};
const parseDateForFirestore = (dateStr) => { // expects dd/mm/yyyy
    if (!dateStr || typeof dateStr !== 'string') return null;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    const [day, month, year] = parts;
    if (day.length < 1 || month.length < 1 || year.length !== 4) return null;
    const date = new Date(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T00:00:00Z`);
    return isNaN(date.getTime()) ? null : date;
};
const capitalizeWords = (str) => str ? str.replace(/\b\w/g, char => char.toUpperCase()) : '';
const autoCompleteMonth = (input) => {
    if (!input || typeof input !== 'string' || input.length < 3) return input;
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const lowerInput = input.toLowerCase();
    const matchedMonth = months.find(m => m.toLowerCase().startsWith(lowerInput));
    return matchedMonth || capitalizeWords(input);
};

const copyToClipboard = (text) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed"; // prevent scrolling to bottom
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy');
    } catch (err) {
        console.error('Fallback: Oops, unable to copy', err);
    }
    document.body.removeChild(textArea);
};

const isDateExpired = (dateInput) => {
    if (!dateInput) return false;
    const date = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
    if (isNaN(date.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Compare against the start of today
    return date < today;
};

const getStatusBadge = (status) => {
    const statusColors = {
        'New Visa': 'bg-blue-500/20 text-blue-400',
        'Under Process': 'bg-yellow-500/20 text-yellow-400',
        'RP Issued': 'bg-green-500/20 text-green-400',
        'Others': 'bg-gray-500/20 text-gray-400',
    };
    return (
        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${statusColors[status] || 'bg-gray-500/20 text-gray-400'}`}>
            {status}
        </span>
    );
};

const restoreTimestamps = (data) => {
    if (data === null || typeof data !== 'object') {
        return data;
    }
    // Firestore Timestamp object check
    if (typeof data.seconds === 'number' && typeof data.nanoseconds === 'number' && Object.keys(data).length === 2) {
        return new Date(data.seconds * 1000 + data.nanoseconds / 1000000);
    }
    if (Array.isArray(data)) {
        return data.map(item => restoreTimestamps(item));
    }
    // Recurse through object properties
    const restoredObject = {};
    for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
            restoredObject[key] = restoreTimestamps(data[key]);
        }
    }
    return restoredObject;
};


// --- Reusable Date Input Component ---
const DateInput = ({ value, onChange, readOnly }) => {
    const [day, setDay] = useState('');
    const [month, setMonth] = useState('');
    const [year, setYear] = useState('');
    const dayRef = useRef(null);
    const monthRef = useRef(null);
    const yearRef = useRef(null);

    useEffect(() => {
        if (value && typeof value === 'string') {
            const parts = value.split('/');
            if (parts.length === 3) { setDay(parts[0]); setMonth(parts[1]); setYear(parts[2]); }
        } else { setDay(''); setMonth(''); setYear(''); }
    }, [value]);

    const handleDayChange = (e) => { const val = e.target.value; if (/^\d{0,2}$/.test(val)) { setDay(val); if (val.length === 2) { monthRef.current?.focus(); } onChange(`${val}/${month}/${year}`); } };
    const handleMonthChange = (e) => { const val = e.target.value; if (/^\d{0,2}$/.test(val)) { setMonth(val); if (val.length === 2) { yearRef.current?.focus(); } onChange(`${day}/${val}/${year}`); } };
    const handleYearChange = (e) => { const val = e.target.value; if (/^\d{0,4}$/.test(val)) { setYear(val); onChange(`${day}/${month}/${val}`); } };
    const handleKeyDown = (e, field) => { if (e.key === 'Backspace') { if (field === 'year' && year === '') monthRef.current?.focus(); if (field === 'month' && month === '') dayRef.current?.focus(); } };

    return (
    <div className={`flex items-center p-2 rounded-md date-input-print-style ${readOnly ? 'dark:bg-gray-800 bg-white cursor-not-allowed text-gray-400' : 'dark:bg-gray-700 bg-gray-100'}`}>
            <input ref={dayRef} type="text" placeholder="dd" value={day} onChange={handleDayChange} className="w-8 bg-transparent outline-none text-center" readOnly={readOnly}/>
            <span>/</span>
            <input ref={monthRef} type="text" placeholder="mm" value={month} onChange={handleMonthChange} onKeyDown={(e) => handleKeyDown(e, 'month')} className="w-8 bg-transparent outline-none text-center" readOnly={readOnly}/>
            <span>/</span>
            <input ref={yearRef} type="text" placeholder="yyyy" value={year} onChange={handleYearChange} onKeyDown={(e) => handleKeyDown(e, 'year')} className="w-12 bg-transparent outline-none text-center" readOnly={readOnly}/>
        </div>
    );
};

// --- Reusable Editable Header Component ---
const EditableHeader = ({ as: Component = 'h2', initialValue, onSave, className, icon }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(initialValue);
    const inputRef = useRef(null);
    useEffect(() => { setValue(initialValue); }, [initialValue]);
    useEffect(() => { if (isEditing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [isEditing]);
    const handleSave = () => { setIsEditing(false); const capitalizedValue = capitalizeWords(value.trim()); if (capitalizedValue && capitalizedValue !== initialValue) { onSave(capitalizedValue); } else { setValue(initialValue); } };
    const handleKeyDown = (e) => { if (e.key === 'Enter') { handleSave(); } else if (e.key === 'Escape') { setValue(initialValue); setIsEditing(false); } };
    return isEditing ? ( <input ref={inputRef} type="text" value={value} onChange={(e) => setValue(e.target.value)} onBlur={handleSave} onKeyDown={handleKeyDown} className={`${className} bg-gray-700 rounded-md px-2 -ml-2`} /> ) : ( <Component className={`${className} cursor-pointer flex items-center`} onClick={() => setIsEditing(true)}> {icon && <span className="mr-3 text-cyan-400">{icon}</span>} {value} </Component> );
};

const EditableTH = ({ initialValue, onSave, className }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(initialValue);
    const inputRef = useRef(null);
    useEffect(() => { setValue(initialValue); }, [initialValue]);
    useEffect(() => { if (isEditing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [isEditing]);
    const handleSave = () => { setIsEditing(false); const trimmedValue = value.trim(); if (trimmedValue && trimmedValue !== initialValue) { onSave(trimmedValue); } else { setValue(initialValue); } };
    const handleKeyDown = (e) => { if (e.key === 'Enter') { handleSave(); } else if (e.key === 'Escape') { setValue(initialValue); setIsEditing(false); } };
    
    return (
        <th className={`p-0 font-semibold text-left ${className}`}>
            <div className="dark:bg-slate-900 bg-white px-3 py-2 rounded-md border dark:border-slate-700/50 cursor-pointer" onClick={() => !isEditing && setIsEditing(true)}>
                {isEditing ? (
                    <input ref={inputRef} type="text" value={value} onChange={e => setValue(e.target.value)} onBlur={handleSave} onKeyDown={handleKeyDown} className="bg-gray-700 rounded-md px-1 w-full" />
                ) : (
                    <span>{value}</span>
                )}
            </div>
        </th>
    );
};

const EditableTextArea = ({ initialValue, onSave, className, rows = 2, placeholder = 'Click to edit' }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(initialValue);
    const inputRef = useRef(null);
    useEffect(() => { setValue(initialValue); }, [initialValue]);
    useEffect(() => { if (isEditing) { inputRef.current?.focus(); } }, [isEditing]);
    const handleSave = () => { setIsEditing(false); onSave(value); };
    return isEditing ? (
        <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={handleSave}
            rows={rows}
            className={`${className} bg-gray-700 rounded-md px-1 -ml-1 w-full`}
        />
    ) : (
        <p className={`${className} cursor-pointer whitespace-pre-wrap min-h-[2rem]`} onClick={() => setIsEditing(true)}>
            {value || <span className="text-gray-500">{placeholder}</span>}
        </p>
    );
};


// --- Live Date/Time Badge ---
const DateTimeLocationBadge = () => {
    const [dateTime, setDateTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setDateTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const formattedDate = dateTime.toLocaleDateString('en-GB', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    }).replace(/\//g, '-');
    const formattedTime = dateTime.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: true
    });

    return (
        <div className="border dark:border-gray-600 border-gray-300 rounded-xl px-3 py-2 text-xs dark:text-gray-300 text-gray-600 text-center hidden md:block">
            <div className="whitespace-nowrap">{formattedDate} <span className="mx-1 opacity-50">|</span> {formattedTime}</div>
            <div className="dark:text-gray-400 text-gray-500">Doha, Qatar</div>
        </div>
    );
};

// --- Last Updated Badge ---
const LastUpdatedBadge = () => {
    const [lastUpdated] = useState(new Date());

    const formattedDate = lastUpdated.toLocaleDateString('en-GB', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    }).replace(/\//g, '-');
    const formattedTime = lastUpdated.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: true
    });

    return (
        <div className="border dark:border-gray-600 border-gray-300 rounded-xl px-3 py-2 text-xs dark:text-gray-300 text-gray-600 text-center hidden md:block">
            {/* Swapped the order of these two divs */}
            <div className="whitespace-nowrap">{formattedDate} - {formattedTime}</div>
            <div className="dark:text-gray-400 text-gray-500">Last Updated</div>
        </div>
    );
};

// --- Document/Credential Modal with File Upload ---
const DocCredModal = ({ isOpen, onSave, onClose, initialData, formFields, title, userId, appId, collectionPrefix, docId }) => {
    const [formData, setFormData] = useState({});
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);
    const [pendingFile, setPendingFile] = useState(null);
    const fileInputRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            const initialFormState = formFields.reduce((acc, field) => {
                let value = initialData?.[field.name] ?? field.defaultValue ?? '';
                
                if (field.type === 'date') {
                    if (initialData && initialData[field.name]) {
                        value = formatDate(initialData[field.name]);
                    } else if (!initialData && !field.noDefaultDate) {
                        value = formatDate(new Date());
                    } else {
                        value = '';
                    }
                } else if (initialData) {
                    value = initialData[field.name] ?? field.defaultValue ?? '';
                } else {
                    value = field.defaultValue ?? '';
                }
                acc[field.name] = value;
                return acc;
            }, {});
            
            if (initialData?.fileUrl) {
                initialFormState.fileUrl = initialData.fileUrl;
                initialFormState.storagePath = initialData.storagePath;
            }
            
            setFormData(initialFormState);
            setPendingFile(null);
        }
    }, [isOpen, initialData, formFields]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.type !== 'application/pdf') {
            setUploadError('Only PDF files are allowed.');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setUploadError('File too large (max 5MB).');
            return;
        }

        setUploadError(null);
        
        // For new documents, store file temporarily
        if (!docId) {
            setPendingFile(file);
            setFormData(prev => ({ ...prev, fileName: file.name }));
            return;
        }

        // For existing documents, upload immediately
        setIsUploading(true);
        try {
            // Delete old file if exists
            if (formData.storagePath) {
                try {
                    const oldRef = ref(storage, formData.storagePath);
                    await deleteObject(oldRef);
                } catch (err) {
                    console.warn('Could not delete old file:', err);
                }
            }

            const storagePath = `docs_creds/${collectionPrefix}/${docId}/${Date.now()}_${file.name}`;
            const storageRef = ref(storage, storagePath);
            await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(storageRef);

            setFormData(prev => ({
                ...prev,
                fileUrl: downloadURL,
                storagePath: storagePath,
                fileName: file.name
            }));
        } catch (err) {
            console.error('Upload failed:', err);
            setUploadError('Upload failed. Please try again.');
        } finally {
            setIsUploading(false);
        }
    };

    const handleRemoveFile = async () => {
        if (!docId) {
            // Remove pending file
            setPendingFile(null);
            setFormData(prev => ({ ...prev, fileName: null }));
            return;
        }

        if (!formData.storagePath) return;

        if (!window.confirm('Are you sure you want to delete this file?')) {
            return;
        }

        setIsUploading(true);
        try {
            const storageRef = ref(storage, formData.storagePath);
            await deleteObject(storageRef);
            
            setFormData(prev => ({
                ...prev,
                fileUrl: null,
                storagePath: null,
                fileName: null
            }));
        } catch (err) {
            console.error('Delete failed:', err);
            setUploadError('Could not delete file.');
        } finally {
            setIsUploading(false);
        }
    };

    const handleSave = async () => {
        const dataToSave = { ...formData };
        
        formFields.forEach(field => {
            if (field.type === 'date') {
                dataToSave[field.name] = parseDateForFirestore(dataToSave[field.name]);
            }
            if (field.type === 'number') {
                dataToSave[field.name] = parseFloat(dataToSave[field.name] || 0);
            }
            if (field.transform === 'capitalize') {
                dataToSave[field.name] = capitalizeWords(dataToSave[field.name] || '');
            }
        });

        // Remove fileName from saved data (it's just for display)
        delete dataToSave.fileName;

        // If there's a pending file, upload it after saving
        if (pendingFile) {
            const uploadCallback = async (newDocId) => {
                try {
                    const storagePath = `docs_creds/${collectionPrefix}/${newDocId}/${Date.now()}_${pendingFile.name}`;
                    const storageRef = ref(storage, storagePath);
                    await uploadBytes(storageRef, pendingFile);
                    const downloadURL = await getDownloadURL(storageRef);
                    
                    // Update the document with file info
                    const docRef = doc(db, `artifacts/${appId}/users/${userId}/${collectionPrefix}Documents`, newDocId);
                    await updateDoc(docRef, {
                        fileUrl: downloadURL,
                        storagePath: storagePath
                    });
                } catch (err) {
                    console.error('Failed to upload file:', err);
                }
            };
            
            onSave(dataToSave, uploadCallback);
        } else {
            onSave(dataToSave);
        }
        
        onClose();
    };
    
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-[100] p-4">
            <div className="dark:bg-gray-800 bg-white p-6 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                <h3 className="text-xl font-bold mb-6">{initialData ? 'Edit' : 'Add'} {title}</h3>
                <div className="overflow-y-auto">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                        {formFields.map(field => (
                            <div key={field.name} className={field.colSpan ? `md:col-span-${field.colSpan}`: ''}>
                                <label className="text-xs dark:text-gray-400 text-gray-500">{field.label}</label>
                                {field.type === 'textarea' ? (
                                    <textarea name={field.name} value={formData[field.name] || ''} onChange={handleChange} className="w-full p-2 dark:bg-gray-700 bg-gray-200 rounded-md h-24 border dark:border-gray-600 border-gray-300" />
                                ) : field.type === 'select' ? (
                                    <select name={field.name} value={formData[field.name] || ''} onChange={handleChange} className="w-full p-2 dark:bg-gray-700 bg-gray-200 rounded-md border dark:border-gray-600 border-gray-300">
                                        {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                    </select>
                                ) : field.type === 'date' ? (
                                    <DateInput 
                                        value={formData[field.name] || ''} 
                                        onChange={val => setFormData(prev => ({ ...prev, [field.name]: val }))} 
                                    />
                                ) : (
                                    <input type={field.type || 'text'} name={field.name} value={formData[field.name] || ''} onChange={handleChange} className="w-full p-2 dark:bg-gray-700 bg-gray-200 rounded-md border dark:border-gray-600 border-gray-300" style={{textTransform: field.transform === 'capitalize' ? 'capitalize' : 'none'}}/>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* File Upload Section */}
                    <div className="border-t dark:border-gray-700 border-gray-300 pt-4 mt-4">
                        <h4 className="text-sm font-semibold mb-3 dark:text-cyan-400 text-cyan-600 flex items-center space-x-2">
                            <FileUp size={14} />
                            <span>Attach PDF Document</span>
                        </h4>
                        <div className="flex items-center space-x-3">
                            <input 
                                type="file" 
                                ref={fileInputRef} 
                                onChange={handleFileChange} 
                                className="hidden" 
                                accept="application/pdf"
                            />
                            <button 
                                onClick={() => fileInputRef.current?.click()} 
                                disabled={isUploading}
                                className="px-4 py-2 bg-cyan-500 hover:bg-cyan-600 rounded-md text-sm font-medium disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
                            >
                                {isUploading ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
                                <span>{isUploading ? 'Uploading...' : (formData.fileUrl || pendingFile) ? 'Replace File' : 'Select PDF'}</span>
                            </button>
                            
                            {(formData.fileUrl || pendingFile) && (
                                <>
                                    <span className="text-sm dark:text-gray-400 text-gray-600 flex items-center space-x-2">
                                        <CheckCircle size={14} className="text-green-400" />
                                        <span>{pendingFile ? pendingFile.name : 'File attached'}</span>
                                    </span>
                                    {formData.fileUrl && (
                                        <a 
                                            href={formData.fileUrl} 
                                            target="_blank" 
                                            rel="noopener noreferrer"
                                            className="p-2 hover:text-cyan-400 transition-colors"
                                            title="View file"
                                        >
                                            <Eye size={16} />
                                        </a>
                                    )}
                                    <button 
                                        onClick={handleRemoveFile} 
                                        disabled={isUploading}
                                        className="p-2 hover:text-red-400 transition-colors disabled:opacity-50"
                                        title="Remove file"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </>
                            )}
                        </div>
                        {uploadError && <p className="text-red-400 text-xs mt-2">{uploadError}</p>}
                        {!docId && pendingFile && <p className="text-xs mt-2 dark:text-cyan-400 text-cyan-600">File will be uploaded after saving</p>}
                    </div>
                </div>
                <div className="flex justify-end space-x-2 mt-6 pt-4 border-t dark:border-gray-700 border-gray-300">
                    <button onClick={onClose} className="px-4 py-2 bg-gray-600 rounded-md hover:bg-gray-700">Cancel</button>
                    <button onClick={handleSave} className="px-4 py-2 bg-cyan-500 rounded-md hover:bg-cyan-600">Save</button>
                </div>
            </div>
        </div>
    );
};

// --- Generic Add/Edit Modal for Sub-Pages ---
const GenericAddEditModal = ({ isOpen, onSave, onClose, initialData, formFields, title, employeeList = [] }) => {
    const [formData, setFormData] = useState({});

    useEffect(() => {
        if (isOpen) {
            const initialFormState = formFields.reduce((acc, field) => {
                let value = initialData?.[field.name] ?? field.defaultValue ?? '';
                
                if (field.type === 'date') {
                    if (initialData && initialData[field.name]) { // Editing existing entry
                        value = formatDate(initialData[field.name]);
                    } else if (!initialData && !field.noDefaultDate) { // New entry with auto-date
                        value = formatDate(new Date()); // Auto-fill current date
                    } else {
                        value = ''; // Editing, but no date was set, or noDefaultDate is true
                    }
                } else if (field.type !== 'date' && initialData) { // Handle non-date fields for editing
                    value = initialData[field.name] ?? field.defaultValue ?? '';
                } else if (field.type !== 'date' && !initialData) { // Handle non-date fields for new
                    value = field.defaultValue ?? '';
                }

                acc[field.name] = value;
                return acc;
            }, {});

            const descriptionField = formFields.find(f => f.type === 'dynamic-description');
            if (descriptionField && initialData?.description) {
                const desc = initialData.description;
                const options = descriptionField.options || [];
                if (desc.startsWith('Vehicle: ')) {
                    initialFormState.description = 'Vehicle';
                    initialFormState.vehicleNumber = desc.replace('Vehicle: ', '');
                } else if (!options.includes(desc)) {
                    initialFormState.description = 'Others';
                    initialFormState.customDescription = desc;
                }
            }

            setFormData(initialFormState);
        }
    }, [isOpen, initialData, formFields]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSave = () => {
        const dataToSave = { ...formData };
        
        if (dataToSave.description === 'Others') {
            dataToSave.description = capitalizeWords(dataToSave.customDescription || 'Others');
        } else if (dataToSave.description === 'Vehicle') {
            dataToSave.description = `Vehicle: ${dataToSave.vehicleNumber || ''}`;
        }
        delete dataToSave.customDescription;
        delete dataToSave.vehicleNumber;

        formFields.forEach(field => {
            if (field.type === 'date') {
                dataToSave[field.name] = parseDateForFirestore(dataToSave[field.name]);
            }
            if (field.type === 'number') {
                dataToSave[field.name] = parseFloat(dataToSave[field.name] || 0);
            }
            if (field.transform === 'capitalize') {
                dataToSave[field.name] = capitalizeWords(dataToSave[field.name] || '');
            }
        });
        onSave(dataToSave);
        onClose();
    };
    
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-[100] p-4">
            <div className="dark:bg-gray-800 bg-white p-6 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                <h3 className="text-xl font-bold mb-6">{initialData ? 'Edit' : 'Add'} {title}</h3>
                <div className="overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {formFields.map(field => (
                        <div key={field.name} className={field.colSpan ? `md:col-span-${field.colSpan}`: ''}>
                            <label className="text-xs dark:text-gray-400 text-gray-500">{field.label}</label>
                            {(field.name === 'name' && employeeList && employeeList.length > 0) ? (
                                <>
                                    <input
                                        list="employee-names-datalist"
                                        name="name"
                                        value={formData.name || ''}
                                        onChange={handleChange}
                                        className="w-full p-2 dark:bg-gray-700 bg-gray-200 rounded-md border dark:border-gray-600 border-gray-300"
                                        placeholder="Type or select..."
                                        style={{textTransform: field.transform === 'capitalize' ? 'capitalize' : 'none'}}
                                    />
                                    <datalist id="employee-names-datalist">
                                        {employeeList.map(empName => <option key={empName} value={empName} />)}
                                    </datalist>
                                </>
                            ) : field.type === 'textarea' ? (
                                <textarea name={field.name} value={formData[field.name] || ''} onChange={handleChange} readOnly={field.readOnly} className={`w-full p-2 dark:bg-gray-700 bg-gray-200 rounded-md h-24 border dark:border-gray-600 border-gray-300 ${field.readOnly ? 'dark:bg-gray-900 bg-gray-100 cursor-not-allowed text-gray-400' : ''}`} />
                            ) : field.type === 'dynamic-description' ? (
                                <div>
                                    <select name="description" value={formData.description || ''} onChange={handleChange} className="w-full p-2 dark:bg-gray-700 bg-gray-200 rounded-md border dark:border-gray-600 border-gray-300">
                                        <option value="">Select...</option>
                                        {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                    </select>
                                    {formData.description === 'Others' && (
                                        <input
                                            type="text" name="customDescription" value={formData.customDescription || ''} onChange={handleChange}
                                            placeholder="Specify other description"
                                            className="w-full p-2 mt-2 dark:bg-gray-700 bg-gray-200 rounded-md border dark:border-gray-600 border-gray-300"
                                            style={{textTransform: 'capitalize'}}
                                        />
                                    )}
                                    {formData.description === 'VEHICLES' && (
                                        <input
                                            type="text" name="vehicleNumber" value={formData.vehicleNumber || ''} onChange={handleChange}
                                            placeholder="Enter Vehicle Number"
                                            className="w-full p-2 mt-2 dark:bg-gray-700 bg-gray-200 rounded-md border dark:border-gray-600 border-gray-300"
                                        />
                                    )}
                                </div>
                            ) : field.type === 'select' ? (
                                <select name={field.name} value={formData[field.name] || ''} onChange={handleChange} disabled={field.readOnly} className="w-full p-2 dark:bg-gray-700 bg-gray-200 rounded-md border dark:border-gray-600 border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed">
                                    {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                </select>
                            ) : field.type === 'date' ? (
                                <DateInput 
                                    value={formData[field.name] || ''} 
                                    readOnly={field.readOnly}
                                    onChange={val => {
                                        const newFormData = { ...formData, [field.name]: val };
                            
                                        if (title === 'Vehicle' && field.name === 'expiry') {
                                            const date = parseDateForFirestore(val);
                                            if (date) {
                                                const today = new Date();
                                                today.setHours(0, 0, 0, 0);
                                                if (date < today) {
                                                    newFormData.status = 'Expired';
                                                } else {
                                                    // Only change status to Active if it was previously Expired
                                                    if (newFormData.status === 'Expired') {
                                                        newFormData.status = 'Active';
                                                    }
                                                }
                                            }
                                        }
                                        setFormData(newFormData);
                                    }} 
                                />
                            ) : (
                                <input type={field.type || 'text'} name={field.name} value={formData[field.name] || ''} onChange={handleChange} readOnly={field.readOnly} className={`w-full p-2 rounded-md border dark:border-gray-600 border-gray-300 ${field.readOnly ? 'dark:bg-gray-900 bg-gray-100 cursor-not-allowed text-gray-400' : 'dark:bg-gray-700 bg-gray-200'}`} style={{textTransform: field.transform === 'capitalize' ? 'capitalize' : 'none'}}/>
                            )}
                        </div>
                    ))}
                </div>
                <div className="flex justify-end space-x-2 mt-6 pt-4 border-t dark:border-gray-700 border-gray-300">
                    <button onClick={onClose} className="px-4 py-2 bg-gray-600 rounded-md">Cancel</button>
                    <button onClick={handleSave} className="px-4 py-2 bg-cyan-500 rounded-md">Save</button>
                </div>
            </div>
        </div>
    );
};

// --- Generic Component for Simple Sub-Pages ---
const GenericSubPage = ({ userId, appId, pageTitle, collectionPath, setConfirmAction, formFields, columns, itemTitle }) => {
    const [items, setItems] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [selectedItems, setSelectedItems] = useState(new Set());
    const importFileInputRef = useRef(null);
    const [searchTerm, setSearchTerm] = useState('');
    const itemsRef = useMemo(() => collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`), [userId, appId, collectionPath]);
    const settingsRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/pageSettings`, collectionPath), [userId, appId, collectionPath]);

    // Load items from Firestore
    useEffect(() => {
        const unsub = onSnapshot(itemsRef, snapshot => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setItems(data);
        });
        return () => unsub();
    }, [itemsRef]);

    // Load and persist selected items
    useEffect(() => {
        if (!settingsRef) return;
        const unsub = onSnapshot(settingsRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setSelectedItems(new Set(data.selectedIds || []));
            } else {
                setSelectedItems(new Set());
            }
        }, (error) => {
            console.error("Error fetching selected items:", error);
        });
        return () => unsub();
    }, [settingsRef]);

    const updateSelectedInFirestore = useCallback(async (newSet) => {
        if (!settingsRef) return;
        try {
            await setDoc(settingsRef, { selectedIds: Array.from(newSet) }, { merge: true });
        } catch (error) {
            console.error("Failed to save selected items:", error);
        }
    }, [settingsRef]);

    const filteredItems = useMemo(() => {
        if (!searchTerm) return items;
        const lowercasedTerm = searchTerm.toLowerCase();
        return items.filter(item => 
            Object.values(item).some(value => 
                (typeof value === 'string' || typeof value === 'number') && String(value).toLowerCase().includes(lowercasedTerm)
            )
        );
    }, [items, searchTerm]);

    const handleExportJson = async () => {
        setConfirmAction({
            title: `Export ${pageTitle}`,
            message: `This will export all entries from ${pageTitle} to a JSON file. Proceed?`,
            confirmText: 'Export',
            type: 'save',
            action: async () => {
                setIsExporting(true);
                try {
                    const snapshot = await getDocs(itemsRef);
                    const dataToExport = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                    const jsonString = JSON.stringify(dataToExport, null, 2);
                    const blob = new Blob([jsonString], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${collectionPath}_backup_${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (error) {
                    console.error("Export failed:", error);
                    alert("An error occurred during export.");
                } finally {
                    setIsExporting(false);
                }
            }
        });
    };

    const handleImportJsonChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                if (!Array.isArray(importedData)) throw new Error("Invalid JSON format. Expected an array of items.");

                setConfirmAction({
                    title: `DANGER: Import ${pageTitle}`,
                    message: `This will DELETE ALL current entries in ${pageTitle} and replace them with data from the file. This action cannot be undone. Are you sure?`,
                    confirmText: 'Yes, Delete & Import',
                    type: 'delete',
                    action: async () => {
                        setIsImporting(true);
                        try {
                            const existingDocsSnapshot = await getDocs(itemsRef);
                            const batch = writeBatch(db);
                            existingDocsSnapshot.forEach(doc => batch.delete(doc.ref));

                            importedData.forEach(item => {
                                const { id, ...data } = item;
                                const restoredData = restoreTimestamps(data);
                                const docRef = doc(db, `artifacts/${appId}/users/${userId}/${collectionPath}`, id);
                                batch.set(docRef, restoredData);
                            });
                            await batch.commit();
                            alert('Import successful!');
                        } catch (err) {
                            console.error("Import process failed:", err);
                            alert(`Import failed: ${err.message}`);
                        } finally {
                            setIsImporting(false);
                        }
                    }
                });

            } catch (err) {
                 alert(`Error reading file: ${err.message}`);
            }
            if (importFileInputRef.current) importFileInputRef.current.value = "";
        };
        reader.readAsText(file);
    };

    const triggerImport = () => {
        importFileInputRef.current?.click();
    };

    const handleSave = async (itemData) => {
        if (editingItem) {
            await updateDoc(doc(itemsRef, editingItem.id), itemData);
        } else {
            await addDoc(itemsRef, itemData);
        }
    };
    
    const onSaveRequest = (itemData) => {
        handleSave(itemData);
        setShowModal(false);
        setEditingItem(null);
    };

    const onDeleteRequest = (item) => {
        setConfirmAction({
            title: `Confirm Delete`,
            message: `Are you sure you want to delete this entry?`,
            confirmText: 'Delete', type: 'delete',
            action: () => deleteDoc(doc(itemsRef, item.id))
        });
    };

    const handleEdit = (item) => {
        setEditingItem(item);
        setShowModal(true);
    };

    const handleToggleSelect = useCallback((itemId) => {
        setSelectedItems(prev => {
            const newSet = new Set(prev);
            if (newSet.has(itemId)) {
                newSet.delete(itemId);
            } else {
                newSet.add(itemId);
            }
            updateSelectedInFirestore(newSet);
            return newSet;
        });
    }, [updateSelectedInFirestore]);

    const handleToggleSelectAll = () => {
        const allIds = filteredItems.map(item => item.id);
        const allAreSelected = allIds.length > 0 && allIds.every(id => selectedItems.has(id));

        setSelectedItems(prev => {
            const newSet = new Set(prev);
            if (allAreSelected) {
                allIds.forEach(id => newSet.delete(id));
            } else {
                allIds.forEach(id => newSet.add(id));
            }
            updateSelectedInFirestore(newSet);
            return newSet;
        });
    };

    const handleDeleteSelected = () => {
        if (selectedItems.size === 0) return;
        
        setConfirmAction({
            title: 'Confirm Bulk Delete',
            message: `Are you sure you want to delete ${selectedItems.size} selected item(s)? This action cannot be undone.`,
            confirmText: 'Delete All',
            type: 'delete',
            action: async () => {
                const batch = writeBatch(db);
                selectedItems.forEach(itemId => {
                    batch.delete(doc(itemsRef, itemId));
                });
                await batch.commit();
                const newSet = new Set();
                setSelectedItems(newSet);
                updateSelectedInFirestore(newSet);
            }
        });
    };
    
    return (
        <div className="p-4 sm:p-8">
            <section className="dark:bg-gray-800 bg-white p-4 sm:p-6 rounded-lg border-l-4 border-cyan-500">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4">
                    <h2 className="py-2 px-4 text-sm font-semibold border-b-2 border-cyan-400 text-cyan-400">{pageTitle}</h2>
                    <div className="flex items-center space-x-2">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md pl-8 border dark:border-gray-600 border-gray-300"
                            />
                            <Search size={18} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                        </div>
                        {selectedItems.size > 0 && (
                            <button onClick={handleDeleteSelected} className="flex items-center space-x-2 px-3 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors text-sm font-medium">
                                <Trash2 size={16}/>
                                <span>Delete ({selectedItems.size})</span>
                            </button>
                        )}
                        <button onClick={() => { setEditingItem(null); setShowModal(true); }} className="flex items-center space-x-1 px-3 py-1.5 bg-cyan-500 rounded-md hover:bg-cyan-600 transition-colors text-sm" title={`Add New ${itemTitle}`}>
                            <PlusCircle size={16}/>
                            <span>Add {itemTitle}</span>
                        </button>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-base font-medium border-separate" style={{borderSpacing: '0 4px'}}>
                        <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase">
                            <tr>
                                <th className="p-0 font-semibold w-12">
                                    <div className="dark:bg-slate-900 bg-white px-3 py-2 rounded-md border dark:border-slate-700/50 flex justify-center items-center">
                                        <input
                                            type="checkbox"
                                            onChange={handleToggleSelectAll}
                                            checked={filteredItems.length > 0 && filteredItems.every(item => selectedItems.has(item.id))}
                                            className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                            title={filteredItems.length > 0 && filteredItems.every(item => selectedItems.has(item.id)) ? "Deselect All" : "Select All"}
                                        />
                                    </div>
                                </th>
                                <th className="p-0 font-semibold text-left"><div className="dark:bg-slate-900 bg-white px-3 py-2 rounded-md border dark:border-slate-700/50">S.No</div></th>
                                {columns.map(col => <th key={col.header} className="p-0 font-semibold text-left"><div className="dark:bg-slate-900 bg-white px-3 py-2 rounded-md border dark:border-slate-700/50">{col.header}</div></th>)}
                                <th className="p-0 font-semibold text-right"><div className="dark:bg-slate-900 bg-white px-3 py-2 rounded-md border dark:border-slate-700/50">Actions</div></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredItems.map((item, index) => {
                                const isSelected = selectedItems.has(item.id);
                                const cellClassName = `p-2 ${isSelected ? 'dark:bg-green-800/40 bg-green-100' : 'dark:bg-gray-800/50 bg-white'}`;
                                return (
                                    <tr key={item.id} className="group/row">
                                        <td className={`${cellClassName} rounded-l-md text-center`}>
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => handleToggleSelect(item.id)}
                                                className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                            />
                                        </td>
                                        <td className={cellClassName}>{index + 1}</td>
                                        {columns.map(col => (
                                            <td key={col.accessor} className={cellClassName}>
                                                {col.render ? col.render(item) : item[col.accessor]}
                                            </td>
                                        ))}
                                        <td className={`${cellClassName} rounded-r-md`}>
                                            <div className="opacity-0 group-hover/row:opacity-100 flex items-center justify-end space-x-1">
                                                <button onClick={() => handleEdit(item)} className="p-1.5 hover:text-cyan-400"><Edit size={16}/></button>
                                                <button onClick={() => onDeleteRequest(item)} className="p-1.5 hover:text-red-400"><Trash2 size={16}/></button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                     {filteredItems.length === 0 && <div className="text-center py-8 text-gray-500">No entries yet.</div>}
                </div>
            </section>
            <GenericAddEditModal isOpen={showModal} onSave={onSaveRequest} onClose={() => setShowModal(false)} initialData={editingItem} formFields={formFields} title={itemTitle} />
        </div>
    );
};

// --- Vehicles Page Component ---
const vehicleFormFields = [
    {name: 'vehicleNo', label: 'Vehicle No'}, {name: 'make', label: 'Make'},
    {name: 'model', label: 'Model'}, {name: 'owner', label: 'Owner'}, {name: 'expiry', label: 'Expiry', type: 'date'},
    {name: 'status', label: 'Status', type: 'select', options: ['Active', 'Expired', 'Sold']},
    {name: 'contact1', label: 'Contact 1'}, {name: 'note', label: 'Note', type: 'textarea', colSpan: 2},
];

const VehiclesPage = ({ userId, appId, pageTitle, collectionPath, setConfirmAction }) => {
    const [vehicles, setVehicles] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [editingVehicle, setEditingVehicle] = useState(null);
    const [activeVehicleView, setActiveVehicleView] = useState('active');
    const [tickedVehicles, setTickedVehicles] = useState(new Set());
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const importFileInputRef = useRef(null);
    const [searchTerm, setSearchTerm] = useState('');
    const vehiclesRef = useMemo(() => collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`), [userId, appId, collectionPath]);
    const settingsRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/pageSettings`, collectionPath), [userId, appId, collectionPath]);

    useEffect(() => {
        const unsub = onSnapshot(vehiclesRef, snapshot => {
            setVehicles(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        return () => unsub();
    }, [vehiclesRef]);

    // Load and persist selected vehicles
    useEffect(() => {
        if (!settingsRef) return;
        const unsub = onSnapshot(settingsRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setTickedVehicles(new Set(data.selectedIds || []));
            } else {
                setTickedVehicles(new Set());
            }
        }, (error) => {
            console.error("Error fetching selected vehicles:", error);
        });
        return () => unsub();
    }, [settingsRef]);

    const updateTickedInFirestore = useCallback(async (newSet) => {
        if (!settingsRef) return;
        try {
            await setDoc(settingsRef, { selectedIds: Array.from(newSet) }, { merge: true });
        } catch (error) {
            console.error("Failed to save selected vehicles:", error);
        }
    }, [settingsRef]);

    const handleToggleTick = useCallback((vehicleId) => {
        setTickedVehicles(prev => {
            const newSet = new Set(prev);
            if (newSet.has(vehicleId)) {
                newSet.delete(vehicleId);
            } else {
                newSet.add(vehicleId);
            }
            updateTickedInFirestore(newSet);
            return newSet;
        });
    }, [updateTickedInFirestore]);

    const handleToggleAllTicks = (vehicleList) => {
        const allIds = vehicleList.map(v => v.id);
        const allAreTicked = allIds.length > 0 && allIds.every(id => tickedVehicles.has(id));

        setTickedVehicles(prev => {
            const newSet = new Set(prev);
            if (allAreTicked) {
                allIds.forEach(id => newSet.delete(id));
            } else {
                allIds.forEach(id => newSet.add(id));
            }
            updateTickedInFirestore(newSet);
            return newSet;
        });
    };

    const handleClearTicks = () => {
        const newSet = new Set();
        setTickedVehicles(newSet);
        updateTickedInFirestore(newSet);
    };

    const handleDeleteSelected = () => {
        if (tickedVehicles.size === 0) return;
        
        setConfirmAction({
            title: 'Confirm Bulk Delete',
            message: `Are you sure you want to delete ${tickedVehicles.size} selected vehicle(s)? This action cannot be undone.`,
            confirmText: 'Delete All',
            type: 'delete',
            action: async () => {
                const batch = writeBatch(db);
                tickedVehicles.forEach(vehicleId => {
                    batch.delete(doc(vehiclesRef, vehicleId));
                });
                await batch.commit();
                const newSet = new Set();
                setTickedVehicles(newSet);
                updateTickedInFirestore(newSet);
            }
        });
    };

    const handleExportJson = async () => {
        setConfirmAction({
            title: 'Export Vehicle Data',
            message: 'This will export all active and sold vehicles to a JSON file. Proceed?',
            confirmText: 'Export',
            type: 'save',
            action: async () => {
                setIsExporting(true);
                try {
                    const snapshot = await getDocs(vehiclesRef);
                    const dataToExport = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                    const jsonString = JSON.stringify(dataToExport, null, 2);
                    const blob = new Blob([jsonString], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${collectionPath}_backup_${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (error) {
                    console.error("Export failed:", error);
                    alert("An error occurred during export.");
                } finally {
                    setIsExporting(false);
                }
            }
        });
    };

    const handleImportJsonChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                if (!Array.isArray(importedData)) throw new Error("Invalid JSON format. Expected an array of vehicles.");

                setConfirmAction({
                    title: 'DANGER: Import Vehicle Data',
                    message: 'This will DELETE ALL current vehicle entries (active and sold) and replace them with data from the file. This action cannot be undone. Are you sure?',
                    confirmText: 'Yes, Delete & Import',
                    type: 'delete',
                    action: async () => {
                        setIsImporting(true);
                        try {
                            const existingDocsSnapshot = await getDocs(vehiclesRef);
                            const batch = writeBatch(db);
                            existingDocsSnapshot.forEach(doc => batch.delete(doc.ref));

                            importedData.forEach(item => {
                                const { id, ...data } = item;
                                const restoredData = restoreTimestamps(data);
                                const docRef = doc(db, `artifacts/${appId}/users/${userId}/${collectionPath}`, id);
                                batch.set(docRef, restoredData);
                            });
                            await batch.commit();
                            alert('Import successful!');
                        } catch (err) {
                            console.error("Import process failed:", err);
                            alert(`Import failed: ${err.message}`);
                        } finally {
                            setIsImporting(false);
                        }
                    }
                });

            } catch (err) {
                 alert(`Error reading file: ${err.message}`);
            }
            if(importFileInputRef.current) importFileInputRef.current.value = "";
        };
        reader.readAsText(file);
    };

    const triggerImport = () => {
        importFileInputRef.current?.click();
    };

    const handleSave = async (data) => {
        // The data is already processed by GenericAddEditModal, including date parsing.
        if (editingVehicle) {
            await updateDoc(doc(vehiclesRef, editingVehicle.id), data);
        } else {
            await addDoc(vehiclesRef, data);
        }
        setShowModal(false);
        setEditingVehicle(null);
    };
    
    const onDeleteRequest = (vehicle) => {
        setConfirmAction({
            title: 'Confirm Delete',
            message: `Delete vehicle ${vehicle.vehicleNo}?`,
            confirmText: 'Delete', type: 'delete',
            action: () => deleteDoc(doc(vehiclesRef, vehicle.id))
        });
    };

    const { activeVehicles, soldVehicles } = useMemo(() => {
        let filteredVehicles = vehicles;
        if (searchTerm) {
            const lowercasedTerm = searchTerm.toLowerCase();
            filteredVehicles = vehicles.filter(v => 
                Object.values(v).some(value => 
                    (typeof value === 'string' || typeof value === 'number') && String(value).toLowerCase().includes(lowercasedTerm)
                )
            );
        }

        const { active, sold } = filteredVehicles.reduce((acc, v) => {
            if (v.status === 'Sold') {
                acc.sold.push(v);
            } else {
                acc.active.push(v);
            }
            return acc;
        }, { active: [], sold: [] });

        // Sort active vehicles by expiry date (soonest first)
        active.sort((a, b) => {
            const dateA = a.expiry?.toDate ? a.expiry.toDate().getTime() : 0;
            const dateB = b.expiry?.toDate ? b.expiry.toDate().getTime() : 0;

            // Handle cases where expiry might be missing
            if (dateA === 0 && dateB === 0) return 0; // both missing, no change
            if (dateA === 0) return 1;  // 'a' is missing, put it at the end
            if (dateB === 0) return -1; // 'b' is missing, put it at the end (so it comes before 'a')

            return dateA - dateB; // ascending order (soonest first)
        });

        return { activeVehicles: active, soldVehicles: sold };
    }, [vehicles, searchTerm]);
    
    const VehicleTable = ({ vehicleList, tickedVehicles, onToggleTick, onToggleAllTicks }) => (
        <div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm border-separate" style={{borderSpacing: '0 4px'}}>
                    <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase">
                        <tr>
                            <th className="p-0 font-semibold w-12">
                                <div className="dark:bg-slate-900 bg-white px-3 py-2 rounded-md border dark:border-slate-700/50 flex justify-center items-center">
                                    <input
                                        type="checkbox"
                                        onChange={() => onToggleAllTicks(vehicleList)}
                                        checked={vehicleList.length > 0 && vehicleList.every(v => tickedVehicles.has(v.id))}
                                        className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                        title={vehicleList.length > 0 && vehicleList.every(v => tickedVehicles.has(v.id)) ? "Deselect All" : "Select All"}
                                    />
                                </div>
                            </th>
                            {['S.No', 'Vehicle No', 'Make', 'Model', 'Owner', 'Expiry', 'Status', 'Contact 1', 'Note', 'Actions'].map(h => (
                                <th key={h} className={`p-0 font-semibold text-left ${h === 'Actions' ? 'text-right' : ''}`}><div className="dark:bg-slate-900 bg-white px-3 py-2 rounded-md border dark:border-slate-700/50">{h}</div></th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {vehicleList.map((v, i) => {
                            const expired = isDateExpired(v.expiry);
                            const statusColor = v.status === 'Active' ? 'text-green-400' : 'text-yellow-400';
                            const isTicked = tickedVehicles.has(v.id);
                            const cellClassName = `p-2 align-middle ${isTicked ? 'dark:bg-green-800/40 bg-green-100' : 'dark:bg-gray-800/50 bg-white'}`;

                            return (
                                <tr key={v.id} className="group/row">
                                    <td className={`${cellClassName} rounded-l-md text-center`}>
                                        <input
                                            type="checkbox"
                                            checked={isTicked}
                                            onChange={() => onToggleTick(v.id)}
                                            className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                        />
                                    </td>
                                    <td className={cellClassName}>{i+1}</td>
                                    <td className={`${cellClassName} font-semibold`}>{v.vehicleNo}</td>
                                    <td className={cellClassName}>{v.make}</td>
                                    <td className={cellClassName}>{v.model}</td>
                                    <td className={cellClassName}>{v.owner}</td>
                                    <td className={`${cellClassName} ${expired ? 'text-red-400 font-bold' : ''}`}>{formatDate(v.expiry)}</td>
                                    <td className={`${cellClassName} font-semibold ${statusColor}`}>{v.status}</td>
                                    <td className={cellClassName}>{v.contact1}</td>
                                    <td className={`${cellClassName} truncate max-w-xs`}>{v.note}</td>
                                    <td className={`${cellClassName} rounded-r-md`}>
                                        <div className="opacity-0 group-hover/row:opacity-100 flex items-center justify-end space-x-1">
                                            <button onClick={() => { setEditingVehicle(v); setShowModal(true); }} className="p-1.5 hover:text-cyan-400"><Edit size={14}/></button>
                                            <button onClick={() => onDeleteRequest(v)} className="p-1.5 hover:text-red-400"><Trash2 size={14}/></button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                 {vehicleList.length === 0 && <div className="text-center py-8 text-gray-500">No vehicles in this section.</div>}
            </div>
        </div>
    );

    return (
        <div className="p-4 sm:p-8">
            <section className="dark:bg-gray-800 bg-white p-4 sm:p-6 rounded-lg border-l-4 border-sky-500">
                <div className="flex flex-wrap gap-4 justify-between items-center mb-6 no-print sticky top-[122px] z-30 dark:bg-gray-800 bg-white -mx-4 sm:-mx-6 px-4 sm:px-6 py-4 border-b-2 dark:border-gray-700">
                    <nav className="flex items-center space-x-4">
                        <button 
                            onClick={() => setActiveVehicleView('active')}
                            className={`py-2 px-4 text-sm font-semibold transition-colors ${activeVehicleView === 'active' ? 'border-b-2 border-cyan-400 text-cyan-400' : 'text-gray-400 hover:text-white'}`}
                        >
                            Active Vehicles ({activeVehicles.length})
                        </button>
                        <button 
                            onClick={() => setActiveVehicleView('sold')}
                            className={`py-2 px-4 text-sm font-semibold transition-colors ${activeVehicleView === 'sold' ? 'border-b-2 border-cyan-400 text-cyan-400' : 'text-gray-400 hover:text-white'}`}
                        >
                            Sold Vehicles ({soldVehicles.length})
                        </button>
                    </nav>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md pl-8 border dark:border-gray-600 border-gray-300"
                            />
                            <Search size={18} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                        </div>
                        {tickedVehicles.size > 0 && (
                            <>
                                <button onClick={handleDeleteSelected} className="flex items-center space-x-2 px-3 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors text-sm font-medium">
                                    <Trash2 size={16}/>
                                    <span>Delete ({tickedVehicles.size})</span>
                                </button>
                                <button onClick={handleClearTicks} className="flex items-center space-x-2 p-2.5 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors text-sm">
                                    <X size={16}/>
                                    <span>Clear ({tickedVehicles.size})</span>
                                </button>
                            </>
                        )}
                         <button onClick={() => { setEditingVehicle(null); setShowModal(true); }} className="flex items-center space-x-1 px-3 py-1.5 bg-cyan-500 rounded-md hover:bg-cyan-600 transition-colors text-sm" title="Add Vehicle">
                            <PlusCircle size={16}/>
                            <span>Add Vehicle</span>
                        </button>
                    </div>
                </div>

                {activeVehicleView === 'active' && <VehicleTable vehicleList={activeVehicles} tickedVehicles={tickedVehicles} onToggleTick={handleToggleTick} onToggleAllTicks={() => handleToggleAllTicks(activeVehicles)} />}
                {activeVehicleView === 'sold' && <VehicleTable vehicleList={soldVehicles} tickedVehicles={tickedVehicles} onToggleTick={handleToggleTick} onToggleAllTicks={() => handleToggleAllTicks(soldVehicles)} />}
            </section>
            
            <GenericAddEditModal isOpen={showModal} onSave={handleSave} onClose={() => setShowModal(false)} initialData={editingVehicle} formFields={vehicleFormFields} title="Vehicle"/>
        </div>
    );
};

const DocumentStatusBadge = ({ date }) => {
    const getStatus = (dateInput) => {
        if (!dateInput) return { text: 'N/A', color: 'gray' };
        const date = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
        if (isNaN(date.getTime())) return { text: 'Invalid', color: 'gray' };

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(today.getDate() + 30);
        thirtyDaysFromNow.setHours(0, 0, 0, 0);

        if (date < today) {
            return { text: 'Expired', color: 'red' };
        } else if (date <= thirtyDaysFromNow) {
            return { text: 'Near Expiry', color: 'yellow' };
        } else {
            return { text: 'Active', color: 'green' };
        }
    };

    const status = getStatus(date);
    const colorClasses = {
        red: 'bg-red-500/20 text-red-400',
        yellow: 'bg-yellow-500/20 text-yellow-400',
        green: 'bg-green-500/20 text-green-400',
        gray: 'bg-gray-500/20 text-gray-400',
    };

    return (
        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${colorClasses[status.color]}`}>
            {status.text}
        </span>
    );
};

const ChequeStatusBadge = ({ date, status }) => {
    const getStatus = (dateInput, status) => {
        if (status !== 'Pending') {
            const colors = {
                'Cashed': { text: 'Cashed', color: 'blue' },
                'Cancelled': { text: 'Cancelled', color: 'gray' },
                'Bounced': { text: 'Bounced', color: 'red' },
            };
            return colors[status] || { text: status, color: 'gray' };
        }

        // Handle 'Pending' status
        if (!dateInput) return { text: 'Pending', color: 'gray' };
        const date = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
        if (isNaN(date.getTime())) return { text: 'Pending', color: 'gray' };

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const chequeDay = new Date(date.getTime());
        chequeDay.setHours(0, 0, 0, 0);


        if (chequeDay < today) {
            return { text: 'Stale', color: 'red' };
        } else if (chequeDay.getTime() === today.getTime()) {
            return { text: 'Ready', color: 'green' };
        } else {
            return { text: 'Post-Dated', color: 'yellow' };
        }
    };

    const statusInfo = getStatus(date, status);
    const colorClasses = {
        red: 'bg-red-500/20 text-red-400',
        yellow: 'bg-yellow-500/20 text-yellow-400',
        green: 'bg-green-500/20 text-green-400',
        gray: 'bg-gray-500/20 text-gray-400',
        blue: 'bg-blue-500/20 text-blue-400',
    };

    return (
        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${colorClasses[statusInfo.color]}`}>
            {statusInfo.text}
        </span>
    );
};


const DocsAndCredsPage = ({ userId, appId, pageTitle, collectionPrefix, setConfirmAction }) => {
    // State and logic for Documents
    const [documents, setDocuments] = useState([]);
    const [showDocModal, setShowDocModal] = useState(false);
    const [editingDoc, setEditingDoc] = useState(null);
    const documentsRef = useMemo(() => collection(db, `artifacts/${appId}/users/${userId}/${collectionPrefix}Documents`), [userId, appId, collectionPrefix]);

    // State and logic for Reminders
    const [reminders, setReminders] = useState([]);
    const [showReminderModal, setShowReminderModal] = useState(false);
    const [editingReminder, setEditingReminder] = useState(null);
    const remindersRef = useMemo(() => collection(db, `artifacts/${appId}/users/${userId}/${collectionPrefix}Reminders`), [userId, appId, collectionPrefix]);

    const [activeView, setActiveView] = useState('documents');
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [selectedDocuments, setSelectedDocuments] = useState(new Set());
    const [selectedCredentials, setSelectedCredentials] = useState(new Set());
    const [selectedReminders, setSelectedReminders] = useState(new Set());
    const importFileInputRef = useRef(null);
    const [searchTerm, setSearchTerm] = useState('');
    
    // Settings refs for persisting selections
    const documentsSettingsRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/pageSettings`, `${collectionPrefix}Documents`), [userId, appId, collectionPrefix]);
    const credentialsSettingsRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/pageSettings`, `${collectionPrefix}Credentials`), [userId, appId, collectionPrefix]);
    const remindersSettingsRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/pageSettings`, `${collectionPrefix}Reminders`), [userId, appId, collectionPrefix]);

    useEffect(() => {
        const unsub = onSnapshot(remindersRef, snapshot => {
            setReminders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        return () => unsub();
    }, [remindersRef]);

    useEffect(() => {
        const unsub = onSnapshot(documentsRef, snapshot => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Sort by expiryDate, soonest first, but prioritize non-expired
            data.sort((a, b) => {
                const dateA = a.expiryDate?.toDate ? a.expiryDate.toDate() : null;
                const dateB = b.expiryDate?.toDate ? b.expiryDate.toDate() : null;
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const isAExpired = dateA ? dateA < today : false;
                const isBExpired = dateB ? dateB < today : false;
                
                // 1. Handle "No Date" - always last
                if (!dateA && !dateB) return 0; // Both no date
                if (!dateA) return 1;          // A has no date, send to end
                if (!dateB) return -1;         // B has no date, send to end

                // 2. Both are not expired
                if (!isAExpired && !isBExpired) {
                    return dateA.getTime() - dateB.getTime(); // Sort by soonest date first (ascending)
                }

                // 3. Both are expired
                if (isAExpired && isBExpired) {
                    return dateA.getTime() - dateB.getTime(); // Sort by most expired first (ascending)
                }

                // 4. One is expired, one is not
                if (isAExpired && !isBExpired) {
                    return 1; // A is expired, send after B (not expired)
                }

                if (!isAExpired && isBExpired) {
                    return -1; // A is not expired, B is. A comes first.
                }

                return 0; // Should be unreachable
            });

            setDocuments(data);
        });
        return () => unsub();
    }, [documentsRef]);

    const handleExportJson = async () => {
        setConfirmAction({
            title: 'Export Docs & Credentials Data',
            message: 'This will export all Documents, Credentials, and Reminders for this company to a single JSON file. Proceed?',
            confirmText: 'Export',
            type: 'save',
            action: async () => {
                setIsExporting(true);
                try {
                    const dataToExport = {};
                    const collectionsToExport = {
                        documents: documentsRef,
                        credentials: credentialsRef,
                        reminders: remindersRef,
                    };

                    for (const [key, collRef] of Object.entries(collectionsToExport)) {
                        const snapshot = await getDocs(collRef);
                        dataToExport[key] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    }

                    const jsonString = JSON.stringify(dataToExport, null, 2);
                    const blob = new Blob([jsonString], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${collectionPrefix}_docs_creds_backup_${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (error) {
                    console.error("Export failed:", error);
                    alert("An error occurred during export.");
                } finally {
                    setIsExporting(false);
                }
            }
        });
    };

    const handleImportJsonChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                
                setConfirmAction({
                    title: 'DANGER: Import Docs & Credentials Data',
                    message: 'This will DELETE ALL current Documents, Credentials, and Reminders and replace them with data from the file. This action cannot be undone. Are you sure?',
                    confirmText: 'Yes, Delete & Import',
                    type: 'delete',
                    action: async () => {
                        setIsImporting(true);
                        try {
                            const collectionsInFile = {
                                documents: documentsRef,
                                credentials: credentialsRef,
                                reminders: remindersRef,
                            };

                            for (const [key, collRef] of Object.entries(collectionsInFile)) {
                                 const existingDocsSnapshot = await getDocs(collRef);
                                 if (!existingDocsSnapshot.empty) {
                                    const batch = writeBatch(db);
                                    existingDocsSnapshot.forEach(doc => batch.delete(doc.ref));
                                    await batch.commit();
                                 }
                            }

                            for (const [key, collRef] of Object.entries(collectionsInFile)) {
                                const itemsToImport = importedData[key];
                                if (Array.isArray(itemsToImport) && itemsToImport.length > 0) {
                                    const batch = writeBatch(db);
                                    itemsToImport.forEach(item => {
                                        const { id, ...data } = item;
                                        const restoredData = restoreTimestamps(data);
                                        const docRef = doc(db, collRef.path, id);
                                        batch.set(docRef, restoredData);
                                    });
                                    await batch.commit();
                                }
                            }
                            alert('Import successful! The data has been restored.');
                        } catch (err) {
                            console.error("Import process failed:", err);
                            alert(`Import failed: ${err.message}`);
                        } finally {
                            setIsImporting(false);
                        }
                    }
                });

            } catch (err) {
                 alert(`Error reading file: ${err.message}`);
            }
            if(importFileInputRef.current) importFileInputRef.current.value = "";
        };
        reader.readAsText(file);
    };

    const triggerImport = () => {
        importFileInputRef.current?.click();
    };

    const handleDocSave = async (data, uploadCallback) => {
        if (editingDoc) {
            await updateDoc(doc(documentsRef, editingDoc.id), data);
        } else {
            const docRef = await addDoc(documentsRef, data);
            if (uploadCallback) {
                await uploadCallback(docRef.id);
            }
        }
        setShowDocModal(false);
        setEditingDoc(null);
    };

    const onDocDeleteRequest = (docItem) => {
        setConfirmAction({
            title: 'Confirm Delete Document',
            message: `Delete document ${docItem.documentName}?`,
            confirmText: 'Delete', type: 'delete',
            action: () => deleteDoc(doc(documentsRef, docItem.id))
        });
    };

    const documentFormFields = [
        { name: 'documentName', label: 'Document Name', transform: 'capitalize' },
        { name: 'type', label: 'Type', transform: 'capitalize' },
        { name: 'number', label: 'Number' },
        { name: 'registrationDate', label: 'Registration Date', type: 'date' },
        { name: 'expiryDate', label: 'Expiry Date', type: 'date' },
        { name: 'notes', label: 'Notes', type: 'textarea', colSpan: 3 },
    ];

    // State and logic for Credentials
    const [credentials, setCredentials] = useState([]);
    const [showCredModal, setShowCredModal] = useState(false);
    const [editingCred, setEditingCred] = useState(null);
    const credentialsRef = useMemo(() => collection(db, `artifacts/${appId}/users/${userId}/${collectionPrefix}Credentials`), [userId, appId, collectionPrefix]);
    
    useEffect(() => {
        const unsub = onSnapshot(credentialsRef, snapshot => {
            setCredentials(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        return () => unsub();
    }, [credentialsRef]);

    // Load and persist selected documents
    useEffect(() => {
        if (!documentsSettingsRef) return;
        const unsub = onSnapshot(documentsSettingsRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setSelectedDocuments(new Set(data.selectedIds || []));
            } else {
                setSelectedDocuments(new Set());
            }
        });
        return () => unsub();
    }, [documentsSettingsRef]);

    // Load and persist selected credentials
    useEffect(() => {
        if (!credentialsSettingsRef) return;
        const unsub = onSnapshot(credentialsSettingsRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setSelectedCredentials(new Set(data.selectedIds || []));
            } else {
                setSelectedCredentials(new Set());
            }
        });
        return () => unsub();
    }, [credentialsSettingsRef]);

    // Load and persist selected reminders
    useEffect(() => {
        if (!remindersSettingsRef) return;
        const unsub = onSnapshot(remindersSettingsRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setSelectedReminders(new Set(data.selectedIds || []));
            } else {
                setSelectedReminders(new Set());
            }
        });
        return () => unsub();
    }, [remindersSettingsRef]);

    const updateSelectedInFirestore = useCallback(async (settingsRef, newSet) => {
        if (!settingsRef) return;
        try {
            await setDoc(settingsRef, { selectedIds: Array.from(newSet) }, { merge: true });
        } catch (error) {
            console.error("Failed to save selected items:", error);
        }
    }, []);

    const filteredDocuments = useMemo(() => {
        if (!searchTerm) return documents;
        const lowercasedTerm = searchTerm.toLowerCase();
        return documents.filter(doc => 
            Object.values(doc).some(value => 
                (typeof value === 'string' || typeof value === 'number') && String(value).toLowerCase().includes(lowercasedTerm)
            )
        );
    }, [documents, searchTerm]);

    const filteredCredentials = useMemo(() => {
        if (!searchTerm) return credentials;
        const lowercasedTerm = searchTerm.toLowerCase();
        return credentials.filter(cred => 
            Object.values(cred).some(value => 
                (typeof value === 'string' || typeof value === 'number') && String(value).toLowerCase().includes(lowercasedTerm)
            )
        );
    }, [credentials, searchTerm]);

    const filteredReminders = useMemo(() => {
        if (!searchTerm) return reminders;
        const lowercasedTerm = searchTerm.toLowerCase();
        return reminders.filter(rem => 
            Object.values(rem).some(value => 
                (typeof value === 'string' || typeof value === 'number') && String(value).toLowerCase().includes(lowercasedTerm)
            )
        );
    }, [reminders, searchTerm]);

    const handleCredSave = async (data, uploadCallback) => {
        if (editingCred) {
            await updateDoc(doc(credentialsRef, editingCred.id), data);
        } else {
            const docRef = await addDoc(credentialsRef, data);
            if (uploadCallback) {
                await uploadCallback(docRef.id);
            }
        }
        setShowCredModal(false);
        setEditingCred(null);
    };
    
    const onCredDeleteRequest = (credItem) => {
        setConfirmAction({
            title: 'Confirm Delete Credential',
            message: `Delete credential for ${credItem.description}?`,
            confirmText: 'Delete', type: 'delete',
            action: () => deleteDoc(doc(credentialsRef, credItem.id))
        });
    };

     const credentialsConfig = {
        itemTitle: 'Credential',
        columns: [ 
            { header: 'Description', accessor: 'description' }, 
            { header: 'Sub-Description', accessor: 'subDescription' }, 
            { header: 'Email', accessor: 'email' }, 
            { header: 'Username', accessor: 'username' }, 
            { header: 'Expiry', accessor: 'expiry', render: (item) => formatDate(item.expiry) }, 
            { header: 'Status', accessor: 'status', render: (item) => <DocumentStatusBadge date={item.expiry} /> },
            { header: 'File', accessor: 'fileUrl', render: (item) => item.fileUrl ? (
                <a href={item.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center space-x-1 px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs hover:bg-green-500/30 transition-colors" title="View file">
                    <FileText size={12} />
                    <span>PDF</span>
                </a>
            ) : <span className="text-xs dark:text-gray-500 text-gray-400">-</span> }
        ],
        formFields: [ { name: 'description', label: 'Description', transform: 'capitalize' }, { name: 'subDescription', label: 'Sub-Description', transform: 'capitalize' }, { name: 'email', label: 'Email' }, { name: 'number', label: 'Number' }, { name: 'contact', label: 'Contact' }, { name: 'username', label: 'Username' }, { name: 'passcode', label: 'Passcode' }, { name: 'pin', label: 'PIN' }, { name: 'expiry', label: 'Expiry', type: 'date' }, { name: 'others', label: 'Others', type: 'textarea' }, ]
    };


    const handleReminderSave = async (data) => {
        if (editingReminder) {
            await updateDoc(doc(remindersRef, editingReminder.id), data);
        } else {
            await addDoc(remindersRef, { ...data, status: 'Pending' });
        }
        setShowReminderModal(false);
        setEditingReminder(null);
    };

    const onReminderDeleteRequest = (reminderItem) => {
        setConfirmAction({
            title: 'Confirm Delete Reminder',
            message: `Delete reminder "${reminderItem.title}"?`,
            confirmText: 'Delete', type: 'delete',
            action: () => deleteDoc(doc(remindersRef, reminderItem.id))
        });
    };

    const handleToggleReminderStatus = async (reminder) => {
        const newStatus = reminder.status === 'Pending' ? 'Completed' : 'Pending';
        await updateDoc(doc(remindersRef, reminder.id), { status: newStatus });
    };

    const reminderFormFields = [ { name: 'title', label: 'Reminder Title', transform: 'capitalize' }, { name: 'dueDate', label: 'Due Date', type: 'date' }, { name: 'reminderDate', label: 'Reminder Date', type: 'date' }, { name: 'notes', label: 'Notes', type: 'textarea', colSpan: 3 }, ];

    // Select/Delete functions for Documents
    const handleToggleSelectDocument = useCallback((docId) => {
        setSelectedDocuments(prev => {
            const newSet = new Set(prev);
            if (newSet.has(docId)) {
                newSet.delete(docId);
            } else {
                newSet.add(docId);
            }
            updateSelectedInFirestore(documentsSettingsRef, newSet);
            return newSet;
        });
    }, [updateSelectedInFirestore, documentsSettingsRef]);

    const handleToggleSelectAllDocuments = () => {
        const allIds = filteredDocuments.map(doc => doc.id);
        const allAreSelected = allIds.length > 0 && allIds.every(id => selectedDocuments.has(id));
        setSelectedDocuments(prev => {
            const newSet = new Set(prev);
            if (allAreSelected) {
                allIds.forEach(id => newSet.delete(id));
            } else {
                allIds.forEach(id => newSet.add(id));
            }
            updateSelectedInFirestore(documentsSettingsRef, newSet);
            return newSet;
        });
    };

    const handleDeleteSelectedDocuments = () => {
        if (selectedDocuments.size === 0) return;
        setConfirmAction({
            title: 'Confirm Bulk Delete',
            message: `Are you sure you want to delete ${selectedDocuments.size} selected document(s)? This action cannot be undone.`,
            confirmText: 'Delete All',
            type: 'delete',
            action: async () => {
                const batch = writeBatch(db);
                selectedDocuments.forEach(docId => {
                    batch.delete(doc(documentsRef, docId));
                });
                await batch.commit();
                const newSet = new Set();
                setSelectedDocuments(newSet);
                updateSelectedInFirestore(documentsSettingsRef, newSet);
            }
        });
    };

    // Select/Delete functions for Credentials
    const handleToggleSelectCredential = useCallback((credId) => {
        setSelectedCredentials(prev => {
            const newSet = new Set(prev);
            if (newSet.has(credId)) {
                newSet.delete(credId);
            } else {
                newSet.add(credId);
            }
            updateSelectedInFirestore(credentialsSettingsRef, newSet);
            return newSet;
        });
    }, [updateSelectedInFirestore, credentialsSettingsRef]);

    const handleToggleSelectAllCredentials = () => {
        const allIds = filteredCredentials.map(cred => cred.id);
        const allAreSelected = allIds.length > 0 && allIds.every(id => selectedCredentials.has(id));
        setSelectedCredentials(prev => {
            const newSet = new Set(prev);
            if (allAreSelected) {
                allIds.forEach(id => newSet.delete(id));
            } else {
                allIds.forEach(id => newSet.add(id));
            }
            updateSelectedInFirestore(credentialsSettingsRef, newSet);
            return newSet;
        });
    };

    const handleDeleteSelectedCredentials = () => {
        if (selectedCredentials.size === 0) return;
        setConfirmAction({
            title: 'Confirm Bulk Delete',
            message: `Are you sure you want to delete ${selectedCredentials.size} selected credential(s)? This action cannot be undone.`,
            confirmText: 'Delete All',
            type: 'delete',
            action: async () => {
                const batch = writeBatch(db);
                selectedCredentials.forEach(credId => {
                    batch.delete(doc(credentialsRef, credId));
                });
                await batch.commit();
                const newSet = new Set();
                setSelectedCredentials(newSet);
                updateSelectedInFirestore(credentialsSettingsRef, newSet);
            }
        });
    };

    // Select/Delete functions for Reminders
    const handleToggleSelectReminder = useCallback((reminderId) => {
        setSelectedReminders(prev => {
            const newSet = new Set(prev);
            if (newSet.has(reminderId)) {
                newSet.delete(reminderId);
            } else {
                newSet.add(reminderId);
            }
            updateSelectedInFirestore(remindersSettingsRef, newSet);
            return newSet;
        });
    }, [updateSelectedInFirestore, remindersSettingsRef]);

    const handleToggleSelectAllReminders = () => {
        const allIds = filteredReminders.map(rem => rem.id);
        const allAreSelected = allIds.length > 0 && allIds.every(id => selectedReminders.has(id));
        setSelectedReminders(prev => {
            const newSet = new Set(prev);
            if (allAreSelected) {
                allIds.forEach(id => newSet.delete(id));
            } else {
                allIds.forEach(id => newSet.add(id));
            }
            updateSelectedInFirestore(remindersSettingsRef, newSet);
            return newSet;
        });
    };

    const handleDeleteSelectedReminders = () => {
        if (selectedReminders.size === 0) return;
        setConfirmAction({
            title: 'Confirm Bulk Delete',
            message: `Are you sure you want to delete ${selectedReminders.size} selected reminder(s)? This action cannot be undone.`,
            confirmText: 'Delete All',
            type: 'delete',
            action: async () => {
                const batch = writeBatch(db);
                selectedReminders.forEach(reminderId => {
                    batch.delete(doc(remindersRef, reminderId));
                });
                await batch.commit();
                const newSet = new Set();
                setSelectedReminders(newSet);
                updateSelectedInFirestore(remindersSettingsRef, newSet);
            }
        });
    };

    return (
        <div className="p-4 sm:p-8">
            <section className="dark:bg-gray-800 bg-white p-4 sm:p-6 rounded-lg border-l-4 border-amber-500">
                <div className="flex justify-between items-center flex-wrap gap-4 mb-6">
                    <nav className="flex items-center space-x-4">
                        <button 
                            onClick={() => setActiveView('documents')}
                            className={`py-2 px-4 text-sm font-semibold transition-colors ${activeView === 'documents' ? 'border-b-2 border-cyan-400 text-cyan-400' : 'text-gray-400 hover:text-white'}`}
                        >
                            Documents ({filteredDocuments.length})
                        </button>
                        <button 
                            onClick={() => setActiveView('credentials')}
                            className={`py-2 px-4 text-sm font-semibold transition-colors ${activeView === 'credentials' ? 'border-b-2 border-cyan-400 text-cyan-400' : 'text-gray-400 hover:text-white'}`}
                        >
                            Credentials ({filteredCredentials.length})
                        </button>
                        <button 
                            onClick={() => setActiveView('reminders')}
                            className={`py-2 px-4 text-sm font-semibold transition-colors ${activeView === 'reminders' ? 'border-b-2 border-cyan-400 text-cyan-400' : 'text-gray-400 hover:text-white'}`}
                        >
                            Reminders ({filteredReminders.length})
                        </button>
                    </nav>
                    <div className="flex items-center space-x-2">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md pl-8 border dark:border-gray-600 border-gray-300"
                            />
                            <Search size={18} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                        </div>
                        {activeView === 'documents' && selectedDocuments.size > 0 && (
                            <button onClick={handleDeleteSelectedDocuments} className="flex items-center space-x-2 px-3 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors text-sm font-medium">
                                <Trash2 size={16}/>
                                <span>Delete ({selectedDocuments.size})</span>
                            </button>
                        )}
                        {activeView === 'credentials' && selectedCredentials.size > 0 && (
                            <button onClick={handleDeleteSelectedCredentials} className="flex items-center space-x-2 px-3 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors text-sm font-medium">
                                <Trash2 size={16}/>
                                <span>Delete ({selectedCredentials.size})</span>
                            </button>
                        )}
                        {activeView === 'reminders' && selectedReminders.size > 0 && (
                            <button onClick={handleDeleteSelectedReminders} className="flex items-center space-x-2 px-3 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors text-sm font-medium">
                                <Trash2 size={16}/>
                                <span>Delete ({selectedReminders.size})</span>
                            </button>
                        )}
                        {activeView === 'documents' && (
                             <button onClick={() => { setEditingDoc(null); setShowDocModal(true); }} className="flex items-center space-x-1 px-3 py-1.5 bg-cyan-500 rounded-md hover:bg-cyan-600 transition-colors text-sm" title="Add Document">
                                <PlusCircle size={16}/>
                                <span>Add Document</span>
                            </button>
                        )}
                        {activeView === 'credentials' && (
                            <button onClick={() => { setEditingCred(null); setShowCredModal(true); }} className="flex items-center space-x-1 px-3 py-1.5 bg-cyan-500 rounded-md hover:bg-cyan-600 transition-colors text-sm" title="Add Credential">
                                <PlusCircle size={16}/>
                                <span>Add Credential</span>
                            </button>
                        )}
                        {activeView === 'reminders' && (
                            <button onClick={() => { setEditingReminder(null); setShowReminderModal(true); }} className="flex items-center space-x-1 px-3 py-1.5 bg-cyan-500 rounded-md hover:bg-cyan-600 transition-colors text-sm" title="Add Reminder">
                                <PlusCircle size={16}/>
                                <span>Add Reminder</span>
                            </button>
                        )}
                    </div>
                </div>

                <div>
                    {activeView === 'documents' && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm border-separate" style={{borderSpacing: '0 4px'}}>
                                <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase">
                                    <tr>
                                        <th className="p-0 font-semibold w-12">
                                            <div className="dark:bg-slate-900 bg-white px-3 py-2 rounded-md border dark:border-slate-700/50 flex justify-center items-center">
                                                <input
                                                    type="checkbox"
                                                    onChange={handleToggleSelectAllDocuments}
                                                    checked={filteredDocuments.length > 0 && filteredDocuments.every(doc => selectedDocuments.has(doc.id))}
                                                    className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                                    title={filteredDocuments.length > 0 && filteredDocuments.every(doc => selectedDocuments.has(doc.id)) ? "Deselect All" : "Select All"}
                                                />
                                            </div>
                                        </th>
                                        {['S.No', 'Document Name', 'Type', 'Number', 'Registration Date', 'Expiry Date', 'Status', 'File', 'Notes', 'Actions'].map(h => <th key={h} className={`p-0 font-semibold ${h === 'File' ? 'text-center' : 'text-left'} ${h === 'Actions' ? 'text-right' : ''}`}><div className="dark:bg-slate-900 bg-white px-3 py-2 rounded-md border dark:border-slate-700/50">{h}</div></th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredDocuments.map((docItem, i) => {
                                        const isSelected = selectedDocuments.has(docItem.id);
                                        const cellClassName = `p-2 ${isSelected ? 'dark:bg-green-800/40 bg-green-100' : 'dark:bg-gray-800/50 bg-white'}`;
                                        return (
                                            <tr key={docItem.id} className="group/row">
                                                <td className={`${cellClassName} rounded-l-md text-center`}>
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => handleToggleSelectDocument(docItem.id)}
                                                        className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                                    />
                                                </td>
                                                <td className={cellClassName}>{i+1}</td>
                                                <td className={`${cellClassName} font-semibold`}>{docItem.documentName}</td>
                                                <td className={cellClassName}>{docItem.type}</td>
                                                <td className={cellClassName}>{docItem.number}</td>
                                                <td className={cellClassName}>{formatDate(docItem.registrationDate)}</td>
                                                <td className={cellClassName}>{formatDate(docItem.expiryDate)}</td>
                                                <td className={cellClassName}><DocumentStatusBadge date={docItem.expiryDate} /></td>
                                                <td className={`${cellClassName} text-center`}>
                                                    {docItem.fileUrl ? (
                                                        <a 
                                                            href={docItem.fileUrl} 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center space-x-1 px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs hover:bg-green-500/30 transition-colors"
                                                            title="View file"
                                                        >
                                                            <FileText size={12} />
                                                            <span>PDF</span>
                                                        </a>
                                                    ) : (
                                                        <span className="text-xs dark:text-gray-500 text-gray-400">-</span>
                                                    )}
                                                </td>
                                                <td className={`${cellClassName} truncate max-w-xs`}>{docItem.notes}</td>
                                                <td className={`${cellClassName} rounded-r-md`}>
                                                    <div className="opacity-0 group-hover/row:opacity-100 flex items-center justify-end space-x-1">
                                                        <button onClick={() => { setEditingDoc(docItem); setShowDocModal(true); }} className="p-1.5 hover:text-cyan-400"><Edit size={14}/></button>
                                                        <button onClick={() => onDocDeleteRequest(docItem)} className="p-1.5 hover:text-red-400"><Trash2 size={14}/></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {filteredDocuments.length === 0 && <div className="text-center py-8 text-gray-500">No documents found.</div>}
                        </div>
                    )}
                    {activeView === 'credentials' && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-base font-medium border-separate" style={{borderSpacing: '0 4px'}}>
                                <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase">
                                    <tr>
                                        <th className="p-0 font-semibold w-12">
                                            <div className="dark:bg-slate-900 bg-white px-3 py-2 rounded-md border dark:border-slate-700/50 flex justify-center items-center">
                                                <input
                                                    type="checkbox"
                                                    onChange={handleToggleSelectAllCredentials}
                                                    checked={filteredCredentials.length > 0 && filteredCredentials.every(cred => selectedCredentials.has(cred.id))}
                                                    className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                                    title={filteredCredentials.length > 0 && filteredCredentials.every(cred => selectedCredentials.has(cred.id)) ? "Deselect All" : "Select All"}
                                                />
                                            </div>
                                        </th>
                                        <th className="p-0 font-semibold text-left"><div className="dark:bg-slate-900 bg-white px-3 py-2 rounded-md border dark:border-slate-700/50">S.No</div></th>
                                        {credentialsConfig.columns.map(col => <th key={col.header} className="p-0 font-semibold text-left"><div className="dark:bg-slate-900 bg-white px-3 py-2 rounded-md border dark:border-slate-700/50">{col.header}</div></th>)}
                                        <th className="p-0 font-semibold text-right"><div className="dark:bg-slate-900 bg-white px-3 py-2 rounded-md border dark:border-slate-700/50">Actions</div></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredCredentials.map((item, index) => {
                                        const isSelected = selectedCredentials.has(item.id);
                                        const cellClassName = `p-2 ${isSelected ? 'dark:bg-green-800/40 bg-green-100' : 'dark:bg-gray-800/50 bg-white'}`;
                                        return (
                                            <tr key={item.id} className="group/row">
                                                <td className={`${cellClassName} rounded-l-md text-center`}>
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => handleToggleSelectCredential(item.id)}
                                                        className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                                    />
                                                </td>
                                                <td className={cellClassName}>{index + 1}</td>
                                                {credentialsConfig.columns.map(col => (
                                                    <td key={col.accessor} className={cellClassName}>
                                                        {col.render ? col.render(item) : item[col.accessor]}
                                                    </td>
                                                ))}
                                                <td className={`${cellClassName} rounded-r-md`}>
                                                    <div className="opacity-0 group-hover/row:opacity-100 flex items-center justify-end space-x-1">
                                                        <button onClick={() => { setEditingCred(item); setShowCredModal(true); }} className="p-1.5 hover:text-cyan-400"><Edit size={16}/></button>
                                                        <button onClick={() => onCredDeleteRequest(item)} className="p-1.5 hover:text-red-400"><Trash2 size={16}/></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {filteredCredentials.length === 0 && <div className="text-center py-8 text-gray-500">No credentials found.</div>}
                        </div>
                    )}
                    {activeView === 'reminders' && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm border-separate" style={{borderSpacing: '0 4px'}}>
                                <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase">
                                    <tr>
                                        <th className="p-0 font-semibold w-12">
                                            <div className="dark:bg-slate-900 bg-gray-200 px-3 py-2 rounded-md border dark:border-slate-700/50 flex justify-center items-center">
                                                <input
                                                    type="checkbox"
                                                    onChange={handleToggleSelectAllReminders}
                                                    checked={filteredReminders.length > 0 && filteredReminders.every(rem => selectedReminders.has(rem.id))}
                                                    className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                                    title={filteredReminders.length > 0 && filteredReminders.every(rem => selectedReminders.has(rem.id)) ? "Deselect All" : "Select All"}
                                                />
                                            </div>
                                        </th>
                                        {['S.No', 'Title', 'Due Date', 'Reminder Date', 'Status', 'Notes', 'Actions'].map(h => <th key={h} className={`p-0 font-semibold text-left ${h === 'Actions' ? 'text-right' : ''}`}><div className="dark:bg-slate-900 bg-gray-200 px-3 py-2 rounded-md border dark:border-slate-700/50">{h}</div></th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredReminders.map((reminder, i) => {
                                        const isSelected = selectedReminders.has(reminder.id);
                                        const cellClassName = `p-2 ${isSelected ? 'dark:bg-green-800/40 bg-green-100' : 'dark:bg-gray-800/50 bg-gray-50'}`;
                                        return (
                                            <tr key={reminder.id} className={`group/row ${reminder.status === 'Completed' ? 'opacity-50' : ''}`}>
                                                <td className={`${cellClassName} rounded-l-md text-center`}>
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => handleToggleSelectReminder(reminder.id)}
                                                        className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                                    />
                                                </td>
                                                <td className={cellClassName}>{i+1}</td>
                                                <td className={`${cellClassName} font-semibold ${reminder.status === 'Completed' ? 'line-through' : ''}`}>{reminder.title}</td>
                                                <td className={cellClassName}>
                                                    <div className="flex items-center space-x-2">
                                                        <span>{formatDate(reminder.dueDate)}</span>
                                                        <DocumentStatusBadge date={reminder.dueDate} />
                                                    </div>
                                                </td>
                                                <td className={cellClassName}>{formatDate(reminder.reminderDate)}</td>
                                                <td className={cellClassName}>
                                                    <button onClick={() => handleToggleReminderStatus(reminder)} className={`px-2 py-1 text-xs font-semibold rounded-full ${reminder.status === 'Completed' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                                                        {reminder.status}
                                                    </button>
                                                </td>
                                                <td className={`${cellClassName} truncate max-w-xs`}>{reminder.notes}</td>
                                                <td className={`${cellClassName} rounded-r-md`}>
                                                    <div className="opacity-0 group-hover/row:opacity-100 flex items-center justify-end space-x-1">
                                                        <button onClick={() => { setEditingReminder(reminder); setShowReminderModal(true); }} className="p-1.5 hover:text-cyan-400"><Edit size={14}/></button>
                                                        <button onClick={() => onReminderDeleteRequest(reminder)} className="p-1.5 hover:text-red-400"><Trash2 size={14}/></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {filteredReminders.length === 0 && <div className="text-center py-8 text-gray-500">No reminders found.</div>}
                        </div>
                    )}
                </div>
            </section>
            
            <DocCredModal 
                isOpen={showDocModal} 
                onSave={handleDocSave} 
                onClose={() => setShowDocModal(false)} 
                initialData={editingDoc} 
                formFields={documentFormFields} 
                title="Document"
                userId={userId}
                appId={appId}
                collectionPrefix={collectionPrefix}
                docId={editingDoc?.id}
            />
            <DocCredModal 
                isOpen={showCredModal} 
                onSave={handleCredSave} 
                onClose={() => setShowCredModal(false)} 
                initialData={editingCred} 
                formFields={credentialsConfig.formFields} 
                title="Credential"
                userId={userId}
                appId={appId}
                collectionPrefix={collectionPrefix}
                docId={editingCred?.id}
            />
            <GenericAddEditModal isOpen={showReminderModal} onSave={handleReminderSave} onClose={() => setShowReminderModal(false)} initialData={editingReminder} formFields={reminderFormFields} title="Reminder"/>
        </div>
    )
}

const NotificationPage = ({ userId, appId }) => {
    const [notifications, setNotifications] = useState({
        employees: [],
        vehicles: [],
        docs_creds: [],
        debts_credits: [],
        business: [],
        visas: []
    });
    const [loading, setLoading] = useState(true);
    const [liveData, setLiveData] = useState({});
    const initialLoadTracker = useRef({});

    const collectionsToListen = useMemo(() => [
        'alMarriData', 'fathoomData',
        'alMarriVehicles', 'fathoomVehicles',
        'alMarriDocuments', 'fathoomDocuments',
        'alMarriCredentials', 'fathoomCredentials',
        'business_recruitments',
        'debts_credits',
        'alMarriReminders', 'fathoomReminders',
        'visa_entries'
    ], []);

    // Effect to set up listeners for real-time updates
    useEffect(() => {
        if (!userId || appId === 'default-app-id') {
            setLoading(false);
            return;
        }

        setLoading(true);
        initialLoadTracker.current = collectionsToListen.reduce((acc, path) => ({ ...acc, [path]: false }), {});

        const unsubs = collectionsToListen.map(path => {
            const collRef = collection(db, `artifacts/${appId}/users/${userId}/${path}`);
            return onSnapshot(collRef, snapshot => {
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setLiveData(prevData => ({ ...prevData, [path]: data }));

                // Once all collections have loaded their initial data, set loading to false.
                if (initialLoadTracker.current[path] === false) {
                    initialLoadTracker.current[path] = true;
                    if (Object.values(initialLoadTracker.current).every(Boolean)) {
                        setLoading(false);
                    }
                }
            }, error => {
                console.error(`Error listening to ${path}:`, error);
                 if (initialLoadTracker.current[path] === false) {
                    initialLoadTracker.current[path] = true;
                    if (Object.values(initialLoadTracker.current).every(Boolean)) {
                        setLoading(false);
                    }
                }
            });
        });

        return () => unsubs.forEach(unsub => unsub());
    }, [userId, appId, collectionsToListen]);

    // Effect to process the live data into notifications whenever any source data changes
    useEffect(() => {
        const notificationsBySource = {
            employees: [],
            vehicles: [],
            docs_creds: [],
            debts_credits: [],
            business: [],
            visas: []
        };
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // --- EMPLOYEES ---
        const employeeScanConfig = [
             { path: 'alMarriData', company: 'Al Marri' },
             { path: 'fathoomData', company: 'Fathoom' }
        ];
        const employeeDocTypes = [
            { type: 'QID', dateField: 'qidExpiry', days: 30 },
            { type: 'Passport', dateField: 'passportExpiry', days: 30 },
            { type: 'Pay Card', dateField: 'payCardExpiry', days: 30 },
            { type: 'Contract', dateField: 'labourContractExpiry', days: 30 },
        ];
        employeeScanConfig.forEach(config => {
            (liveData[config.path] || []).filter(item => item.status === 'Active').forEach(item => {
                employeeDocTypes.forEach(docType => {
                    const dateValue = item[docType.dateField];
                    if (!dateValue) return;
                    
                    // Handle both Firestore Timestamp and regular Date objects
                    let expiryDate;
                    if (dateValue.toDate && typeof dateValue.toDate === 'function') {
                        expiryDate = dateValue.toDate();
                    } else if (dateValue instanceof Date) {
                        expiryDate = dateValue;
                    } else if (typeof dateValue === 'string') {
                        expiryDate = new Date(dateValue);
                    } else {
                        return; // Skip if not a valid date format
                    }
                    
                    if (expiryDate && !isNaN(expiryDate.getTime())) {
                        const warningDate = new Date();
                        warningDate.setDate(new Date().getDate() + docType.days);
                        if (expiryDate <= warningDate) {
                             const isExpired = expiryDate < today;
                             notificationsBySource.employees.push({
                                id: item.id,
                                title: `${docType.type} expiring for ${item.fullName}`,
                                description: `Expiry Date: ${formatDate(expiryDate)}`,
                                date: expiryDate,
                                isExpired: isExpired,
                                source: config.company,
                             });
                        }
                    }
                });
            });

            // Add notification for changed/cancelled employees to cancel their pay card
            (liveData[config.path] || [])
                .filter(item => (item.status === 'Changed' || item.status === 'Cancelled'))
                .forEach(item => {
                    if (item.payCard && !item.payCardCancelled) {
                        notificationsBySource.employees.push({
                            id: `${item.id}-paycard-cancel`,
                            title: `Action Required: Cancel Pay Card for ${item.fullName}`,
                            description: `Employee status is "${item.status}". Please ensure their pay card is cancelled.`,
                            date: null, // Not date-based, but should be high priority
                            isExpired: true, // Mark as high priority
                            source: config.company,
                        });
                    }
                });
        });

        // --- VEHICLES ---
        const vehicleScanConfig = [
             { path: 'alMarriVehicles', company: 'Al Marri' },
             { path: 'fathoomVehicles', company: 'Fathoom' }
        ];
        vehicleScanConfig.forEach(config => {
            (liveData[config.path] || []).forEach(item => {
                const dateValue = item.expiry;
                if (!dateValue) return;
                
                let expiryDate;
                if (dateValue.toDate && typeof dateValue.toDate === 'function') {
                    expiryDate = dateValue.toDate();
                } else if (dateValue instanceof Date) {
                    expiryDate = dateValue;
                } else if (typeof dateValue === 'string') {
                    expiryDate = new Date(dateValue);
                } else {
                    return;
                }
                
                if (expiryDate && !isNaN(expiryDate.getTime())) {
                    const warningDate = new Date();
                    warningDate.setDate(today.getDate() + 30); // 30-day warning
                    if (expiryDate <= warningDate) {
                         const isExpired = expiryDate < today;
                         notificationsBySource.vehicles.push({
                            id: item.id,
                            title: `Vehicle registration expiring for ${item.vehicleNo}`,
                            description: `Expiry Date: ${formatDate(expiryDate)}`,
                            date: expiryDate,
                            isExpired: isExpired,
                            source: config.company,
                         });
                    }
                }
            });
        });

        // --- VISAS ---
        // Note: RP Issued Date (expiryDate) is not a reminder field, so we don't show notifications for it

        // --- DOCS & CREDS ---
        const docsCredsScanConfig = [
            { path: 'alMarriDocuments', company: 'Al Marri', type: 'Company Document', nameField: 'documentName', dateField: 'expiryDate', days: 30 },
            { path: 'fathoomDocuments', company: 'Fathoom', type: 'Company Document', nameField: 'documentName', dateField: 'expiryDate', days: 30 },
            { path: 'alMarriCredentials', company: 'Al Marri'},
            { path: 'fathoomCredentials', company: 'Fathoom'},
        ];
         docsCredsScanConfig.forEach(config => {
            (liveData[config.path] || []).forEach(item => {
                if(config.type === 'Company Document') {
                    const dateValue = item[config.dateField];
                    if (!dateValue) return;
                    
                    let expiryDate;
                    if (dateValue.toDate && typeof dateValue.toDate === 'function') {
                        expiryDate = dateValue.toDate();
                    } else if (dateValue instanceof Date) {
                        expiryDate = dateValue;
                    } else if (typeof dateValue === 'string') {
                        expiryDate = new Date(dateValue);
                    } else {
                        return;
                    }
                    
                    if (expiryDate && !isNaN(expiryDate.getTime())) {
                        const warningDate = new Date();
                        warningDate.setDate(new Date().getDate() + config.days);
                        if(expiryDate <= warningDate){
                            const isExpired = expiryDate < today;
                            notificationsBySource.docs_creds.push({
                                id: `${item.id}-doc`,
                                title: `${config.type} "${item[config.nameField]}" expiring`,
                                description: `Expiry Date: ${formatDate(expiryDate)}`,
                                date: expiryDate, isExpired, source: config.company
                            });
                        }
                    }
                } else { // Handle Credentials
                     const dateValue = item.expiry;
                     if (!dateValue) return;
                     
                     let expiryDate;
                     if (dateValue.toDate && typeof dateValue.toDate === 'function') {
                         expiryDate = dateValue.toDate();
                     } else if (dateValue instanceof Date) {
                         expiryDate = dateValue;
                     } else if (typeof dateValue === 'string') {
                         expiryDate = new Date(dateValue);
                     } else {
                         return;
                     }
                     
                     if(expiryDate && !isNaN(expiryDate.getTime())){
                        const nameValue = item.description?.toLowerCase() || '';
                        let days = 30;
                        let type = 'Credential';
                        if (nameValue.includes('electricity')) { days = 2; type = 'Electricity Payment'; }
                        else if (nameValue.includes('rent')) { days = 7; type = 'Office Rent'; }
                        else if (['electricity', 'rent'].some(kw => nameValue.includes(kw))) { return; }

                        const warningDate = new Date();
                        warningDate.setDate(new Date().getDate() + days);
                         if(expiryDate <= warningDate){
                            const isExpired = expiryDate < today;
                            notificationsBySource.docs_creds.push({
                                id: `${item.id}-cred`,
                                title: `${type} "${item.description}" expiring`,
                                description: `Expiry Date: ${formatDate(expiryDate)}`,
                                date: expiryDate, isExpired, source: config.company
                            });
                        }
                     }
                }
            });
        });
        const reminderScanConfig = [ { path: 'alMarriReminders', company: 'Al Marri' }, { path: 'fathoomReminders', company: 'Fathoom' }];
        reminderScanConfig.forEach(config => {
            (liveData[config.path] || []).filter(item => item.status === 'Pending').forEach(item => {
                const dateValue = item.reminderDate;
                if (!dateValue) return;
                
                let reminderDate;
                if (dateValue.toDate && typeof dateValue.toDate === 'function') {
                    reminderDate = dateValue.toDate();
                } else if (dateValue instanceof Date) {
                    reminderDate = dateValue;
                } else if (typeof dateValue === 'string') {
                    reminderDate = new Date(dateValue);
                } else {
                    return;
                }
                
                if (reminderDate && !isNaN(reminderDate.getTime())) {
                    const warningThreshold = new Date(); warningThreshold.setDate(today.getDate() + 3);
                    if (reminderDate < warningThreshold) {
                         // Handle dueDate for display
                         const dueDateValue = item.dueDate;
                         let dueDate;
                         if (dueDateValue?.toDate && typeof dueDateValue.toDate === 'function') {
                             dueDate = dueDateValue.toDate();
                         } else if (dueDateValue instanceof Date) {
                             dueDate = dueDateValue;
                         } else if (typeof dueDateValue === 'string') {
                             dueDate = new Date(dueDateValue);
                         }
                         
                         notificationsBySource.docs_creds.push({
                            id: item.id,
                            title: `Reminder: ${item.title}`,
                            description: `Due Date: ${formatDate(item.dueDate)}`,
                            date: dueDate,
                            isExpired: dueDate && !isNaN(dueDate.getTime()) ? dueDate < today : false,
                            source: config.company
                        });
                    }
                }
            });
        });

        // --- DEBTS & CREDITS ---
        (liveData['debts_credits'] || []).forEach(item => {
            const dateValue = item.dueDate;
            if (!dateValue) return;
            
            let dueDate;
            if (dateValue.toDate && typeof dateValue.toDate === 'function') {
                dueDate = dateValue.toDate();
            } else if (dateValue instanceof Date) {
                dueDate = dateValue;
            } else if (typeof dateValue === 'string') {
                dueDate = new Date(dateValue);
            } else {
                return;
            }
            
            if (dueDate && !isNaN(dueDate.getTime())) {
                const warningThreshold = new Date(); warningThreshold.setDate(today.getDate() + 3);
                if (dueDate < warningThreshold) {
                    const isExpired = dueDate < today;
                    notificationsBySource.debts_credits.push({
                        id: item.id,
                        title: `${item.mainCategory === 'Current Assets' ? 'Debtor' : 'Creditor'} Payment Due: ${item.name}`,
                        description: `Due Date: ${formatDate(dueDate)}`,
                        date: dueDate,
                        isExpired: isExpired,
                        source: 'Debts & Credits',
                    });
                }
            }
        });

        // --- BUSINESS ---
        (liveData['business_recruitments'] || []).forEach(item => {
            const balance = (item.sold || 0) - (item.received || 0);
            if (balance > 0) {
                notificationsBySource.business.push({
                    id: item.id,
                    title: `Recruitment Balance for ${item.name}`,
                    description: `Pending Balance: ${formatCurrency(balance)}`,
                    date: null, // No date for balance
                    isExpired: false,
                    source: 'Business',
                });
            }
        });

        // Sort each category by date
        for (const key in notificationsBySource) {
            notificationsBySource[key].sort((a, b) => {
                const dateA = a.date;
                const dateB = b.date;
                if (dateA && dateB) return dateA - dateB;
                if (dateA) return -1;
                if (dateB) return 1;
                return a.title.localeCompare(b.title); // Fallback sort for items without dates
            });
        }
        
        setNotifications(notificationsBySource);

    }, [liveData]);

    const notificationColors = {
        employees: {
            heading: 'text-teal-400 border-teal-500',
            bg: 'dark:bg-teal-900/10'
        },
        vehicles: {
            heading: 'text-sky-400 border-sky-500',
            bg: 'dark:bg-sky-900/10'
        },
        visas: {
            heading: 'text-indigo-400 border-indigo-500',
            bg: 'dark:bg-indigo-900/10'
        },
        docs_creds: {
            heading: 'text-amber-400 border-amber-500',
            bg: 'dark:bg-amber-900/10'
        },
        debts_credits: {
            heading: 'text-rose-400 border-rose-500',
            bg: 'dark:bg-rose-900/10'
        },
        business: {
            heading: 'text-lime-400 border-lime-500',
            bg: 'dark:bg-lime-900/10'
        },
    };

    const hasNotifications = Object.values(notifications).some(arr => arr.length > 0);

    const NotificationItem = ({ item }) => (
         <div key={item.id} className={`p-3 rounded-lg flex items-start space-x-3 text-sm ${item.isExpired ? 'bg-red-500/20 border-l-4 border-red-500' : 'bg-yellow-500/20 border-l-4 border-yellow-500'}`}>
            <AlertTriangle size={18} className={`mt-0.5 flex-shrink-0 ${item.isExpired ? 'text-red-400' : 'text-yellow-400'}`} />
            <div>
                <p className="font-semibold leading-tight">{item.title}</p>
                <p className="text-xs text-gray-400">
                    {item.description} ({item.source})
                    {item.isExpired && <span className="font-bold"> Expired!</span>}
                </p>
            </div>
        </div>
    );

    const NotificationGroup = ({ title, items, icon, colorConfig }) => {
        if (!items || items.length === 0) return null;
        return (
             <section className={`p-4 rounded-lg ${colorConfig.bg}`}>
                <h3 className={`text-xl font-bold mb-4 border-b-2 pb-2 flex items-center ${colorConfig.heading}`}>
                    {icon}
                    <span className="ml-3">{title} ({items.length})</span>
                </h3>
                <div className="space-y-3">
                    {items.map(item => <NotificationItem key={item.id} item={item} />)}
                </div>
            </section>
        );
    }

    return (
        <div className="p-4 sm:p-8">
            <div className="max-w-[1800px] mx-auto">
                <div className="dark:bg-gray-800 bg-white p-6 rounded-lg">
                    {loading ? (
                        <div className="text-center"><Loader2 className="animate-spin inline-block mr-2" /> Loading notifications...</div>
                    ) : !hasNotifications ? (
                        <div className="text-center text-gray-500 py-8">No urgent notifications. Everything is up to date!</div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                            <NotificationGroup title="Employees" items={notifications.employees} icon={<Users size={24}/>} colorConfig={notificationColors.employees} />
                            <NotificationGroup title="Vehicles" items={notifications.vehicles} icon={<Car size={24}/>} colorConfig={notificationColors.vehicles} />
                            <NotificationGroup title="Visa Expiries" items={notifications.visas} icon={<IdCard size={24}/>} colorConfig={notificationColors.visas} />
                            <NotificationGroup title="Documents & Credentials" items={notifications.docs_creds} icon={<IdCard size={24}/>} colorConfig={notificationColors.docs_creds} />
                            <NotificationGroup title="Debts & Credits" items={notifications.debts_credits} icon={<HandCoins size={24}/>} colorConfig={notificationColors.debts_credits} />
                            <NotificationGroup title="Business" items={notifications.business} icon={<Briefcase size={24}/>} colorConfig={notificationColors.business} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const visaFormFields = [
    { name: 'date', label: 'Applied Date', type: 'date' }, // Changed label
    { name: 'expiryDate', label: 'RP Issued Date', type: 'date', noDefaultDate: true }, // Changed label, no auto-date
    { name: 'vpNumber', label: 'VP Number' },
    { name: 'company', label: 'Company', type: 'select', options: ['ALM', 'FTH', 'Others'], defaultValue: 'ALM' },
    { name: 'visaNumber', label: 'Visa Number' },
    { name: 'name', label: 'Holder Name', transform: 'capitalize' },
    { name: 'profession', label: 'Profession', transform: 'capitalize' },
    { name: 'nationality', label: 'Nationality', transform: 'capitalize' },
    { name: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female', 'Other'], defaultValue: 'Male' },
    { name: 'status', label: 'Status', type: 'select', options: ['New Visa', 'Under Process', 'RP Issued', 'Others'], defaultValue: 'New Visa'},
    { name: 'notes', label: 'Notes', type: 'textarea', colSpan: 2 },
];

const visaPnlFormFields = [
    { name: 'date', label: 'Date', type: 'date' },
    { name: 'holderName', label: 'Holder Name', transform: 'capitalize' },
    { name: 'careOff', label: 'C/O', transform: 'capitalize' },
    { name: 'nationality', label: 'Nationality', transform: 'capitalize' },
    { name: 'profession', label: 'Profession', transform: 'capitalize' },
    { name: 'visaNo', label: 'Visa No' },
    { name: 'price', label: 'Price', type: 'number' },
    { name: 'approvalExp', label: 'Approval Exp', type: 'number' },
    { name: 'proExp', label: 'PRO Exp', type: 'number' },
    { name: 'govtExpenses', label: 'Govt Expenses', type: 'number' },
    { name: 'commissionExp', label: 'Commission Exp', type: 'number' },
    { name: 'received', label: 'Received', type: 'number' },
];

const VisaPage = ({ userId, appId, setConfirmAction, currency }) => {
    const [entries, setEntries] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [editingEntry, setEditingEntry] = useState(null);
    const [activeView, setActiveView] = useState('new'); // 'new', 'processing', 'issued', 'others'
    const [view, setView] = useState('yearly');
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
    const entriesRef = useMemo(() => collection(db, `artifacts/${appId}/users/${userId}/visa_entries`), [userId, appId]);
    const [searchTerm, setSearchTerm] = useState('');

    const [pnlEntries, setPnlEntries] = useState([]);
    const [showPnlModal, setShowPnlModal] = useState(false);
    const [editingPnlEntry, setEditingPnlEntry] = useState(null);
    const pnlEntriesRef = useMemo(() => collection(db, `artifacts/${appId}/users/${userId}/visa_pnl`), [userId, appId]);
    const [tickedPnlEntries, setTickedPnlEntries] = useState(new Set());
    const [tickedEntries, setTickedEntries] = useState(new Set());
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [isExportingExcel, setIsExportingExcel] = useState(false); // Add this line
    const importFileInputRef = useRef(null);

    const tickedItemsRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/visaSettings/tickedItems`), [userId, appId]);

    const updateTickedInFirestore = useCallback(async (dataToMerge) => {
        if (!tickedItemsRef) return;
        try {
            // Use setDoc with merge: true to only update the fields provided
            await setDoc(tickedItemsRef, dataToMerge, { merge: true });
        } catch (error) {
            console.error("Failed to save ticked items:", error);
            // Don't bother the user, just log the error.
        }
    }, [tickedItemsRef]);

    // Effect to load persistent ticked entries
    useEffect(() => {
        if (!tickedItemsRef) return;
        const unsub = onSnapshot(tickedItemsRef, (docSnap) => {
            if (docSnap.exists()) {
                setTickedEntries(new Set(docSnap.data().tickedEntryIds || []));
                setTickedPnlEntries(new Set(docSnap.data().tickedPnlEntryIds || []));
            } else {
                // No doc, just use default empty sets
                setTickedEntries(new Set());
                setTickedPnlEntries(new Set());
            }
        }, (error) => {
            console.error("Error fetching ticked items:", error);
        });
        return () => unsub();
    }, [tickedItemsRef]);


    const handleToggleTick = useCallback((entryId) => {
        setTickedEntries(prev => {
            const newSet = new Set(prev);
            if (newSet.has(entryId)) {
                newSet.delete(entryId);
            } else {
                newSet.add(entryId);
            }
            updateTickedInFirestore({ tickedEntryIds: Array.from(newSet) }); // Save change
            return newSet;
        });
    }, [updateTickedInFirestore]);

    const handleToggleAllTicks = useCallback((entryList) => {
        const allIds = entryList.map(e => e.id);
        const allAreTicked = allIds.length > 0 && allIds.every(id => tickedEntries.has(id));

        setTickedEntries(prev => {
            const newSet = new Set(prev);
            if (allAreTicked) {
                allIds.forEach(id => newSet.delete(id));
            } else {
                allIds.forEach(id => newSet.add(id));
            }
            updateTickedInFirestore({ tickedEntryIds: Array.from(newSet) }); // Save change
            return newSet;
        });
    }, [tickedEntries, updateTickedInFirestore]);

    const handleClearTicks = () => {
        const newSet = new Set();
        setTickedEntries(newSet);
        updateTickedInFirestore({ tickedEntryIds: [] }); // Save change
    };

    const handleTogglePnlTick = useCallback((entryId) => {
        setTickedPnlEntries(prev => {
            const newSet = new Set(prev);
            if (newSet.has(entryId)) {
                newSet.delete(entryId);
            } else {
                newSet.add(entryId);
            }
            updateTickedInFirestore({ tickedPnlEntryIds: Array.from(newSet) }); // Save change
            return newSet;
        });
    }, [updateTickedInFirestore]);

    const handleToggleAllPnlTicks = useCallback((entryList) => {
        const allIds = entryList.map(e => e.id);
        const allAreTicked = allIds.length > 0 && allIds.every(id => tickedPnlEntries.has(id));

        setTickedPnlEntries(prev => {
            const newSet = new Set(prev);
            if (allAreTicked) {
                allIds.forEach(id => newSet.delete(id));
            } else {
                allIds.forEach(id => newSet.add(id));
            }
            updateTickedInFirestore({ tickedPnlEntryIds: Array.from(newSet) }); // Save change
            return newSet;
        });
    }, [tickedPnlEntries, updateTickedInFirestore]);

    const handleClearPnlTicks = () => {
        const newSet = new Set();
        setTickedPnlEntries(newSet);
        updateTickedInFirestore({ tickedPnlEntryIds: [] }); // Save change
    };

    const handleExportJson = async () => {
        setConfirmAction({
            title: 'Export Visa Data',
            message: 'This will export all visa entries and P&L data to a single JSON file. Proceed?',
            confirmText: 'Export',
            type: 'save',
            action: async () => {
                setIsExporting(true);
                try {
                    const dataToExport = {};
                    const collectionsToExport = {
                        visa_entries: entriesRef,
                        visa_pnl: pnlEntriesRef,
                    };

                    for (const [key, collRef] of Object.entries(collectionsToExport)) {
                        const snapshot = await getDocs(collRef);
                        dataToExport[key] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    }

                    const jsonString = JSON.stringify(dataToExport, null, 2);
                    const blob = new Blob([jsonString], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `visa_data_backup_${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (error) {
                    console.error("Export failed:", error);
                    alert("An error occurred during export.");
                } finally {
                    setIsExporting(false);
                }
            }
        });
    };

    const handleImportJsonChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                
                setConfirmAction({
                    title: 'DANGER: Import Visa Data',
                    message: 'This will DELETE ALL current visa entries and P&L data and replace it with data from the file. This action cannot be undone. Are you sure?',
                    confirmText: 'Yes, Delete & Import',
                    type: 'delete',
                    action: async () => {
                        setIsImporting(true);
                        try {
                            const collectionsInFile = Object.keys(importedData);

                            for (const collectionName of collectionsInFile) {
                                 const collRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionName}`);
                                 const existingDocsSnapshot = await getDocs(collRef);
                                 if (!existingDocsSnapshot.empty) {
                                    const batch = writeBatch(db);
                                    existingDocsSnapshot.forEach(doc => batch.delete(doc.ref));
                                    await batch.commit();
                                 }
                            }

                            for (const collectionName of collectionsInFile) {
                                const itemsToImport = importedData[collectionName];
                                if (Array.isArray(itemsToImport) && itemsToImport.length > 0) {
                                    const batch = writeBatch(db);
                                    itemsToImport.forEach(item => {
                                        const { id, ...data } = item;
                                        const restoredData = restoreTimestamps(data);
                                        const docRef = doc(db, `artifacts/${appId}/users/${userId}/${collectionName}`, id);
                                        batch.set(docRef, restoredData);
                                    });
                                    await batch.commit();
                                }
                            }
                            alert('Import successful! The visa data has been restored.');
                        } catch (err) {
                            console.error("Import process failed:", err);
                            alert(`Import failed: ${err.message}`);
                        } finally {
                            setIsImporting(false);
                        }
                    }
                });

            } catch (err) {
                 alert(`Error reading file: ${err.message}`);
            }
            if(importFileInputRef.current) importFileInputRef.current.value = "";
        };
        reader.readAsText(file);
    };

    const triggerImport = () => {
        importFileInputRef.current?.click();
    };

    const handleExportExcel = () => {
        if (!window.XLSX) {
            alert("Excel export library is not ready. Please try again.");
            return;
        }

        setConfirmAction({
            title: 'Export Visa Data to Excel',
            message: 'This will export the currently filtered visa entries and P&L data to an Excel file. Proceed?',
            confirmText: 'Export',
            type: 'save',
            action: async () => {
                setIsExportingExcel(true);
                try {
                    const wb = window.XLSX.utils.book_new();
                    
                    // Helper to format data
                    const processSheet = (data, columns) => {
                        return data.map((item, index) => {
                            const row = { "S.No": index + 1 };
                            columns.forEach(col => {
                                let value;
                                if (col.render) {
                                    // Simple render logic for Excel (no JSX)
                                    if (col.accessor === 'date' || col.accessor === 'expiryDate') {
                                        value = formatDate(item[col.accessor]);
                                    } else if (col.accessor === 'status') {
                                        value = item.status; // Just the text, not the badge
                                    } else {
                                        value = item[col.accessor];
                                    }
                                } else {
                                    value = item[col.accessor];
                                }
                                row[col.header] = value;
                            });
                            return row;
                        });
                    };
                    
                    // Helper to format P&L data
                    const processPnlSheet = (data) => {
                         return data.map((entry, i) => {
                            const govtExpenses = (entry.govtExpenses || 0) + (entry.medicalExp || 0) + (entry.visaLcExp || 0) + (entry.issueRpExp || 0);
                            const totalExp = (entry.approvalExp || 0) + (entry.proExp || 0) + govtExpenses + (entry.commissionExp || 0);
                            const gBalance = (entry.price || 0) - totalExp;
                            const balance = (entry.price || 0) - (entry.received || 0);
                            
                            return {
                                "S.No": i + 1,
                                "Date": formatDate(entry.date),
                                "Holder Name": entry.holderName,
                                "C/O": entry.careOff,
                                "Nationality": entry.nationality,
                                "Profession": entry.profession,
                                "Visa No": entry.visaNo,
                                "Price": entry.price || 0,
                                "Approval Exp": entry.approvalExp || 0,
                                "PRO Exp": entry.proExp || 0,
                                "Govt Expenses": govtExpenses,
                                "Commission Exp": entry.commissionExp || 0,
                                "G Balance": gBalance,
                                "Received": entry.received || 0,
                                "Balance": balance,
                            };
                        });
                    };

                    const visaColumns = [
                        { header: 'Applied Date', accessor: 'date', render: true },
                        { header: 'RP Issued Date', accessor: 'expiryDate', render: true },
                        { header: 'VP Number', accessor: 'vpNumber' },
                        { header: 'Company', accessor: 'company' },
                        { header: 'Gender', accessor: 'gender' },
                        { header: 'Nationality', accessor: 'nationality' },
                        { header: 'Profession', accessor: 'profession' },
                        { header: 'Visa Number', accessor: 'visaNumber' },
                        { header: 'Holder Name', accessor: 'name' },
                        { header: 'Status', accessor: 'status', render: true },
                        { header: 'Notes', accessor: 'notes' },
                    ];

                    if(newVisas.length > 0) window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(processSheet(newVisas, visaColumns)), "New Visas");
                    if(underProcessVisas.length > 0) window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(processSheet(underProcessVisas, visaColumns)), "Under Process");
                    if(rpIssuedVisas.length > 0) window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(processSheet(rpIssuedVisas, visaColumns)), "RP Issued");
                    if(otherVisas.length > 0) window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(processSheet(otherVisas, visaColumns)), "Others");
                    if(filteredPnlEntries.length > 0) {
                         const pnlData = processPnlSheet(filteredPnlEntries);
                         // Add totals row
                         pnlData.push({
                            "S.No": "TOTAL",
                            "Price": pnlTotals.price,
                            "Approval Exp": pnlTotals.approvalExp,
                            "PRO Exp": pnlTotals.proExp,
                            "Govt Expenses": pnlTotals.govtExpenses,
                            "Commission Exp": pnlTotals.commissionExp,
                            "G Balance": pnlTotals.gBalance,
                            "Received": pnlTotals.received,
                            "Balance": pnlTotals.balance,
                         });
                         window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(pnlData), "P&L");
                    }
                    
                    const period = view === 'monthly' ? `${selectedYear}-${selectedMonth+1}` : view === 'yearly' ? selectedYear : 'all_time';
                    window.XLSX.writeFile(wb, `visa_report_${period}_${new Date().toISOString().split('T')[0]}.xlsx`);

                } catch (error) {
                    console.error("Excel Export failed:", error);
                    alert("An error occurred during the Excel export.");
                } finally {
                    setIsExportingExcel(false);
                }
            }
        });
    };

    const handleImportExcel = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsImporting(true);
        try {
            const data = await file.arrayBuffer();
            const workbook = window.XLSX.read(data);
            
            // Check which sheets exist
            const hasVisaEntries = workbook.SheetNames.includes('Visa Entries');
            const hasPnlEntries = workbook.SheetNames.includes('Visa P&L');
            
            if (!hasVisaEntries && !hasPnlEntries) {
                throw new Error('No valid sheets found. Expected "Visa Entries" and/or "Visa P&L"');
            }

            setConfirmAction({
                title: 'Confirm Import',
                message: `This will import visa data from the Excel file. Existing entries with the same ID will be updated. Continue?`,
                confirmText: 'Import',
                type: 'import',
                action: async () => {
                    try {
                        // Import Visa Entries
                        if (hasVisaEntries) {
                            const visaSheet = workbook.Sheets['Visa Entries'];
                            const visaData = window.XLSX.utils.sheet_to_json(visaSheet);
                            
                            for (const row of visaData) {
                                const entryData = {
                                    date: parseDateForFirestore(row['Applied Date']) || new Date(),
                                    expiryDate: parseDateForFirestore(row['RP Issued Date']) || new Date(),
                                    vpNumber: row['VP Number'] || '',
                                    company: row['Company'] || '',
                                    gender: row['Gender'] || '',
                                    profession: row['Profession'] || '',
                                    status: row['Status'] || 'New',
                                    remarks: row['Remarks'] || ''
                                };

                                if (row.id) {
                                    await setDoc(doc(entriesRef, row.id), entryData, { merge: true });
                                } else {
                                    await addDoc(entriesRef, entryData);
                                }
                            }
                        }

                        // Import P&L Entries
                        if (hasPnlEntries) {
                            const pnlSheet = workbook.Sheets['Visa P&L'];
                            const pnlData = window.XLSX.utils.sheet_to_json(pnlSheet);
                            
                            for (const row of pnlData) {
                                const pnlEntryData = {
                                    date: parseDateForFirestore(row['Date']) || new Date(),
                                    holderName: row['Holder Name'] || '',
                                    careOff: row['C/O'] || '',
                                    nationality: row['Nationality'] || '',
                                    profession: row['Profession'] || '',
                                    visaNo: row['Visa No'] || '',
                                    price: Number(row['Price']) || 0,
                                    approvalExp: Number(row['Approval Exp']) || 0,
                                    proExp: Number(row['PRO Exp']) || 0,
                                    govtExpenses: Number(row['Govt Expenses']) || 0,
                                    commissionExp: Number(row['Commission Exp']) || 0,
                                    received: Number(row['Received']) || 0
                                };

                                if (row.id) {
                                    await setDoc(doc(pnlEntriesRef, row.id), pnlEntryData, { merge: true });
                                } else {
                                    await addDoc(pnlEntriesRef, pnlEntryData);
                                }
                            }
                        }

                        alert('Import successful!');
                    } catch (error) {
                        console.error('Import process failed:', error);
                        alert(`Import failed: ${error.message}`);
                    }
                }
            });
        } catch (error) {
            console.error('Import failed:', error);
            alert(`Failed to read Excel file: ${error.message}`);
        } finally {
            setIsImporting(false);
            e.target.value = '';
        }
    };

    useEffect(() => {
        const unsubPnl = onSnapshot(pnlEntriesRef, snapshot => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
                .sort((a, b) => {
                    const dateB = getDateFromField(b.date) || new Date(0);
                    const dateA = getDateFromField(a.date) || new Date(0);
                    return dateB - dateA; // Newest first
                });
            setPnlEntries(data);
        });
        return () => unsubPnl();
    }, [pnlEntriesRef]);

    const filteredPnlEntries = useMemo(() => {
        if (!searchTerm) return pnlEntries;
        const lowercasedTerm = searchTerm.toLowerCase();
        return pnlEntries.filter(item => 
            Object.values(item).some(value => 
                (typeof value === 'string' || typeof value === 'number') && String(value).toLowerCase().includes(lowercasedTerm)
            )
        );
    }, [pnlEntries, searchTerm]);

    const pnlTotals = useMemo(() => {
        return filteredPnlEntries.reduce((acc, entry) => {
            const govtExpenses = (entry.govtExpenses || 0) + (entry.medicalExp || 0) + (entry.visaLcExp || 0) + (entry.issueRpExp || 0);
            const totalExp = (entry.approvalExp || 0) + (entry.proExp || 0) + govtExpenses + (entry.commissionExp || 0);
            const gBalance = (entry.price || 0) - totalExp;
            const balance = (entry.price || 0) - (entry.received || 0);
            
            acc.price += entry.price || 0;
            acc.approvalExp += entry.approvalExp || 0;
            acc.proExp += entry.proExp || 0;
            acc.govtExpenses += govtExpenses;
            acc.commissionExp += entry.commissionExp || 0;
            acc.gBalance += gBalance;
            acc.received += entry.received || 0;
            acc.balance += balance;

            return acc;
        }, {
            price: 0,
            approvalExp: 0,
            proExp: 0,
            govtExpenses: 0,
            commissionExp: 0,
            gBalance: 0,
            received: 0,
            balance: 0,
        });
    }, [filteredPnlEntries]);

    useEffect(() => {
        const unsub = onSnapshot(entriesRef, snapshot => {
            const companyOrder = ['Mohamed Al Marri Trading', 'Fathoom Transportation', 'Others'];
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
                .sort((a, b) => {
                    const companyAIndex = companyOrder.indexOf(a.company);
                    const companyBIndex = companyOrder.indexOf(b.company);

                    // Handle cases where a company might not be in the list (though it should be)
                    const finalAIndex = companyAIndex === -1 ? companyOrder.length : companyAIndex;
                    const finalBIndex = companyBIndex === -1 ? companyOrder.length : companyBIndex;

                    if (finalAIndex !== finalBIndex) {
                        return finalAIndex - finalBIndex;
                    }

                    // If companies are the same, sort by date descending (newest first)
                    const dateB = getDateFromField(b.date) || new Date(0);
                    const dateA = getDateFromField(a.date) || new Date(0);
                    return dateB - dateA;
                });
            setEntries(data);
        });
        return () => unsub();
    }, [entriesRef]);

    const getDateFromField = (dateField) => {
        if (!dateField) return null;
        if (dateField.toDate && typeof dateField.toDate === 'function') {
            return dateField.toDate();
        }
        if (dateField instanceof Date) {
            return dateField;
        }
        if (typeof dateField === 'string') {
            const parsed = new Date(dateField);
            return isNaN(parsed.getTime()) ? null : parsed;
        }
        return null;
    };

    const years = useMemo(() => [...new Set(entries.map(e => getDateFromField(e.date)?.getFullYear()))].filter(Boolean).sort((a,b) => b-a), [entries]);
    const months = useMemo(() => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], []);

    const filteredEntries = useMemo(() => {
        let tempEntries = entries; // Start with all entries

        // Date filtering
        if (view === 'yearly') {
            tempEntries = tempEntries.filter(e => {
                const date = getDateFromField(e.date);
                if (!date) return false;
                return date.getFullYear() === selectedYear;
            });
        } else if (view === 'monthly') {
            tempEntries = tempEntries.filter(e => {
                const date = getDateFromField(e.date);
                if (!date) return false;
                return date.getFullYear() === selectedYear && date.getMonth() === selectedMonth;
            });
        }
        // 'all' view does no date filtering

        // Search filtering
        if (searchTerm) {
            const lowercasedTerm = searchTerm.toLowerCase();
            tempEntries = tempEntries.filter(item => 
                Object.values(item).some(value => 
                    (typeof value === 'string' || typeof value === 'number') && String(value).toLowerCase().includes(lowercasedTerm)
                )
            );
        }

        return tempEntries;
    }, [entries, view, selectedYear, selectedMonth, searchTerm]);

    const { newVisas, underProcessVisas, rpIssuedVisas, otherVisas } = useMemo(() => {
        return filteredEntries.reduce((acc, v) => {
            switch (v.status) {
                case 'New Visa':
                    acc.newVisas.push(v);
                    break;
                case 'Under Process':
                    acc.underProcessVisas.push(v);
                    break;
                case 'RP Issued':
                    acc.rpIssuedVisas.push(v);
                    break;
                default:
                    acc.otherVisas.push(v);
                    break;
            }
            return acc;
        }, { newVisas: [], underProcessVisas: [], rpIssuedVisas: [], otherVisas: [] });
    }, [filteredEntries]);

    const handleSave = async (data) => {
        const pnlStatuses = ['Under Process', 'RP Issued'];

        if (editingEntry) {
            // This is an edit
            const oldStatus = editingEntry.status;
            const newStatus = data.status;
            
            const wasInPnlStatus = pnlStatuses.includes(oldStatus);
            const isNowInPnlStatus = pnlStatuses.includes(newStatus);

            // First, update the visa entry itself
            await updateDoc(doc(entriesRef, editingEntry.id), data);

            // Scenario 1: Promote to P&L (e.g., New Visa -> Under Process)
            if (!wasInPnlStatus && isNowInPnlStatus) {
                try {
                    // Check if a P&L entry *already* exists for this visa number, just in case
                    const pnlQuery = query(pnlEntriesRef, where("visaNo", "==", data.visaNumber));
                    const existingPnlSnapshot = await getDocs(pnlQuery);
                    
                    if (existingPnlSnapshot.empty) { // Only create if one doesn't exist
                        const pnlEntry = {
                            date: data.date || new Date(),
                            holderName: data.name || '',
                            nationality: data.nationality || '',
                            profession: data.profession || '',
                            visaNo: data.visaNumber || '',
                            price: 0, approvalExp: 0, proExp: 0, govtExpenses: 0, commissionExp: 0, received: 0,
                            createdAt: new Date(), 
                        };
                        await addDoc(pnlEntriesRef, pnlEntry);
                    }
                } catch (pnlError) {
                    console.error("Failed to create P&L entry on status update:", pnlError);
                }
            }
            // Scenario 2: Demote from P&L (e.g., Under Process -> New Visa)
            else if (wasInPnlStatus && !isNowInPnlStatus) {
                try {
                    // Find the P&L entry using the visa number from the *original* entry
                    const visaNumberToFind = editingEntry.visaNumber;
                    if (visaNumberToFind) {
                        const pnlQuery = query(pnlEntriesRef, where("visaNo", "==", visaNumberToFind));
                        const pnlSnapshot = await getDocs(pnlQuery);
                        
                        if (!pnlSnapshot.empty) {
                            // Delete all matching P&L entries (should ideally be just one)
                            const batch = writeBatch(db);
                            pnlSnapshot.forEach(pnlDoc => {
                                batch.delete(pnlDoc.ref);
                            });
                            await batch.commit();
                        }
                    }
                } catch (pnlError) {
                    console.error("Failed to delete P&L entry on status update:", pnlError);
                }
            }
            // Scenarios 3 & 4 (no change in P&L status) - do nothing.

        } else {
            // This is a new entry (existing logic)
            await addDoc(entriesRef, data); // Add the visa entry

            // Check status to create a P&L entry
            if (pnlStatuses.includes(data.status)) {
                try {
                    const pnlEntry = {
                        date: data.date || new Date(), // Use the visa's "Applied Date"
                        holderName: data.name || '',
                        nationality: data.nationality || '',
                        profession: data.profession || '',
                        visaNo: data.visaNumber || '',
                        // Initialize financial fields to 0
                        price: 0,
                        approvalExp: 0,
                        proExp: 0,
                        govtExpenses: 0,
                        commissionExp: 0,
                        received: 0,
                        // Add a creation timestamp for reference
                        createdAt: new Date(), 
                    };
                    await addDoc(pnlEntriesRef, pnlEntry);
                } catch (pnlError) {
                    console.error("Failed to automatically create P&L entry:", pnlError);
                    // Don't block the main save from succeeding, just log the error.
                }
            }
        }
        setShowModal(false);
        setEditingEntry(null);
    };

    const handlePnlSave = async (data) => {
        if (editingPnlEntry) {
            await updateDoc(doc(pnlEntriesRef, editingPnlEntry.id), data);
        } else {
            await addDoc(pnlEntriesRef, data);
        }
        setShowPnlModal(false);
        setEditingPnlEntry(null);
    };
    
    const onDeleteRequest = (entry) => {
        setConfirmAction({
            title: 'Confirm Delete',
            message: `Delete visa entry for ${entry.name}?`,
            confirmText: 'Delete', type: 'delete',
            action: () => deleteDoc(doc(entriesRef, entry.id))
        });
    };

    const onPnlDeleteRequest = (entry) => {
        setConfirmAction({
            title: 'Confirm Delete',
            message: `Delete P&L entry for ${entry.holderName}?`,
            confirmText: 'Delete', type: 'delete',
            action: () => deleteDoc(doc(pnlEntriesRef, entry.id))
        });
    };

    const VisaPnlTable = ({ pnlList, totals, tickedEntries, onToggleTick, onToggleAllTicks }) => (
        <div className="overflow-x-auto mt-6">
            <table className="w-full text-sm border-separate table-fixed" style={{borderSpacing: '0 4px'}}>
                <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase">
                    <tr>
                        <th className="p-0 font-semibold w-12">
                            <div className="dark:bg-slate-900 bg-gray-200 px-3 py-2 rounded-md border dark:border-slate-700/50 flex justify-center items-center">
                                <input
                                    type="checkbox"
                                    onChange={() => onToggleAllTicks(pnlList)}
                                    checked={pnlList.length > 0 && pnlList.every(e => tickedEntries.has(e.id))}
                                    className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                />
                            </div>
                        </th>
                        {['S.No', 'Date', 'Holder Name', 'C/O', 'Nationality', 'Profession', 'Visa No', 'Price', 'Approval Exp', 'PRO Exp', 'Govt Expenses', 'Commission Exp', 'G Balance', 'Received', 'Balance', 'Actions'].map(h => {
                            const alignClass = ['Price', 'Approval Exp', 'PRO Exp', 'Govt Expenses', 'Commission Exp', 'G Balance', 'Received', 'Balance', 'Actions'].includes(h) ? 'text-right' : 'text-left';
                            
                            let widthClass = '';
                            if (h === 'Holder Name') {
                                widthClass = 'w-96';
                            } else if (h === 'C/O' || h === 'Profession') {
                                widthClass = 'w-44';
                            } else if (['Price', 'Approval Exp', 'PRO Exp', 'Govt Expenses', 'Commission Exp', 'G Balance', 'Received', 'Balance'].includes(h)) {
                                widthClass = 'w-32';
                            } else if (h === 'Visa No' || h === 'Actions' || h === 'Nationality') {
                                widthClass = 'w-24';
                            } else if (h === 'Date') {
                                widthClass = 'w-24';
                            } else if (h === 'S.No') {
                                widthClass = 'w-12';
                            }


                            return (
                                <th key={h} className={`p-0 font-semibold ${alignClass} ${widthClass}`}>
                                    <div className="dark:bg-slate-900 bg-gray-200 px-3 py-2 rounded-md border dark:border-slate-700/50">{h}</div>
                                </th>
                            )
                        })}
                    </tr>
                </thead>
                <tbody>
                    {pnlList.map((entry, i) => {
                        const govtExpenses = (entry.govtExpenses || 0) + (entry.medicalExp || 0) + (entry.visaLcExp || 0) + (entry.issueRpExp || 0);
                        const totalExp = (entry.approvalExp || 0) + (entry.proExp || 0) + govtExpenses + (entry.commissionExp || 0);
                        const gBalance = (entry.price || 0) - totalExp;
                        const balance = (entry.price || 0) - (entry.received || 0);
                        const isTicked = tickedEntries.has(entry.id);
                        const cellClassName = `p-2 ${isTicked ? 'dark:bg-green-800/40 bg-green-100' : 'dark:bg-gray-800/50 bg-gray-50'}`;


                        return (
                            <tr key={entry.id} className="group/row">
                                <td className={`${cellClassName} rounded-l-md text-center`}>
                                    <input
                                        type="checkbox"
                                        checked={isTicked}
                                        onChange={() => onToggleTick(entry.id)}
                                        className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                    />
                                </td>
                                <td className={cellClassName}>{i + 1}</td>
                                <td className={cellClassName}>{formatDate(entry.date)}</td>
                                <td className={`${cellClassName} font-semibold`}>{entry.holderName}</td>
                                <td className={cellClassName}>{entry.careOff}</td>
                                <td className={cellClassName}>{entry.nationality}</td>
                                <td className={cellClassName}>{entry.profession}</td>
                                <td className={cellClassName}>{entry.visaNo}</td>
                                <td className={`${cellClassName} text-right text-blue-400`}>{formatAmount(entry.price)}</td>
                                <td className={`${cellClassName} text-right text-red-400`}>{formatAmount(entry.approvalExp)}</td>
                                <td className={`${cellClassName} text-right text-red-400`}>{formatAmount(entry.proExp)}</td>
                                <td className={`${cellClassName} text-right text-red-400`}>{formatAmount(govtExpenses)}</td>
                                <td className={`${cellClassName} text-right text-red-400`}>{formatAmount(entry.commissionExp)}</td>
                                <td className={`${cellClassName} text-right font-bold ${gBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatAmount(gBalance)}</td>
                                <td className={`${cellClassName} text-right`}>{formatAmount(entry.received)}</td>
                                <td className={`${cellClassName} text-right font-bold ${balance >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatAmount(balance)}</td>
                                <td className={`${cellClassName} rounded-r-md text-right`}>
                                    <div className="opacity-0 group-hover/row:opacity-100 flex items-center justify-end space-x-1">
                                        <button onClick={() => { 
                                            const govtExpenses = (entry.govtExpenses || 0) + (entry.medicalExp || 0) + (entry.visaLcExp || 0) + (entry.issueRpExp || 0);
                                            setEditingPnlEntry({...entry, govtExpenses}); 
                                            setShowPnlModal(true); 
                                        }} className="p-1.5 hover:text-cyan-400"><Edit size={14} /></button>
                                        <button onClick={() => onPnlDeleteRequest(entry)} className="p-1.5 hover:text-red-400"><Trash2 size={14} /></button>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
                <tfoot className="font-bold">
                    <tr>
                        <td colSpan="8" className="p-2 text-right dark:bg-slate-900 bg-gray-200 rounded-l-md">Total</td>
                        <td className="p-2 text-right dark:bg-slate-900 bg-gray-200 text-blue-400">{formatAmount(totals.price)}</td>
                        <td className="p-2 text-right dark:bg-slate-900 bg-gray-200 text-red-400">{formatAmount(totals.approvalExp)}</td>
                        <td className="p-2 text-right dark:bg-slate-900 bg-gray-200 text-red-400">{formatAmount(totals.proExp)}</td>
                        <td className="p-2 text-right dark:bg-slate-900 bg-gray-200 text-red-400">{formatAmount(totals.govtExpenses)}</td>
                        <td className="p-2 text-right dark:bg-slate-900 bg-gray-200 text-red-400">{formatAmount(totals.commissionExp)}</td>
                        <td className={`p-2 text-right font-bold dark:bg-slate-900 bg-gray-200 ${totals.gBalance >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatAmount(totals.gBalance)}</td>
                        <td className="p-2 text-right dark:bg-slate-900 bg-gray-200">{formatAmount(totals.received)}</td>
                        <td className={`p-2 text-right font-bold dark:bg-slate-900 bg-gray-200 ${totals.balance >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatAmount(totals.balance)}</td>
                        <td className="dark:bg-slate-900 bg-gray-200 rounded-r-md"></td>
                    </tr>
                </tfoot>
            </table>
            {pnlList.length === 0 && <div className="text-center py-8 text-gray-500">No P&L entries yet.</div>}
        </div>
    );

    const VisaTable = ({ visaList, tickedEntries, onToggleTick, onToggleAllTicks }) => (
        <div className="overflow-x-auto mt-6">
            <table className="w-full text-sm table-fixed">
                <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase">
                    <tr>
                        <th className="p-0 font-semibold w-12">
                            <div className="dark:bg-slate-900 bg-gray-200 px-3 py-2 rounded-md border dark:border-slate-700/50 flex justify-center items-center">
                                <input
                                    type="checkbox"
                                    onChange={onToggleAllTicks}
                                    checked={visaList.length > 0 && visaList.every(v => tickedEntries.has(v.id))}
                                    className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                />
                            </div>
                        </th>
                        {/* Changed 'Date' to 'Applied Date' and 'Expiry Date' to 'RP Issued Date' */}
                        {['S.No', 'Applied Date', 'RP Issued Date', 'VP Number', 'Company', 'Gender', 'Nationality', 'Profession', 'Visa Number', 'Holder Name', 'Status', 'Notes', 'Actions'].map(h => {
                            const alignClass = h === 'Actions' ? 'text-right' : 'text-left';
                            let widthClass = '';
                            if (h === 'S.No') widthClass = 'w-12';
                            // Adjusted widths slightly to accommodate longer header names
                            else if (h === 'Applied Date' || h === 'RP Issued Date' || h === 'VP Number' || h === 'Nationality' || h === 'Visa Number') widthClass = 'w-28'; // Increased width
                            else if (h === 'Company' || h === 'Notes') widthClass = 'w-48';
                            else if (h === 'Gender') widthClass = 'w-20';
                            else if (h === 'Profession') widthClass = 'w-32';
                            else if (h === 'Holder Name') widthClass = 'w-80';
                            else if (h === 'Status') widthClass = 'w-28';
                            else if (h === 'Actions') widthClass = 'w-20';

                            return (
                                <th key={h} className={`p-0 font-semibold ${alignClass} ${widthClass}`}>
                                    <div className="dark:bg-slate-900 bg-gray-200 px-3 py-2 rounded-md border dark:border-slate-700/50">{h}</div>
                                </th>
                            )
                        })}
                    </tr>
                </thead>
                <tbody>
                    {visaList.map((v, i) => {
                        const isTicked = tickedEntries.has(v.id);
                        let rowClass = 'group/row border-b dark:border-gray-700 border-gray-200 transition-colors';
                        let companyClass = 'font-semibold';
                        const expired = isDateExpired(v.expiryDate); // Keep using expiryDate for logic if needed, but display RP Issued Date

                        if (isTicked) {
                            rowClass += ' dark:bg-green-800/40 bg-green-100';
                        } else if (v.company === 'Mohamed Al Marri Trading') {
                            rowClass += ' dark:bg-cyan-900/20 bg-cyan-50/50';
                            companyClass += ' text-cyan-400';
                        } else if (v.company === 'Fathoom Transportation') {
                            rowClass += ' dark:bg-blue-900/20 bg-blue-50/50';
                            companyClass += ' text-blue-400';
                        }

                        return (
                            <tr key={v.id} className={rowClass}>
                                <td className="p-2 text-center">
                                    <input
                                        type="checkbox"
                                        checked={isTicked}
                                        onChange={() => onToggleTick(v.id)}
                                        className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                    />
                                </td>
                                <td className="p-2 truncate">{i + 1}</td>
                                <td className="p-2 truncate">{formatDate(v.date)}</td> {/* Display Applied Date */}
                                <td className={`p-2 truncate ${expired ? 'text-red-400 font-bold' : ''}`}>{formatDate(v.expiryDate)}</td> {/* Display RP Issued Date */}
                                <td className="p-2 truncate">{v.vpNumber}</td>
                                <td className={`p-2 truncate ${companyClass}`}>{v.company}</td>
                                <td className="p-2 truncate">{v.gender}</td>
                                <td className="p-2 truncate">{v.nationality}</td>
                                <td className="p-2 truncate">{v.profession}</td>
                                <td className="p-2 truncate">{v.visaNumber}</td>
                                <td className="p-2 font-semibold truncate">{v.name}</td>
                                <td className="p-2 text-left">{getStatusBadge(v.status)}</td>
                                <td className="p-2 truncate">{v.notes}</td>
                                <td className="p-2 text-right">
                                    <div className="opacity-0 group-hover/row:opacity-100 flex items-center justify-end space-x-1">
                                        <button onClick={() => { setEditingEntry(v); setShowModal(true); }} className="p-1.5 hover:text-cyan-400"><Edit size={14} /></button>
                                        <button onClick={() => onDeleteRequest(v)} className="p-1.5 hover:text-red-400"><Trash2 size={14} /></button>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            {visaList.length === 0 && <div className="text-center py-8 text-gray-500">No entries in this section.</div>}
        </div>
    );

    return (
        <div className="p-4 sm:p-8">
            <section className="dark:bg-gray-800 bg-white p-4 sm:p-6 rounded-lg border-l-4 border-sky-500">
                <div className="flex justify-between items-center mt-6 pb-4 border-b-2 dark:border-gray-700 mb-6 flex-wrap gap-4">
                    <nav className="flex items-center flex-wrap gap-2">
                        <button 
                            onClick={() => setActiveView('new')}
                            className={`py-2 px-4 text-sm font-semibold rounded-full transition-colors ${activeView === 'new' ? 'bg-cyan-600 text-white' : 'dark:bg-gray-700 bg-gray-200 dark:hover:bg-gray-600 hover:bg-gray-300 dark:text-gray-300 text-gray-600'}`}
                        >
                            New Visas ({newVisas.length})
                        </button>
                        <button 
                            onClick={() => setActiveView('processing')}
                            className={`py-2 px-4 text-sm font-semibold rounded-full transition-colors ${activeView === 'processing' ? 'bg-cyan-600 text-white' : 'dark:bg-gray-700 bg-gray-200 dark:hover:bg-gray-600 hover:bg-gray-300 dark:text-gray-300 text-gray-600'}`}
                        >
                            Under Process ({underProcessVisas.length})
                        </button>
                        <button 
                            onClick={() => setActiveView('issued')}
                            className={`py-2 px-4 text-sm font-semibold rounded-full transition-colors ${activeView === 'issued' ? 'bg-cyan-600 text-white' : 'dark:bg-gray-700 bg-gray-200 dark:hover:bg-gray-600 hover:bg-gray-300 dark:text-gray-300 text-gray-600'}`}
                        >
                            RP Issued ({rpIssuedVisas.length})
                        </button>
                        <button 
                            onClick={() => setActiveView('others')}
                            className={`py-2 px-4 text-sm font-semibold rounded-full transition-colors ${activeView === 'others' ? 'bg-cyan-600 text-white' : 'dark:bg-gray-700 bg-gray-200 dark:hover:bg-gray-600 hover:bg-gray-300 dark:text-gray-300 text-gray-600'}`}
                        >
                            Others ({otherVisas.length})
                        </button>
                        <button 
                            onClick={() => setActiveView('pnl')}
                            className={`py-2 px-4 text-sm font-semibold rounded-full transition-colors ${activeView === 'pnl' ? 'bg-cyan-600 text-white' : 'dark:bg-gray-700 bg-gray-200 dark:hover:bg-gray-600 hover:bg-gray-300 dark:text-gray-300 text-gray-600'}`}
                        >
                            P&L ({pnlEntries.length})
                        </button>
                    </nav>
                    <div className="flex items-center space-x-2 flex-wrap gap-2 no-print">
                        {activeView === 'pnl' && tickedPnlEntries.size > 0 && (
                            <button onClick={handleClearPnlTicks} className="flex items-center space-x-2 p-2.5 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors text-sm">
                                <X size={16}/>
                                <span>Clear ({tickedPnlEntries.size})</span>
                            </button>
                        )}
                        {activeView !== 'pnl' && tickedEntries.size > 0 && (
                            <button onClick={handleClearTicks} className="flex items-center space-x-2 p-2.5 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors text-sm">
                                <X size={16}/>
                                <span>Clear ({tickedEntries.size})</span>
                            </button>
                        )}
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md pl-8 border dark:border-gray-600 border-gray-300"
                            />
                            <Search size={18} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                        </div>
                        <label className="font-semibold text-sm">View:</label>
                        <div className="flex items-center space-x-1 bg-gray-700 p-1 rounded-lg">
                            <button onClick={() => setView('all')} className={`px-3 py-1 text-xs rounded-md ${view === 'all' ? 'bg-cyan-600 text-white' : 'text-gray-300'}`}>All Time</button>
                            <button onClick={() => setView('yearly')} className={`px-3 py-1 text-xs rounded-md ${view === 'yearly' ? 'bg-cyan-600 text-white' : 'text-gray-300'}`}>Yearly</button>
                            <button onClick={() => setView('monthly')} className={`px-3 py-1 text-xs rounded-md ${view === 'monthly' ? 'bg-cyan-600 text-white' : 'text-gray-300'}`}>Monthly</button>
                        </div>
                        {(view === 'yearly' || view === 'monthly') && (
                            <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} className="p-2 bg-gray-700 rounded-md text-sm">
                                {years.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                        )}
                        {view === 'monthly' && (
                            <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))} className="p-2 bg-gray-700 rounded-md text-sm">
                                {months.map((m, i) => <option key={m} value={i}>{m}</option>)}
                            </select>
                        )}
                        {/* Excel Export Button */}
                        <button 
                            onClick={handleExportExcel} 
                            disabled={isExportingExcel || isImporting} 
                            title="Export to Excel" 
                            className="group flex items-center space-x-2 px-4 py-2 dark:bg-green-700 bg-green-100 rounded-full dark:hover:bg-green-600 hover:bg-green-200 text-sm font-semibold transition-all duration-300 disabled:opacity-50 border dark:border-green-600 border-green-300 dark:text-white text-green-700 shadow-md hover:shadow-lg hover:scale-105"
                        >
                            {isExportingExcel ? <Loader2 size={16} className="animate-spin" /> : <FileCheck2 size={16}/>}
                            <span>{isExportingExcel ? 'Exporting...' : 'Export Excel'}</span>
                        </button>
                        {/* Excel Import Button */}
                        <input
                            ref={importFileInputRef}
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={handleImportExcel}
                            className="hidden"
                        />
                        <button 
                            onClick={() => importFileInputRef.current?.click()} 
                            disabled={isImporting || isExportingExcel} 
                            title="Import from Excel" 
                            className="group flex items-center space-x-2 px-4 py-2 dark:bg-blue-700 bg-blue-100 rounded-full dark:hover:bg-blue-600 hover:bg-blue-200 text-sm font-semibold transition-all duration-300 disabled:opacity-50 border dark:border-blue-600 border-blue-300 dark:text-white text-blue-700 shadow-md hover:shadow-lg hover:scale-105"
                        >
                            {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16}/>}
                            <span>{isImporting ? 'Importing...' : 'Import Excel'}</span>
                        </button>
                        {activeView !== 'pnl' ? (
                            <button onClick={() => { setEditingEntry(null); setShowModal(true); }} className="p-2 bg-cyan-500 rounded-full hover:bg-cyan-600 transition-colors" title="Add Visa Entry">
                                <PlusCircle size={20}/>
                            </button>
                        ) : (
                            <button onClick={() => { setEditingPnlEntry(null); setShowPnlModal(true); }} className="p-2 bg-cyan-500 rounded-full hover:bg-cyan-600 transition-colors" title="Add Visa P&L Entry">
                                <PlusCircle size={20}/>
                            </button>
                        )}
                    </div>
                </div>
                
                {activeView === 'new' && <VisaTable visaList={newVisas} tickedEntries={tickedEntries} onToggleTick={handleToggleTick} onToggleAllTicks={() => handleToggleAllTicks(newVisas)} />}
                {activeView === 'processing' && <VisaTable visaList={underProcessVisas} tickedEntries={tickedEntries} onToggleTick={handleToggleTick} onToggleAllTicks={() => handleToggleAllTicks(underProcessVisas)} />}
                {activeView === 'issued' && <VisaTable visaList={rpIssuedVisas} tickedEntries={tickedEntries} onToggleTick={handleToggleTick} onToggleAllTicks={() => handleToggleAllTicks(rpIssuedVisas)} />}
                {activeView === 'others' && <VisaTable visaList={otherVisas} tickedEntries={tickedEntries} onToggleTick={handleToggleTick} onToggleAllTicks={() => handleToggleAllTicks(otherVisas)} />}
                {activeView === 'pnl' && <VisaPnlTable pnlList={filteredPnlEntries} totals={pnlTotals} tickedEntries={tickedPnlEntries} onToggleTick={handleTogglePnlTick} onToggleAllTicks={() => handleToggleAllPnlTicks(filteredPnlEntries)} />}

            </section>
            <GenericAddEditModal isOpen={showModal} onSave={handleSave} onClose={() => setShowModal(false)} initialData={editingEntry} formFields={visaFormFields} title="Visa Entry"/>
            <GenericAddEditModal isOpen={showPnlModal} onSave={handlePnlSave} onClose={() => setShowPnlModal(false)} initialData={editingPnlEntry} formFields={visaPnlFormFields} title="Visa P&L Entry"/>
        </div>
    );
};

const StatementEditor = ({ initialStatement, clients, currency, companyDetails, onCompanyDetailsSave, onSave, onCancel, onDelete }) => {
    const [formData, setFormData] = useState(null);
    const [isPrintableMode, setIsPrintableMode] = useState(false);
    const printableRef = useRef(null);

    useEffect(() => {
        if (initialStatement) {
            setFormData({
                ...initialStatement,
                date: formatDate(initialStatement.date),
                closingName: initialStatement.closingName || companyDetails.name,
                invoiceItems: initialStatement.invoiceItems.map(item => ({...item, date: formatDate(item.date)})),
                notes: initialStatement.notes || '', // Ensure notes are initialized
            });
        }
    }, [initialStatement, companyDetails.name]);

    const handleFieldChange = (field, value) => {
        let processedValue = value;
        // Capitalize fields that are typically proper nouns or headings
        if (['to', 'subject', 'closingName', 'greeting'].includes(field)) {
            processedValue = capitalizeWords(value);
        }
        setFormData(prev => ({...prev, [field]: processedValue}));
    };
    const handleItemChange = (index, field, value) => {
        const newItems = [...formData.invoiceItems];
        let processedValue = value;
        if (field === 'description') {
            processedValue = capitalizeWords(value);
        }
        newItems[index][field] = processedValue;
        setFormData(prev => ({...prev, invoiceItems: newItems}));
    };
    const addItem = () => setFormData(prev => ({...prev, invoiceItems: [...prev.invoiceItems, { date: formatDate(new Date()), description: '', invoiceNo: '', debit: 0, credit: 0 }]}));
    const removeItem = (index) => setFormData(prev => ({...prev, invoiceItems: prev.invoiceItems.filter((_, i) => i !== index)}));

    const { totalDebit, totalCredit, balanceDue } = useMemo(() => {
        if (!formData) return { totalDebit: 0, totalCredit: 0, balanceDue: 0 };
        const totals = formData.invoiceItems.reduce((acc, item) => {
            acc.totalDebit += parseFloat(item.debit) || 0;
            acc.totalCredit += parseFloat(item.credit) || 0;
            return acc;
        }, { totalDebit: 0, totalCredit: 0 });
        return { ...totals, balanceDue: totals.totalDebit - totals.totalCredit };
    }, [formData]);

    const handleSaveClick = () => {
        if (!formData) return;
        const dataToSave = {
            ...formData,
            date: parseDateForFirestore(formData.date),
            notes: formData.notes || '', // Ensure notes are saved
            invoiceItems: formData.invoiceItems.map(item => ({
                ...item,
                date: parseDateForFirestore(item.date),
                debit: parseFloat(item.debit) || 0,
                credit: parseFloat(item.credit) || 0,
            })),
        };
        onSave(dataToSave);
    };

    const generatePdf = async (element) => {
        const { jsPDF } = window.jspdf;
        if (!element) return;
    
        const replacements = [];
        element.querySelectorAll('input[type="text"], input[type="number"], textarea').forEach(input => {
            const div = document.createElement('div');
            const computedStyle = window.getComputedStyle(input);
            div.innerText = input.value;
            div.style.width = computedStyle.width;
            div.style.height = computedStyle.height;
            div.style.padding = computedStyle.padding;
            div.style.border = computedStyle.border;
            div.style.borderRadius = computedStyle.borderRadius;
            div.style.font = computedStyle.font;
            div.style.lineHeight = computedStyle.lineHeight;
            div.style.textAlign = computedStyle.textAlign;
            div.style.color = 'inherit';
            div.style.backgroundColor = 'transparent';
            div.style.boxSizing = 'border-box';
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            if(computedStyle.textAlign === 'right') div.style.justifyContent = 'flex-end';
            if(computedStyle.textAlign === 'center') div.style.justifyContent = 'center';
            if (input.tagName === 'TEXTAREA') {
                div.style.whiteSpace = 'pre-wrap';
                div.style.alignItems = 'flex-start';
            }
            input.style.display = 'none';
            input.after(div);
            replacements.push({ original: input, replacement: div });
        });
        element.querySelectorAll('.date-input-print-style').forEach(container => {
            const day = container.querySelector('input[placeholder="dd"]')?.value || '';
            const month = container.querySelector('input[placeholder="mm"]')?.value || '';
            const year = container.querySelector('input[placeholder="yyyy"]')?.value || '';
            const fullDate = `${day}/${month}/${year}`;
            const div = document.createElement('div');
            const computedStyle = window.getComputedStyle(container);
            div.textContent = fullDate;
            div.style.width = computedStyle.width;
            div.style.height = computedStyle.height;
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.justifyContent = 'center';
            div.style.font = computedStyle.font;
            container.style.display = 'none';
            container.after(div);
            replacements.push({ original: container, replacement: div });
        });
    
        element.classList.add('force-light-text');
        try {
            const pdf = new jsPDF('p', 'mm', 'a4');
            const canvas = await window.html2canvas(element, { scale: 2, backgroundColor: '#ffffff', logging: false });
            const imgData = canvas.toDataURL('image/png');
            const imgProps = pdf.getImageProperties(imgData);
            const pdfPageWidth = pdf.internal.pageSize.getWidth();
            const pdfPageHeight = (imgProps.height * pdfPageWidth) / imgProps.width;
            pdf.addImage(imgData, 'PNG', 0, 0, pdfPageWidth, pdfPageHeight);
            pdf.save(`statement_${formData.to.replace(/ /g, '_')}_${formData.date.replace(/\//g, '-')}.pdf`);
        } catch(error) {
            console.error("Error generating PDF:", error);
        } finally {
            element.classList.remove('force-light-text');
            replacements.forEach(({ original, replacement }) => {
                original.style.display = '';
                replacement.remove();
            });
        }
    };
    
    const handlePrint = async () => {
        if (!isPrintableMode) {
            setIsPrintableMode(true);
            setTimeout(() => {
                generatePdf(printableRef.current);
            }, 100);
        } else {
            generatePdf(printableRef.current);
        }
    };
    
    if (!formData) return <div className="p-8 text-center"><Loader2 className="animate-spin inline-block"/></div>;

    return (
        <div className="p-4 sm:p-8">
            <div className="flex justify-between items-center mb-4 no-print flex-wrap gap-2">
                <button onClick={onCancel} className="px-4 py-2 dark:bg-gray-700 bg-gray-200 rounded-full text-sm dark:hover:bg-gray-800 hover:bg-gray-300 transition-all duration-300 dark:text-white text-gray-700 shadow-md hover:shadow-lg hover:scale-105">&larr; Back to List</button>
                <div className="flex items-center space-x-2 flex-wrap gap-2">
                    <button onClick={() => setIsPrintableMode(prev => !prev)} className="px-4 py-2 dark:bg-gray-700 bg-gray-200 rounded-full text-sm dark:hover:bg-gray-800 hover:bg-gray-300 transition-all duration-300 dark:text-white text-gray-700 shadow-md hover:shadow-lg hover:scale-105">{isPrintableMode ? 'Editor View' : 'Printable View'}</button>
                    <button onClick={handlePrint} className="px-4 py-2 dark:bg-blue-700 bg-blue-100 rounded-full text-sm dark:hover:bg-blue-600 hover:bg-blue-200 transition-all duration-300 border dark:border-blue-600 border-blue-300 dark:text-white text-blue-700 shadow-md hover:shadow-lg hover:scale-105 font-semibold">Print/Download</button>
                    <button onClick={handleSaveClick} className="px-4 py-2 dark:bg-cyan-700 bg-cyan-100 rounded-full text-sm dark:hover:bg-cyan-600 hover:bg-cyan-200 transition-all duration-300 border dark:border-cyan-600 border-cyan-300 dark:text-white text-cyan-700 shadow-md hover:shadow-lg hover:scale-105 font-semibold">Save</button>
                    {!initialStatement.isNew && (
                         <button onClick={() => onDelete(initialStatement.id)} className="p-2.5 dark:bg-red-700 bg-red-100 rounded-full dark:hover:bg-red-600 hover:bg-red-200 transition-all duration-300 border dark:border-red-600 border-red-300 dark:text-white text-red-700 shadow-md hover:shadow-lg hover:scale-105"><Trash2 size={16}/></button>
                    )}
                </div>
            </div>

            {isPrintableMode ? (
                <div ref={printableRef} className="max-w-6xl mx-auto dark:bg-gray-900 bg-white p-8 rounded-lg shadow-2xl dark:text-white text-gray-800 font-serif">
                    <header className="flex justify-between items-start pb-4 border-b border-gray-700">
                        <div>
                            <EditableHeader as="h1" initialValue={companyDetails.name} onSave={(name) => onCompanyDetailsSave({...companyDetails, name})} className="text-3xl font-bold text-cyan-400" />
                            <EditableTextArea initialValue={companyDetails.address} onSave={(address) => onCompanyDetailsSave({...companyDetails, address})} className="text-gray-400" placeholder="Click to edit company address"/>
                        </div>
                        <h2 className="text-4xl font-thin text-gray-500 tracking-widest uppercase text-right">Statement</h2>
                    </header>
                    <section className="grid grid-cols-2 gap-8 mt-8">
                        <div>
                            <p className="text-gray-500 font-bold mb-2">TO:</p>
                            <input list="clients-datalist" value={formData.to} onChange={e => handleFieldChange('to', e.target.value)} className="w-full p-2 bg-gray-800 border border-gray-700 rounded-md" placeholder="Type or select client..."/>
                            <datalist id="clients-datalist">{clients.map(c => <option key={c} value={c} />)}</datalist>
                             <textarea value={formData.clientAddress} onChange={e => handleFieldChange('clientAddress', e.target.value)} className="w-full p-2 mt-2 bg-gray-800 border border-gray-700 rounded-md" rows="2" placeholder="Client Address..."/>
                        </div>
                        <div className="text-right flex flex-col items-end">
                            <p className="text-gray-500 font-bold mb-2">DATE:</p><DateInput value={formData.date} onChange={val => handleFieldChange('date', val)} />
                        </div>
                    </section>
                    <section className="mt-8"><p className="text-gray-500 font-bold mb-2">SUBJECT:</p><input type="text" value={formData.subject} onChange={e => handleFieldChange('subject', e.target.value)} className="w-full p-2 bg-gray-800 border border-gray-700 rounded-md text-lg font-semibold"/></section>
                    <section className="mt-8"><textarea value={formData.greeting} onChange={e => handleFieldChange('greeting', e.target.value)} rows="1" className="w-full p-2 bg-gray-800 border border-gray-700 rounded-md"/><textarea value={formData.body} onChange={e => handleFieldChange('body', e.target.value)} rows="2" className="w-full p-2 mt-2 bg-gray-800 border border-gray-700 rounded-md"/></section>
                    {/* Reusing full table from original code */}
                    <section className="mt-4"><table className="w-full"><thead className="border-b-2 border-t-2 border-gray-600"><tr><th className="p-3 text-left font-semibold w-1/4">Invoice Date</th><th className="p-3 text-left font-semibold">Description</th><th className="p-3 text-left font-semibold">Invoice #</th><th className="p-3 text-right font-semibold">Debit ({currency})</th><th className="p-3 text-right font-semibold">Credit ({currency})</th><th className="w-10 no-print"></th></tr></thead><tbody>{formData.invoiceItems.map((item, index) => (<tr key={index} className="border-b border-gray-800"><td className="px-3 py-2"><DateInput value={item.date} onChange={val => handleItemChange(index, 'date', val)} /></td><td className="px-3 py-2"><input type="text" value={item.description} onChange={e => handleItemChange(index, 'description', e.target.value)} className="w-full p-2 bg-gray-800 rounded-md"/></td><td className="px-3 py-2"><input type="text" value={item.invoiceNo} onChange={e => handleItemChange(index, 'invoiceNo', e.target.value)} className="w-full p-2 bg-gray-800 rounded-md"/></td><td className="px-3 py-2"><input type="number" value={item.debit} onChange={e => handleItemChange(index, 'debit', e.target.value)} className="w-full p-2 bg-gray-800 rounded-md text-right"/></td><td className="px-3 py-2"><input type="number" value={item.credit} onChange={e => handleItemChange(index, 'credit', e.target.value)} className="w-full p-2 bg-gray-800 rounded-md text-right"/></td><td className="no-print px-3 py-2"><button onClick={() => removeItem(index)} className="p-1 text-red-500"><Trash2 size={16}/></button></td></tr>))}</tbody><tfoot><tr className="border-t-2 border-gray-600 font-bold"><td colSpan="3" className="p-3 text-right">Totals</td><td className="p-3 text-right">{formatCurrency(totalDebit, currency)}</td><td className="p-3 text-right">{formatCurrency(totalCredit, currency)}</td><td className="no-print"></td></tr></tfoot></table><button onClick={addItem} className="mt-2 px-3 py-1 bg-gray-700 rounded-md text-xs no-print">+ Add Item</button></section>
                    <section className="mt-8 p-4 bg-gray-800 rounded-lg"><h3 className="font-bold text-lg mb-2 text-cyan-400">Account Summary</h3><div className="flex justify-between"><p>Total Amount Invoiced:</p><p>{formatCurrency(totalDebit, currency)}</p></div><div className="flex justify-between"><p>Total Amount Paid:</p><p>{formatCurrency(totalCredit, currency)}</p></div><div className="flex justify-between font-bold text-lg border-t border-gray-600 mt-2 pt-2"><p>Balance Due:</p><p>{formatCurrency(balanceDue, currency)}</p></div></section>
                    <section className="mt-8"><h4 className="font-bold mb-2">Payment Terms:</h4><textarea value={formData.paymentTerms} onChange={e => handleFieldChange('paymentTerms', e.target.value)} className="w-full p-2 bg-transparent border-b border-gray-700 focus:outline-none focus:ring-0 focus:border-cyan-500" rows="3"/></section>
                    {/* --- ADDED NOTES SECTION FOR PRINTABLE VIEW --- */}
                    <section className="mt-8">
                        <h4 className="font-bold mb-2">Notes:</h4>
                        <textarea 
                            value={formData.notes} 
                            onChange={e => handleFieldChange('notes', e.target.value)} 
                            className="w-full p-2 bg-transparent border-b border-gray-700 focus:outline-none focus:ring-0 focus:border-cyan-500" 
                            rows="4"
                            placeholder="Add any notes here..."
                        />
                    </section>
                    {/* --- END OF ADDED SECTION --- */}
                    <footer className="mt-12 pt-8 border-t border-gray-700 flex justify-between items-end"><div className="text-left text-gray-400"><p className="font-bold">Sincerely,</p><p className="mt-2">The Accounts Department</p><input type="text" value={formData.closingName || ''} onChange={e => handleFieldChange('closingName', e.target.value)} className="font-bold text-cyan-400 bg-transparent w-full max-w-xs mt-2 p-1 focus:outline-none border-b border-gray-700 focus:border-cyan-400" placeholder="Enter Company Name"/></div><div className="text-right text-gray-500 text-xs max-w-xs"><p>Thank you for your business. Should you have any questions regarding this statement, please do not hesitate to contact us.</p></div></footer>
                </div>
            ) : (
                <div className="max-w-6xl mx-auto dark:bg-gray-800 bg-white p-8 rounded-lg shadow-lg">
                    <h2 className="text-2xl font-bold mb-1">Statement For:</h2>
                    <input list="clients-datalist" value={formData.to} onChange={e => handleFieldChange('to', e.target.value)} className="w-full p-2 dark:bg-gray-700 bg-gray-200 border dark:border-gray-600 border-gray-300 rounded-md text-xl font-semibold dark:text-white text-gray-800" placeholder="Client Name"/>
                    <datalist id="clients-datalist">{clients.map(c => <option key={c} value={c} />)}</datalist>
                    <section className="mt-8">
                        <table className="w-full text-sm">
                            <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase"><tr className="border-b dark:border-gray-700"><th className="px-4 py-3 text-left w-12">S.No</th><th className="px-4 py-3 text-left w-40">Date</th><th className="px-4 py-3 text-left">Description</th><th className="px-4 py-3 text-right w-32">Debit</th><th className="px-4 py-3 text-right w-32">Credit</th><th className="px-4 py-3 w-10"></th></tr></thead>
                            <tbody>
                                {formData.invoiceItems.map((item, index) => (
                                    <tr key={index} className="border-b dark:border-gray-700/50">
                                        <td className="px-4 py-3">{index + 1}</td><td className="px-4 py-3"><DateInput value={item.date} onChange={val => handleItemChange(index, 'date', val)} /></td>
                                        <td className="px-4 py-3"><input type="text" value={item.description} onChange={e => handleItemChange(index, 'description', e.target.value)} className="w-full p-2 dark:bg-gray-700 bg-gray-200 rounded-md border dark:border-gray-600 border-gray-300 dark:text-white text-gray-800"/></td>
                                        <td className="px-4 py-3"><input type="number" value={item.debit} onChange={e => handleItemChange(index, 'debit', e.target.value)} className="w-full p-2 dark:bg-gray-700 bg-gray-200 rounded-md text-right border dark:border-gray-600 border-gray-300 dark:text-white text-gray-800"/></td>
                                        <td className="px-4 py-3"><input type="number" value={item.credit} onChange={e => handleItemChange(index, 'credit', e.target.value)} className="w-full p-2 dark:bg-gray-700 bg-gray-200 rounded-md text-right border dark:border-gray-600 border-gray-300 dark:text-white text-gray-800"/></td>
                                        <td className="text-right px-4 py-3"><button onClick={() => removeItem(index)} className="p-1 text-red-500 hover:text-red-400"><Trash2 size={16}/></button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <button onClick={addItem} className="mt-4 flex items-center space-x-2 px-3 py-1 dark:bg-gray-700 bg-gray-200 rounded-md text-xs dark:hover:bg-gray-600 hover:bg-gray-300 no-print border dark:border-gray-600 border-gray-300 dark:text-gray-300 text-gray-700"><PlusCircle size={14}/><span>Add Item</span></button>
                    </section>
                    <section className="mt-8 p-4 dark:bg-gray-700/50 bg-gray-50 rounded-lg"><h3 className="font-bold text-lg mb-2 text-cyan-400">Account Summary</h3><div className="flex justify-between"><p>Total Debit:</p><p>{formatCurrency(totalDebit, currency)}</p></div><div className="flex justify-between"><p>Total Credit:</p><p>{formatCurrency(totalCredit, currency)}</p></div><div className="flex justify-between font-bold text-lg border-t dark:border-gray-600 border-gray-300 mt-2 pt-2"><p>Balance Due:</p><p>{formatCurrency(balanceDue, currency)}</p></div></section>
                    
                    {/* --- ADDED NOTES SECTION FOR EDITOR VIEW --- */}
                    <section className="mt-8">
                        <h3 className="font-bold text-lg mb-2 text-cyan-400">Notes</h3>
                        <textarea 
                            value={formData.notes} 
                            onChange={e => handleFieldChange('notes', e.target.value)} 
                            className="w-full p-2 dark:bg-gray-700 bg-gray-200 rounded-md border dark:border-gray-600 border-gray-300 dark:text-white text-gray-800" 
                            rows="4"
                            placeholder="Add any notes here..."
                        />
                    </section>
                    {/* --- END OF ADDED SECTION --- */}
                </div>
            )}
        </div>
    );
};

const StatementsPage = ({ userId, appId, currency, setConfirmAction }) => {
    // Helper function to handle different date formats
    const getDateFromField = (dateField) => {
        if (!dateField) return null;
        if (dateField.toDate && typeof dateField.toDate === 'function') {
            return dateField.toDate(); // Firestore Timestamp
        }
        if (dateField instanceof Date) {
            return dateField; // Regular Date
        }
        if (typeof dateField === 'string') {
            const parsed = new Date(dateField);
            return isNaN(parsed.getTime()) ? null : parsed;
        }
        return null;
    };

    const [statements, setStatements] = useState([]);
    const [clients, setClients] = useState([]);
    const [selectedStatement, setSelectedStatement] = useState(null);
    const [companyDetails, setCompanyDetails] = useState({ name: 'QATAR BUSINESS GROUP', address: 'Doha, Qatar' });
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const importFileInputRef = useRef(null);

    const statementsRef = useMemo(() => collection(db, `artifacts/${appId}/users/${userId}/statements`), [userId, appId]);
    const settingsRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/settings/app_settings`), [userId, appId]);

    useEffect(() => {
        const unsubStatements = onSnapshot(statementsRef, snapshot => {
            const sorted = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
                .sort((a,b) => {
                    const dateA = getDateFromField(a.date) || new Date(0);
                    const dateB = getDateFromField(b.date) || new Date(0);
                    return dateB - dateA;
                });
            setStatements(sorted);
        });

        const fetchClients = async () => {
            const debtsCreditsRef = collection(db, `artifacts/${appId}/users/${userId}/debts_credits`);
            const q = query(debtsCreditsRef, where('mainCategory', '==', 'Current Assets'));
            const snapshot = await getDocs(q);
            const clientNames = snapshot.docs.map(doc => doc.data().particulars);
            setClients([...new Set(clientNames)].sort());
        };
        fetchClients();

        const unsubSettings = onSnapshot(settingsRef, (doc) => {
            if (doc.exists() && doc.data().companyDetails) {
                setCompanyDetails(doc.data().companyDetails);
            }
        });
        return () => { unsubStatements(); unsubSettings(); };
    }, [statementsRef, settingsRef, userId, appId]);
    
    const createNewStatement = () => {
        setSelectedStatement({
            isNew: true,
            to: '',
            clientAddress: '',
            subject: 'Account Statement',
            date: new Date(),
            greeting: 'Dear Accounts Department,',
            body: `Please find below the statement of account.`,
            invoiceItems: [{ date: new Date(), description: '', invoiceNo: '', debit: 0, credit: 0 }],
            paymentTerms: 'As per our agreement, payment is due within 3-months of the invoice submission date.',
            closingName: companyDetails.name,
            notes: '', // Add notes field here
        });
    };

    const handleSelectStatement = (statement) => {
        setSelectedStatement({
            ...statement,
            isNew: false,
            date: statement.date?.toDate ? statement.date.toDate() : new Date(),
            clientAddress: statement.clientAddress || '',
            closingName: statement.closingName || companyDetails.name,
            notes: statement.notes || '', // Add notes field here
            invoiceItems: statement.invoiceItems.map(item => ({
                ...item,
                date: item.date?.toDate ? item.date.toDate() : new Date(),
            }))
        });
    };
    
    const handleSaveStatement = async (statementToSave) => {
        const { isNew, ...data } = statementToSave;
        if (data.id) {
            await updateDoc(doc(statementsRef, data.id), data);
        } else {
            const { id, ...saveData } = data;
            await addDoc(statementsRef, saveData);
        }
        setSelectedStatement(null);
    };

    const handleCompanyDetailsSave = async (newDetails) => {
        await setDoc(settingsRef, { companyDetails: newDetails }, { merge: true });
    };

    const handleDeleteRequest = (statementId) => {
        setConfirmAction({
            title: 'Delete Statement',
            message: 'Are you sure you want to delete this statement?',
            confirmText: 'Delete',
            type: 'delete',
            action: async () => {
                await deleteDoc(doc(statementsRef, statementId));
                setSelectedStatement(null);
            }
        });
    };

    const handleExportJson = async () => {
        setConfirmAction({
            title: 'Export Statements Data',
            message: 'This will export all statements and company details to a JSON file. Proceed?',
            confirmText: 'Export',
            type: 'save',
            action: async () => {
                setIsExporting(true);
                try {
                    const statementsSnapshot = await getDocs(statementsRef);
                    const statementsData = statementsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    
                    const settingsSnap = await getDoc(settingsRef);
                    const companyDetailsData = settingsSnap.exists() ? settingsSnap.data().companyDetails : companyDetails;

                    const dataToExport = {
                        statements: statementsData,
                        companyDetails: companyDetailsData
                    };

                    const jsonString = JSON.stringify(dataToExport, null, 2);
                    const blob = new Blob([jsonString], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `statements_backup_${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (error) {
                    console.error("Export failed:", error);
                    alert("An error occurred during export.");
                } finally {
                    setIsExporting(false);
                }
            }
        });
    };

    const handleImportJsonChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                if (!importedData || !Array.isArray(importedData.statements) || !importedData.companyDetails) {
                    throw new Error("Invalid JSON format. Expected an object with 'statements' (array) and 'companyDetails' (object).");
                }

                setConfirmAction({
                    title: 'DANGER: Import Statements Data',
                    message: 'This will DELETE ALL current statements and replace company details with data from the file. This action cannot be undone. Are you sure?',
                    confirmText: 'Yes, Delete & Import',
                    type: 'delete',
                    action: async () => {
                        setIsImporting(true);
                        try {
                            // Wipe existing statements
                            const existingDocsSnapshot = await getDocs(statementsRef);
                            const batch = writeBatch(db);
                            existingDocsSnapshot.forEach(doc => batch.delete(doc.ref));

                            // Import new statements
                            importedData.statements.forEach(item => {
                                const { id, ...data } = item;
                                const restoredData = restoreTimestamps(data);
                                const docRef = doc(db, `artifacts/${appId}/users/${userId}/statements`, id);
                                batch.set(docRef, restoredData);
                            });
                            
                            await batch.commit();

                            // Restore company details
                            await setDoc(settingsRef, { companyDetails: importedData.companyDetails }, { merge: true });
                            
                            alert('Import successful!');
                        } catch (err) {
                            console.error("Import process failed:", err);
                            alert(`Import failed: ${err.message}`);
                        } finally {
                            setIsImporting(false);
                        }
                    }
                });

            } catch (err) {
                 alert(`Error reading file: ${err.message}`);
            }
            if(importFileInputRef.current) importFileInputRef.current.value = "";
        };
        reader.readAsText(file);
    };

    const triggerImport = () => {
        importFileInputRef.current?.click();
    };

    const handleExportExcel = async () => {
        setIsExporting(true);
        try {
            const statementsData = statements.map(stmt => ({
                id: stmt.id,
                to: stmt.to,
                clientAddress: stmt.clientAddress,
                subject: stmt.subject,
                date: formatDate(stmt.date),
                greeting: stmt.greeting,
                body: stmt.body,
                invoiceItems: JSON.stringify(stmt.invoiceItems),
                paymentTerms: stmt.paymentTerms,
                closingName: stmt.closingName,
                notes: stmt.notes
            }));

            const worksheet = window.XLSX.utils.json_to_sheet(statementsData);
            const workbook = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Statements');
            window.XLSX.writeFile(workbook, `statements_export_${new Date().toISOString().split('T')[0]}.xlsx`);
        } catch (error) {
            console.error('Export failed:', error);
            alert('Failed to export statements. Check console for details.');
        } finally {
            setIsExporting(false);
        }
    };

    const handleImportExcel = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsImporting(true);
        try {
            const data = await file.arrayBuffer();
            const workbook = window.XLSX.read(data);
            const worksheet = workbook.Sheets['Statements'];
            
            if (!worksheet) {
                throw new Error('No "Statements" sheet found in the Excel file');
            }

            const jsonData = window.XLSX.utils.sheet_to_json(worksheet);
            
            setConfirmAction({
                title: 'Confirm Import',
                message: `This will import ${jsonData.length} statements. Existing statements with the same ID will be updated. Continue?`,
                confirmText: 'Import',
                type: 'import',
                action: async () => {
                    for (const row of jsonData) {
                        const statementData = {
                            to: row.to || '',
                            clientAddress: row.clientAddress || '',
                            subject: row.subject || 'Account Statement',
                            date: parseDateForFirestore(row.date) || new Date(),
                            greeting: row.greeting || '',
                            body: row.body || '',
                            invoiceItems: row.invoiceItems ? JSON.parse(row.invoiceItems) : [],
                            paymentTerms: row.paymentTerms || '',
                            closingName: row.closingName || companyDetails.name,
                            notes: row.notes || ''
                        };

                        if (row.id) {
                            await setDoc(doc(statementsRef, row.id), statementData, { merge: true });
                        } else {
                            await addDoc(statementsRef, statementData);
                        }
                    }
                    alert('Import successful!');
                }
            });
        } catch (error) {
            console.error('Import failed:', error);
            alert(`Failed to import statements: ${error.message}`);
        } finally {
            setIsImporting(false);
            e.target.value = '';
        }
    };

    return (
        <div className="flex h-[calc(100vh-70px)] dark:bg-gray-900 bg-gray-100">
            <div className="w-full max-w-xs xl:max-w-sm border-r dark:border-gray-700 border-gray-200 flex flex-col">
                <div className="p-4 border-b dark:border-gray-700 border-gray-200 flex-shrink-0">
                    <div className="flex justify-between items-center mb-2">
                        <h2 className="text-xl font-bold">Statements</h2>
                        <button onClick={createNewStatement} className="flex items-center space-x-2 px-3 py-1.5 bg-cyan-500 rounded-md hover:bg-cyan-600 text-sm">
                            <PlusCircle size={16}/>
                            <span>New</span>
                        </button>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                        <button
                            onClick={handleExportExcel}
                            disabled={isExporting}
                            className="group flex items-center space-x-2 px-4 py-2 dark:bg-green-700 bg-green-100 rounded-full dark:hover:bg-green-600 hover:bg-green-200 text-sm font-semibold transition-all duration-300 disabled:opacity-50 border dark:border-green-600 border-green-300 dark:text-white text-green-700 flex-1 shadow-md hover:shadow-lg hover:scale-105"
                            title="Export Statements to Excel"
                        >
                            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            <span>{isExporting ? 'Exporting...' : 'Export Excel'}</span>
                        </button>
                        <input
                            ref={importFileInputRef}
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={handleImportExcel}
                            className="hidden"
                        />
                        <button
                            onClick={() => importFileInputRef.current?.click()}
                            disabled={isImporting}
                            className="group flex items-center space-x-2 px-4 py-2 dark:bg-blue-700 bg-blue-100 rounded-full dark:hover:bg-blue-600 hover:bg-blue-200 text-sm font-semibold transition-all duration-300 disabled:opacity-50 border dark:border-blue-600 border-blue-300 dark:text-white text-blue-700 flex-1 shadow-md hover:shadow-lg hover:scale-105"
                            title="Import Statements from Excel"
                        >
                            {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                            <span>{isImporting ? 'Importing...' : 'Import Excel'}</span>
                        </button>
                    </div>
                </div>
                <div className="overflow-y-auto p-2">
                    {statements.length > 0 ? statements.map(stmt => (
                    <div
                        key={stmt.id}
                        onClick={() => handleSelectStatement(stmt)}
                        className={`p-3 rounded-md mb-2 cursor-pointer transition-colors ${selectedStatement?.id === stmt.id ? 'bg-cyan-500/30' : 'dark:bg-gray-800 bg-white dark:hover:bg-gray-700/70 hover:bg-gray-50'}`}
                    >
                        <p className="font-bold truncate text-cyan-400">{stmt.to}</p>
                        <p className="text-xs text-gray-400">{stmt.subject} - {formatDate(stmt.date)}</p>
                    </div>
                    )) : <p className="p-4 text-center text-gray-500">No statements saved.</p>}
                </div>

            </div>

            <div className="flex-1 overflow-y-auto">
                {selectedStatement ? (
                    <StatementEditor
                        key={selectedStatement.id || 'new-statement'}
                        initialStatement={selectedStatement}
                        clients={clients} currency={currency}
                        companyDetails={companyDetails}
                        onCompanyDetailsSave={handleCompanyDetailsSave}
                        onSave={handleSaveStatement}
                        onCancel={() => setSelectedStatement(null)}
                        onDelete={handleDeleteRequest}
                    />
                ) : (
                    <div className="flex h-full items-center justify-center text-center text-gray-500 p-8">
                        <div>
                            <FileText size={48} className="mx-auto mb-4"/>
                            <h3 className="text-xl font-semibold">Select a statement to view or edit</h3>
                            <p>Or create a new one using the button on the left.</p>
                        </div>
                    </div>
                )}
            </div>
      </div>
    );
};


// --- Passcode Settings Page Component ---
const PasscodeSettingsPage = ({ userId, appId, setConfirmAction }) => {
    const [currentPasscode, setCurrentPasscode] = useState('');
    const [newPasscode, setNewPasscode] = useState('');
    const [confirmPasscode, setConfirmPasscode] = useState('');
    const [hint, setHint] = useState('');
    const [existingHash, setExistingHash] = useState(null);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    const passcodeRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/settings/passcode`), [appId, userId]);

    useEffect(() => {
        const fetchSettings = async () => {
            setIsLoading(true);
            try {
                const docSnap = await getDoc(passcodeRef);
                if (docSnap.exists() && docSnap.data().hash) {
                    setExistingHash(docSnap.data().hash);
                    setHint(docSnap.data().hint || '');
                } else {
                    setExistingHash(null);
                    setHint('');
                }
            } catch (err) {
                console.error("Error fetching passcode settings:", err);
                setError("Could not load settings.");
            }
            setIsLoading(false);
        };
        fetchSettings();
    }, [passcodeRef]);

    const clearMessages = () => {
        setError('');
        setSuccess('');
    };

    const handleSave = async () => {
        clearMessages();
        setIsLoading(true);

        // 1. Verify current passcode if one is set
        if (existingHash) {
            if (hashPasscode(currentPasscode) !== existingHash) {
                setError('Current passcode is incorrect.');
                setIsLoading(false);
                return;
            }
        }

        let newHashToSave = existingHash;

        // 2. Validate and set new passcode if provided
        if (newPasscode) {
            if (newPasscode.length < 6) {
                setError('New passcode must be at least 6 characters long.');
                setIsLoading(false);
                return;
            }
            if (newPasscode !== confirmPasscode) {
                setError('New passcodes do not match.');
                setIsLoading(false);
                return;
            }
            newHashToSave = hashPasscode(newPasscode);
        }

        // 3. Save to Firestore
        try {
            const newHint = hint.trim();
            if (!newHashToSave && !newHint) {
                // If user is trying to save an empty passcode and empty hint, treat as removal.
                await setDoc(passcodeRef, { hash: null, hint: null });
                setSuccess('Passcode protection removed.');
                setExistingHash(null);
            } else {
                await setDoc(passcodeRef, { hash: newHashToSave, hint: newHint });
                setSuccess('Passcode settings saved successfully!');
                setExistingHash(newHashToSave);
            }
            
            // Clear password fields
            setCurrentPasscode('');
            setNewPasscode('');
            setConfirmPasscode('');
        } catch (err) {
            console.error("Error saving passcode:", err);
            setError('Failed to save settings. Please try again.');
        }

        setIsLoading(false);
    };

    const handleRemovePasscode = () => {
        clearMessages();
        if (!existingHash) {
            setError("No passcode is set to remove.");
            return;
        }

        setConfirmAction({
            title: 'Remove Passcode Protection',
            message: 'Are you sure you want to remove passcode protection? Please enter your current passcode to confirm.',
            confirmText: 'Remove Passcode',
            type: 'delete',
            customForm: (
                <input
                    type="password"
                    placeholder="Enter current passcode"
                    className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                    onChange={(e) => (setConfirmAction(prev => ({ ...prev, verificationPasscode: e.target.value })))}
                />
            ),
            action: async (details) => {
                if (!details.verificationPasscode || hashPasscode(details.verificationPasscode) !== existingHash) {
                    alert("Incorrect passcode. Removal cancelled.");
                    return;
                }
                
                try {
                    await setDoc(passcodeRef, { hash: null, hint: null });
                    setSuccess('Passcode protection removed.');
                    setExistingHash(null);
                    setHint('');
                    setCurrentPasscode('');
                    setNewPasscode('');
                    setConfirmPasscode('');
                } catch (err) {
                    console.error("Error removing passcode:", err);
                    alert("Failed to remove passcode. Please try again.");
                }
            }
        });
    };

    return (
        <div className="p-4 sm:p-8">
            <section className="dark:bg-gray-800 bg-white p-4 sm:p-6 rounded-lg border-l-4 border-cyan-500 max-w-2xl mx-auto">
                <h2 className="py-2 px-4 text-sm font-semibold border-b-2 border-cyan-400 text-cyan-400 mb-6">Passcode Settings</h2>
                
                {isLoading ? (
                    <div className="text-center"><Loader2 className="animate-spin inline-block" /> Loading...</div>
                ) : (
                    <div className="space-y-6">
                        {error && <div className="p-3 bg-red-500/20 text-red-400 rounded-md text-sm">{error}</div>}
                        {success && <div className="p-3 bg-green-500/20 text-green-400 rounded-md text-sm">{success}</div>}

                        {existingHash && (
                            <div>
                                <label className="text-xs dark:text-gray-400 text-gray-500">Current Passcode</label>
                                <input
                                    type="password"
                                    value={currentPasscode}
                                    onChange={(e) => setCurrentPasscode(e.target.value)}
                                    className="w-full p-2 dark:bg-gray-700 bg-gray-200 rounded-md border dark:border-gray-600 border-gray-300"
                                    placeholder="Enter current passcode to make changes"
                                />
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs dark:text-gray-400 text-gray-500">{existingHash ? 'New Passcode' : 'Set Passcode'}</label>
                                <input
                                    type="password"
                                    value={newPasscode}
                                    onChange={(e) => setNewPasscode(e.target.value)}
                                    className="w-full p-2 dark:bg-gray-700 bg-gray-200 rounded-md border dark:border-gray-600 border-gray-300"
                                    placeholder="Min 6 characters"
                                />
                            </div>
                            <div>
                                <label className="text-xs dark:text-gray-400 text-gray-500">Confirm Passcode</label>
                                <input
                                    type="password"
                                    value={confirmPasscode}
                                    onChange={(e) => setConfirmPasscode(e.target.value)}
                                    className="w-full p-2 dark:bg-gray-700 bg-gray-200 rounded-md border dark:border-gray-600 border-gray-300"
                                    placeholder="Confirm new passcode"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="text-xs dark:text-gray-400 text-gray-500">Passcode Hint</label>
                            <input
                                type="text"
                                value={hint}
                                onChange={(e) => setHint(e.target.value)}
                                className="w-full p-2 dark:bg-gray-700 bg-gray-200 rounded-md border dark:border-gray-600 border-gray-300"
                                placeholder="Enter a hint (optional)"
                            />
                        </div>

                        <div className="flex justify-between items-center pt-6 border-t dark:border-gray-700 border-gray-300">
                            <button
                                onClick={handleRemovePasscode}
                                disabled={!existingHash || isLoading}
                                className="px-4 py-2 bg-red-600 rounded-md text-sm hover:bg-red-700 disabled:bg-gray-600"
                            >
                                Remove Passcode
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isLoading}
                                className="px-6 py-2 bg-cyan-500 rounded-md text-sm hover:bg-cyan-600 disabled:bg-gray-600"
                            >
                                {isLoading ? <Loader2 className="animate-spin inline-block" /> : 'Save Settings'}
                            </button>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
};


// --- Main App Component ---
export default function App() {
    const [showLanding, setShowLanding] = useState(true); // Show landing page initially
    const [currentPage, setCurrentPage] = useState('notification');
    const [activeSubPage, setActiveSubPage] = useState('employees');
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [appId, setAppId] = useState('default-app-id');
    const [theme, setTheme] = useState('dark');
    const [lastAction, setLastAction] = useState(null);
    const [showUndoMessage, setShowUndoMessage] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [showSearchModal, setShowSearchModal] = useState(false);
    const [isLocked, setIsLocked] = useState(true); // Start locked
    const [passcodeSettings, setPasscodeSettings] = useState(null); // { hash: '...', hint: '...' }
    const [passcodeLoading, setPasscodeLoading] = useState(true);

    const mainContentRef = useRef(null);
    const autoLogoutTimerRef = useRef(null);

    const handleConfirm = async () => {
        if (!confirmAction?.action) return;
        try {
            await confirmAction.action();
        } catch (error) {
            console.error("Confirmed action failed:", error);
        }
        setConfirmAction(null);
    };

    useEffect(() => {
        const jspdfScript = document.createElement('script'); jspdfScript.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"; jspdfScript.async = true; document.body.appendChild(jspdfScript);
        const html2canvasScript = document.createElement('script'); html2canvasScript.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"; html2canvasScript.async = true; document.body.appendChild(html2canvasScript);
        const xlsxScript = document.createElement('script'); xlsxScript.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; xlsxScript.async = true; document.body.appendChild(xlsxScript);
        return () => { 
            if (document.body.contains(jspdfScript)) {
                document.body.removeChild(jspdfScript);
            }
            if (document.body.contains(html2canvasScript)) {
                document.body.removeChild(html2canvasScript);
            }
            if (document.body.contains(xlsxScript)) {
                document.body.removeChild(xlsxScript);
            }
        }
    }, []);

    useEffect(() => {
        if (typeof __app_id !== 'undefined') { setAppId(__app_id); }
        
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            if (currentUser) {
                setIsLocked(false); // User authenticated, no lock needed
                setPasscodeLoading(false);
                setLoading(false);
            } else {
                // No user, show landing page
                setShowLanding(true);
                setLoading(false);
                setPasscodeLoading(false);
                setIsLocked(false);
            }
        });
        return () => unsubscribe();
    }, [appId]);

    // Auto-logout timer when on landing page (5 minutes of inactivity)
    useEffect(() => {
        // Clear any existing timer
        if (autoLogoutTimerRef.current) {
            clearTimeout(autoLogoutTimerRef.current);
            autoLogoutTimerRef.current = null;
        }

        // Only set timer if user is logged in AND on landing page
        if (user && showLanding) {
            const AUTO_LOGOUT_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

            autoLogoutTimerRef.current = setTimeout(async () => {
                console.log('Auto-logout: Session expired on landing page');
                try {
                    await signOut(auth);
                    setShowLanding(true);
                } catch (error) {
                    console.error('Auto-logout error:', error);
                }
            }, AUTO_LOGOUT_DURATION);
        }

        // Cleanup timer on unmount or when dependencies change
        return () => {
            if (autoLogoutTimerRef.current) {
                clearTimeout(autoLogoutTimerRef.current);
                autoLogoutTimerRef.current = null;
            }
        };
    }, [user, showLanding]);
    
    const handleUndo = async () => {
        if (lastAction?.undo) {
            try { await lastAction.undo(); setShowUndoMessage(lastAction.message || 'Last action undone.'); setLastAction(null); setTimeout(() => setShowUndoMessage(false), 3000); } catch (error) { console.error("Undo failed:", error); setShowUndoMessage('Could not undo.'); setTimeout(() => setShowUndoMessage(false), 3000); }
        } else { setShowUndoMessage('Nothing to undo.'); setTimeout(() => setShowUndoMessage(false), 3000); }
    };

    // Simplified theme toggle (dark <-> light) and apply dark class at the document root
    const toggleTheme = () => {
        setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
    };

    useEffect(() => {
        // Tailwind's dark variant expects a parent with 'dark' class; ensure both <html> and <body> reflect theme
        const root = document.documentElement;
        const body = document.body;
        if (theme === 'dark') {
            root.classList.add('dark');
            body.classList.add('dark');
        } else {
            root.classList.remove('dark');
            body.classList.remove('dark');
        }
    }, [theme]);

    const handleDownloadReport = async () => {
        if (!window.jspdf || !window.html2canvas) { console.error("PDF libraries are not loaded yet."); return; }
        const { jsPDF } = window.jspdf; const pdf = new jsPDF('p', 'mm', 'a4'); 
        const pagesToExport = ['al_marri', 'fathoom', 'visa', 'business', 'ledger', 'finReport', 'debts_credits', 'statements', 'vision', 'notification'];
        const originalPage = currentPage;
        for (const pageId of pagesToExport) {
            await new Promise(resolve => { setCurrentPage(pageId); setTimeout(async () => { 
                const elementToPrint = mainContentRef.current;
                
                const elementsToHide = elementToPrint.querySelectorAll('.no-print');
                elementsToHide.forEach(el => el.style.visibility = 'hidden');

                const canvas = await window.html2canvas(elementToPrint, { 
                    scale: 2,
                    backgroundColor: theme === 'dark' ? '#111827' : '#ffffff' 
                });
                
                elementsToHide.forEach(el => el.style.visibility = 'visible');

                const imgData = canvas.toDataURL('image/png'); const imgProps = pdf.getImageProperties(imgData); const pdfWidth = pdf.internal.pageSize.getWidth(); const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width; if (pagesToExport.indexOf(pageId) > 0) { pdf.addPage(); } pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight); resolve(); }, 1000); });
        }
        pdf.save("financial_report.pdf"); setCurrentPage(originalPage);
    };
    
    const handlePageChange = (page) => {
        setCurrentPage(page);
        if (page === 'al_marri' || page === 'fathoom') {
            setActiveSubPage('employees');
        }
    };

    const renderPage = () => {
        if (!user) return <div className="flex justify-center items-center h-full">Authenticating...</div>;
        
        const currency = 'QAR';
        const commonProps = { 
            userId: user.uid, 
            appId, 
            setLastAction, 
            setConfirmAction, 
            theme,
            currency,
        };
        
        const isCompanyPage = ['al_marri', 'fathoom'].includes(currentPage);

        return (
            <>
                {isCompanyPage && <CompanySubNav activeSubPage={activeSubPage} setActiveSubPage={setActiveSubPage} collectionPrefix={currentPage === 'al_marri' ? 'alMarri' : 'fathoom'} pageTitle={currentPage === 'al_marri' ? 'Mohamed Al Marri Trading' : 'Fathoom Transportation'} {...commonProps} />}
                <main ref={mainContentRef}>
                    {(() => {
                        switch (currentPage) {
                            case 'al_marri': return <CompanyPageContent pageTitle="Mohamed Al Marri Trading" collectionPrefix="alMarri" activeSubPage={activeSubPage} {...commonProps} />;
                            case 'fathoom': return <CompanyPageContent pageTitle="Fathoom Transportation" collectionPrefix="fathoom" activeSubPage={activeSubPage} {...commonProps} />;
                            case 'business': return <BusinessPage {...commonProps} />;
                            case 'visa': return <VisaPage {...commonProps} />;
                            case 'ledger': return <LedgerPage {...commonProps} collectionPath="ledgerQatar" />;
            case 'finReport': return <FinancialReportsPage {...commonProps} collectionPath="ledgerQatar" />;
            case 'debts_credits': return <DebtsAndCreditsPage {...commonProps} />;
            case 'statements': return <StatementsPage {...commonProps} />;
            case 'vision': return (
                <ErrorBoundary>
                    <VisionPage userId={user.uid} appId={appId} onDownloadReport={handleDownloadReport} setConfirmAction={setConfirmAction} />
                </ErrorBoundary>
            );
            case 'notification': return <NotificationPage userId={user.uid} appId={appId} />;
            case 'passcode_settings': return <PasscodeSettingsPage {...commonProps} />;
            default: return <CompanyPageContent pageTitle="Mohamed Al Marri Trading" collectionPrefix="alMarri" activeSubPage={activeSubPage} {...commonProps} />;
                        }
                    })()}
                </main>
            </>
        );
    };

    const handleAuthSuccess = async (authData) => {
        const { email, password, displayName, mode } = authData;
        try {
            // Check if email is in the whitelist
            const whitelistRef = doc(db, 'authorized_users', 'whitelist');
            const whitelistDoc = await getDoc(whitelistRef);
            
            if (!whitelistDoc.exists()) {
                alert('Authorization system not configured. Please contact administrator.');
                return;
            }

            const authorizedEmails = whitelistDoc.data().emails || [];
            if (!authorizedEmails.includes(email.toLowerCase())) {
                alert('Access denied. Your email is not authorized. Please contact the administrator.');
                return;
            }

            // Email is authorized, proceed with authentication
            if (mode === 'signup') {
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                await updateProfile(userCredential.user, { displayName });
                console.log('Account created successfully');
            } else {
                await signInWithEmailAndPassword(auth, email, password);
                console.log('Logged in successfully');
            }
            setShowLanding(false);
        } catch (error) {
            console.error('Authentication error:', error);
            let errorMessage = 'Authentication failed';
            if (error.code === 'auth/email-already-in-use') {
                errorMessage = 'Email already in use';
            } else if (error.code === 'auth/invalid-email') {
                errorMessage = 'Invalid email address';
            } else if (error.code === 'auth/user-not-found') {
                errorMessage = 'No account found with this email';
            } else if (error.code === 'auth/wrong-password') {
                errorMessage = 'Incorrect password';
            } else if (error.code === 'auth/weak-password') {
                errorMessage = 'Password is too weak';
            }
            alert(errorMessage);
        }
    };

    const handleLogout = async () => {
        try {
            await signOut(auth);
            setShowLanding(true);
        } catch (error) {
            console.error('Logout error:', error);
        }
    };

    if (loading || passcodeLoading) { return <div className="flex justify-center items-center h-screen bg-gray-900 text-white">Loading Dashboard...</div>; }

    // Show landing page if flag is set or no user
    if (showLanding || !user) {
        return <LandingPage 
            onLoginSuccess={handleAuthSuccess} 
            user={user}
            onDashboardClick={() => setShowLanding(false)}
        />;
    }

    return (
        <div className={`${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-800'} min-h-screen font-sans transition-colors duration-300`}>
            <style>{`
                .force-light-text.force-light-text, 
                .force-light-text .text-white,
                .force-light-text .dark\\:text-white {
                    color: #1f2937 !important;
                }
                .force-light-text .text-gray-400, .force-light-text .text-gray-500 {
                    color: #4b5563 !important;
                }
                .force-light-text .text-cyan-400 {
                    color: #0891b2 !important;
                }
                .force-light-text { /* Add padding to help canvas capture footer */
                    padding-bottom: 50px !important;
                }
                .force-light-text .dark\\:bg-gray-900 {
                    background-color: #ffffff !important;
                }
                .force-light-text .bg-gray-800 {
                    background-color: #f9fafb !important;
                }
                .force-light-text .border-gray-700, .force-light-text .border-gray-600, .force-light-text .border-gray-800 {
                    border-color: #d1d5db !important;
                }
                /* Styles for printing inputs to prevent clipping */
                .force-light-text input,
                .force-light-text textarea {
                    background: transparent !important;
                    border: none !important;
                    box-shadow: none !important;
                    -webkit-print-color-adjust: exact !important;
                    color-adjust: exact !important;
                    color: inherit !important;
                    overflow: visible !important; /* Prevent text clipping */
                    line-height: 1.5 !important; /* Ensure text isn't cut off */
                    padding-top: 2px !important;
                    padding-bottom: 2px !important;
                }
                .force-light-text .date-input-print-style { 
                    background: transparent !important;
                    padding: 0 !important; /* Remove container padding for print */
                }
                .force-light-text .date-input-print-style input {
                    padding: 2px !important; /* Add some padding back to inner inputs */
                }
            `}</style>
            <Header 
                userId={user?.uid} 
                appId={appId} 
                onUndoClick={handleUndo} 
                toggleTheme={toggleTheme} 
                theme={theme}
                currentPage={currentPage}
                setCurrentPage={handlePageChange}
                onSettingsClick={() => setShowSettingsModal(true)}
                onSearchClick={() => setShowSearchModal(true)}
                onReturnToLanding={() => setShowLanding(true)}
                onLogout={handleLogout}
                userDisplayName={user?.displayName || user?.email}
            />
            {renderPage()}
            {showSettingsModal && <NavigationSettingsModal userId={user?.uid} appId={appId} onClose={() => setShowSettingsModal(false)} />}
            {showSearchModal && <UniversalSearchModal userId={user?.uid} appId={appId} onClose={() => setShowSearchModal(false)} />}
            {confirmAction && <ConfirmationModal details={confirmAction} onConfirm={handleConfirm} onCancel={() => setConfirmAction(null)} />}
            {showUndoMessage && ( <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-[101]"> {showUndoMessage} </div> )}
        </div>
    );
}

// --- Navigation Components ---
const Header = ({ userId, appId, onUndoClick, toggleTheme, theme, currentPage, setCurrentPage, onSettingsClick, onSearchClick, onReturnToLanding, onLogout, userDisplayName }) => {
    const [navLinks, setNavLinks] = useState([]);
    const settingsRef = useMemo(() => (userId && appId !== 'default-app-id') ? doc(db, `artifacts/${appId}/users/${userId}/settings/app_settings`) : null, [userId, appId]);

    useEffect(() => {
        const defaultLinks = [
            { id: 'al_marri', title: 'CO1', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 14.5a7.5 7.5 0 0 0 13 0"/><path d="M12 2a4.5 4.5 0 0 0-4.5 4.5c0 2.22 1.25 4.14 3 5.19"/><path d="M12 2a4.5 4.5 0 0 1 4.5 4.5c0 2.22-1.25 4.14-3 5.19"/><path d="M13.5 2.5c0 2.5-2 2-3 4"/></svg>, gradient: 'from-teal-500 to-cyan-500' },
            { id: 'fathoom', title: 'CO2', icon: <Truck size={16} />, gradient: 'from-blue-500 to-gray-500' },
            { id: 'visa', title: 'RCRT', icon: <IdCard size={16} />, gradient: 'from-sky-500 to-blue-500' },
            { id: 'business', title: 'BS1', icon: <Building2 size={16} />, gradient: 'from-indigo-500 to-purple-500' },
            { id: 'ledger', title: 'Ledger', icon: <BookOpen size={16} />, gradient: 'from-pink-500 to-rose-500' },
            { id: 'finReport', title: 'Financial Report', icon: <TrendingUp size={16} />, gradient: 'from-amber-500 to-orange-500' },
            { id: 'debts_credits', title: 'DB6', icon: <HandCoins size={16} />, gradient: 'from-green-500 to-red-500' },
            { id: 'statements', title: 'Statements', icon: <FileText size={16} />, gradient: 'from-purple-500 to-pink-500' },
            { id: 'vision', title: 'Vision', icon: <Target size={16} />, gradient: 'from-green-500 to-yellow-500' },
            { id: 'notification', title: 'Notification', icon: <Bell size={16} />, gradient: 'from-red-500 to-orange-500' },
        ];
        if (!settingsRef) {
            setNavLinks(defaultLinks);
            return;
        }

        const unsub = onSnapshot(settingsRef, (doc) => {
            if (doc.exists()) {
                const settings = doc.data();
                if (settings.navLinks) {
                    const updatedLinks = defaultLinks.map(link => ({
                        ...link,
                        title: settings.navLinks[link.id]?.title || link.title,
                    }));
                    setNavLinks(updatedLinks);
                } else {
                    setNavLinks(defaultLinks);
                }
            } else {
                setNavLinks(defaultLinks);
            }
        });
        return () => unsub();
    }, [settingsRef]);

    return (
        <header className="dark:bg-gray-800 bg-white dark:text-white text-gray-800 p-3 sticky top-0 z-50 shadow-md flex items-center justify-between w-full flex-wrap gap-2">
            <div className="flex items-center space-x-4 flex-1 min-w-[200px]">
                <DateTimeLocationBadge />
                <LastUpdatedBadge />
            </div>

            <nav className="flex items-center justify-center space-x-1 sm:space-x-2 flex-grow my-2 md:my-0 order-3 sm:order-2 w-full sm:w-auto">
                 {/* Restore the mapping of navLinks */}
                 {navLinks.map(page => (
                    <button
                        key={page.id}
                        onClick={() => setCurrentPage(page.id)}
                        className={`flex items-center space-x-2 px-3 py-2 text-sm sm:text-base font-bold rounded-full transition-all duration-300 transform hover:scale-105 flex-grow sm:flex-grow-0 ${
                            currentPage === page.id
                                ? `bg-gradient-to-r ${page.gradient} text-white shadow-lg`
                                : 'dark:bg-gray-700 bg-gray-200 dark:hover:bg-gray-600 hover:bg-gray-300'
                        }`}
                    >
                        {page.icon}
                        <span className="hidden sm:inline">{page.title}</span>
                    </button>
                ))}
            </nav>

            <div className="flex items-center space-x-2 flex-1 justify-end min-w-[150px] order-2 sm:order-3">
                {userDisplayName && (
                    <div className="hidden md:flex items-center space-x-2 px-3 py-1 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 rounded-lg">
                        <User size={16} className="text-cyan-400" />
                        <span className="text-sm font-medium">{userDisplayName}</span>
                    </div>
                )}
                <div className="border dark:border-gray-600 border-gray-300 rounded-xl px-2 py-1 flex items-center space-x-1">
                    <button onClick={onReturnToLanding} title="Return to Home" className="p-1.5 rounded-full dark:hover:bg-gray-700 hover:bg-gray-200 transition-colors"><Home size={18} /></button>
                    <button onClick={onSearchClick} title="Universal Search" className="p-1.5 rounded-full hover:bg-gray-700 transition-colors"><SearchCode size={18} /></button>
                    <button onClick={onSettingsClick} title="Settings" className="p-1.5 rounded-full hover:bg-gray-700 transition-colors"><Settings size={18} /></button>
                    <button onClick={onUndoClick} title="Undo" className="p-1.5 rounded-full hover:bg-gray-700 transition-colors"><Undo size={18} /></button>
                    <button onClick={toggleTheme} title="Toggle Theme" className="p-1.5 rounded-full dark:hover:bg-gray-700 hover:bg-gray-200 transition-colors">{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button>
                    <button onClick={onLogout} title="Logout" className="p-1.5 rounded-full hover:bg-red-500 hover:text-white transition-colors"><LogOut size={18} /></button>
                </div>
            </div>
        </header>
    );
};

const CompanySubNav = ({ activeSubPage, setActiveSubPage, userId, appId, collectionPrefix, pageTitle }) => {
    const [subNavLinks, setSubNavLinks] = useState([]);
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const importFileInputRef = useRef(null);
    const settingsRef = useMemo(() => (userId && appId !== 'default-app-id') ? doc(db, `artifacts/${appId}/users/${userId}/settings/app_settings`) : null, [userId, appId]);
     
    useEffect(() => {
        const defaultLinks = [
            { id: 'employees', title: 'Employees', icon: <Users size={16}/> },
            { id: 'vehicles', title: 'Vehicles', icon: <Car size={16}/> },
            { id: 'wps', title: 'WPS Status', icon: <Banknote size={16}/> },
            { id: 'bank', title: 'Bank', icon: <Building2 size={16}/> },
            { id: 'audit', title: 'Audit Reports', icon: <FileCheck2 size={16}/> },
            { id: 'credentials', title: 'Docs & Creds', icon: <KeyRound size={16}/> },
            { id: 'cheques', title: 'Cheques', icon: <FileCheck2 size={16}/> },
            { id: 'others', title: 'Others', icon: <MoreHorizontal size={16}/> },
        ];
        if (!settingsRef) {
            setSubNavLinks(defaultLinks);
            return;
        };
        const unsub = onSnapshot(settingsRef, (doc) => {
            if (doc.exists() && doc.data().subNavLinks) {
                const settings = doc.data().subNavLinks;
                const updatedLinks = defaultLinks.map(link => ({
                    ...link,
                    title: settings[link.id]?.title || link.title,
                }));
                setSubNavLinks(updatedLinks);
            } else {
                setSubNavLinks(defaultLinks);
            }
        });
        return () => unsub();
    }, [settingsRef]);

    const handleExportExcel = async () => {
        setIsExporting(true);
        try {
        const collections = [
            { name: 'Employees', path: `${collectionPrefix}Data` },
            { name: 'Vehicles', path: `${collectionPrefix}Vehicles` },
            { name: 'WPS', path: `${collectionPrefix}Wps` },
            { name: 'Bank', path: `${collectionPrefix}Bank` },
            { name: 'Audit', path: `${collectionPrefix}Audit` },
            { name: 'Documents', path: `${collectionPrefix}Documents` },
            { name: 'Credentials', path: `${collectionPrefix}Credentials` },
            { name: 'Cheques', path: `${collectionPrefix}Cheques` },
            { name: 'Others', path: `${collectionPrefix}Others` }
        ];            const workbook = XLSX.utils.book_new();

            // Fields to EXCLUDE from export (document URLs, storage paths, and internal fields)
            const excludeFields = [
                // Document URLs
                'photoUrl', 'idCopyUrl', 'ppCopyUrl', 'lcCopyUrl', 'settleDocUrl',
                'visaUrl', 'passportUrl', 'contractUrl', 'documentUrl', 'fileUrl',
                'attachmentUrl', 'proofUrl', 'receiptUrl', 'imageUrl',
                // Storage paths
                'storagePath', 'idCopyStoragePath', 'qidExpiryStoragePath', 'ppCopyStoragePath',
                // Boolean flags for document existence (not useful in Excel)
                'ppCopy', 'lcCopy', 'idCopy', 'settle',
                // Internal fields
                '_subCollections', 'createdAt', 'updatedAt', 'timestamp'
            ];

            // Helper to capitalize field names properly
            const formatHeaderName = (key) => {
                // Handle special cases
                const specialCases = {
                    'id': 'ID',
                    'fullName': 'Full Name',
                    'employeeNo': 'Employee No',
                    'eNo': 'E.No',
                    'qid': 'QID',
                    'visaNo': 'Visa No',
                    'passportNo': 'Passport No',
                    'wpNumber': 'WP Number',
                    'careOff': 'C/O',
                    'bankName': 'Bank Name',
                    'accountName': 'Account Name',
                    'iban': 'IBAN',
                    'swiftCode': 'SWIFT Code',
                    'chequeNo': 'Cheque No',
                    'givenDate': 'Given Date',
                    'chequeDate': 'Cheque Date',
                    'contact1': 'Contact 1',
                    'contact2': 'Contact 2',
                    'contact3': 'Contact 3',
                    'payCardPin': 'Pay Card PIN',
                    'labourContract2': 'Labour Contract 2'
                };

                if (specialCases[key]) return specialCases[key];

                // Convert camelCase to Title Case
                return key
                    .replace(/([A-Z])/g, ' $1') // Add space before capitals
                    .replace(/^./, str => str.toUpperCase()) // Capitalize first letter
                    .trim();
            };

            for (const col of collections) {
                const snapshot = await getDocs(collection(db, `artifacts/${appId}/users/${userId}/${col.path}`));
                
                // Helper to get value and format it
                const getValue = (docData, key) => {
                    if (!docData[key]) return '';
                    let value = docData[key];
                    if (value?.toDate) {
                        return formatDate(value);
                    }
                    if (Array.isArray(value)) {
                        return value.length > 0 ? JSON.stringify(value) : '';
                    }
                    if (value !== null && typeof value === 'object') {
                        return JSON.stringify(value);
                    }
                    return value;
                };
                
                let data;
                
                // SPECIAL HANDLING FOR EMPLOYEES PAGE ONLY
                if (col.name === 'Employees') {
                    data = snapshot.docs.map(doc => {
                        const docData = { ...doc.data() };
                        const orderedData = {};
                        
                        // Set columns in exact order for Employees
                        orderedData['ID'] = doc.id;
                        orderedData['Full Name'] = getValue(docData, 'fullName');
                        orderedData['QID'] = getValue(docData, 'qid');
                        orderedData['Qid Expiry'] = getValue(docData, 'qidExpiry');
                        orderedData['Profession'] = getValue(docData, 'profession');
                        orderedData['Nationality'] = getValue(docData, 'nationality');
                        orderedData['Address'] = getValue(docData, 'address');
                        orderedData['Pay Card PIN'] = getValue(docData, 'payCardPin');
                        orderedData['Contact 1'] = getValue(docData, 'contact1');
                        orderedData['Contact 2'] = getValue(docData, 'contact2');
                        orderedData['Contact 3'] = getValue(docData, 'contact3');
                        orderedData['E.No'] = getValue(docData, 'eNo') || getValue(docData, 'employeeNo');
                        orderedData['Passport'] = getValue(docData, 'passportNo') || getValue(docData, 'passport');
                        orderedData['Pay Card'] = getValue(docData, 'payCard');
                        orderedData['Status'] = getValue(docData, 'status');
                        orderedData['Notes'] = getValue(docData, 'notes');
                        orderedData['Gender'] = getValue(docData, 'gender');
                        orderedData['Labour Contract'] = getValue(docData, 'labourContract') || getValue(docData, 'labourContract2');
                        
                        return orderedData;
                    });
                } else {
                    // STANDARD HANDLING FOR ALL OTHER PAGES
                    data = snapshot.docs.map(doc => {
                        const docData = { ...doc.data() };
                        const cleanData = { ID: doc.id };
                        
                        Object.keys(docData).forEach(key => {
                            if (excludeFields.includes(key)) return;
                            
                            let value = docData[key];
                            if (value?.toDate) {
                                value = formatDate(value);
                            } else if (Array.isArray(value)) {
                                value = value.length > 0 ? JSON.stringify(value) : '';
                            } else if (value !== null && typeof value === 'object') {
                                value = JSON.stringify(value);
                            }
                            
                            const headerName = formatHeaderName(key);
                            cleanData[headerName] = value;
                        });
                        
                        return cleanData;
                    });
                }

                // Create worksheet with data OR empty sheet with headers
                let worksheet;
                if (data.length > 0) {
                    worksheet = XLSX.utils.json_to_sheet(data);
                } else {
                    // Create empty sheet with headers based on page type
                    const emptyHeaders = col.name === 'Employees' 
                        ? ['ID', 'Full Name', 'QID', 'Qid Expiry', 'Profession', 'Nationality', 'Address', 
                           'Pay Card PIN', 'Contact 1', 'Contact 2', 'Contact 3', 'E.No', 'Passport', 
                           'Pay Card', 'Status', 'Notes', 'Gender', 'Labour Contract']
                        : ['ID']; // Other sheets will have at least ID column
                    
                    worksheet = XLSX.utils.aoa_to_sheet([emptyHeaders]);
                }
                
                XLSX.utils.book_append_sheet(workbook, worksheet, col.name);
            }

            XLSX.writeFile(workbook, `${pageTitle.replace(/ /g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`);
        } catch (error) {
            console.error('Export failed:', error);
            alert('Failed to export data. Check console for details.');
        } finally {
            setIsExporting(false);
        }
    };

    const handleImportExcel = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsImporting(true);
        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);

            const sheetMappings = {
                'Employees': `${collectionPrefix}Data`,
                'Vehicles': `${collectionPrefix}Vehicles`,
                'WPS': `${collectionPrefix}Wps`,
                'Bank': `${collectionPrefix}Bank`,
                'Audit': `${collectionPrefix}Audit`,
                'Documents': `${collectionPrefix}Documents`,
                'Credentials': `${collectionPrefix}Credentials`,
                'Cheques': `${collectionPrefix}Cheques`,
                'Others': `${collectionPrefix}Others`
            };

            // Define expected headers for Employees sheet (strict validation)
            const employeesHeaders = ['ID', 'Full Name', 'QID', 'Qid Expiry', 'Profession', 'Nationality', 'Address', 'Pay Card PIN', 'Contact 1', 'Contact 2', 'Contact 3', 'E.No', 'Passport', 'Pay Card', 'Status', 'Notes', 'Gender', 'Labour Contract'];
            
            // Validate all sheets before importing
            const validationErrors = [];
            
            for (const sheetName of workbook.SheetNames) {
                // Check if sheet is recognized
                if (!sheetMappings[sheetName]) {
                    validationErrors.push(`❌ Unknown sheet: "${sheetName}"\n   Expected sheets: ${Object.keys(sheetMappings).join(', ')}`);
                    continue;
                }

                const sheet = workbook.Sheets[sheetName];
                const sheetData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                
                if (sheetData.length === 0) continue; // Empty sheet is OK
                
                const fileHeaders = sheetData[0] || [];
                
                // Check for missing ID column (required for all sheets)
                if (!fileHeaders.includes('ID')) {
                    validationErrors.push(`❌ Sheet "${sheetName}" is missing required column: ID`);
                    continue;
                }
                
                // Strict validation for Employees sheet
                if (sheetName === 'Employees') {
                    // Check for extra columns
                    const extraColumns = fileHeaders.filter(h => !employeesHeaders.includes(h));
                    if (extraColumns.length > 0) {
                        validationErrors.push(`❌ Sheet "Employees" has extra/unknown columns:\n   ${extraColumns.join(', ')}\n   Remove these columns before importing.`);
                    }
                    
                    // Check for missing columns
                    const missingColumns = employeesHeaders.filter(h => !fileHeaders.includes(h));
                    if (missingColumns.length > 0) {
                        validationErrors.push(`❌ Sheet "Employees" is missing columns:\n   ${missingColumns.join(', ')}\n   Add these columns before importing.`);
                    }
                    
                    // Check column order
                    const expectedOrder = employeesHeaders.join(',');
                    const actualOrder = fileHeaders.filter(h => employeesHeaders.includes(h)).join(',');
                    if (expectedOrder !== actualOrder) {
                        validationErrors.push(`⚠️ Sheet "Employees" columns are in wrong order.\n   Expected: ${employeesHeaders.join(', ')}`);
                    }
                } else {
                    // For other sheets, just warn about unknown sheets but allow any columns
                    // as they are dynamic based on actual data
                }
            }

            // If validation errors found, reject the import
            if (validationErrors.length > 0) {
                const errorMessage = '⚠️ Import Failed - Template Validation Errors:\n\n' + 
                    validationErrors.join('\n\n') + 
                    '\n\n📋 Please export a fresh template and use it without modifying the structure.';
                alert(errorMessage);
                setIsImporting(false);
                e.target.value = '';
                return;
            }

            // Validation passed, proceed with import using batch writes
            let totalImported = 0;
            
            for (const sheetName of workbook.SheetNames) {
                const collectionPath = sheetMappings[sheetName];
                if (!collectionPath) continue;

                const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
                if (sheetData.length === 0) continue; // Skip empty sheets
                
                const collectionRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`);

                // Helper to convert formatted header back to field name
                const toFieldName = (headerName) => {
                    const reverseMap = {
                        'Full Name': 'fullName',
                        'QID': 'qid',
                        'Qid Expiry': 'qidExpiry',
                        'Profession': 'profession',
                        'Nationality': 'nationality',
                        'Address': 'address',
                        'Pay Card PIN': 'payCardPin',
                        'Contact 1': 'contact1',
                        'Contact 2': 'contact2',
                        'Contact 3': 'contact3',
                        'E.No': 'eNo',
                        'Passport': 'passportNo',
                        'Pay Card': 'payCard',
                        'Status': 'status',
                        'Notes': 'notes',
                        'Gender': 'gender',
                        'Labour Contract': 'labourContract'
                    };
                    
                    if (reverseMap[headerName]) return reverseMap[headerName];
                    
                    // Convert Title Case to camelCase for other fields
                    return headerName
                        .split(' ')
                        .map((word, index) => 
                            index === 0 
                                ? word.toLowerCase() 
                                : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                        )
                        .join('');
                };

                // Use batch writes for better performance
                let batch = writeBatch(db);
                let batchCount = 0;
                const BATCH_SIZE = 500;

                for (const row of sheetData) {
                    const { ID, id, ...rowData } = row;
                    const docId = ID || id;
                    
                    if (!docId) continue; // Skip rows without ID
                    
                    // Convert headers back to field names
                    const firestoreData = {};
                    Object.keys(rowData).forEach(headerName => {
                        const fieldName = toFieldName(headerName);
                        let value = rowData[headerName];
                        
                        // Skip empty values
                        if (value === '' || value === null || value === undefined) return;
                        
                        // Convert date strings to Firestore timestamps
                        if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}$/)) {
                            value = parseDateForFirestore(value);
                        }
                        
                        // Parse JSON arrays/objects
                        if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
                            try {
                                value = JSON.parse(value);
                            } catch (e) {
                                // Keep as string if not valid JSON
                            }
                        }
                        
                        firestoreData[fieldName] = value;
                    });
                    
                    const docRef = doc(collectionRef, docId);
                    batch.set(docRef, firestoreData, { merge: true });
                    batchCount++;
                    totalImported++;
                    
                    // Commit batch when reaching size limit
                    if (batchCount >= BATCH_SIZE) {
                        await batch.commit();
                        batch = writeBatch(db);
                        batchCount = 0;
                    }
                }
                
                // Commit remaining documents
                if (batchCount > 0) {
                    await batch.commit();
                }
            }

            alert(`✅ Successfully imported ${totalImported} records!`);
        } catch (error) {
            console.error('Import failed:', error);
            alert('Failed to import data. Check console for details.');
        } finally {
            setIsImporting(false);
            e.target.value = '';
        }
    };

    return (
         <nav className="dark:bg-gray-800/80 bg-white/80 backdrop-blur-sm p-2 flex justify-center items-center gap-2 sticky top-[70px] z-40 shadow-sm flex-wrap">
            {subNavLinks.map(link => (
                <button
                    key={link.id}
                    onClick={() => setActiveSubPage(link.id)}
                    className={`flex items-center space-x-2 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all duration-200 ${
                        activeSubPage === link.id
                            ? 'bg-gradient-to-r from-gray-900 to-blue-700 text-white shadow-md'
                            : 'dark:text-gray-300 text-gray-600 dark:hover:bg-gray-700 hover:bg-gray-200'
                    }`}
                >
                    {link.icon}
                    <span>{link.title}</span>
                </button>
            ))}

            <div className="w-px h-6 bg-gray-300 dark:bg-gray-600"></div>

            <button
                onClick={handleExportExcel}
                disabled={isExporting}
                className="group flex items-center space-x-2 px-4 py-2 dark:bg-green-700 bg-green-100 rounded-full dark:hover:bg-green-600 hover:bg-green-200 text-sm font-semibold transition-all duration-300 disabled:opacity-50 border dark:border-green-600 border-green-300 dark:text-white text-green-700 shadow-md hover:shadow-lg hover:scale-105"
                title="Export all company data to Excel"
            >
                {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                <span>{isExporting ? 'Exporting...' : 'Export Excel'}</span>
            </button>

            <input
                ref={importFileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleImportExcel}
                className="hidden"
            />
            <button
                onClick={() => importFileInputRef.current?.click()}
                disabled={isImporting}
                className="group flex items-center space-x-2 px-4 py-2 dark:bg-blue-700 bg-blue-100 rounded-full dark:hover:bg-blue-600 hover:bg-blue-200 text-sm font-semibold transition-all duration-300 disabled:opacity-50 border dark:border-blue-600 border-blue-300 dark:text-white text-blue-700 shadow-md hover:shadow-lg hover:scale-105"
                title="Import company data from Excel"
            >
                {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                <span>{isImporting ? 'Importing...' : 'Import Excel'}</span>
            </button>
        </nav>
    );
}

const CompanyPageContent = ({ pageTitle, collectionPrefix, activeSubPage, ...commonProps }) => {
    // Configurations for GenericSubPage
    const wpsConfig = {
        itemTitle: 'WPS Entry',
        columns: [ { header: 'Year', accessor: 'year' }, { header: 'Month', accessor: 'month' }, { header: 'Total Employees', accessor: 'totalEmployees' }, { header: 'Listed in WPS', accessor: 'listedInWps' }, { header: 'Salary Paid', accessor: 'salaryPaid' }, { header: 'Vacation Status', accessor: 'vacationStatus' }, { header: 'Unlisted', accessor: 'unlisted', render: (item) => {
            const unlistedCount = (item.totalEmployees || 0) - (item.listedInWps || 0);
            const colorClass = unlistedCount > 0 ? 'text-red-400' : 'text-green-400';
            return <span className={`font-bold ${colorClass}`}>{unlistedCount}</span>;
        } } ],
        formFields: [ { name: 'year', label: 'Year', type: 'number' }, { name: 'month', label: 'Month' }, { name: 'totalEmployees', label: 'Total Employees', type: 'number' }, { name: 'listedInWps', label: 'Listed in WPS', type: 'number' }, { name: 'salaryPaid', label: 'Salary Paid' }, { name: 'vacationStatus', label: 'Vacation Status', type: 'textarea' }, ]
    };
    const bankConfig = {
        itemTitle: 'Bank Details',
        columns: [ { header: 'Bank Name', accessor: 'bankName' }, { header: 'Account Name', accessor: 'accountName' }, { header: 'IBAN', accessor: 'iban' }, { header: 'SWIFT', accessor: 'swiftCode' }, { header: 'Contact', accessor: 'contact' }, { header: 'Notes', accessor: 'notes' }, ],
        formFields: [ { name: 'bankName', label: 'Bank Name', transform: 'capitalize' }, { name: 'accountName', label: 'Account Name', transform: 'capitalize' }, { name: 'iban', label: 'IBAN Number' }, { name: 'swiftCode', label: 'SWIFT Code' }, { name: 'address', label: 'Address', type: 'textarea' }, { name: 'email', label: 'Email' }, { name: 'contact', label: 'Contact' }, { name: 'notes', label: 'Notes', type: 'textarea' }, ]
    };
    const auditConfig = {
        itemTitle: 'Audit Report',
        columns: [ { header: 'Year', accessor: 'year' }, { header: 'Month', accessor: 'month' }, { header: 'Auditor', accessor: 'auditor' }, { header: 'Status', accessor: 'status' }, { header: 'Notes', accessor: 'notes' }, ],
        formFields: [ { name: 'year', label: 'Year', type: 'number' }, { name: 'month', label: 'Month' }, { name: 'auditor', label: 'Auditor', transform: 'capitalize' }, { name: 'status', label: 'Status' }, { name: 'notes', label: 'Notes', type: 'textarea' }, ]
    };
    const credentialsConfig = {
        itemTitle: 'Credential',
        columns: [ { header: 'Description', accessor: 'description' }, { header: 'Sub-Description', accessor: 'subDescription' }, { header: 'Email', accessor: 'email' }, { header: 'Username', accessor: 'username' }, { header: 'Expiry', accessor: 'expiry', render: (item) => formatDate(item.expiry) }, ],
        formFields: [ { name: 'description', label: 'Description', transform: 'capitalize' }, { name: 'subDescription', label: 'Sub-Description', transform: 'capitalize' }, { name: 'email', label: 'Email' }, { name: 'number', label: 'Number' }, { name: 'contact', label: 'Contact' }, { name: 'username', label: 'Username' }, { name: 'passcode', label: 'Passcode' }, { name: 'pin', label: 'PIN' }, { name: 'expiry', label: 'Expiry', type: 'date' }, { name: 'others', label: 'Others', type: 'textarea' }, ]
    };
    const othersConfig = {
        itemTitle: 'Entry',
        columns: [ { header: 'Year', accessor: 'year' }, { header: 'Month', accessor: 'month' }, { header: 'Description', accessor: 'description' }, { header: 'Notes', accessor: 'notes' } ],
        formFields: [ { name: 'year', label: 'Year', type: 'number' }, { name: 'month', label: 'Month' }, { name: 'description', label: 'Description', transform: 'capitalize', type: 'textarea' }, { name: 'notes', label: 'Notes', type: 'textarea' } ]
    };

    const chequeConfig = {
        itemTitle: 'Cheque',
        columns: [
            { header: 'Cheque No', accessor: 'chequeNo' },
            { header: 'Given Date', accessor: 'givenDate', render: (item) => formatDate(item.givenDate) },
            { header: 'Cheque Date', accessor: 'chequeDate', render: (item) => formatDate(item.chequeDate) },
            { header: 'C/O', accessor: 'careOff' },
            { header: 'Name', accessor: 'name' },
            { header: 'Bank', accessor: 'bankName' },
            { header: 'Amount', accessor: 'amount', render: (item) => formatCurrency(item.amount, commonProps.currency) },
            { header: 'Status', accessor: 'status', render: (item) => <ChequeStatusBadge date={item.chequeDate} status={item.status} /> },
            { header: 'Notes', accessor: 'notes' },
        ],
        formFields: [
            { name: 'chequeNo', label: 'Cheque No' },
            { name: 'givenDate', label: 'Given Date', type: 'date' },
            { name: 'chequeDate', label: 'Cheque Date', type: 'date' },
            { name: 'careOff', label: 'C/O', transform: 'capitalize' },
            { name: 'name', label: 'Name', transform: 'capitalize' },
            { name: 'bankName', label: 'Bank Name', transform: 'capitalize' },
            { name: 'amount', label: 'Amount', type: 'number' },
            { name: 'status', label: 'Status', type: 'select', options: ['Pending', 'Cashed', 'Bounced', 'Cancelled'], defaultValue: 'Pending' },
            { name: 'notes', label: 'Notes', type: 'textarea', colSpan: 2 },
        ]
    };


    switch (activeSubPage) {
        case 'employees': return <GenericEmployeePage pageTitle={`Employees Details ${pageTitle}`} collectionPath={`${collectionPrefix}Data`} {...commonProps} />;
        case 'vehicles': return <VehiclesPage pageTitle={`${pageTitle} Vehicles`} collectionPath={`${collectionPrefix}Vehicles`} {...commonProps} />;
        case 'wps': return <GenericSubPage pageTitle="WPS Status" collectionPath={`${collectionPrefix}Wps`} {...wpsConfig} {...commonProps} />;
        case 'bank': return <GenericSubPage pageTitle="Bank Details" collectionPath={`${collectionPrefix}Bank`} {...bankConfig} {...commonProps} />;
        case 'audit': return <GenericSubPage pageTitle="Audit Reports" collectionPath={`${collectionPrefix}Audit`} {...auditConfig} {...commonProps} />;
        case 'credentials': return <DocsAndCredsPage pageTitle={`${pageTitle} Docs & Creds`} collectionPrefix={collectionPrefix} {...commonProps} />;
        case 'cheques': return <GenericSubPage pageTitle={`${pageTitle} Cheques`} collectionPath={`${collectionPrefix}Cheques`} {...chequeConfig} {...commonProps} />;
        case 'others': return <GenericSubPage pageTitle="Other Details" collectionPath={`${collectionPrefix}Others`} {...othersConfig} {...commonProps} />;
        default: return <GenericEmployeePage pageTitle={`Employees Details ${pageTitle}`} collectionPath={`${collectionPrefix}Data`} {...commonProps} />;
    }
};

const LockScreen = ({ onUnlock, hint, correctHash }) => {
    const [passcode, setPasscode] = useState('');
    const [error, setError] = useState('');
    const [showHint, setShowHint] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (hashPasscode(passcode) === correctHash) {
            setError('');
            onUnlock();
        } else {
            setError('Incorrect passcode. Please try again.');
            setPasscode('');
        }
    };

    return (
        <div className="dark bg-gray-900 text-white min-h-screen flex items-center justify-center font-sans">
            <div className="w-full max-w-md p-8 space-y-8 bg-gray-800 rounded-xl shadow-2xl">
                <div className="text-center">
                    <ShieldCheck className="mx-auto h-12 w-12 text-cyan-400" />
                    <h2 className="mt-6 text-3xl font-extrabold">Dashboard Locked</h2>
                    <p className="mt-2 text-sm text-gray-400">Please enter your passcode to continue.</p>
                </div>
                <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
                    <div className="relative">
                        <input
                            ref={inputRef}
                            id="passcode"
                            name="passcode"
                            type="password"
                            autoComplete="current-password"
                            required
                            value={passcode}
                            onChange={(e) => setPasscode(e.target.value)}
                            className="w-full px-4 py-3 text-lg text-center bg-gray-700 border border-gray-600 rounded-md focus:ring-cyan-500 focus:border-cyan-500 tracking-widest"
                            placeholder="••••••"
                        />
                    </div>
                    {error && <p className="text-sm text-red-400 text-center">{error}</p>}
                    <button
                        type="submit"
                        className="w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 focus:ring-offset-gray-800"
                    >
                        Unlock
                    </button>
                </form>
                {hint && (
                    <div className="text-center">
                        <button onClick={() => setShowHint(!showHint)} className="text-xs text-gray-400 hover:text-cyan-400">
                            {showHint ? 'Hide Hint' : 'Show Hint'}
                        </button>
                        {showHint && <p className="mt-2 text-sm p-3 bg-gray-700/50 rounded-md">{hint}</p>}
                    </div>
                )}
            </div>
        </div>
    );
};

const EmployeePnlPage = ({ userId, appId, pageTitle, collectionPath, setConfirmAction, currency }) => {
    const [entries, setEntries] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [editingEntry, setEditingEntry] = useState(null);
    const [employees, setEmployees] = useState([]);
    const employeeNames = useMemo(() => employees.map(e => e.fullName).filter(Boolean).sort(), [employees]);

    const [view, setView] = useState('all');
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
    const [searchTerm, setSearchTerm] = useState('');
    const [tickedEntries, setTickedEntries] = useState(new Set());

    const entriesRef = useMemo(() => collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`), [userId, appId, collectionPath]);
    const companyPrefix = collectionPath.replace('EmployeePnl', '');
    const employeeDataRef = useMemo(() => collection(db, `artifacts/${appId}/users/${userId}/${companyPrefix}Data`), [userId, appId, companyPrefix]);

    useEffect(() => {
        const unsubEntries = onSnapshot(entriesRef, snapshot => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setEntries(data);
        });
        const unsubEmployees = onSnapshot(employeeDataRef, snapshot => {
            const empData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setEmployees(empData);
        });
        return () => {
            unsubEntries();
            unsubEmployees();
        };
    }, [entriesRef, employeeDataRef]);

    const handleToggleTick = useCallback((entryId) => {
        setTickedEntries(prev => {
            const newSet = new Set(prev);
            if (newSet.has(entryId)) {
                newSet.delete(entryId);
            } else {
                newSet.add(entryId);
            }
            return newSet;
        });
    }, []);

    const handleToggleAllTicks = useCallback((entryList) => {
        const allIds = entryList.map(e => e.id);
        const allAreTicked = allIds.length > 0 && allIds.every(id => tickedEntries.has(id));

        setTickedEntries(prev => {
            const newSet = new Set(prev);
            if (allAreTicked) {
                allIds.forEach(id => newSet.delete(id));
            } else {
                allIds.forEach(id => newSet.add(id));
            }
            return newSet;
        });
    }, []);

    const handleClearTicks = () => {
        setTickedEntries(new Set());
    };

    const years = useMemo(() => {
        const yearSet = new Set(entries.map(e => {
            if (e.yearRange && e.yearRange.match(/^\d{4}/)) {
                return parseInt(e.yearRange.match(/^\d{4}/)[0], 10);
            }
            return e.createdAt?.toDate()?.getFullYear();
        }));
        return [...yearSet].filter(Boolean).sort((a,b) => b-a);
    }, [entries]);

    const months = useMemo(() => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], []);

    const filteredEntries = useMemo(() => {
        let tempEntries = entries.filter(e => {
            if (view === 'all') return true;

            const yearPart = e.yearRange ? parseInt(e.yearRange.match(/^\d{4}/)?.[0], 10) : e.createdAt?.toDate()?.getFullYear();
            
            if (!yearPart) return false;

            if (view === 'yearly') return yearPart === selectedYear;

            if (view === 'monthly') {
                 const date = e.createdAt?.toDate();
                 return yearPart === selectedYear && date && date.getMonth() === selectedMonth;
            }
            return false;
        });

        if (searchTerm) {
            const lowerSearchTerm = searchTerm.toLowerCase();
            tempEntries = tempEntries.filter(e => {
                return Object.values(e).some(val => 
                    val && (typeof val === 'string' || typeof val === 'number') && String(val).toLowerCase().includes(lowerSearchTerm)
                );
            });
        }

        return tempEntries;
    }, [entries, view, selectedYear, selectedMonth, searchTerm]);

    const currentYear = new Date().getFullYear();
    const yearRanges = useMemo(() => {
        const ranges = [];
        for (let year = 2022; year < 2050; year++) {
            ranges.push(`${year}-${year + 1}`);
        }
        return ranges;
    }, []);

    const pnlFormFields = [
        { name: 'name', label: 'Full Name', transform: 'capitalize' },
        { name: 'nationality', label: 'Nationality', transform: 'capitalize' },
        { 
            name: 'yearRange', 
            label: 'Year Range',
            type: 'select',
            options: yearRanges,
            defaultValue: `${currentYear}-${currentYear + 1}`
        },
        { name: 'sponsorshipFees', label: 'Sponsorship Fees', type: 'number' },
        { name: 'otherFee', label: 'Other Fee', type: 'number' },
        { name: 'expense', label: 'Expense', type: 'number' },
        { name: 'feesPaid', label: 'Fees Paid', type: 'number' },
    ];

    const handleSave = async (itemData) => {
        const dataToSave = { ...itemData, fullName: itemData.name };
        delete dataToSave.name;

        const selectedEmployee = employees.find(e => e.fullName === dataToSave.fullName);
        if (selectedEmployee) {
            dataToSave.eNo = selectedEmployee.eNo || '';
            dataToSave.nationality = selectedEmployee.nationality || '';
            dataToSave.qid = selectedEmployee.qid || '';
            dataToSave.qidExpiry = selectedEmployee.qidExpiry || null;
        }

        if (editingEntry) {
            await updateDoc(doc(entriesRef, editingEntry.id), dataToSave);
        } else {
            dataToSave.createdAt = new Date();
            await addDoc(entriesRef, dataToSave);
        }
        setShowModal(false);
        setEditingEntry(null);
    };

    const handleEdit = (entry) => {
        const entryForModal = { ...entry, name: entry.fullName };
        setEditingEntry(entryForModal);
        setShowModal(true);
    };

    const onDeleteRequest = (entry) => {
        setConfirmAction({
            title: 'Confirm Delete',
            message: `Are you sure you want to delete the P&L entry for ${entry.fullName}?`,
            confirmText: 'Delete',
            type: 'delete',
            action: () => deleteDoc(doc(entriesRef, entry.id))
        });
    };

    const totals = useMemo(() => {
        return filteredEntries.reduce((acc, entry) => {
            const sponsorshipFees = parseFloat(entry.sponsorshipFees || 0);
            const otherFee = parseFloat(entry.otherFee || 0);
            const totalFee = sponsorshipFees + otherFee;
            const expense = parseFloat(entry.expense || 0);
            const feesPaid = parseFloat(entry.feesPaid || 0);

            acc.sponsorshipFees += sponsorshipFees;
            acc.otherFee += otherFee;
            acc.totalFee += totalFee;
            acc.expense += expense;
            acc.profit += (totalFee - expense);
            acc.feesPaid += feesPaid;
            acc.balance += (totalFee - feesPaid);
            return acc;
        }, { sponsorshipFees: 0, otherFee: 0, totalFee: 0, expense: 0, profit: 0, feesPaid: 0, balance: 0 });
    }, [filteredEntries]);

    return (
        <div>
            <div className="flex items-center justify-between space-x-2 flex-wrap gap-2 no-print mb-4 p-4 dark:bg-gray-800 bg-white rounded-lg">
                <div className="flex items-center space-x-2 flex-wrap gap-2">
                    <div className="flex items-center space-x-1 dark:bg-gray-700 bg-gray-200 p-1 rounded-lg border dark:border-gray-600 border-gray-300">
                        <button onClick={() => setView('all')} className={`px-3 py-1 text-sm rounded-md ${view === 'all' ? 'bg-cyan-600 text-white' : 'dark:text-gray-300 text-gray-700 dark:hover:bg-gray-600 hover:bg-gray-300'}`}>All Time</button>
                        <button onClick={() => setView('yearly')} className={`px-3 py-1 text-sm rounded-md ${view === 'yearly' ? 'bg-cyan-600 text-white' : 'dark:text-gray-300 text-gray-700 dark:hover:bg-gray-600 hover:bg-gray-300'}`}>Yearly</button>
                        <button onClick={() => setView('monthly')} className={`px-3 py-1 text-sm rounded-md ${view === 'monthly' ? 'bg-cyan-600 text-white' : 'dark:text-gray-300 text-gray-700 dark:hover:bg-gray-600 hover:bg-gray-300'}`}>Monthly</button>
                    </div>
                    {(view === 'yearly' || view === 'monthly') && (
                        <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md text-sm border dark:border-gray-600 border-gray-300 dark:text-white text-gray-800">
                            {years.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    )}
                    {view === 'monthly' && (
                        <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md text-sm border dark:border-gray-600 border-gray-300 dark:text-white text-gray-800">
                            {months.map((m, i) => <option key={m} value={i}>{m}</option>)}
                        </select>
                    )}
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Search..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md pl-8 border dark:border-gray-600 border-gray-300"
                        />
                        <Search size={18} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                    </div>
                </div>
                 <div className="flex items-center space-x-2">
                    {tickedEntries.size > 0 && (
                        <button onClick={handleClearTicks} className="flex items-center space-x-2 p-2.5 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors text-sm">
                            <X size={16}/>
                            <span>Clear ({tickedEntries.size})</span>
                        </button>
                    )}
                    <button onClick={() => { setEditingEntry(null); setShowModal(true); }} className="flex items-center space-x-2 px-4 py-2 bg-cyan-500 rounded-md hover:bg-cyan-600">
                        <PlusCircle size={18}/>
                        <span>Add P&L Entry</span>
                    </button>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm border-separate table-fixed" style={{borderSpacing: '4px 8px', minWidth: '1800px'}}>
                    <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase align-middle">
                        <tr>
                            <th className="w-12 p-0 font-semibold text-center">
                                <div className="dark:bg-slate-900 bg-gray-200 px-3 py-2 rounded-md border dark:border-slate-700/50 flex justify-center items-center">
                                    <input
                                        type="checkbox"
                                        onChange={() => handleToggleAllTicks(filteredEntries)}
                                        checked={filteredEntries.length > 0 && filteredEntries.every(e => tickedEntries.has(e.id))}
                                        className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                    />
                                </div>
                            </th>
                            {['S.No', 'Full Name', 'Nationality', 'Year Range', 'Sponsorship Fees', 'Other Fee', 'Total Fee', 'Expense', 'Profit', 'Fees Paid', 'Balance', 'Actions'].map(h => {
                                const isRightAligned = ['Sponsorship Fees', 'Other Fee', 'Total Fee', 'Expense', 'Profit', 'Fees Paid', 'Balance', 'Actions'].includes(h);

                                let widthClass = '';
                                if (h === 'S.No') widthClass = 'w-12';
                                else if (h === 'Full Name') widthClass = 'w-96';
                                else if (h === 'Nationality') widthClass = 'w-32';
                                else if (['Year Range', 'Sponsorship Fees', 'Other Fee', 'Total Fee', 'Expense', 'Profit', 'Fees Paid', 'Balance'].includes(h)) widthClass = 'w-28';
                                else if (h === 'Actions') widthClass = 'w-20';

                                return (
                                <th key={h} className={`p-0 font-semibold ${isRightAligned ? 'text-right' : 'text-left'} ${widthClass}`}>
                                    <div className="dark:bg-slate-900 bg-gray-200 px-3 py-2 rounded-md border dark:border-slate-700/50">
                                        {h}
                                    </div>
                                </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {filteredEntries.map((entry, index) => {
                            const totalFee = (entry.sponsorshipFees || 0) + (entry.otherFee || 0);
                            const profit = totalFee - (entry.expense || 0);
                            const balance = totalFee - (entry.feesPaid || 0);
                            const isTicked = tickedEntries.has(entry.id);
                            const cellClassName = `p-2 ${isTicked ? 'dark:bg-green-800/40 bg-green-100' : 'dark:bg-gray-800/50 bg-gray-50'}`;
                            return (
                            <tr key={entry.id} className="group/row">
                                <td className={`${cellClassName} rounded-l-md text-center`}>
                                    <input
                                        type="checkbox"
                                        checked={isTicked}
                                        onChange={() => handleToggleTick(entry.id)}
                                        className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                    />
                                </td>
                                <td className={cellClassName}>{index + 1}</td>
                                <td className={cellClassName}>{entry.fullName}</td>
                                <td className={cellClassName}>{entry.nationality}</td>
                                <td className={cellClassName}>{entry.yearRange}</td>
                                <td className={`${cellClassName} text-right`}>{formatAmount(entry.sponsorshipFees)}</td>
                                <td className={`${cellClassName} text-right`}>{formatAmount(entry.otherFee)}</td>
                                <td className={`${cellClassName} text-right`}>{formatAmount(totalFee)}</td>
                                <td className={`${cellClassName} text-right`}>{formatAmount(entry.expense)}</td>
                                <td className={`${cellClassName} text-right ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatAmount(profit)}</td>
                                <td className={`${cellClassName} text-right`}>{formatAmount(entry.feesPaid)}</td>
                                <td className={`${cellClassName} text-right ${balance > 0 ? 'text-red-400' : 'text-green-400'}`}>{formatAmount(balance)}</td>
                                <td className={`${cellClassName} rounded-r-md`}>
                                    <div className="opacity-0 group-hover/row:opacity-100 flex items-center justify-end space-x-1">
                                        <button onClick={() => handleEdit(entry)} className="p-1.5 hover:text-cyan-400"><Edit size={16}/></button>
                                        <button onClick={() => onDeleteRequest(entry)} className="p-1.5 hover:text-red-400"><Trash2 size={16}/></button>
                                    </div>
                                </td>
                            </tr>
                            );
                        })}
                    </tbody>
                    <tfoot className="font-bold border-t-2 dark:border-gray-600">
                        <tr>
                            <td colSpan="5" className="p-2 text-right">Total</td>
                            <td className="p-2 text-right">{formatCurrency(totals.sponsorshipFees, currency)}</td>
                            <td className="p-2 text-right">{formatCurrency(totals.otherFee, currency)}</td>
                            <td className="p-2 text-right font-semibold">{formatCurrency(totals.totalFee, currency)}</td>
                            <td className="p-2 text-right">{formatCurrency(totals.expense, currency)}</td>
                            <td className={`p-2 text-right ${totals.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatCurrency(totals.profit, currency)}</td>
                            <td className="p-2 text-right">{formatCurrency(totals.feesPaid, currency)}</td>
                            <td className={`p-2 text-right ${totals.balance > 0 ? 'text-red-400' : 'text-green-400'}`}>{formatCurrency(totals.balance, currency)}</td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
                 {filteredEntries.length === 0 && <div className="text-center py-8 text-gray-500">No entries for this period.</div>}
            </div>
            <GenericAddEditModal 
                isOpen={showModal} 
                onSave={handleSave} 
                onClose={() => setShowModal(false)} 
                initialData={editingEntry} 
                formFields={pnlFormFields} 
                title="Employee P&L Entry"
                employeeList={employeeNames}
            />
        </div>
    );
};

const StructuredBusinessSection = ({ title, icon, collectionPath, columns, formFields, userId, appId, currency, setConfirmAction, theme, isCustom, onDelete, onTitleSave, employeeList = [], entries, tickedEntries, onToggleTick, onToggleAllTicks }) => {
    const [showModal, setShowModal] = useState(false);
    const [editingEntry, setEditingEntry] = useState(null);
    const entriesRef = useMemo(() => collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`), [userId, appId, collectionPath]);

    const handleSave = async (entryData) => {
        if (editingEntry) {
            await updateDoc(doc(entriesRef, editingEntry.id), entryData);
        } else {
            await addDoc(entriesRef, entryData);
        }
    };
    const onSaveRequest = (entryData) => { handleSave(entryData); setShowModal(false); setEditingEntry(null); };
    
    const onEditRequest = (entry) => { setEditingEntry(entry); setShowModal(true); };
    const onDeleteRequest = (entry) => setConfirmAction({ title: 'Confirm Delete', message: 'Are you sure you want to delete this entry?', confirmText: 'Delete', type: 'delete', action: () => deleteDoc(doc(entriesRef, entry.id)) });

    const tableColumns = useMemo(() => [
        ...columns,
        {
            header: 'Actions',
            accessor: 'actions',
            render: (item) => (
                <div className="opacity-0 group-hover/row:opacity-100 flex items-center justify-end space-x-1 no-print">
                    <button onClick={() => onEditRequest(item)} className="p-1.5 hover:text-cyan-400"><Edit size={14}/></button>
                    <button onClick={() => onDeleteRequest(item)} className="p-1.5 hover:text-red-400"><Trash2 size={14}/></button>
                </div>
            ),
            textAlign: 'right'
        }
    ], [columns]);

    const totals = useMemo(() => entries.reduce((acc, entry) => { acc.income += entry.income || 0; acc.expense += entry.expense || 0; return acc; }, { income: 0, expense: 0 }), [entries]);
    // const chartData = useMemo(() => ({ labels: ['Total Income', 'Total Expense'], datasets: [{ data: [totals.income, totals.expense], backgroundColor: ['#34D399', '#F87171'], borderColor: '#1f2937', borderWidth: 2, pointStyle: 'circle' }] }), [totals]);
    // const chartOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'left', labels: { color: theme === 'dark' ? '#FFFFFF' : '#1f2937', font: { size: 16, weight: 'bold', family: "Inter, sans-serif" }, usePointStyle: true, } } } };

    return (
        <section className="group">
            {isCustom && (
                <div className="flex items-center justify-end mb-4">
                    <button onClick={onDelete} className="p-1.5 text-red-400 hover:text-red-300 no-print" title="Delete Section">
                        <Trash2 size={18} />
                    </button>
                </div>
            )}
            <div className="flex flex-col gap-6">
                <div className="w-full overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase dark:bg-gray-700 bg-gray-50">
                            <tr>
                                <th className="px-2 py-2 text-left w-12">
                                    <input
                                        type="checkbox"
                                        onChange={() => onToggleAllTicks(entries)}
                                        checked={entries.length > 0 && entries.every(e => tickedEntries.has(e.id))}
                                        className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                    />
                                </th>
                                {tableColumns.map(c => <th key={c.header} className={`px-2 py-2 text-left ${c.textAlign === 'right' ? 'text-right' : ''}`}>{c.header}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {entries.map((entry) => {
                                const isTicked = tickedEntries.has(entry.id);
                                return (
                                <tr key={entry.id} className={`group/row border-b dark:border-gray-700 border-gray-200 ${isTicked ? 'dark:bg-green-800/40 bg-green-100' : ''}`}>
                                    <td className="p-2 text-center">
                                        <input
                                            type="checkbox"
                                            checked={isTicked}
                                            onChange={() => onToggleTick(entry.id)}
                                            className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                        />
                                    </td>
                                    {tableColumns.map(col => (
                                        <td key={col.accessor} className={`p-2 ${col.className || ''} ${col.textAlign === 'right' ? 'text-right' : ''}`}>
                                            {col.render ? col.render(entry, currency) : entry[col.accessor]}
                                        </td>
                                    ))}
                                </tr>
                                );
                            })}
                        </tbody>
                        <tfoot className="font-bold border-t-2 dark:border-gray-600 border-gray-300">
                            <tr>
                                <td></td>
                                <td colSpan={tableColumns.findIndex(c=>c.accessor === 'income')} className="p-2 text-right">Total</td>
                                <td className="p-2 text-right text-green-400">{formatCurrency(totals.income, currency)}</td>
                                <td className="p-2 text-right text-red-400">{formatCurrency(totals.expense, currency)}</td>
                                <td className={`p-2 text-right ${(totals.income - totals.expense) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatCurrency(totals.income - totals.expense, currency)}</td>
                                <td colSpan={tableColumns.length - tableColumns.findIndex(c=>c.accessor === 'pnl') - 1}></td>
                            </tr>
                        </tfoot>
                    </table>
                     {entries.length === 0 && <div className="text-center py-8 text-gray-500">No entries for this period.</div>}
                </div>
                {/* <div className="lg:w-1/3 border dark:border-gray-700 border-gray-200 rounded-lg p-4 flex flex-col">
                    <h3 className="font-bold mb-2 text-center">{title} - Overview</h3>
                    <div className="flex-grow w-full h-full min-h-[250px]"><Pie data={chartData} options={chartOptions} /></div>
                </div> */}
            </div>
            <div className="mt-4 flex justify-start">
                 <button onClick={() => { setEditingEntry(null); setShowModal(true); }} className="flex items-center space-x-2 px-4 py-2 bg-cyan-500 rounded-md hover:bg-cyan-600 transition-colors no-print">
                    <PlusCircle size={18}/><span>Add Entry</span>
                 </button>
            </div>
            <GenericAddEditModal isOpen={showModal} onSave={onSaveRequest} initialData={editingEntry} onClose={() => setShowModal(false)} formFields={formFields} title={title} employeeList={employeeList}/>
        </section>
    );
}

const RecruitmentDetailModal = ({ isOpen, onClose, onSave, initialData }) => {
    const [formData, setFormData] = useState({});

    useEffect(() => {
        if (isOpen && initialData) {
            setFormData({
                name: initialData.name || '',
                careOff: initialData.careOff || '',
                nationality: initialData.nationality || '',
                visaNumber: initialData.visaNumber || '',
                profession: initialData.profession || '',
                sold: initialData.sold || 0,
                received: initialData.received || 0,
                notes: initialData.notes || '',
            });
        }
    }, [isOpen, initialData]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };
    
    const handleSave = () => {
        const dataToSave = {
            ...formData,
            name: capitalizeWords(formData.name),
            careOff: capitalizeWords(formData.careOff),
            nationality: capitalizeWords(formData.nationality),
            profession: capitalizeWords(formData.profession),
            sold: parseFloat(formData.sold || 0),
            received: parseFloat(formData.received || 0),
        };
        onSave(dataToSave);
    };

    const balance = useMemo(() => {
        const sold = parseFloat(formData.sold || 0);
        const received = parseFloat(formData.received || 0);
        return sold - received;
    }, [formData.sold, formData.received]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-[101] p-4">
            <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                <h3 className="text-xl font-bold mb-6">Recruitment Details: {initialData?.name}</h3>
                <div className="overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div><label className="text-xs text-gray-400">Name</label><input type="text" name="name" value={formData.name} onChange={handleChange} className="w-full p-2 bg-gray-700 rounded-md" /></div>
                    <div><label className="text-xs text-gray-400">Care Of</label><input type="text" name="careOff" value={formData.careOff} onChange={handleChange} className="w-full p-2 bg-gray-700 rounded-md" /></div>
                    <div><label className="text-xs text-gray-400">Nationality</label><input type="text" name="nationality" value={formData.nationality} onChange={handleChange} className="w-full p-2 bg-gray-700 rounded-md" /></div>
                    <div><label className="text-xs text-gray-400">Visa Number</label><input type="text" name="visaNumber" value={formData.visaNumber} onChange={handleChange} className="w-full p-2 bg-gray-700 rounded-md" /></div>
                    <div><label className="text-xs text-gray-400">Profession</label><input type="text" name="profession" value={formData.profession} onChange={handleChange} className="w-full p-2 bg-gray-700 rounded-md" /></div>
                    <div><label className="text-xs text-gray-400">Sold (Amount)</label><input type="number" name="sold" value={formData.sold} onChange={handleChange} className="w-full p-2 bg-gray-700 rounded-md" /></div>
                    <div><label className="text-xs text-gray-400">Received (Amount)</label><input type="number" name="received" value={formData.received} onChange={handleChange} className="w-full p-2 bg-gray-700 rounded-md" /></div>
                    <div><label className="text-xs text-gray-400">Balance</label><input type="text" readOnly value={formatCurrency(balance, 'QAR')} className="w-full p-2 bg-gray-900 rounded-md" /></div>
                    <div className="md:col-span-2 lg:col-span-3"><label className="text-xs text-gray-400">Notes</label><textarea name="notes" value={formData.notes} onChange={handleChange} className="w-full p-2 bg-gray-700 rounded-md h-24" /></div>
                </div>
                 <div className="flex justify-end space-x-2 mt-6 pt-4 border-t border-gray-700">
                    <button onClick={onClose} className="px-4 py-2 bg-gray-600 rounded-md">Cancel</button>
                    <button onClick={handleSave} className="px-4 py-2 bg-cyan-500 rounded-md">Save</button>
                </div>
            </div>
        </div>
    );
};

const AddNewBusinessSection = ({ onAdd }) => {
    const [title, setTitle] = useState('');
    const [isAdding, setIsAdding] = useState(false);

    const handleAdd = () => {
        if (title.trim()) {
            onAdd(capitalizeWords(title.trim()));
            setTitle('');
            setIsAdding(false);
        }
    };

    if (!isAdding) {
        return (
            <button onClick={() => setIsAdding(true)} title="Add New Section" className="p-2.5 dark:bg-gray-600 bg-gray-200 text-sm rounded-md dark:hover:bg-gray-500 hover:bg-gray-300 border dark:border-gray-600 border-gray-300 dark:text-white text-gray-800">
                <PlusCircle size={16}/>
            </button>
        );
    }

    return (
        <div className="flex items-center space-x-2 p-2 dark:bg-gray-700/50 bg-gray-200/50 rounded-lg">
            <input
                type="text"
                placeholder="New section title..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                className="p-2 dark:bg-gray-700 bg-white rounded-md text-sm border dark:border-gray-600 border-gray-300"
                autoFocus
            />
            <button onClick={handleAdd} className="p-2 bg-cyan-500 rounded-md hover:bg-cyan-600" title="Save Section"><Save size={18} /></button>
            <button onClick={() => setIsAdding(false)} className="p-2 bg-red-500 rounded-md hover:bg-red-600" title="Cancel"><X size={18} /></button>
        </div>
    );
};

const ManageBusinessDescriptionsModal = ({ userId, appId, onClose, initialDescriptions, setConfirmAction }) => {
    const [newDescription, setNewDescription] = useState({});

    const settingsRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/settings/businessDescriptions`), [appId, userId]);

    const handleAdd = async (categoryKey) => {
        const valueToAdd = newDescription[categoryKey]?.trim();
        if (!valueToAdd) return;

        await updateDoc(settingsRef, {
            [categoryKey]: arrayUnion(capitalizeWords(valueToAdd))
        });

        setNewDescription(prev => ({ ...prev, [categoryKey]: '' }));
    };

    const handleDeleteRequest = (categoryKey, description) => {
        setConfirmAction({
            title: 'Confirm Delete',
            message: `Are you sure you want to delete the description "${description}"? This cannot be undone.`,
            confirmText: 'Delete',
            type: 'delete',
            action: async () => {
                await updateDoc(settingsRef, {
                    [categoryKey]: arrayRemove(description)
                });
            }
        });
    };

    const handleInputChange = (categoryKey, value) => {
        setNewDescription(prev => ({ ...prev, [categoryKey]: value }));
    };

    const descriptionCategories = [
        { key: 'alMarri_fathoom', title: 'Al Marri & Fathoom' },
        { key: 'recruitments', title: 'Recruitments' },
        { key: 'vehicles', title: 'Vehicles' },
        { key: 'transportation', title: 'Transportation' },
        { key: 'custom', title: 'Custom Sections' }
    ];

    return (
         <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-[101] p-4">
            <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col">
                <div className="flex justify-between items-center mb-4 flex-shrink-0">
                    <h3 className="text-xl font-bold">Manage Business Descriptions</h3>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700"><X size={20}/></button>
                </div>
                <div className="overflow-y-auto">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {descriptionCategories.map(cat => (
                            <div key={cat.key} className="dark:bg-gray-700/50 bg-gray-100/50 p-4 rounded-lg">
                                <h4 className="font-bold text-lg mb-3 text-cyan-400">{cat.title}</h4>
                                <div className="space-y-2 mb-4 min-h-[50px]">
                                    {initialDescriptions[cat.key]?.sort().map(desc => (
                                        <div key={desc} className="flex items-center justify-between bg-gray-600/50 p-2 rounded-md text-sm">
                                            <span>{desc}</span>
                                            <button onClick={() => handleDeleteRequest(cat.key, desc)} className="p-1 text-red-400 hover:text-red-300">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        placeholder="Add new description..."
                                        value={newDescription[cat.key] || ''}
                                        onChange={(e) => handleInputChange(cat.key, e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleAdd(cat.key)}
                                        className="flex-grow p-2 bg-gray-700 rounded-md text-sm"
                                        style={{textTransform: 'capitalize'}}
                                    />
                                    <button onClick={() => handleAdd(cat.key)} className="p-2 bg-cyan-500 rounded-md hover:bg-cyan-600">
                                        <PlusCircle size={18} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                 <div className="flex justify-end mt-6 flex-shrink-0">
                    <button onClick={onClose} className="px-6 py-2 bg-gray-600 rounded-md hover:bg-gray-500">Close</button>
                </div>
            </div>
        </div>
    );
};


const BusinessPage = ({ userId, appId, currency, setConfirmAction, theme }) => {
    // Helper function to handle different date formats
    const getDateFromField = (dateField) => {
        if (!dateField) return null;
        if (dateField.toDate && typeof dateField.toDate === 'function') {
            return dateField.toDate(); // Firestore Timestamp
        }
        if (dateField instanceof Date) {
            return dateField; // Regular Date
        }
        if (typeof dateField === 'string') {
            const parsed = new Date(dateField);
            return isNaN(parsed.getTime()) ? null : parsed; // Date string
        }
        return null;
    };

    // ... existing state and useEffect hooks ...
    const [showRecruitmentModal, setShowRecruitmentModal] = useState(false);
    const [selectedRecruitment, setSelectedRecruitment] = useState(null);
    const [customSections, setCustomSections] = useState([]);
    const [sectionTitles, setSectionTitles] = useState({});
    const [alMarriEmployees, setAlMarriEmployees] = useState([]);
    const [fathoomEmployees, setFathoomEmployees] = useState([]);
    const [allBusinessEntries, setAllBusinessEntries] = useState([]);
    const [loadingTotals, setLoadingTotals] = useState(true);
    const [activeBusinessSection, setActiveBusinessSection] = useState('almarri');
    const [tickedEntries, setTickedEntries] = useState(new Set());
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [isClearingData, setIsClearingData] = useState(false); // <-- Add this
    const [isExportingExcel, setIsExportingExcel] = useState(false); // <-- Add this new state
    const importFileInputRef = useRef(null);

    const [view, setView] = useState('recent');
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
    const [nameFilter, setNameFilter] = useState('');
    const [descriptionFilter, setDescriptionFilter] = useState('');
    const [showNameFilter, setShowNameFilter] = useState(false);
    const [showDescriptionFilter, setShowDescriptionFilter] = useState(false);
    const [editingSectionId, setEditingSectionId] = useState(null);
    const [editingTitle, setEditingTitle] = useState('');

    const [showManageDescriptionsModal, setShowManageDescriptionsModal] = useState(false);
    const defaultBusinessDescriptions = useMemo(() => ({
        alMarri_fathoom: ['Qid Reniew', 'Issue Resident Permit', 'Change Passport Details', 'Sponsership Change', 'Vehicle', 'Others'],
        recruitments: ['New Recruitment', 'New Approval Charges', 'Others'],
        vehicles: ['Sponsorship', 'PRO Charges', 'Others'],
        transportation: ['Rental Charges', 'Transportation Charges', 'Others'],
        custom: ['General Income', 'General Expense', 'Others'],
    }), []);
    const [businessDescriptions, setBusinessDescriptions] = useState(defaultBusinessDescriptions);

    const commonProps = { userId, appId, currency, setConfirmAction, theme };
    
    const customSectionsRef = useMemo(() => collection(db, `artifacts/${appId}/users/${userId}/business_sections`), [userId, appId]);
    const settingsRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/settings/app_settings`), [userId, appId]);
    const businessDescriptionsRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/settings/businessDescriptions`), [userId, appId]);

    const tickedEntriesRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/businessSettings/tickedEntries`), [userId, appId]);

    const updateTickedEntriesInFirestore = useCallback(async (newSet) => {
        if (!tickedEntriesRef) return;
        try {
            await setDoc(tickedEntriesRef, { ids: Array.from(newSet) });
        } catch (error) {
            console.error("Failed to save ticked entries:", error);
        }
    }, [tickedEntriesRef]);

    // ... existing handler functions (toggle ticks, export/import, filters, etc.) ...
     const handleToggleTick = useCallback((entryId) => {
        setTickedEntries(prev => {
            const newSet = new Set(prev);
            if (newSet.has(entryId)) {
                newSet.delete(entryId);
            } else {
                newSet.add(entryId);
            }
            updateTickedEntriesInFirestore(newSet);
            return newSet;
        });
    }, [updateTickedEntriesInFirestore]);

    const handleToggleAllTicks = (entryList) => {
        const allIds = entryList.map(e => e.id);
        const allAreTicked = allIds.length > 0 && allIds.every(id => tickedEntries.has(id));

        setTickedEntries(prev => {
            const newSet = new Set(prev);
            if (allAreTicked) {
                allIds.forEach(id => newSet.delete(id));
            } else {
                allIds.forEach(id => newSet.add(id));
            }
            updateTickedEntriesInFirestore(newSet);
            return newSet;
        });
    };

    const handleClearTicks = () => {
        const newSet = new Set();
        setTickedEntries(newSet);
        updateTickedEntriesInFirestore(newSet);
    };

    const predefinedCollectionPaths = useMemo(() => [
        'business_almarri',
        'business_fathoom',
        'business_recruitments',
        'business_vehicles',
        'business_transportation',
    ], []);
    
    const allCustomSectionPaths = useMemo(() => customSections.map(s => s.collectionPath), [customSections]);

    const handleExportJson = async () => {
        setConfirmAction({
            title: 'Export Business Data',
            message: 'This will export all business entries, custom sections, and custom descriptions to a single JSON file. Proceed?',
            confirmText: 'Export',
            type: 'save',
            action: async () => {
                setIsExporting(true);
                try {
                    const dataToExport = {};
                    const collectionsToExport = [
                        ...predefinedCollectionPaths,
                        ...allCustomSectionPaths,
                        'business_sections'
                    ];

                    for (const path of collectionsToExport) {
                        const collRef = collection(db, `artifacts/${appId}/users/${userId}/${path}`);
                        const snapshot = await getDocs(collRef);
                        dataToExport[path] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    }

                    // Add business descriptions settings
                    const descriptionsRef = doc(db, `artifacts/${appId}/users/${userId}/settings/businessDescriptions`);
                    const descriptionsSnap = await getDoc(descriptionsRef);
                    if (descriptionsSnap.exists()) {
                        dataToExport['businessDescriptions'] = descriptionsSnap.data();
                    }

                    const jsonString = JSON.stringify(dataToExport, null, 2);
                    const blob = new Blob([jsonString], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `business_data_backup_${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (error) {
                    console.error("Export failed:", error);
                    alert("An error occurred during export.");
                } finally {
                    setIsExporting(false);
                }
            }
        });
    };

    const handleImportJsonChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                
                const hasSettings = importedData.businessDescriptions;
                const message = `This will DELETE ALL current business data ${hasSettings ? '(including custom sections and descriptions)' : ''} and replace it with data from the file. This action cannot be undone. Are you sure?`;

                setConfirmAction({
                    title: 'DANGER: Import Business Data',
                    message: message,
                    confirmText: 'Yes, Delete & Import',
                    type: 'delete',
                    action: async () => {
                        setIsImporting(true);
                        try {
                            const collectionsInFile = Object.keys(importedData).filter(key => key !== 'businessDescriptions');
                            const descriptionsToImport = importedData.businessDescriptions || null;

                            for (const collectionName of collectionsInFile) {
                                 const collRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionName}`);
                                 const existingDocsSnapshot = await getDocs(collRef);
                                 if (!existingDocsSnapshot.empty) {
                                    const batch = writeBatch(db);
                                    existingDocsSnapshot.forEach(doc => batch.delete(doc.ref));
                                    await batch.commit();
                                 }
                            }

                            for (const collectionName of collectionsInFile) {
                                const itemsToImport = importedData[collectionName];
                                if (Array.isArray(itemsToImport) && itemsToImport.length > 0) {
                                    const batch = writeBatch(db);
                                    itemsToImport.forEach(item => {
                                        const { id, ...data } = item;
                                        const restoredData = restoreTimestamps(data);
                                        const docRef = doc(db, `artifacts/${appId}/users/${userId}/${collectionName}`, id);
                                        batch.set(docRef, restoredData);
                                    });
                                    await batch.commit();
                                }
                            }

                            // Import settings
                            if (descriptionsToImport) {
                                const descriptionsRef = doc(db, `artifacts/${appId}/users/${userId}/settings/businessDescriptions`);
                                await setDoc(descriptionsRef, descriptionsToImport);
                            }
                            
                            alert('Import successful! The data has been restored.');
                        } catch (err) {
                            console.error("Import process failed:", err);
                            alert(`Import failed: ${err.message}`);
                        } finally {
                            setIsImporting(false);
                        }
                    }
                });

            } catch (err) {
                 alert(`Error reading file: ${err.message}`);
            }
            if(importFileInputRef.current) importFileInputRef.current.value = "";
        };
        reader.readAsText(file);
    };

    const triggerImport = () => {
        importFileInputRef.current?.click();
    };

    // --- NEW FUNCTION ---
    const handleClearBusinessData = () => {
        setConfirmAction({
            title: 'DANGER: Clear All Business Data',
            message: 'Are you sure you want to delete ALL business entries, custom sections, and custom descriptions? This action cannot be undone.',
            confirmText: 'Yes, Delete All Business Data',
            type: 'delete',
            action: async () => {
                setIsClearingData(true);
                try {
                    const collectionsToWipe = [
                        ...predefinedCollectionPaths,
                        ...allCustomSectionPaths,
                        'business_sections'
                    ];
                    
                    const batch = writeBatch(db);

                    for (const path of collectionsToWipe) {
                        if (!path) continue; // Safety check
                        const collRef = collection(db, `artifacts/${appId}/users/${userId}/${path}`);
                        const snapshot = await getDocs(collRef);
                        if (!snapshot.empty) {
                            snapshot.forEach(doc => batch.delete(doc.ref));
                        }
                    }

                    // Delete settings docs
                    const descriptionsRef = doc(db, `artifacts/${appId}/users/${userId}/settings/businessDescriptions`);
                    const tickedRef = doc(db, `artifacts/${appId}/users/${userId}/businessSettings/tickedEntries`);
                    
                    batch.delete(descriptionsRef);
                    batch.delete(tickedRef);

                    await batch.commit();

                    // Also clear section titles from app_settings
                    await setDoc(settingsRef, {
                        businessSectionTitles: {}
                    }, { merge: true });

                    alert('All Business data has been cleared.');
                } catch (err) {
                    console.error("Business data clear process failed:", err);
                    alert(`Data clear failed: ${err.message}`);
                } finally {
                    setIsClearingData(false);
                }
            }
        });
    };
    // --- END NEW FUNCTION ---

    // --- NEW EXCEL EXPORT FUNCTIONS ---
    // Helper to format data for Excel
    const processAndAddSheet = (data, sheetName, wb) => {
        if (data.length === 0) return;
        const formattedData = data.map(item => {
            const { id, source_path, ...rest } = item; // Exclude internal fields
            const newItem = {};
            for (const key in rest) {
                const value = rest[key];
                if (value && typeof value.toDate === 'function') {
                    newItem[key] = formatDate(value); // Use existing formatDate
                } else if (Array.isArray(value) || (value !== null && typeof value === 'object' && !value.toDate)) {
                    newItem[key] = JSON.stringify(value);
                } else {
                    newItem[key] = value;
                }
            }
            return newItem;
        });
        const ws = window.XLSX.utils.json_to_sheet(formattedData);
        // Sanitize sheet name (max 31 chars, no invalid chars)
        const safeSheetName = sheetName.replace(/[\\/*?[\]:]/g, "").substring(0, 31);
        window.XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
    };

    // New handler function in BusinessPage
    const handleExportExcel = () => {
        if (!window.XLSX) {
            alert("Excel export library is not ready. Please try again in a moment.");
            return;
        }

        setConfirmAction({
            title: 'Export Business (BS1) Excel',
            message: 'This will export all business sections to a single Excel file, with one sheet per section. Proceed?',
            confirmText: 'Export',
            type: 'save',
            action: async () => {
                setIsExportingExcel(true);
                try {
                    const wb = window.XLSX.utils.book_new();

                    // Use allDisplaySections to iterate
                    allDisplaySections.forEach(section => {
                        const sectionEntries = allBusinessEntries.filter(e => e.source_path === section.collectionPath);
                        // Use the user-visible title for the sheet
                        processAndAddSheet(sectionEntries, section.title, wb); 
                    });
                    
                    window.XLSX.writeFile(wb, `business_bs1_export_${new Date().toISOString().split('T')[0]}.xlsx`);

                } catch (error) {
                    console.error("Excel Export failed:", error);
                    alert("An error occurred during the Excel export.");
                } finally {
                    setIsExportingExcel(false);
                }
            }
        });
    };

    const handleImportExcel = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsImporting(true);
        try {
            const data = await file.arrayBuffer();
            const workbook = window.XLSX.read(data);

            setConfirmAction({
                title: 'Confirm Import',
                message: `This will import business data from ${workbook.SheetNames.length} sheets. Existing entries with the same ID will be updated. Continue?`,
                confirmText: 'Import',
                type: 'import',
                action: async () => {
                    try {
                        for (const sheetName of workbook.SheetNames) {
                            const worksheet = workbook.Sheets[sheetName];
                            const jsonData = window.XLSX.utils.sheet_to_json(worksheet);
                            
                            // Find the matching section
                            const matchingSection = allDisplaySections.find(s => 
                                s.title === sheetName || 
                                s.title.replace(/[\\/*?[\]:]/g, "").substring(0, 31) === sheetName
                            );
                            
                            if (!matchingSection) {
                                console.warn(`No matching section found for sheet: ${sheetName}`);
                                continue;
                            }

                            const collectionRef = collection(db, `artifacts/${appId}/users/${userId}/${matchingSection.collectionPath}`);
                            
                            for (const row of jsonData) {
                                const { id, ...dataWithoutId } = row;
                                
                                // Convert date strings back to Firestore timestamps
                                Object.keys(dataWithoutId).forEach(key => {
                                    const value = dataWithoutId[key];
                                    if (typeof value === 'string') {
                                        // Try to parse as date
                                        if (value.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                                            dataWithoutId[key] = parseDateForFirestore(value);
                                        }
                                        // Try to parse as JSON (for arrays/objects)
                                        else if ((value.startsWith('[') && value.endsWith(']')) || 
                                                 (value.startsWith('{') && value.endsWith('}'))) {
                                            try {
                                                dataWithoutId[key] = JSON.parse(value);
                                            } catch (e) {
                                                // Keep as string if parsing fails
                                            }
                                        }
                                    }
                                });

                                if (id) {
                                    await setDoc(doc(collectionRef, id), dataWithoutId, { merge: true });
                                } else {
                                    await addDoc(collectionRef, dataWithoutId);
                                }
                            }
                        }

                        alert('Import successful!');
                    } catch (error) {
                        console.error('Import process failed:', error);
                        alert(`Import failed: ${error.message}`);
                    }
                }
            });
        } catch (error) {
            console.error('Import failed:', error);
            alert(`Failed to read Excel file: ${error.message}`);
        } finally {
            setIsImporting(false);
            e.target.value = '';
        }
    };
    // --- END NEW EXCEL EXPORT FUNCTIONS ---


    const years = useMemo(() => [...new Set(allBusinessEntries.map(e => getDateFromField(e.date)?.getFullYear()))].filter(Boolean).sort((a,b) => b-a), [allBusinessEntries]);
    const months = useMemo(() => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], []);


    useEffect(() => {
        if (!userId || appId === 'default-app-id') return;
        let isMounted = true;
        
        const allPaths = [...predefinedCollectionPaths, ...allCustomSectionPaths];
        if (allPaths.length === 0) {
            setLoadingTotals(false);
            return;
        }

        setLoadingTotals(true);
        const initialFetchPromises = allPaths.map(path => 
            getDocs(collection(db, `artifacts/${appId}/users/${userId}/${path}`))
        );

        Promise.all(initialFetchPromises).then(() => {
            if(isMounted) setLoadingTotals(false);
        }).catch(err => {
            console.error("Error with initial business data fetch:", err);
            if(isMounted) setLoadingTotals(false);
        });

        const dataCache = {};
        const unsubs = allPaths.map(path => {
            const collRef = collection(db, `artifacts/${appId}/users/${userId}/${path}`);
            return onSnapshot(collRef, (snapshot) => {
                if (!isMounted) return;
                dataCache[path] = snapshot.docs.map(d => ({id: d.id, ...d.data(), source_path: path}));
                const combinedData = Object.values(dataCache).flat();
                setAllBusinessEntries(combinedData);
            }, (error) => {
                console.error(`Error fetching from ${path}:`, error);
                dataCache[path] = [];
                const combinedData = Object.values(dataCache).flat();
                setAllBusinessEntries(combinedData);
            });
        });

        return () => {
            isMounted = false;
            unsubs.forEach(unsub => unsub());
        };
    }, [userId, appId, allCustomSectionPaths, predefinedCollectionPaths]);

    const filteredBusinessEntries = useMemo(() => {
        let tempEntries = allBusinessEntries;

        if (view === 'recent') {
            const today = new Date();
            const currentYear = today.getFullYear();
            const currentMonth = today.getMonth();
            tempEntries = tempEntries.filter(e => {
                const date = getDateFromField(e.date);
                if (!date) return false;
                return date.getFullYear() === currentYear && date.getMonth() === currentMonth;
            });
        } else if (view === 'yearly') {
            tempEntries = tempEntries.filter(e => {
                const date = getDateFromField(e.date);
                if (!date) return false;
                return date.getFullYear() === selectedYear;
            });
        } else if (view === 'monthly') {
            tempEntries = tempEntries.filter(e => {
                const date = getDateFromField(e.date);
                if (!date) return false;
                return date.getFullYear() === selectedYear && date.getMonth() === selectedMonth;
            });
        }
        
        if (nameFilter) {
            const lowerNameFilter = nameFilter.toLowerCase();
            tempEntries = tempEntries.filter(e => 
                e.name && e.name.toLowerCase().includes(lowerNameFilter)
            );
        }

        if (descriptionFilter) {
            const lowerDescFilter = descriptionFilter.toLowerCase();
            tempEntries = tempEntries.filter(e => 
                e.description && e.description.toLowerCase().includes(lowerDescFilter)
            );
        }

        return [...tempEntries].sort((a, b) => {
            const dateA = getDateFromField(a.date) || new Date(0);
            const dateB = getDateFromField(b.date) || new Date(0);
            return dateA - dateB;
        });
    }, [allBusinessEntries, view, selectedYear, selectedMonth, nameFilter, descriptionFilter]);

    const summaryTotals = useMemo(() => {
        return filteredBusinessEntries.reduce((acc, entry) => {
            acc.totalIncome += entry.income || 0;
            acc.totalExpenses += entry.expense || 0;
            return acc;
        }, { totalIncome: 0, totalExpenses: 0 });
    }, [filteredBusinessEntries]);

    const profitAndLoss = summaryTotals.totalIncome - summaryTotals.totalExpenses;

    useEffect(() => {
        if (!userId || appId === 'default-app-id') return;
        const unsub = onSnapshot(customSectionsRef, (snapshot) => {
            const sectionsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setCustomSections(sectionsData);
        });
        const unsubSettings = onSnapshot(settingsRef, (doc) => {
            if (doc.exists() && doc.data().businessSectionTitles) {
                setSectionTitles(doc.data().businessSectionTitles);
            }
        });
        
        const alMarriRef = collection(db, `artifacts/${appId}/users/${userId}/alMarriData`);
        const fathoomRef = collection(db, `artifacts/${appId}/users/${userId}/fathoomData`);

        const unsubAlMarri = onSnapshot(alMarriRef, (snapshot) => {
            const employeeNames = snapshot.docs.map(doc => doc.data().fullName).filter(Boolean).sort();
            setAlMarriEmployees(employeeNames);
        });
        const unsubFathoom = onSnapshot(fathoomRef, (snapshot) => {
            const employeeNames = snapshot.docs.map(doc => doc.data().fullName).filter(Boolean).sort();
            setFathoomEmployees(employeeNames);
        });

        const unsubBusinessDescriptions = onSnapshot(businessDescriptionsRef, (docSnap) => {
            if (docSnap.exists()) {
                setBusinessDescriptions(docSnap.data());
            } else {
                setDoc(businessDescriptionsRef, defaultBusinessDescriptions);
                setBusinessDescriptions(defaultBusinessDescriptions);
            }
        });

        return () => { 
            unsub(); 
            unsubSettings(); 
            unsubAlMarri();
            unsubFathoom();
            unsubBusinessDescriptions();
        };
    }, [customSectionsRef, settingsRef, userId, appId, businessDescriptionsRef, defaultBusinessDescriptions]);

    // Effect to load persistent ticked entries
    useEffect(() => {
        if (!tickedEntriesRef) return;
        const unsub = onSnapshot(tickedEntriesRef, (docSnap) => {
            if (docSnap.exists() && Array.isArray(docSnap.data().ids)) {
                setTickedEntries(new Set(docSnap.data().ids));
            } else {
                setTickedEntries(new Set()); // No doc or empty/invalid data
            }
        }, (error) => {
            console.error("Error fetching ticked entries:", error);
        });
        return () => unsub();
    }, [tickedEntriesRef]);

    const handleAddSection = async (title) => {
        await addDoc(customSectionsRef, {
            title,
            collectionPath: `business_custom_${Date.now()}`
        });
    };

    const handleDeleteSection = (sectionId) => {
        setConfirmAction({
            title: 'Delete Business Section',
            message: 'Are you sure you want to delete this entire section? This action cannot be undone.',
            confirmText: 'Delete Section',
            type: 'delete',
            action: async () => {
                await deleteDoc(doc(customSectionsRef, sectionId));
            }
        });
    };

    const handleTitleSave = async (sectionKey, newTitle) => {
        await setDoc(settingsRef, {
            businessSectionTitles: {
                ...sectionTitles,
                [sectionKey]: newTitle
            }
        }, { merge: true });
    };
    
    const handleCustomTitleSave = async (sectionId, newTitle) => {
        const sectionDocRef = doc(customSectionsRef, sectionId);
        await updateDoc(sectionDocRef, { title: newTitle });
    };

    const handleTitleDoubleClick = (section) => {
        setEditingSectionId(section.id);
        setEditingTitle(section.title);
    };

    const handleEditingTitleChange = (e) => {
        setEditingTitle(e.target.value);
    };

    const handleTitleUpdate = (section) => {
        const newTitle = editingTitle.trim();
        if (newTitle && newTitle !== section.title) {
            if (section.isCustom) {
                handleCustomTitleSave(section.id, newTitle);
            } else {
                handleTitleSave(section.key, newTitle);
            }
        }
        setEditingSectionId(null);
        setEditingTitle('');
    };

    const handleTitleKeyDown = (e, section) => {
        if (e.key === 'Enter') {
            handleTitleUpdate(section);
        } else if (e.key === 'Escape') {
            setEditingSectionId(null);
            setEditingTitle('');
        }
    };
    
    const handleRecruitmentNameClick = (item) => {
        setSelectedRecruitment(item);
        setShowRecruitmentModal(true);
    };
    
    const handleSaveRecruitmentDetails = async (dataToSave) => {
        if (!selectedRecruitment) return;
        const recruitmentDocRef = doc(db, `artifacts/${appId}/users/${userId}/business_recruitments`, selectedRecruitment.id);
        await updateDoc(recruitmentDocRef, dataToSave);
        setShowRecruitmentModal(false);
        setSelectedRecruitment(null);
    };

    const baseColumns = [
        { header: 'Date', accessor: 'date', render: (item) => formatDate(item.date) },
        { header: 'Name', accessor: 'name' },
        { header: 'Description', accessor: 'description' },
        { header: 'Income', accessor: 'income', render: (item, currency) => formatCurrency(item.income, currency), textAlign: 'right', className: 'text-green-400' },
        { header: 'Expense', accessor: 'expense', render: (item, currency) => formatCurrency(item.expense, currency), textAlign: 'right', className: 'text-red-400' },
        { header: 'P & L', accessor: 'pnl', render: (item, currency) => formatCurrency((item.income || 0) - (item.expense || 0), currency), textAlign: 'right', className: 'font-semibold' },
        { header: 'Notes', accessor: 'notes' },
    ];
    
    const baseFormFieldsForCustom = useMemo(() => ([
        { name: 'date', label: 'Date', type: 'date' },
        { name: 'name', label: 'Name', transform: 'capitalize' },
        { 
            name: 'description', 
            label: 'Description', 
            type: 'dynamic-description', 
            options: businessDescriptions.custom || [],
        },
        { name: 'income', label: 'Income', type: 'number' },
        { name: 'expense', label: 'Expense', type: 'number' },
        { name: 'notes', label: 'Notes', type: 'textarea', colSpan: 3 },
    ]), [businessDescriptions.custom]);

    const recruitmentColumns = [
        { header: 'Date', accessor: 'date', render: (item) => formatDate(item.date) },
        { header: 'Name', accessor: 'name', render: (item) => (<button onClick={() => handleRecruitmentNameClick(item)} className="hover:text-cyan-400 text-left w-full truncate">{item.name}</button>) },
        { header: 'Description', accessor: 'description' },
        { header: 'Income', accessor: 'income', render: (item, currency) => formatCurrency(item.income, currency), textAlign: 'right', className: 'text-green-400' },
        { header: 'Expense', accessor: 'expense', render: (item, currency) => formatCurrency(item.expense, currency), textAlign: 'right', className: 'text-red-400' },
        { header: 'P & L', accessor: 'pnl', render: (item, currency) => formatCurrency((item.income || 0) - (item.expense || 0), currency), textAlign: 'right', className: 'font-semibold' },
        { header: 'Notes', accessor: 'notes' },
    ];

    const allDisplaySections = useMemo(() => {
        const predefined = [
            { 
                key: 'almarri', id: 'almarri', title: sectionTitles.almarri || 'CO1',  icon: <Briefcase size={16}/>, collectionPath: 'business_almarri', columns: baseColumns,
                formFields: [ { name: 'date', label: 'Date', type: 'date' }, { name: 'name', label: 'Name', transform: 'capitalize' }, { name: 'description', label: 'Description', type: 'dynamic-description', options: businessDescriptions.alMarri_fathoom || [], }, { name: 'income', label: 'Income', type: 'number' }, { name: 'expense', label: 'Expense', type: 'number' }, { name: 'notes', label: 'Notes', type: 'textarea', colSpan: 3 }, ], isCustom: false,
            },
            { 
                key: 'fathoom', id: 'fathoom', title: sectionTitles.fathoom || 'CO2', icon: <Truck size={16}/>, collectionPath: 'business_fathoom', columns: baseColumns,
                formFields: [ { name: 'date', label: 'Date', type: 'date' }, { name: 'name', label: 'Name', transform: 'capitalize' }, { name: 'description', label: 'Description', type: 'dynamic-description', options: businessDescriptions.alMarri_fathoom || [], }, { name: 'income', label: 'Income', type: 'number' }, { name: 'expense', label: 'Expense', type: 'number' }, { name: 'notes', label: 'Notes', type: 'textarea', colSpan: 3 }, ], isCustom: false,
            },
            { 
                key: 'recruitments', id: 'recruitments', title: sectionTitles.recruitments || 'RC',  icon: <UserPlus size={16}/>, collectionPath: 'business_recruitments', columns: recruitmentColumns,
                formFields: [ { name: 'date', label: 'Date', type: 'date' }, { name: 'name', label: 'Name', transform: 'capitalize' }, { name: 'description', label: 'Description', type: 'dynamic-description', options: businessDescriptions.recruitments || [], }, { name: 'income', label: 'Income', type: 'number' }, { name: 'expense', label: 'Expense', type: 'number' }, { name: 'notes', label: 'Notes', type: 'textarea', colSpan: 3 }, ], isCustom: false,
            },
            // Swapped Transportation and Vehicles
             { 
                key: 'transportation', id: 'transportation', title: sectionTitles.transportation || 'TR1',  icon: <Truck size={16}/>, collectionPath: 'business_transportation',
                columns: [ { header: 'Date', accessor: 'date', render: (item) => formatDate(item.date) }, { header: 'Vehicle No', accessor: 'vehicleNo' }, { header: 'Driver', accessor: 'driver' }, { header: 'Description', accessor: 'description' }, { header: 'Income', accessor: 'income', render: (item, currency) => formatCurrency(item.income, currency), textAlign: 'right', className: 'text-green-400' }, { header: 'Expense', accessor: 'expense', render: (item, currency) => formatCurrency(item.expense, currency), textAlign: 'right', className: 'text-red-400' }, { header: 'P & L', accessor: 'pnl', render: (item, currency) => formatCurrency((item.income || 0) - (item.expense || 0), currency), textAlign: 'right', className: 'font-semibold' }, { header: 'Notes', accessor: 'notes' }, ],
                formFields: [ { name: 'date', label: 'Date', type: 'date' }, { name: 'vehicleNo', label: 'Vehicle Number' }, { name: 'driver', label: 'Driver', transform: 'capitalize' }, { name: 'description', label: 'Description', type: 'dynamic-description', options: businessDescriptions.transportation || [], }, { name: 'income', label: 'Income', type: 'number' }, { name: 'expense', label: 'Expense', type: 'number' }, { name: 'notes', label: 'Notes', type: 'textarea', colSpan: 3 }, ], isCustom: false,
            },
            { 
                key: 'vehicles', id: 'vehicles', title: sectionTitles.vehicles || 'Vehicles',  icon: <Car size={16}/>, collectionPath: 'business_vehicles',
                columns: [ { header: 'Date', accessor: 'date', render: (item) => formatDate(item.date) }, { header: 'Name', accessor: 'name' }, { header: 'Vehicle No', accessor: 'vehicleNo' }, { header: 'Owner', accessor: 'owner' }, { header: 'Description', accessor: 'description' }, { header: 'Income', accessor: 'income', render: (item, currency) => formatCurrency(item.income, currency), textAlign: 'right', className: 'text-green-400' }, { header: 'Expense', accessor: 'expense', render: (item, currency) => formatCurrency(item.expense, currency), textAlign: 'right', className: 'text-red-400' }, { header: 'P & L', accessor: 'pnl', render: (item, currency) => formatCurrency((item.income || 0) - (item.expense || 0), currency), textAlign: 'right', className: 'font-semibold' }, { header: 'Notes', accessor: 'notes' }, ],
                formFields: [ { name: 'date', label: 'Date', type: 'date' }, { name: 'name', label: 'Name', transform: 'capitalize' }, { name: 'vehicleNo', label: 'Vehicle Number' }, { name: 'owner', label: 'Owner', transform: 'capitalize' }, { name: 'description', label: 'Description', type: 'dynamic-description', options: businessDescriptions.vehicles || [] }, { name: 'income', label: 'Income', type: 'number' }, { name: 'expense', label: 'Expense', type: 'number' }, { name: 'notes', label: 'Notes', type: 'textarea', colSpan: 3 }, ], isCustom: false,
            },
        ];

        const custom = customSections.filter(s => s.title && s.collectionPath).map(s => ({
            key: s.id, id: s.id, title: s.title, icon: <Carrot size={16}/>, collectionPath: s.collectionPath, columns: baseColumns,
            formFields: baseFormFieldsForCustom, isCustom: true,
            onDelete: () => handleDeleteSection(s.id), onTitleSave: (newTitle) => handleCustomTitleSave(s.id, newTitle),
        }));

        return [...predefined, ...custom];
    }, [sectionTitles, customSections, baseColumns, recruitmentColumns, businessDescriptions, baseFormFieldsForCustom]);

    const sectionsToRender = useMemo(() => {
        if (activeBusinessSection === 'all') {
            return allDisplaySections;
        }
        return allDisplaySections.filter(section => section.id === activeBusinessSection);
    }, [activeBusinessSection, allDisplaySections]);

    return (
        <div className="p-4 sm:p-8">
            <style>{`html { scroll-behavior: smooth; }`}</style>
            <div>
                
                {/* The top bar with filters/summaries that was here has been removed. */}
                {/* <div className="dark:bg-gray-800 bg-white p-4 rounded-lg ... sticky top-[70px] ...">
                    ... (content of the removed bar) ...
                 </div>
                */}

                <div className="dark:bg-gray-800 bg-white p-4 sm:p-6 rounded-lg border-l-4 border-indigo-500 mt-4">
                    {/* Adjusted sticky top position from top-[150px] to top-[70px] to account for the removed bar */}
                    <nav className="p-2 flex justify-between items-center space-x-1 sm:space-x-2 sticky top-[70px] z-30 flex-wrap gap-4 mb-6 no-print border-b-2 dark:border-gray-700 pb-4 dark:bg-gray-800 bg-white">
                        <div className="flex items-center space-x-1 sm:space-x-2 flex-wrap gap-y-2 overflow-x-auto">
                            {/* Removed the 'View All Sections' button that was here */}
                            {allDisplaySections.map(section => (
                                <div key={section.id}>
                                    {editingSectionId === section.id ? (
                                        <div className="flex items-center space-x-2 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md bg-cyan-700 text-white shadow-md">
                                            {section.icon}
                                            <input
                                                type="text"
                                                value={editingTitle}
                                                onChange={handleEditingTitleChange}
                                                onBlur={() => handleTitleUpdate(section)}
                                                onKeyDown={(e) => handleTitleKeyDown(e, section)}
                                                autoFocus
                                                className="bg-gray-800 text-white p-1 rounded-md text-xs sm:text-sm w-40 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                            />
                                        </div>
                                    ) : (
                                        <a 
                                            href={`#business-section-${section.id}`}
                                            onDoubleClick={(e) => { e.preventDefault(); handleTitleDoubleClick(section); }}
                                            onClick={(e) => {
                                                e.preventDefault();
                                                setActiveBusinessSection(section.id);
                                                const element = document.getElementById(`business-section-${section.id}`);
                                                if (element) {
                                                    // Adjust scroll position to account for the sticky nav bar height (approx 70px + subnav height)
                                                    const yOffset = -120; // Adjust this value as needed
                                                    const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
                                                    window.scrollTo({top: y, behavior: 'smooth'});
                                                }
                                            }}
                                            className={`flex items-center space-x-2 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all duration-200 flex-shrink-0 ${activeBusinessSection === section.id ? 'bg-cyan-600 text-white shadow-md' : 'dark:text-gray-300 text-gray-600 dark:hover:bg-gray-700 hover:bg-gray-200'}`}
                                            title="Double-click to edit title"
                                        >
                                            <span>{section.title}</span>
                                        </a>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Summary Cards - Moved here */}
                        <div className="flex justify-center items-center gap-4 flex-wrap">
                            <div className="dark:bg-gray-700/50 bg-white px-3 py-2 rounded-lg shadow-sm flex items-center space-x-2 min-w-[180px]">
                                <div className="p-1.5 rounded-full bg-blue-500/20"> <TrendingUp size={18} className="text-blue-400" /> </div>
                                <p className="text-lg font-bold"> {loadingTotals ? <Loader2 size={18} className="animate-spin" /> : formatCurrency(summaryTotals.totalIncome, currency)} </p>
                            </div>
                            <div className="dark:bg-gray-700/50 bg-white px-3 py-2 rounded-lg shadow-sm flex items-center space-x-2 min-w-[180px]">
                                <div className="p-1.5 rounded-full bg-red-500/20"> <TrendingDown size={18} className="text-red-400" /> </div>
                                <p className="text-lg font-bold"> {loadingTotals ? <Loader2 size={18} className="animate-spin" /> : formatCurrency(summaryTotals.totalExpenses, currency)} </p>
                            </div>
                            <div className="dark:bg-gray-700/50 bg-white px-3 py-2 rounded-lg shadow-sm flex items-center space-x-2 min-w-[180px]">
                                <div className={`p-1.5 rounded-full ${profitAndLoss >= 0 ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                                    <HandCoins size={18} className={profitAndLoss >= 0 ? 'text-green-400' : 'text-red-400'} />
                                </div>
                                <p className={`text-lg font-bold ${profitAndLoss >= 0 ? 'text-green-400' : 'text-red-400'}`}> {loadingTotals ? <Loader2 size={18} className="animate-spin" /> : formatCurrency(profitAndLoss, currency)} </p>
                            </div>
                        </div>
                        {/* End of Summary Cards */}

                        {/* Filters Moved Here */}
                        <div className="flex items-center space-x-2 sm:space-x-4 flex-wrap gap-2 justify-center">
                            {/* This block is now empty as it was moved */}
                        </div>

                        {/* Right side: Action Buttons */}
                        <div className="flex items-center space-x-2 flex-shrink-0">
                            <button onClick={() => setShowManageDescriptionsModal(true)} title="Manage Dropdown Descriptions" className="p-2.5 dark:bg-gray-600 bg-gray-200 text-sm rounded-md dark:hover:bg-gray-500 hover:bg-gray-300 no-print border dark:border-gray-600 border-gray-300 dark:text-white text-gray-800">
                                <BookOpen size={16}/>
                            </button>

                            {/* --- MOVED FILTERS START --- */}
                            <div className="flex items-center space-x-2 sm:space-x-4 flex-wrap gap-2 justify-center">
                                <select value={view} onChange={e => setView(e.target.value)} className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md border dark:border-gray-600 border-gray-300">
                                    <option value="recent">Recent</option>
                                    <option value="monthly">Monthly</option>
                                    <option value="yearly">Yearly</option>
                                    <option value="all">All Time</option>
                                </select>
                                {(view === 'yearly' || view === 'monthly') && ( <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md text-sm border dark:border-gray-600 border-gray-300 dark:text-white text-gray-800"> {years.map(y => <option key={y} value={y}>{y}</option>)} </select> )}
                                {view === 'monthly' && ( <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md text-sm border dark:border-gray-600 border-gray-300 dark:text-white text-gray-800"> {months.map((m, i) => <option key={m} value={i}>{m}</option>)} </select> )}
                            </div>
                            {/* --- MOVED FILTERS END --- */}

                            {/* --- NEW FILTERS START --- */}
                            <button 
                                onClick={() => { setShowNameFilter(s => !s); setShowDescriptionFilter(false); }} 
                                title="Filter by Name" 
                                className={`p-2.5 text-sm rounded-md no-print border dark:border-gray-600 border-gray-300 transition-colors ${showNameFilter ? 'bg-cyan-600 text-white' : 'dark:bg-gray-600 bg-gray-200 dark:hover:bg-gray-500 hover:bg-gray-300 dark:text-white text-gray-800'}`}
                            >
                                <Search size={16}/>
                            </button>
                            {showNameFilter && (
                                <div className="relative">
                                    <input 
                                        type="text" 
                                        placeholder="Filter by Name..." 
                                        value={nameFilter} 
                                        onChange={e => setNameFilter(e.target.value)}
                                        className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md pl-8 border dark:border-gray-600 border-gray-300 w-40"
                                        autoFocus
                                    />
                                    <Search size={18} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                                </div>
                            )}

                            <button 
                                onClick={() => { setShowDescriptionFilter(s => !s); setShowNameFilter(false); }} 
                                title="Filter by Description" 
                                className={`p-2.5 text-sm rounded-md no-print border dark:border-gray-600 border-gray-300 transition-colors ${showDescriptionFilter ? 'bg-cyan-600 text-white' : 'dark:bg-gray-600 bg-gray-200 dark:hover:bg-gray-500 hover:bg-gray-300 dark:text-white text-gray-800'}`}
                            >
                                <Search size={16}/>
                            </button>
                            {showDescriptionFilter && (
                                <div className="relative">
                                    <input 
                                        type="text" 
                                        placeholder="Filter by Description..." 
                                        value={descriptionFilter} 
                                        onChange={e => setDescriptionFilter(e.target.value)}
                                        className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md pl-8 border dark:border-gray-600 border-gray-300 w-40"
                                        autoFocus
                                    />
                                    <Search size={18} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                                </div>
                            )}
                            {/* --- NEW FILTERS END --- */}

                            {/* Excel Export Button */}
                            <button 
                                onClick={handleExportExcel} 
                                disabled={isExportingExcel || isExporting || isImporting || isClearingData} 
                                title="Export Business (BS1) to Excel" 
                                className="group flex items-center space-x-2 px-4 py-2 dark:bg-green-700 bg-green-100 rounded-full dark:hover:bg-green-600 hover:bg-green-200 text-sm font-semibold transition-all duration-300 disabled:opacity-50 border dark:border-green-600 border-green-300 dark:text-white text-green-700 shadow-md hover:shadow-lg hover:scale-105 no-print"
                            >
                                {isExportingExcel ? <Loader2 size={16} className="animate-spin" /> : <FileCheck2 size={16}/>}
                                <span>{isExportingExcel ? 'Exporting...' : 'Export Excel'}</span>
                            </button>
                            {/* Excel Import Button */}
                            <input
                                ref={importFileInputRef}
                                type="file"
                                accept=".xlsx,.xls"
                                onChange={handleImportExcel}
                                className="hidden"
                            />
                            <button 
                                onClick={() => importFileInputRef.current?.click()} 
                                disabled={isImporting || isExportingExcel || isExporting || isClearingData} 
                                title="Import Business (BS1) from Excel" 
                                className="group flex items-center space-x-2 px-4 py-2 dark:bg-blue-700 bg-blue-100 rounded-full dark:hover:bg-blue-600 hover:bg-blue-200 text-sm font-semibold transition-all duration-300 disabled:opacity-50 border dark:border-blue-600 border-blue-300 dark:text-white text-blue-700 shadow-md hover:shadow-lg hover:scale-105 no-print"
                            >
                                {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16}/>}
                                <span>{isImporting ? 'Importing...' : 'Import Excel'}</span>
                            </button>
                            {/* Clear All Button */}
                            <button onClick={handleClearBusinessData} disabled={isClearingData || isExportingExcel} title="Clear All Business Data" className="p-2.5 dark:bg-red-700 bg-red-100 text-sm rounded-md dark:hover:bg-red-800 hover:bg-red-200 no-print disabled:bg-gray-500 border dark:border-red-600 border-red-300 dark:text-white text-red-700">
                                {isClearingData ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16}/>}
                            </button>
                             <AddNewBusinessSection onAdd={handleAddSection} />
                        </div>
                    </nav>

                    {/* Content Sections */}
                    <div className="space-y-8">
                        {sectionsToRender.map(section => {
                            const sectionEntries = filteredBusinessEntries
                                .filter(e => e.source_path === section.collectionPath);
                            const { key: sectionKey, ...sectionProps } = section;
                            return (
                                <div id={`business-section-${section.id}`} key={section.collectionPath}>
                                    <StructuredBusinessSection 
                                        key={sectionKey}
                                        {...sectionProps} 
                                        onTitleSave={sectionKey === 'almarri' || sectionKey === 'fathoom' ? (newTitle) => handleTitleSave(sectionKey, newTitle) : section.onTitleSave}
                                        {...commonProps} 
                                        employeeList={sectionKey === 'almarri' ? alMarriEmployees : sectionKey === 'fathoom' ? fathoomEmployees : []}
                                        entries={sectionEntries}
                                        tickedEntries={tickedEntries}
                                        onToggleTick={handleToggleTick}
                                        onToggleAllTicks={handleToggleAllTicks}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
            {showRecruitmentModal && <RecruitmentDetailModal isOpen={showRecruitmentModal} onClose={() => setShowRecruitmentModal(false)} onSave={handleSaveRecruitmentDetails} initialData={selectedRecruitment} />}
            {showManageDescriptionsModal && <ManageBusinessDescriptionsModal userId={userId} appId={appId} onClose={() => setShowManageDescriptionsModal(false)} initialDescriptions={businessDescriptions} setConfirmAction={setConfirmAction} />}
        </div>
    );
};

const AddEditEmployeeModal = ({ onSave, onClose, initialData, employees, userId, appId, collectionPath, setConfirmAction }) => {
    const defaultState = {
        eNo: '', fullName: '', nationality: '', profession: '', qid: '', qidExpiry: '', 
        contact1: '', status: 'Active',
        idCopy: false, ppCopy: false, lcCopy: false, settle: false,
        gender: '',
        idCopyUrl: '', ppCopyUrl: '', lcCopyUrl: '', settleDocUrl: '',
        joinDate: '', departedDate: '', passport: '', passportExpiry: '',
        payCard: '', payCardPin: '', payCardExpiry: '',
        labourContract: '', labourContractExpiry: '',
        contact2: '', contact3: '', address: '', notes: '',
        photoURL: '', storagePath: '',
    };
    const [formData, setFormData] = useState(initialData ? 
        {
            ...initialData,
            qidExpiry: formatDate(initialData.qidExpiry),
            joinDate: formatDate(initialData.joinDate),
            departedDate: formatDate(initialData.departedDate),
            passportExpiry: formatDate(initialData.passportExpiry),
            payCardExpiry: formatDate(initialData.payCardExpiry),
            labourContractExpiry: formatDate(initialData.labourContractExpiry),
        } 
        : defaultState
    );
    const [errorMessage, setErrorMessage] = useState('');
    const [docUploadStates, setDocUploadStates] = useState({});
    const [pendingDocs, setPendingDocs] = useState({}); // Store files for new employees
    const [pendingPhoto, setPendingPhoto] = useState(null); // Store photo for new employees
    const [docPreview, setDocPreview] = useState(null);
    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
    const [photoUploadError, setPhotoUploadError] = useState(null);
    const photoInputRef = useRef(null);
    const employeeDocRef = useMemo(() => 
        initialData?.id ? doc(db, `artifacts/${appId}/users/${userId}/${collectionPath}`, initialData.id) : null,
        [appId, userId, collectionPath, initialData?.id]
    );
    
    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handlePhotoChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            setPhotoUploadError("File is too large. Please select an image under 5MB.");
            return;
        }

        // For new employees (no ID yet), store file temporarily
        if (!initialData?.id) {
            setPendingPhoto(file);
            // Create a preview URL
            const previewURL = URL.createObjectURL(file);
            setFormData(prev => ({ ...prev, photoURL: previewURL }));
            setPhotoUploadError(null);
            return;
        }

        setIsUploadingPhoto(true);
        setPhotoUploadError(null);

        try {
            // Delete old photo if exists
            if (formData.storagePath) {
                try {
                    const oldStorageRef = ref(storage, formData.storagePath);
                    await deleteObject(oldStorageRef);
                } catch (deleteErr) {
                    console.warn("Could not delete old photo:", deleteErr);
                }
            }

            // Upload new photo
            const storagePath = `employee_photos/${collectionPath}/${initialData.id}/${Date.now()}_${file.name}`;
            const newStorageRef = ref(storage, storagePath);
            await uploadBytes(newStorageRef, file);
            const downloadURL = await getDownloadURL(newStorageRef);

            // Update Firestore
            await updateDoc(employeeDocRef, {
                photoURL: downloadURL,
                storagePath: storagePath
            });

            // Update local state
            setFormData(prev => ({
                ...prev,
                photoURL: downloadURL,
                storagePath: storagePath
            }));

        } catch (err) {
            console.error("Error uploading photo:", err);
            setPhotoUploadError("Upload failed. Please try again.");
        } finally {
            setIsUploadingPhoto(false);
            if (photoInputRef.current) photoInputRef.current.value = "";
        }
    };

    const handleRemovePhoto = async () => {
        if (!formData.storagePath || !initialData?.id) return;

        if (!window.confirm(`Are you sure you want to remove the profile photo?`)) {
            return;
        }

        setIsUploadingPhoto(true);
        try {
            const storageRef = ref(storage, formData.storagePath);
            await deleteObject(storageRef);
            
            await updateDoc(employeeDocRef, {
                photoURL: null,
                storagePath: null
            });
            
            setFormData(prev => ({
                ...prev,
                photoURL: null,
                storagePath: null
            }));
        } catch (err) {
            console.error("Error removing photo:", err);
            setPhotoUploadError("Could not remove photo. Please try again.");
        } finally {
            setIsUploadingPhoto(false);
        }
    };

    const handleDocumentUpload = async (type, file) => {
        if (!file) return;
        if (file.type !== 'application/pdf') {
            setDocUploadStates(prev => ({ ...prev, [type]: { uploading: false, error: 'Only PDF files allowed.' } }));
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setDocUploadStates(prev => ({ ...prev, [type]: { uploading: false, error: 'File too large (max 5MB).' } }));
            return;
        }
        
        // For new employees (no ID yet), store file temporarily to upload after save
        if (!initialData?.id) {
            setPendingDocs(prev => ({ ...prev, [type]: file }));
            setFormData(prev => ({ ...prev, [type]: true }));
            return;
        }

        setDocUploadStates(prev => ({ ...prev, [type]: { uploading: true, error: null } }));
        try {
            console.log('[EMPLOYEE MODAL] Starting upload...', { type, userId, appId, currentUser: auth.currentUser?.uid });
            const storagePath = `employee_docs/${collectionPath}/${initialData.id}/${type}_${Date.now()}.pdf`;
            const storageRef = ref(storage, storagePath);
            console.log('[EMPLOYEE MODAL] Storage path:', storagePath);
            console.log('[EMPLOYEE MODAL] Auth token:', await auth.currentUser?.getIdToken());
            await uploadBytes(storageRef, file);
            console.log('[EMPLOYEE MODAL] Upload successful, getting URL...');
            const downloadURL = await getDownloadURL(storageRef);
            console.log('[EMPLOYEE MODAL] Download URL:', downloadURL);
            
            // Update Firestore immediately
            const employeesRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`);
            await updateDoc(doc(employeesRef, initialData.id), {
                [`${type}`]: true,
                [`${type}Url`]: downloadURL,
                [`${type}StoragePath`]: storagePath,
                updatedAt: new Date()
            });

            // Update local form state
            setFormData(prev => ({
                ...prev,
                [type]: true,
                [`${type}Url`]: downloadURL,
                [`${type}StoragePath`]: storagePath
            }));
            
            setDocUploadStates(prev => ({ ...prev, [type]: { uploading: false, error: null } }));
        } catch (err) {
            console.error('[EMPLOYEE MODAL] Upload failed:', err);
            console.error('[EMPLOYEE MODAL] Error code:', err.code);
            console.error('[EMPLOYEE MODAL] Error message:', err.message);
            console.error('[EMPLOYEE MODAL] Full error:', JSON.stringify(err, null, 2));
            setDocUploadStates(prev => ({ ...prev, [type]: { uploading: false, error: `Upload failed: ${err.message || 'Unknown error'}` } }));
        }
    };

    const handleDocumentDelete = async (type, urlField, storagePathField) => {
        if (!initialData?.id || !formData[storagePathField]) return;
        
        if (!window.confirm(`Are you sure you want to delete this document? This action cannot be undone.`)) {
            return;
        }

        setDocUploadStates(prev => ({ ...prev, [type]: { uploading: true, error: null } }));
        try {
            // Delete from Storage
            const storageRef = ref(storage, formData[storagePathField]);
            await deleteObject(storageRef);
            
            // Update Firestore
            const employeesRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`);
            await updateDoc(doc(employeesRef, initialData.id), {
                [`${type}`]: false,
                [`${urlField}`]: null,
                [`${storagePathField}`]: null,
                updatedAt: new Date()
            });

            // Update local form state
            setFormData(prev => ({
                ...prev,
                [type]: false,
                [urlField]: null,
                [storagePathField]: null
            }));
            
            setDocUploadStates(prev => ({ ...prev, [type]: { uploading: false, error: null } }));
        } catch (err) {
            console.error('Delete failed:', err);
            setDocUploadStates(prev => ({ ...prev, [type]: { uploading: false, error: 'Delete failed.' } }));
        }
    };

    const handleSave = () => {
        // ... existing validation logic ...
        const uniqueFields = ['eNo', 'qid', 'contact1'];
        let duplicateError = null;

        for (const field of uniqueFields) {
            const valueToCheck = formData[field];
            if (!valueToCheck || String(valueToCheck).trim() === '') continue;

            const duplicateEmployee = employees.find(emp => {
                if (initialData && emp.id === initialData.id) return false;
                return emp[field] && String(emp[field]).trim().toLowerCase() === String(valueToCheck).trim().toLowerCase();
            });

            if (duplicateEmployee) {
                duplicateError = `The value "${valueToCheck}" for ${field} is already used by ${duplicateEmployee.fullName}.`;
                break;
            }
        }

        if (duplicateError) {
            setErrorMessage(duplicateError);
            return;
        }

        setErrorMessage('');
        
        const dataToSave = {
            ...formData,
            fullName: capitalizeWords(formData.fullName),
            gender: (formData.gender || '').toUpperCase(),
            nationality: capitalizeWords(formData.nationality),
            profession: capitalizeWords(formData.profession),
            qidExpiry: parseDateForFirestore(formData.qidExpiry),
            joinDate: parseDateForFirestore(formData.joinDate),
            departedDate: parseDateForFirestore(formData.departedDate),
            passportExpiry: parseDateForFirestore(formData.passportExpiry),
            payCardExpiry: parseDateForFirestore(formData.payCardExpiry),
            labourContractExpiry: parseDateForFirestore(formData.labourContractExpiry),
        };

        // If new employee with pending docs or photo, handle uploads after save
        if (!initialData?.id && (Object.keys(pendingDocs).length > 0 || pendingPhoto)) {
            // Save employee first, then upload docs and photo
            const uploadPendingFiles = async (newEmployeeId) => {
                // Upload pending photo first
                if (pendingPhoto) {
                    try {
                        const storagePath = `employee_photos/${collectionPath}/${newEmployeeId}/${Date.now()}_${pendingPhoto.name}`;
                        const storageRef = ref(storage, storagePath);
                        await uploadBytes(storageRef, pendingPhoto);
                        const downloadURL = await getDownloadURL(storageRef);
                        
                        const employeesRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`);
                        await updateDoc(doc(employeesRef, newEmployeeId), {
                            photoURL: downloadURL,
                            storagePath: storagePath,
                            updatedAt: new Date()
                        });
                    } catch (err) {
                        console.error('Failed to upload photo:', err);
                    }
                }
                
                // Upload pending documents
                for (const [type, file] of Object.entries(pendingDocs)) {
                    try {
                        const storagePath = `employee_docs/${collectionPath}/${newEmployeeId}/${type}_${Date.now()}.pdf`;
                        const storageRef = ref(storage, storagePath);
                        await uploadBytes(storageRef, file);
                        const downloadURL = await getDownloadURL(storageRef);
                        
                        const employeesRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`);
                        await updateDoc(doc(employeesRef, newEmployeeId), {
                            [`${type}`]: true,
                            [`${type}Url`]: downloadURL,
                            [`${type}StoragePath`]: storagePath,
                            updatedAt: new Date()
                        });
                    } catch (err) {
                        console.error(`Failed to upload ${type}:`, err);
                    }
                }
            };
            
            // Save with callback to upload files
            onSave(dataToSave, uploadPendingFiles);
        } else {
            onSave(dataToSave);
        }
        
        onClose();
    };


    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4 overflow-y-auto">
            <div className="dark:bg-gray-800 bg-white rounded-xl shadow-2xl w-full max-w-5xl my-8">
                {/* Header */}
                <div className="flex justify-between items-center px-6 py-4 border-b dark:border-gray-700 border-gray-300">
                    <h3 className="text-xl font-bold text-cyan-400">{initialData ? 'Edit Employee' : 'Add New Employee'}</h3>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700 transition-colors"><X size={20}/></button>
                </div>

                {errorMessage && <div className="mx-6 mt-4 bg-red-500/20 text-red-300 p-3 rounded-md text-sm">{errorMessage}</div>}
                
                <div className="max-h-[75vh] overflow-y-auto px-6 py-4">
                    {/* Two Column Layout */}
                    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
                        {/* Left Column - Photo */}
                        <div className="flex flex-col items-center">
                            {formData.photoURL ? (
                                <img 
                                    src={formData.photoURL} 
                                    alt={formData.fullName || 'Employee'} 
                                    className="w-40 h-40 rounded-full object-cover border-4 dark:border-gray-600 border-gray-200 shadow-lg"
                                    onError={(e) => { e.target.onerror = null; e.target.src="https://placehold.co/160x160/4A5568/E2E8F0?text=No+Photo"; }}
                                />
                            ) : (
                                <div className="w-40 h-40 rounded-full bg-gradient-to-br from-gray-600 to-gray-700 flex items-center justify-center border-4 dark:border-gray-600 border-gray-200 shadow-lg">
                                    <Users size={60} className="text-gray-400" />
                                </div>
                            )}
                            <input 
                                type="file" 
                                ref={photoInputRef} 
                                onChange={handlePhotoChange} 
                                className="hidden" 
                                accept="image/png, image/jpeg, image/webp"
                            />
                            <button 
                                onClick={() => photoInputRef.current?.click()} 
                                disabled={isUploadingPhoto}
                                className="mt-4 w-full px-3 py-2 bg-cyan-500 hover:bg-cyan-600 rounded-lg text-sm font-medium disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors flex items-center justify-center space-x-2"
                            >
                                {isUploadingPhoto ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
                                <span>{isUploadingPhoto ? 'Uploading...' : formData.photoURL ? 'Change' : 'Select Photo'}</span>
                            </button>
                            {formData.photoURL && !isUploadingPhoto && (
                                <button 
                                    onClick={() => {
                                        if (!initialData?.id) {
                                            // Remove pending photo
                                            setPendingPhoto(null);
                                            setFormData(prev => ({ ...prev, photoURL: null }));
                                        } else {
                                            handleRemovePhoto();
                                        }
                                    }} 
                                    className="mt-2 w-full px-3 py-2 bg-red-500 hover:bg-red-600 rounded-lg text-sm font-medium transition-colors flex items-center justify-center space-x-2"
                                >
                                    <Trash2 size={14} />
                                    <span>Remove</span>
                                </button>
                            )}
                            {photoUploadError && <p className="text-red-400 text-xs mt-2 text-center">{photoUploadError}</p>}
                            {!initialData?.id && pendingPhoto && <p className="text-xs mt-3 text-center dark:text-cyan-400 text-cyan-600 font-medium">✓ Ready to upload after save</p>}
                        </div>

                        {/* Right Column - Form Fields */}
                        <div className="space-y-5">
                            {/* Basic Info Section */}
                            <div>
                                <h4 className="text-sm font-semibold mb-3 dark:text-cyan-400 text-cyan-600 flex items-center space-x-2">
                                    <IdCard size={14} />
                                    <span>Basic Information</span>
                                </h4>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                        <div>
                                            <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">E.NO</label>
                                            <input type="text" name="eNo" value={formData.eNo} onChange={handleChange} className="w-full px-2 py-1.5 text-sm dark:bg-gray-700 bg-white rounded border dark:border-gray-600 border-gray-300 focus:ring-1 focus:ring-cyan-500 outline-none" />
                                        </div>
                                        <div>
                                            <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Gender</label>
                                            <select name="gender" value={formData.gender || ''} onChange={handleChange} className="w-full px-2 py-1.5 text-sm dark:bg-gray-700 bg-white rounded border dark:border-gray-600 border-gray-300 focus:ring-1 focus:ring-cyan-500 outline-none">
                                                <option value="">Select...</option>
                                                <option value="M">Male</option>
                                                <option value="F">Female</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Status</label>
                                            <select name="status" value={formData.status} onChange={handleChange} className="w-full px-2 py-1.5 text-sm dark:bg-gray-700 bg-white rounded border dark:border-gray-600 border-gray-300 focus:ring-1 focus:ring-cyan-500 outline-none">
                                                <option>Active</option>
                                                <option>Vacation</option>
                                                <option>Changed</option>
                                                <option>Cancelled</option>
                                                <option>Case Filed</option>
                                                <option>Waiting for Join</option>
                                                <option>SC Requested</option>
                                                <option>Others</option>
                                            </select>
                                        </div>
                                        <div className="col-span-2 md:col-span-3">
                                            <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Full Name</label>
                                            <input type="text" name="fullName" value={formData.fullName} onChange={handleChange} className="w-full px-2 py-1.5 text-sm dark:bg-gray-700 bg-white rounded border dark:border-gray-600 border-gray-300 focus:ring-1 focus:ring-cyan-500 outline-none capitalize" />
                                        </div>
                                        <div>
                                            <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Nationality</label>
                                            <input type="text" name="nationality" value={formData.nationality} onChange={handleChange} className="w-full px-2 py-1.5 text-sm dark:bg-gray-700 bg-white rounded border dark:border-gray-600 border-gray-300 focus:ring-1 focus:ring-cyan-500 outline-none capitalize" />
                                        </div>
                                        <div>
                                            <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Profession</label>
                                            <input type="text" name="profession" value={formData.profession} onChange={handleChange} className="w-full px-2 py-1.5 text-sm dark:bg-gray-700 bg-white rounded border dark:border-gray-600 border-gray-300 focus:ring-1 focus:ring-cyan-500 outline-none capitalize" />
                                        </div>
                                        <div>
                                            <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Contact</label>
                                            <input type="text" name="contact1" value={formData.contact1} onChange={handleChange} className="w-full px-2 py-1.5 text-sm dark:bg-gray-700 bg-white rounded border dark:border-gray-600 border-gray-300 focus:ring-1 focus:ring-cyan-500 outline-none" />
                                        </div>
                                        <div>
                                            <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">QID</label>
                                            <input type="text" name="qid" value={formData.qid} onChange={handleChange} className="w-full px-2 py-1.5 text-sm dark:bg-gray-700 bg-white rounded border dark:border-gray-600 border-gray-300 focus:ring-1 focus:ring-cyan-500 outline-none" />
                                        </div>
                                        <div>
                                            <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">QID Expiry</label>
                                            <DateInput value={formData.qidExpiry} onChange={val => setFormData(p => ({ ...p, qidExpiry: val }))} />
                                        </div>
                                    </div>
                                </div>

                            {/* Extended Details Section */}
                            <div>
                                <h4 className="text-sm font-semibold mb-3 dark:text-cyan-400 text-cyan-600 flex items-center space-x-2">
                                    <FileText size={14} />
                                    <span>Extended Details</span>
                                </h4>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Join Date</label>
                                        <DateInput value={formData.joinDate} onChange={val => setFormData(p => ({ ...p, joinDate: val }))} />
                                    </div>
                                    <div>
                                        <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Departed Date</label>
                                        <DateInput value={formData.departedDate} onChange={val => setFormData(p => ({ ...p, departedDate: val }))} />
                                    </div>
                                    <div>
                                        <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Passport</label>
                                        <input type="text" name="passport" value={formData.passport} onChange={handleChange} className="w-full px-2 py-1.5 text-sm dark:bg-gray-700 bg-white rounded border dark:border-gray-600 border-gray-300 focus:ring-1 focus:ring-cyan-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Passport Expiry</label>
                                        <DateInput value={formData.passportExpiry} onChange={val => setFormData(p => ({ ...p, passportExpiry: val }))} />
                                    </div>
                                    <div>
                                        <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Labour Contract</label>
                                        <input type="text" name="labourContract" value={formData.labourContract} onChange={handleChange} className="w-full px-2 py-1.5 text-sm dark:bg-gray-700 bg-white rounded border dark:border-gray-600 border-gray-300 focus:ring-1 focus:ring-cyan-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Labour Contract Expiry</label>
                                        <DateInput value={formData.labourContractExpiry} onChange={val => setFormData(p => ({ ...p, labourContractExpiry: val }))} />
                                    </div>
                                    <div>
                                        <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Pay Card</label>
                                        <input type="text" name="payCard" value={formData.payCard} onChange={handleChange} className="w-full px-2 py-1.5 text-sm dark:bg-gray-700 bg-white rounded border dark:border-gray-600 border-gray-300 focus:ring-1 focus:ring-cyan-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Pay Card PIN</label>
                                        <input type="text" name="payCardPin" value={formData.payCardPin} onChange={handleChange} className="w-full px-2 py-1.5 text-sm dark:bg-gray-700 bg-white rounded border dark:border-gray-600 border-gray-300 focus:ring-1 focus:ring-cyan-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Pay Card Expiry</label>
                                        <DateInput value={formData.payCardExpiry} onChange={val => setFormData(p => ({ ...p, payCardExpiry: val }))} />
                                    </div>
                                    <div>
                                        <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Contact 2</label>
                                        <input type="text" name="contact2" value={formData.contact2} onChange={handleChange} className="w-full px-2 py-1.5 text-sm dark:bg-gray-700 bg-white rounded border dark:border-gray-600 border-gray-300 focus:ring-1 focus:ring-cyan-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Contact 3</label>
                                        <input type="text" name="contact3" value={formData.contact3} onChange={handleChange} className="w-full px-2 py-1.5 text-sm dark:bg-gray-700 bg-white rounded border dark:border-gray-600 border-gray-300 focus:ring-1 focus:ring-cyan-500 outline-none" />
                                    </div>
                                    <div className="col-span-2 md:col-span-3">
                                        <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Address</label>
                                        <textarea name="address" value={formData.address} onChange={handleChange} rows="2" className="w-full px-2 py-1.5 text-sm dark:bg-gray-700 bg-white rounded border dark:border-gray-600 border-gray-300 focus:ring-1 focus:ring-cyan-500 outline-none resize-none" />
                                    </div>
                                    <div className="col-span-2 md:col-span-3">
                                        <label className="block text-xs mb-1 dark:text-gray-400 text-gray-600">Notes</label>
                                        <textarea name="notes" value={formData.notes} onChange={handleChange} rows="2" className="w-full px-2 py-1.5 text-sm dark:bg-gray-700 bg-white rounded border dark:border-gray-600 border-gray-300 focus:ring-1 focus:ring-cyan-500 outline-none resize-none" />
                                    </div>
                                </div>
                            </div>

                            {/* Documents Section */}
                            <div>
                                <h4 className="text-sm font-semibold mb-3 dark:text-cyan-400 text-cyan-600 flex items-center space-x-2">
                                    <FileUp size={14} />
                                    <span>Documents</span>
                                </h4>
                                {!initialData?.id && Object.keys(pendingDocs).length > 0 && (
                                    <div className="bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 px-3 py-2 rounded-lg mb-3 text-xs flex items-center space-x-2">
                                        <span className="font-medium">{Object.keys(pendingDocs).length} document(s) ready to upload after save</span>
                                    </div>
                                )}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    {[
                                        { type: 'idCopy', urlField: 'idCopyUrl', label: 'ID Copy', icon: <IdCard size={14} /> },
                                        { type: 'ppCopy', urlField: 'ppCopyUrl', label: 'Passport', icon: <BookUser size={14} /> },
                                        { type: 'lcCopy', urlField: 'lcCopyUrl', label: 'Labour Card', icon: <FileText size={14} /> },
                                        { type: 'settle', urlField: 'settleDocUrl', label: 'Settlement', icon: <HandCoins size={14} /> }
                                    ].map(({ type, urlField, label, icon }) => {
                                        const state = docUploadStates[type] || { uploading: false, error: null };
                                        const hasDoc = !!formData[urlField];
                                        const hasPending = !!pendingDocs[type];
                                        const inputId = `modal_file_${type}`;
                                        return (
                                            <div key={type} className="dark:bg-gray-700/50 bg-gray-50 p-2.5 rounded-lg border dark:border-gray-600 border-gray-200">
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center space-x-1.5 text-xs font-medium dark:text-gray-300 text-gray-700">
                                                        {icon}
                                                        <span>{label}</span>
                                                    </div>
                                                    {hasDoc && <span className="text-[10px] px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">✓</span>}
                                                    {!hasDoc && hasPending && <span className="text-[10px] px-1.5 py-0.5 bg-cyan-500/20 text-cyan-400 rounded">Ready</span>}
                                                </div>
                                                <div className="flex items-center space-x-1.5">
                                                    {state.uploading ? (
                                                        <div className="w-full flex items-center justify-center py-2">
                                                            <Loader2 size={16} className="animate-spin text-cyan-400" />
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <label 
                                                                htmlFor={inputId}
                                                                className={`flex-1 flex items-center justify-center space-x-1 px-2 py-1.5 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                                                                    hasDoc
                                                                        ? 'dark:bg-yellow-600 bg-yellow-500 hover:bg-yellow-600 text-white'
                                                                        : hasPending
                                                                            ? 'dark:bg-cyan-600 bg-cyan-500 hover:bg-cyan-600 text-white'
                                                                            : 'dark:bg-cyan-600 bg-cyan-500 hover:bg-cyan-600 text-white'
                                                                }`}
                                                            >
                                                                <FileUp size={12} />
                                                                <span>{hasDoc ? 'Replace' : hasPending ? 'Change' : 'Select'}</span>
                                                            </label>
                                                            <input 
                                                                id={inputId}
                                                                type="file" 
                                                                accept="application/pdf" 
                                                                className="hidden" 
                                                                onChange={(e) => {
                                                                    const file = e.target.files[0];
                                                                    if (file) handleDocumentUpload(type, file);
                                                                    e.target.value = '';
                                                                }}
                                                            />
                                                            {hasDoc && (
                                                                <>
                                                                    <button
                                                                        onClick={() => setDocPreview({ url: formData[urlField], type: label, employeeName: formData.fullName })}
                                                                        className="p-1.5 dark:bg-cyan-600 bg-cyan-500 hover:bg-cyan-600 rounded transition-colors"
                                                                        title="View"
                                                                    >
                                                                        <Eye size={12} />
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDocumentDelete(type, urlField, `${type}StoragePath`)}
                                                                        className="p-1.5 dark:bg-red-600 bg-red-500 hover:bg-red-600 rounded transition-colors"
                                                                        title="Delete"
                                                                    >
                                                                        <Trash2 size={12} />
                                                                    </button>
                                                                </>
                                                            )}
                                                            {!hasDoc && hasPending && (
                                                                <button
                                                                    onClick={() => {
                                                                        const newPending = {...pendingDocs};
                                                                        delete newPending[type];
                                                                        setPendingDocs(newPending);
                                                                    }}
                                                                    className="p-1.5 dark:bg-red-600 bg-red-500 hover:bg-red-600 rounded transition-colors"
                                                                    title="Remove"
                                                                >
                                                                    <X size={12} />
                                                                </button>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                                {hasPending && <div className="mt-1 text-[10px] dark:text-cyan-400 text-cyan-600 truncate" title={pendingDocs[type]?.name}>{pendingDocs[type]?.name}</div>}
                                                {state.error && <div className="mt-1 text-[10px] text-red-400">{state.error}</div>}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Footer Buttons */}
                    <div className="flex justify-end space-x-3 pt-4 mt-5 border-t dark:border-gray-700 border-gray-200">
                        <button 
                            onClick={onClose} 
                            className="px-5 py-2 bg-gray-600 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleSave} 
                            className="px-5 py-2 bg-cyan-500 hover:bg-cyan-600 rounded-lg text-sm font-medium transition-colors flex items-center space-x-2"
                        >
                            <Save size={16} />
                            <span>Save Employee</span>
                        </button>
                    </div>
                </div>
            </div>
            
            {docPreview && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4" onClick={() => setDocPreview(null)}>
                    <div className="dark:bg-gray-800 bg-white rounded-lg shadow-xl w-full max-w-4xl h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-3 border-b dark:border-gray-700 border-gray-300">
                            <h4 className="font-semibold text-sm">{docPreview.type} - {docPreview.employeeName}</h4>
                            <button onClick={() => setDocPreview(null)} className="p-1 hover:text-red-400" title="Close"><X size={16} /></button>
                        </div>
                        <div className="flex-1 overflow-hidden">
                            <iframe src={docPreview.url} title="Document Preview" className="w-full h-full rounded-b-lg" />
                        </div>
                        <div className="p-2 flex justify-end space-x-2 border-t dark:border-gray-700 border-gray-300">
                            <a href={docPreview.url} target="_blank" rel="noopener noreferrer" className="px-3 py-1 text-xs rounded-md bg-cyan-500 hover:bg-cyan-600" title="Open in new tab">Open Full</a>
                            <button onClick={() => setDocPreview(null)} className="px-3 py-1 text-xs rounded-md bg-gray-600 hover:bg-gray-700">Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const PayCardModal = ({ isOpen, onClose, employees }) => {
    if (!isOpen) return null;

    const handleDownload = () => {
        const headers = ["S.No", "Full Name", "Nationality", "QID", "Paycard Number", "Pay Card PIN", "Pay Card Expiry"];
        let csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n";

        employees.forEach((e, index) => {
            const row = [
                index + 1,
                `"${e.fullName || ''}"`,
                `"${e.nationality || ''}"`,
                `"${e.qid || ''}"`,
                `"${e.payCard || ''}"`,
                `"${e.payCardPin || ''}"`,
                `"${formatDate(e.payCardExpiry)}"`
            ].join(",");
            csvContent += row + "\n";
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "pay_card_details.csv");
        document.body.appendChild(link);
        link.click();
        if (document.body.contains(link)) {
            document.body.removeChild(link);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-start pt-20 z-[100] p-4">
            <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-[90vw] max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center mb-4 flex-shrink-0">
                     <div className="flex items-center gap-4">
                        <h3 className="text-2xl font-bold">Pay Card Details ({employees.length})</h3>
                        <button onClick={handleDownload} className="p-2 rounded-full hover:bg-gray-700" title="Download CSV">
                            <Download size={20} />
                        </button>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700"><X size={24}/></button>
                </div>
                <div className="overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase">
                            <tr>
                                <th className="p-2 text-left">S.No</th>
                                <th className="p-2 text-left">Full Name</th>
                                <th className="p-2 text-left">Nationality</th>
                                <th className="p-2 text-left">QID</th>
                                <th className="p-2 text-left">Paycard Number</th>
                                <th className="p-2 text-left">Pay Card PIN</th>
                                <th className="p-2 text-left">Pay Card Expiry</th>
                            </tr>
                        </thead>
                        <tbody>
                            {employees.map((e, index) => (
                                <tr key={e.id} className="group/row border-b dark:border-gray-700 border-gray-200">
                                    <td className="p-2">{index + 1}</td>
                                    <td className="p-2 font-semibold">{e.fullName}</td>
                                    <td className="p-2">{e.nationality}</td>
                                    <td className="p-2">{e.qid}</td>
                                    <td className="p-2">{e.payCard}</td>
                                    <td className="p-2">{e.payCardPin}</td>
                                    <td className="p-2">
                                        <div className="flex items-center space-x-2">
                                            <span>{formatDate(e.payCardExpiry)}</span>
                                            <DocumentStatusBadge date={e.payCardExpiry} />
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {employees.length === 0 && <div className="text-center py-8 text-gray-500">No active employees with Pay Card details found.</div>}
                </div>
            </div>
        </div>
    );
};

const EmployeeTable = ({ title, employees, onEdit, onDelete, onViewDetails, headers, onHeaderSave, onPayCardCancelRequest, tickedEmployees, onToggleTick, onToggleAllTicks, isPinnedTable, onPin, onUnpin, docUploadStates, onUploadDocument, onOpenDocPreview }) => {
    const [copiedId, setCopiedId] = useState(null);

    const handleCopy = (text, id) => {
        copyToClipboard(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1500);
    };

    // Helper to get document status counts for header coloring
    const getDocumentStats = (urlField) => {
        const uploaded = employees.filter(e => e[urlField]).length;
        const total = employees.length;
        return { uploaded, total, hasUploaded: uploaded > 0, allUploaded: uploaded === total };
    };

    const getStatusStyle = (status) => {
        switch (status) {
            case 'Active':
                return 'bg-green-500/20 text-green-400';
            default:
                return 'bg-yellow-500/20 text-yellow-400';
        }
    };

    const ExpiryStatusBadge = ({ date }) => {
        const getStatus = (dateInput) => {
            if (!dateInput) return { text: 'N/A', color: 'gray' };
            const date = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
            if (isNaN(date.getTime())) return { text: 'Invalid', color: 'gray' };

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const thirtyDaysFromNow = new Date();
            thirtyDaysFromNow.setDate(today.getDate() + 30);
            thirtyDaysFromNow.setHours(0, 0, 0, 0);

            if (date < today) {
                return { text: 'Expired', color: 'red' };
            } else if (date <= thirtyDaysFromNow) {
                return { text: 'Near Expiry', color: 'yellow' };
            } else {
                return { text: 'Active', color: 'green' };
            }
        };

        const status = getStatus(date);
        const colorClasses = {
            red: 'bg-red-500/20 text-red-400',
            yellow: 'bg-yellow-500/20 text-yellow-400',
            green: 'bg-green-500/20 text-green-400',
            gray: 'bg-gray-500/20 text-gray-400',
        };

        return (
            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${colorClasses[status.color]}`}>
                {status.text}
            </span>
        );
    };

    const CheckboxCell = ({ checked, isTicked }) => (
        <td className={`p-3 text-center rounded-md border align-middle ${isTicked ? 'dark:bg-green-800/40 bg-green-100 dark:border-green-700/50 border-green-200' : 'dark:bg-slate-800 bg-white dark:border-slate-700/50'}`}>
            <div className={`w-6 h-6 mx-auto rounded-full flex items-center justify-center border-2 ${checked ? 'border-green-400 bg-green-500/10' : 'border-red-400 bg-red-500/10'}`}>
                 {checked ? <CheckCircle size={14} className="text-green-400" /> : <X size={14} className="text-red-400" />}
            </div>
        </td>
    );

    const DocumentCell = ({ employee, type, urlField, label, isTicked }) => {
        const key = `${employee.id}_${type}`;
        const state = docUploadStates[key] || { uploading: false, error: null };
        const hasDoc = !!employee[urlField];
        const baseClass = `p-2 text-center rounded-md border align-middle ${isTicked ? 'dark:bg-green-800/40 bg-green-100 dark:border-green-700/50 border-green-200' : 'dark:bg-slate-800 bg-white dark:border-slate-700/50'}`;
        const inputId = `file_input_${employee.id}_${type}`;
        const onFileChange = (e) => {
            const file = e.target.files[0];
            if (file) onUploadDocument(employee.id, type, file);
            e.target.value = '';
        };
        
        // Get appropriate icon based on document type
        const getDocIcon = () => {
            switch(type) {
                case 'idCopy': return <IdCard size={18} />;
                case 'ppCopy': return <BookUser size={18} />;
                case 'lcCopy': return <FileText size={18} />;
                case 'settle': return <HandCoins size={18} />;
                default: return <FileUp size={18} />;
            }
        };
        
        return (
            <td className={baseClass}>
                {state.uploading ? (
                    <div className="flex items-center justify-center">
                        <Loader2 size={18} className="animate-spin text-cyan-400" title={`Uploading ${label}...`} />
                    </div>
                ) : (
                    <div className="flex items-center justify-center space-x-1">
                        <label 
                            className={`flex items-center justify-center p-1 cursor-pointer transition-colors ${hasDoc ? 'text-green-400' : 'text-red-400 hover:text-red-300'}`}
                            title={hasDoc ? `View/Replace ${label} document` : `Upload ${label} document`} 
                            htmlFor={inputId}
                        >
                            {getDocIcon()}
                        </label>
                        {hasDoc && (
                            <button
                                onClick={() => onOpenDocPreview(employee[urlField], label, employee.fullName)}
                                className="p-1 hover:text-cyan-400 transition-colors"
                                title={`View ${label} document`}
                            >
                                <Eye size={14} />
                            </button>
                        )}
                    </div>
                )}
                <input id={inputId} type="file" accept="application/pdf" className="hidden" onChange={onFileChange} />
                {state.error && <div className="mt-1 text-[10px] text-red-400">{state.error}</div>}
            </td>
        );
    };
    
    const allAreTicked = employees.length > 0 && employees.every(e => tickedEmployees.has(e.id));

    return (
        <div className="mt-0">
            <div className="overflow-x-auto">
                <table className="w-full text-sm font-medium border-separate table-fixed" style={{borderSpacing: '4px 8px', minWidth: '1650px'}}>
                    <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase align-middle">
                        <tr>
                            <th className="w-12 p-0 font-semibold text-center">
                                <div className="dark:bg-slate-900 bg-gray-200 px-3 py-2 rounded-md border dark:border-slate-700/50 flex justify-center items-center" title={allAreTicked ? "Deselect All" : "Select All"}>
                                    <input
                                        type="checkbox"
                                        onChange={onToggleAllTicks}
                                        checked={allAreTicked}
                                        className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                    />
                                </div>
                            </th>
                            <th className="w-12 p-0 font-semibold text-left"><div className="dark:bg-slate-900 bg-gray-200 px-3 py-2 rounded-md border dark:border-slate-700/50">S.No</div></th>
                            <EditableTH initialValue={headers.eNo} onSave={(val) => onHeaderSave('eNo', val)} className="w-20" />
                            <EditableTH initialValue={headers.gender} onSave={(val) => onHeaderSave('gender', val)} className="w-16" />
                            <EditableTH initialValue={headers.fullName} onSave={(val) => onHeaderSave('fullName', val)} className="w-80" />
                            <EditableTH initialValue={headers.nationality} onSave={(val) => onHeaderSave('nationality', val)} className="w-32" />
                            <EditableTH initialValue={headers.profession} onSave={(val) => onHeaderSave('profession', val)} className="w-48" />
                            <EditableTH initialValue={headers.qid} onSave={(val) => onHeaderSave('qid', val)} className="w-36" />
                            <EditableTH initialValue={headers.qidExpiry} onSave={(val) => onHeaderSave('qidExpiry', val)} className="w-28" />
                            <EditableTH initialValue={headers.contact1} onSave={(val) => onHeaderSave('contact1', val)} className="w-32" />
                            <EditableTH initialValue={headers.status} onSave={(val) => onHeaderSave('status', val)} className="w-28" />
                            <EditableTH initialValue={headers.passport} onSave={(val) => onHeaderSave('passport', val)} className="w-24" />
                            <EditableTH initialValue={headers.labourContract} onSave={(val) => onHeaderSave('labourContract', val)} className="w-24" />
                            <EditableTH initialValue={headers.payCard} onSave={(val) => onHeaderSave('payCard', val)} className="w-24" />
                            <th className="w-24 p-0 font-semibold text-center">
                                <div className={`dark:bg-slate-900 bg-gray-200 px-3 py-2 rounded-md border dark:border-slate-700/50 flex justify-center items-center ${getDocumentStats('idCopyUrl').allUploaded ? 'text-green-400' : getDocumentStats('idCopyUrl').hasUploaded ? 'text-yellow-400' : 'text-red-400'}`} title="ID Copy">
                                    <IdCard size={16}/>
                                </div>
                            </th>
                            <th className="w-24 p-0 font-semibold text-center">
                                <div className={`dark:bg-slate-900 bg-gray-200 px-3 py-2 rounded-md border dark:border-slate-700/50 flex justify-center items-center ${getDocumentStats('ppCopyUrl').allUploaded ? 'text-green-400' : getDocumentStats('ppCopyUrl').hasUploaded ? 'text-yellow-400' : 'text-red-400'}`} title="Passport Copy">
                                    <BookUser size={16}/>
                                </div>
                            </th>
                            <th className="w-24 p-0 font-semibold text-center">
                                <div className={`dark:bg-slate-900 bg-gray-200 px-3 py-2 rounded-md border dark:border-slate-700/50 flex justify-center items-center ${getDocumentStats('lcCopyUrl').allUploaded ? 'text-green-400' : getDocumentStats('lcCopyUrl').hasUploaded ? 'text-yellow-400' : 'text-red-400'}`} title="Contract Copy">
                                    <FileText size={16}/>
                                </div>
                            </th>
                            <th className="w-32 p-0 font-semibold text-center">
                                <div className={`dark:bg-slate-900 bg-gray-200 px-3 py-2 rounded-md border dark:border-slate-700/50 flex justify-center items-center ${getDocumentStats('settleDocUrl').allUploaded ? 'text-green-400' : getDocumentStats('settleDocUrl').hasUploaded ? 'text-yellow-400' : 'text-red-400'}`} title="Settlement">
                                    <HandCoins size={16}/>
                                </div>
                            </th>
                            <th className="w-20 p-0 font-semibold text-center"><div className="dark:bg-slate-900 bg-gray-200 px-3 py-2 rounded-md border dark:border-slate-700/50">Actions</div></th>
                        </tr>
                    </thead>
                    <tbody>
                        {employees.map((e, index) => {
                            const qidExpired = isDateExpired(e.qidExpiry);
                            const thirtyDaysFromNow = new Date();
                            thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
                            const qidExpiryDate = e.qidExpiry?.toDate ? e.qidExpiry.toDate() : null;
                            let qidColorClass = '';
                            if (qidExpiryDate) {
                                const today = new Date();
                                today.setHours(0, 0, 0, 0);
                                if (qidExpiryDate < today) {
                                    qidColorClass = 'text-red-400 font-bold'; // Expired
                                } else if (qidExpiryDate <= thirtyDaysFromNow) {
                                    qidColorClass = 'text-orange-400 font-bold'; // Expiring soon
                                }
                            }
                            
                            const isTicked = tickedEmployees.has(e.id);
                            const cellClassName = `p-3 rounded-md border align-middle ${isTicked ? 'dark:bg-green-800/40 bg-green-100 dark:border-green-700/50 border-green-200' : 'dark:bg-slate-800 bg-white dark:border-slate-700/50'}`;
                            
                            return (
                                <tr key={e.id} className={`group/row transition-colors duration-200`}>
                                    <td className={`${cellClassName} text-center`}>
                                        <input
                                            type="checkbox"
                                            checked={isTicked}
                                            onChange={() => onToggleTick(e.id)}
                                            className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                        />
                                    </td>
                                    <td className={`${cellClassName} truncate`}>{index + 1}</td>
                                    <td className={`${cellClassName} truncate`}>{e.eNo}</td>
                                    <td className={`${cellClassName} truncate`}>{e.gender}</td>
                                    <td className={`${cellClassName} font-semibold truncate`}>
                                        <div className="flex items-center justify-between">
                                            {/* --- ADDED PHOTO/PLACEHOLDER --- */}
                                            {e.photoURL ? (
                                                <img 
                                                  src={e.photoURL} 
                                                  alt={e.fullName} 
                                                  className="w-8 h-8 rounded-full mr-3 object-cover flex-shrink-0" 
                                                  onError={(e) => { e.target.onerror = null; e.target.src="https://placehold.co/40x40/4A5568/E2E8F0?text=Error"; }}
                                                />
                                            ) : (
                                                <div className="w-8 h-8 rounded-full mr-3 bg-gray-600 flex items-center justify-center text-xs font-bold text-gray-300 flex-shrink-0">
                                                  {e.fullName ? e.fullName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : <Users size={14} />}
                                                </div>
                                            )}
                                            {/* --- END OF PHOTO/PLACEHOLDER --- */}
                                            
                                            <span className="text-left w-full truncate">{e.fullName}</span>
                                            <button 
                                                onClick={() => handleCopy(e.fullName, e.id)} 
                                                className="p-1 opacity-0 group-hover/row:opacity-100 hover:text-cyan-400 ml-2 flex-shrink-0"
                                                title={`Copy ${e.fullName}`}
                                            >
                                                {copiedId === e.id ? <CheckCircle size={14} className="text-green-400" /> : <Copy size={14} />}
                                            </button>
                                        </div>
                                    </td>
                                    <td className={`${cellClassName} truncate`}>{e.nationality}</td>
                                    <td className={`${cellClassName} truncate`}>{e.profession}</td>
                                    <td className={`${cellClassName} truncate ${qidColorClass}`}>{e.qid}</td>
                                    <td className={`${cellClassName} truncate ${qidColorClass}`}>{formatDate(e.qidExpiry)}</td>
                                    <td className={`${cellClassName} truncate`}>{e.contact1}</td>
                                    <td className={`${cellClassName}`}><span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusStyle(e.status)}`}>{e.status}</span></td>
                                    <td className={`${cellClassName} text-center`}><ExpiryStatusBadge date={e.passportExpiry} /></td>
                                    <td className={`${cellClassName} text-center`}><ExpiryStatusBadge date={e.labourContractExpiry} /></td>
                                    <td className={`${cellClassName} text-center`}><ExpiryStatusBadge date={e.payCardExpiry} /></td>
                                    {/* Document cells (ID, Passport, Labour Contract, Settlement) */}
                                    <DocumentCell employee={e} type="idCopy" urlField="idCopyUrl" label="ID" isTicked={isTicked} />
                                    <DocumentCell employee={e} type="ppCopy" urlField="ppCopyUrl" label="PP" isTicked={isTicked} />
                                    <DocumentCell employee={e} type="lcCopy" urlField="lcCopyUrl" label="LC" isTicked={isTicked} />
                                    <DocumentCell employee={e} type="settle" urlField="settleDocUrl" label="Settle" isTicked={isTicked} />
                                    <td className={cellClassName}>
                                        <div className="opacity-0 group-hover/row:opacity-100 flex items-center justify-center space-x-1">
                                            {isPinnedTable ? (
                                                <button onClick={() => onUnpin(e)} className="p-1.5 hover:text-yellow-400" title="Unpin Employee"><PinOff size={16}/></button>
                                            ) : (
                                                <button onClick={() => onPin(e)} className="p-1.5 hover:text-yellow-400" title="Pin Employee"><Pin size={16}/></button>
                                            )}
                                            <button onClick={() => onEdit(e)} className="p-1.5 hover:text-cyan-400"><Edit size={16}/></button>
                                            <button onClick={() => onDelete(e)} className="p-1.5 hover:text-red-400"><Trash2 size={16}/></button>
                                            {(e.status === 'Cancelled' || e.status === 'Changed') && e.payCard && (
                                                e.payCardCancelled ? (
                                                    <span className="p-1.5 text-green-400" title="Pay Card has been marked as cancelled.">
                                                        <ShieldCheck size={16} />
                                                    </span>
                                                ) : (
                                                    <button 
                                                        onClick={() => onPayCardCancelRequest(e)} 
                                                        className="p-1.5 hover:text-yellow-400" 
                                                        title="Mark Pay Card as Cancelled"
                                                    >
                                                        <IdCard size={16} />
                                                    </button>
                                                )
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const GenericEmployeePage = ({ userId, appId, pageTitle, collectionPath, setConfirmAction }) => {
    // ... existing state variables ...
    const [employees, setEmployees] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [nationalityFilter, setNationalityFilter] = useState('');
    const [professionFilter, setProfessionFilter] = useState('');
    const [showPayCardModal, setShowPayCardModal] = useState(false);
    const [headers, setHeaders] = useState({ eNo: 'E.NO', gender: 'Gender', fullName: 'Full Name', nationality: 'Nationality', profession: 'Profession', qid: 'QID', qidExpiry: 'QID Expiry', contact1: 'Contact', status: 'Employee Status', passport: 'Passport', labourContract: 'Contract', payCard: 'Pay Card'});
    // Document preview modal state
    const [docPreview, setDocPreview] = useState(null); // { url, type, employeeName }
    const [docUploadStates, setDocUploadStates] = useState({}); // key `${empId}_${type}` => { uploading: bool, error: string|null }
    const [activeStatusView, setActiveStatusView] = useState('Active');
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [isExportingExcel, setIsExportingExcel] = useState(false); // Add new state for Excel export
    const importFileInputRef = useRef(null);
    const [tickedEmployees, setTickedEmployees] = useState(new Set());
    const [pinnedEmployeeIds, setPinnedEmployeeIds] = useState(new Set());
    // const [employeePageView, setEmployeePageView] = useState('list'); // 'list' or 'pnl' // REMOVED
    const [isClearingData, setIsClearingData] = useState(false); // Add this state

    const employeesRef = useMemo(() => collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`), [userId, appId, collectionPath]);
    const settingsRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/settings/app_settings`), [userId, appId]);
    const employeeSettingsRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/employeeSettings`, collectionPath), [userId, appId, collectionPath]);

    const updateTickedInFirestore = useCallback(async (newSet) => {
        if (!employeeSettingsRef) return;
        try {
            await setDoc(employeeSettingsRef, { ids: Array.from(newSet) }, { merge: true });
        } catch (error) {
            console.error("Failed to save ticked employees:", error);
        }
    }, [employeeSettingsRef]);

    const updatePinnedInFirestore = useCallback(async (newSet) => {
        if (!employeeSettingsRef) return;
        try {
            await setDoc(employeeSettingsRef, { pinnedIds: Array.from(newSet) }, { merge: true });
        } catch (error) {
            console.error("Failed to save pinned employees:", error);
        }
    }, [employeeSettingsRef]);


    const lastEmployeeNumber = useMemo(() => {
        // ... existing logic ...
        if (!employees || employees.length === 0) {
            return "N/A";
        }

        const lastEmployee = employees
            .filter(emp => emp.eNo && typeof emp.eNo === 'string') // ensure we have a string eNo to work with
            .reduce((last, current) => {
                if (!last) return current;

                // Extract all sequences of digits and join them to handle complex IDs
                const lastNumMatch = last.eNo.match(/\d+/g);
                const currentNumMatch = current.eNo.match(/\d+/g);

                // If no digits found, treat as 0
                const lastNum = lastNumMatch ? parseInt(lastNumMatch.join(''), 10) : 0;
                const currentNum = currentNumMatch ? parseInt(currentNumMatch.join(''), 10) : 0;
                
                return currentNum > lastNum ? current : last;
            }, null); // Start with null

        return lastEmployee ? lastEmployee.eNo : "N/A";
    }, [employees]);


    useEffect(() => {
        // ... existing useEffect logic ...
        const unsub = onSnapshot(employeesRef, snapshot => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setEmployees(data);
        });
        const unsubSettings = onSnapshot(settingsRef, (doc) => {
            if(doc.exists() && doc.data().employeeTableHeaders){
                setHeaders(h => ({...h, ...doc.data().employeeTableHeaders}));
            }
        });
        return () => { unsub(); unsubSettings(); };
    }, [employeesRef, settingsRef]);

    useEffect(() => {
        if (!employeeSettingsRef) return;
        const unsub = onSnapshot(employeeSettingsRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setTickedEmployees(new Set(data.ids || []));
                setPinnedEmployeeIds(new Set(data.pinnedIds || []));
            } else {
                setTickedEmployees(new Set()); // No doc or empty/invalid data
                setPinnedEmployeeIds(new Set());
            }
        }, (error) => {
            console.error("Error fetching ticked/pinned employees:", error);
        });
        return () => unsub();
    }, [employeeSettingsRef]);

    // ... existing handler functions (handleToggleTick, handleToggleAllTicks, handleClearTicks, handlePayCardCancelled, handlePayCardCancelRequest, handleSave, onDeleteRequest, handleHeaderSave, handleExportJson, handleImportJsonChange, triggerImport, handleDownloadEmployees) ...
        const handleToggleTick = useCallback((employeeId) => {
        setTickedEmployees(prev => {
            const newSet = new Set(prev);
            if (newSet.has(employeeId)) {
                newSet.delete(employeeId);
            } else {
                newSet.add(employeeId);
            }
            updateTickedInFirestore(newSet);
            return newSet;
        });
    }, [updateTickedInFirestore]);

    const handleToggleAllTicks = (employeeList) => {
        const allIds = employeeList.map(e => e.id);
        const allAreTicked = allIds.length > 0 && allIds.every(id => tickedEmployees.has(id));

        setTickedEmployees(prev => {
            const newSet = new Set(prev);
            if (allAreTicked) {
                allIds.forEach(id => newSet.delete(id));
            } else {
                allIds.forEach(id => newSet.add(id));
            }
            updateTickedInFirestore(newSet);
            return newSet;
        });
    };

    const handleClearTicks = () => {
        const newSet = new Set();
        setTickedEmployees(newSet);
        updateTickedInFirestore(newSet);
    };

    const handlePayCardCancelled = async (employeeId) => {
        const employeeDocRef = doc(employeesRef, employeeId);
        await updateDoc(employeeDocRef, {
            payCardCancelled: true
        });
    };

    const handlePayCardCancelRequest = (employee) => {
        setConfirmAction({
            title: 'Confirm Pay Card Cancellation',
            message: `Are you sure you want to mark the pay card for ${employee.fullName} as cancelled? This action will remove the notification and cannot be undone.`,
            confirmText: 'Confirm',
            type: 'save',
            action: () => handlePayCardCancelled(employee.id),
        });
    };

    const handlePinEmployee = (employee) => {
        setConfirmAction({
            title: 'Pin Employee',
            message: `Pin ${employee.fullName} to the top of this list?`,
            confirmText: 'Pin',
            type: 'save',
            action: () => {
                const newPinnedIds = new Set(pinnedEmployeeIds);
                newPinnedIds.add(employee.id);
                setPinnedEmployeeIds(newPinnedIds);
                updatePinnedInFirestore(newPinnedIds);
            }
        });
    };

    const handleUnpinEmployee = (employee) => {
        setConfirmAction({
            title: 'Unpin Employee',
            message: `Unpin ${employee.fullName}?`,
            confirmText: 'Unpin',
            type: 'delete',
            action: () => {
                const newPinnedIds = new Set(pinnedEmployeeIds);
                newPinnedIds.delete(employee.id);
                setPinnedEmployeeIds(newPinnedIds);
                updatePinnedInFirestore(newPinnedIds);
            }
        });
    };

    // Upload a single PDF document for an employee
    const handleUploadEmployeeDocument = async (employeeId, type, file) => {
        if (!file) {
            console.log('No file provided');
            return;
        }
        const key = `${employeeId}_${type}`;
        console.log('Upload started:', { employeeId, type, fileName: file.name, fileType: file.type, fileSize: file.size });
        
        if (file.type !== 'application/pdf') {
            setDocUploadStates(prev => ({ ...prev, [key]: { uploading: false, error: 'Only PDF files allowed.' } }));
            return;
        }
        if (file.size > 5 * 1024 * 1024) { // 5MB limit
            setDocUploadStates(prev => ({ ...prev, [key]: { uploading: false, error: 'File too large (max 5MB).' } }));
            return;
        }
        setDocUploadStates(prev => ({ ...prev, [key]: { uploading: true, error: null } }));
        try {
            const storagePath = `employee_docs/${collectionPath}/${employeeId}/${type}_${Date.now()}.pdf`;
            console.log('Uploading to path:', storagePath);
            const storageRef = ref(storage, storagePath);
            await uploadBytes(storageRef, file);
            console.log('Upload complete, getting download URL...');
            const downloadURL = await getDownloadURL(storageRef);
            console.log('Download URL obtained:', downloadURL);
            await updateDoc(doc(employeesRef, employeeId), {
                [`${type}`]: true, // keep existing boolean semantics
                [`${type}Url`]: downloadURL,
                [`${type}StoragePath`]: storagePath,
                updatedAt: new Date()
            });
            console.log('Firestore updated successfully');
            setDocUploadStates(prev => ({ ...prev, [key]: { uploading: false, error: null } }));
        } catch (err) {
            console.error('Upload failed:', err);
            console.error('Error details:', { code: err.code, message: err.message, stack: err.stack });
            let errorMsg = 'Upload failed';
            if (err.code === 'storage/unauthorized') {
                errorMsg = 'Permission denied. Check Storage rules.';
            } else if (err.message) {
                errorMsg = err.message.length > 50 ? err.message.substring(0, 50) + '...' : err.message;
            }
            setDocUploadStates(prev => ({ ...prev, [key]: { uploading: false, error: errorMsg } }));
        }
    };

    const handleOpenDocPreview = (url, type, employeeName) => {
        setDocPreview({ url, type, employeeName });
    };

    const handleCloseDocPreview = () => setDocPreview(null);

    const handleSave = async (employeeData, uploadCallback) => {
        if (editingEmployee) {
            const { id, ...dataToSave } = employeeData;
            await updateDoc(doc(employeesRef, id), dataToSave);
        } else {
            // New employee creation
            const docRef = await addDoc(employeesRef, employeeData);
            // If there's a callback to upload pending documents, call it
            if (uploadCallback && typeof uploadCallback === 'function') {
                await uploadCallback(docRef.id);
            }
        }
        setShowModal(false);
        setEditingEmployee(null);
    };

    const onDeleteRequest = (employee) => {
        setConfirmAction({
            title: 'Confirm Delete',
            message: `Are you sure you want to delete employee ${employee.fullName}?`,
            confirmText: 'Delete',
            type: 'delete',
            action: () => deleteDoc(doc(employeesRef, employee.id))
        });
    };
    
    const handleHeaderSave = async (key, newTitle) => {
        await setDoc(settingsRef, {
            employeeTableHeaders: {
                ...headers,
                [key]: newTitle
            }
        }, { merge: true });
    };

    const handleExportJson = async () => {
        setConfirmAction({
            title: `Export ${pageTitle} Data`,
            message: 'This will export all employee data for this company to a JSON file. Proceed?',
            confirmText: 'Export',
            type: 'save',
            action: async () => {
                setIsExporting(true);
                try {
                    const employeesSnapshot = await getDocs(employeesRef);
                    const employeesData = [];

                    for (const empDoc of employeesSnapshot.docs) {
                        const employee = { id: empDoc.id, ...empDoc.data() };
                        // The schema might have this subcollection, so we include it for backup compatibility.
                        const docSubCollRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}/${empDoc.id}/documents`);
                        const docSubSnapshot = await getDocs(docSubCollRef);
                         if (!docSubSnapshot.empty) {
                            employee._subCollections = {
                                documents: docSubSnapshot.docs.map(d => ({ id: d.id, ...d.data() }))
                            };
                        }
                        employeesData.push(employee);
                    }

                    const jsonString = JSON.stringify(employeesData, null, 2);
                    const blob = new Blob([jsonString], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${collectionPath}_backup_${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (error) {
                    console.error("Export failed:", error);
                    alert("An error occurred during export. Check console for details.");
                } finally {
                    setIsExporting(false);
                }
            }
        });
    };

    const handleImportJsonChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                if (!Array.isArray(importedData)) {
                    throw new Error("Invalid file format: Expected a JSON array of employees.");
                }
                
                setConfirmAction({
                    title: `DANGER: Import ${pageTitle} Data`,
                    message: `This will DELETE ALL current employees for this company and replace them with data from the file. This action cannot be undone. Are you sure?`,
                    confirmText: 'Yes, Delete & Import',
                    type: 'delete',
                    action: async () => {
                        setIsImporting(true);
                        try {
                            // Step 1: Wipe existing data
                            const existingDocsSnapshot = await getDocs(employeesRef);
                            for (const empDoc of existingDocsSnapshot.docs) {
                                // Delete subcollections first
                                const subCollRef = collection(db, empDoc.ref.path, 'documents');
                                const subSnapshot = await getDocs(subCollRef);
                                if (!subSnapshot.empty) {
                                    const subBatch = writeBatch(db);
                                    subSnapshot.forEach(subDoc => subBatch.delete(subDoc.ref));
                                    await subBatch.commit();
                                }
                            }
                            // Delete main documents
                             if (!existingDocsSnapshot.empty) {
                                const mainBatch = writeBatch(db);
                                existingDocsSnapshot.forEach(doc => mainBatch.delete(doc.ref));
                                await mainBatch.commit();
                            }

                            // Step 2: Import new data
                            for (const item of importedData) {
                                const { id, _subCollections, ...data } = item;
                                const restoredData = restoreTimestamps(data);
                                const docRef = doc(db, `artifacts/${appId}/users/${userId}/${collectionPath}`, id);
                                await setDoc(docRef, restoredData);

                                if (_subCollections && _subCollections.documents) {
                                    for (const subItem of _subCollections.documents) {
                                        const { id: subId, ...subData } = subItem;
                                        const restoredSubData = restoreTimestamps(subData);
                                        const subDocRef = doc(db, `artifacts/${appId}/users/${userId}/${collectionPath}/${id}/documents`, subId);
                                        await setDoc(subDocRef, restoredSubData);
                                    }
                                }
                            }
                            alert('Import successful! The data has been restored.');
                        } catch (err) {
                            console.error("Import process failed:", err);
                            alert(`Import failed: ${err.message}`);
                        } finally {
                            setIsImporting(false);
                        }
                    }
                });

            } catch (err) {
                 alert(`Error reading file: ${err.message}`);
            }
            if(importFileInputRef.current) importFileInputRef.current.value = "";
        };
        reader.readAsText(file);
    };

    const triggerImport = () => {
        importFileInputRef.current?.click();
    };

    const handleDownloadEmployees = () => {
        const headers = [
            "S.No", "E.NO", "Gender", "Full Name", "Nationality", "Profession", "QID", "QID Expiry", "Contact 1", "Status",
            "Join Date", "Departed Date", "Passport", "Passport Expiry", "Pay Card", "Pay Card PIN", "Pay Card Expiry",
            "Contract", "Labour Contract Expiry", "Address", "Contact 2", "Contact 3",
            "ID Copy", "PP Copy", "LC Copy", "Settle"
        ];
        let csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n";

        activeAndVacationEmployees.forEach((e, index) => {
            const row = [
                index + 1,
                `"${e.eNo || ''}"`,
                `"${e.gender || ''}"`,
                `"${e.fullName || ''}"`,
                `"${e.nationality || ''}"`,
                `"${e.profession || ''}"`,
                `"${e.qid || ''}"`,
                `"${formatDate(e.qidExpiry)}"`,
                `"${e.contact1 || ''}"`,
                `"${e.status || ''}"`,
                `"${formatDate(e.joinDate)}"`,
                `"${formatDate(e.departedDate)}"`,
                `"${e.passport || ''}"`,
                `"${formatDate(e.passportExpiry)}"`,
                `"${e.payCard || ''}"`,
                `"${e.payCardPin || ''}"`,
                `"${formatDate(e.payCardExpiry)}"`,
                `"${e.labourContract || ''}"`,
                `"${formatDate(e.labourContractExpiry)}"`,
                `"${(e.address || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
                `"${e.contact2 || ''}"`,
                `"${e.contact3 || ''}"`,
                e.idCopy ? "Yes" : "No",
                e.ppCopy ? "Yes" : "No",
                e.lcCopy ? "Yes" : "No",
                e.settle ? "Yes" : "No",
            ].join(",");
            csvContent += row + "\n";
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `active_employees_report_${pageTitle.replace(/ /g, '_')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // New Excel Export Function
    const handleExportExcelReport = () => {
        if (!window.XLSX) {
            alert("Excel export library is not ready. Please try again in a moment.");
            return;
        }

        setConfirmAction({
            title: 'Export Excel Report',
            message: 'This will generate an Excel file with employee details, vehicles, and cheques across separate sheets. Proceed?',
            confirmText: 'Export',
            type: 'save',
            action: async () => {
                setIsExportingExcel(true);
                try {
                    const wb = window.XLSX.utils.book_new();

                    const createSheetData = (employeeList) => {
                        return employeeList.map((e, index) => ({
                            "S.No": index + 1,
                            "E.NO": e.eNo || '',
                            "Nationality": e.nationality || '',
                            "Profession": e.profession || '',
                            "Employee Name": e.fullName || '',
                            "QID Number": e.qid || '',
                            "QID Expiry": formatDate(e.qidExpiry),
                            "Passport Number": e.passport || '',
                            "Passport Expiry": formatDate(e.passportExpiry),
                            "Contact": e.contact1 || '',
                            "Paycard": e.payCard || '',
                            "Paycard Pin": e.payCardPin || '',
                        }));
                    };

                    // Sheet 1: Active & Vacation Employees
                    const sheet1Data = createSheetData(activeAndVacationEmployees);
                    const ws1 = window.XLSX.utils.json_to_sheet(sheet1Data);
                    window.XLSX.utils.book_append_sheet(wb, ws1, "Active_Vacation_Employees");

                    // Sheet 2: Other Status Employees
                    const otherEmployees = sectionOrder.flatMap(status => 
                        groupedAndSortedEmployees[status].pinned.concat(groupedAndSortedEmployees[status].main)
                    );
                    const sheet2Data = createSheetData(otherEmployees);
                    const ws2 = window.XLSX.utils.json_to_sheet(sheet2Data);
                    window.XLSX.utils.book_append_sheet(wb, ws2, "Other_Status_Employees");

                    // --- NEW SHEETS ---
                    const companyPrefix = collectionPath.replace('Data', '');
                    
                    // Sheet 3: Vehicles
                    const vehiclesRef = collection(db, `artifacts/${appId}/users/${userId}/${companyPrefix}Vehicles`);
                    const vehiclesSnapshot = await getDocs(vehiclesRef);
                    const vehiclesData = vehiclesSnapshot.docs.map(doc => doc.data());
                    const sheet3Data = vehiclesData.map(v => ({
                        "Vehicle Number": v.vehicleNo || '',
                        "Make": v.make || '',
                        "Model": v.model || '',
                        "Expiry": formatDate(v.expiry),
                        "Contact": v.contact1 || '',
                    }));
                    if (sheet3Data.length > 0) {
                        const ws3 = window.XLSX.utils.json_to_sheet(sheet3Data);
                        window.XLSX.utils.book_append_sheet(wb, ws3, "Vehicles");
                    }

                    // Sheet 4: Cheques
                    const chequesRef = collection(db, `artifacts/${appId}/users/${userId}/${companyPrefix}Cheques`);
                    const chequesSnapshot = await getDocs(chequesRef);
                    const chequesData = chequesSnapshot.docs.map(doc => doc.data());
                    const sheet4Data = chequesData.map((c, index) => ({
                        "S.No": index + 1,
                        "CHQ No": c.chequeNo || '',
                        "Given Date": formatDate(c.givenDate),
                        "CHQ Date": formatDate(c.chequeDate),
                        "C/O": c.careOff || '',
                        "Name": c.name || '',
                        "Bank": c.bankName || '',
                        "Amount": c.amount || 0,
                    }));
                    if (sheet4Data.length > 0) {
                        const ws4 = window.XLSX.utils.json_to_sheet(sheet4Data);
                        window.XLSX.utils.book_append_sheet(wb, ws4, "Cheques");
                    }
                    // --- END NEW SHEETS ---

                    // Download the file
                    window.XLSX.writeFile(wb, `${collectionPath}_employee_report_${new Date().toISOString().split('T')[0]}.xlsx`);

                } catch (error) {
                    console.error("Excel Export failed:", error);
                    alert("An error occurred during the Excel export.");
                } finally {
                    setIsExportingExcel(false);
                }
            }
        });
    };

    const handleClearAllEmployees = () => {
        setConfirmAction({
            title: `DANGER: Clear All Employee Data`,
            message: `Are you sure you want to delete ALL employee entries for "${pageTitle}"? This action cannot be undone.`,
            confirmText: 'Yes, Delete All',
            type: 'delete',
            action: async () => {
                setIsClearingData(true);
                try {
                    const existingDocsSnapshot = await getDocs(employeesRef);
                    
                    // Batch delete all subcollections first
                    for (const empDoc of existingDocsSnapshot.docs) {
                        const subCollRef = collection(db, empDoc.ref.path, 'documents');
                        const subSnapshot = await getDocs(subCollRef);
                        if (!subSnapshot.empty) {
                            const subBatch = writeBatch(db);
                            subSnapshot.forEach(subDoc => subBatch.delete(subDoc.ref));
                            await subBatch.commit();
                        }
                    }

                    // Batch delete all main documents
                    if (!existingDocsSnapshot.empty) {
                        const mainBatch = writeBatch(db);
                        existingDocsSnapshot.forEach(doc => mainBatch.delete(doc.ref));
                        await mainBatch.commit();
                    }
                    
                    alert('All employee data for this company has been cleared.');
                } catch (err) {
                    console.error("Data clear process failed:", err);
                    alert(`Data clear failed: ${err.message}`);
                } finally {
                    setIsClearingData(false);
                }
            }
        });
    };

    const nationalities = useMemo(() => [...new Set(employees.map(e => e.nationality).filter(Boolean))].sort(), [employees]);
    const professions = useMemo(() => [...new Set(employees.map(e => e.profession).filter(Boolean))].sort(), [employees]);

    const payCardEmployees = useMemo(() => {
        // Filter employees who have a payCard number and are in 'Active' or 'Vacation' status, then sort them.
        return employees
            .filter(e => e.payCard && e.payCard.trim() !== '' && (e.status === 'Active' || e.status === 'Vacation'))
            .sort((a, b) => {
                // A simple locale-based sort for names
                return (a.fullName || '').localeCompare(b.fullName || '');
            });
    }, [employees]);


    const groupedAndSortedEmployees = useMemo(() => {
        let filtered = employees;
        
        if (nationalityFilter) {
            filtered = filtered.filter(e => e.nationality === nationalityFilter);
        }
        if (professionFilter) {
            filtered = filtered.filter(e => e.profession === professionFilter);
        }

        if (searchTerm) {
            const lowerSearchTerm = searchTerm.toLowerCase();
            filtered = filtered.filter(e => {
                return Object.values(e).some(val => 
                    val && (typeof val === 'string' || typeof val === 'number') && String(val).toLowerCase().includes(lowerSearchTerm)
                );
            });
        }

        filtered.sort((a, b) => {
            const dateA = a.qidExpiry?.toDate ? a.qidExpiry.toDate().getTime() : 0;
            const dateB = b.qidExpiry?.toDate ? b.qidExpiry.toDate().getTime() : 0;
            if (dateA === 0 && dateB === 0) return 0;
            if (dateA === 0) return 1;
            if (dateB === 0) return -1;
            return dateA - dateB;
        });

        const statusGroups = {
            'Active': [],
            'Vacation': [],
            'Changed': [],
            'Cancelled': [],
            'Case Filed': [],
            'Waiting for Join': [],
            'Others': [],
            // Removed New Recruitment group
        };
        
        const statusKeys = Object.keys(statusGroups);

        filtered.forEach(emp => {
            if (emp.status === 'SC Requested') {
                statusGroups['Active'].push(emp);
            } else if (emp.status === 'New Recruitment') {
                // If an employee still has this status, group them under 'Others'
                statusGroups['Others'].push(emp); 
            } else if (statusKeys.includes(emp.status)) {
                statusGroups[emp.status].push(emp);
            } else {
                statusGroups['Others'].push(emp);
            }
        });

        // NEW: Split each group into pinned and main
        const finalGroups = {};
        for (const status in statusGroups) {
            finalGroups[status] = {
                pinned: [],
                main: []
            };
            statusGroups[status].forEach(emp => {
                if (pinnedEmployeeIds.has(emp.id)) {
                    finalGroups[status].pinned.push(emp);
                } else {
                    finalGroups[status].main.push(emp);
                }
            });
        }
        return finalGroups;

    }, [employees, searchTerm, nationalityFilter, professionFilter, pinnedEmployeeIds]);
    
    const handleEdit = (employee) => {
        setEditingEmployee(employee);
        setShowModal(true);
    };

    // Removed New Recruitment from sectionOrder
    const sectionOrder = ['Case Filed', 'Waiting for Join', 'Cancelled', 'Changed', 'Others'];

    const statusStyles = {
        'Active': { border: 'dark:border-gray-700 border-gray-300', heading: { bg: 'dark:bg-cyan-800/70 bg-cyan-100', text: 'dark:text-cyan-200 text-cyan-800' } },
        // Removed New Recruitment style
        'Waiting for Join': { border: 'dark:border-gray-700 border-gray-300', heading: { bg: 'dark:bg-yellow-800/70 bg-yellow-100', text: 'dark:text-yellow-200 text-yellow-800' } },
        'Cancelled': { border: 'dark:border-gray-700 border-gray-300', heading: { bg: 'dark:bg-red-800/70 bg-red-100', text: 'dark:text-red-200 text-red-800' } },
        'Changed': { border: 'dark:border-gray-700 border-gray-300', heading: { bg: 'dark:bg-blue-800/70 bg-blue-100', text: 'dark:text-blue-200 text-blue-800' } },
        'Case Filed': { border: 'dark:border-gray-700 border-gray-300', heading: { bg: 'dark:bg-pink-800/70 bg-pink-100', text: 'dark:text-pink-200 text-pink-800' } },
        'Others': { border: 'dark:border-gray-700 border-gray-300', heading: { bg: 'dark:bg-gray-600/70 bg-gray-200', text: 'dark:text-gray-200 text-gray-800' } },
    };
    
    const activeAndVacationPinned = [...(groupedAndSortedEmployees['Active']?.pinned || []), ...(groupedAndSortedEmployees['Vacation']?.pinned || [])];
    const activeAndVacationMain = [...(groupedAndSortedEmployees['Active']?.main || []), ...(groupedAndSortedEmployees['Vacation']?.main || [])];
    const activeAndVacationEmployees = [...activeAndVacationPinned, ...activeAndVacationMain];

    // ... existing genderCounts logic ...
    const genderCounts = useMemo(() => {
        return activeAndVacationEmployees.reduce((acc, emp) => {
            const gender = (emp.gender || '').toUpperCase();
            if (gender === 'M') {
                acc.male++;
            } else if (gender === 'F') {
                acc.female++;
            }
            return acc;
        }, { male: 0, female: 0 });
    }, [activeAndVacationEmployees]);

    const statusDisplayLabels = {
        // Removed New Recruitment label
        'Waiting for Join': 'Joinings',
    };

    // Updated statusViews to exclude New Recruitment
    const statusViews = [
        { id: 'Active', label: 'Active', count: activeAndVacationPinned.length + activeAndVacationMain.length, style: statusStyles['Active'].heading },
        ...sectionOrder.map(status => ({
            id: status,
            label: statusDisplayLabels[status] || status,
            count: groupedAndSortedEmployees[status].pinned.length + groupedAndSortedEmployees[status].main.length,
            style: statusStyles[status].heading,
        }))
    ];


    return (
        <div className="p-4 sm:p-8 space-y-8">
            <div className="dark:bg-gray-800 bg-white p-4 sm:p-6 rounded-lg border-l-4 border-teal-500">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4 pb-4 border-b-2 dark:border-gray-700 border-gray-300 no-print sticky top-[122px] z-30 dark:bg-gray-800 bg-white -mx-4 sm:-mx-6 px-4 sm:px-6">
                    <nav className="flex items-center flex-wrap gap-2">
                        {statusViews.map(view => (
                            <button
                                key={view.id}
                                onClick={() => {
                                    // setEmployeePageView('list'); // REMOVED
                                    setActiveStatusView(view.id);
                                }}
                                // ... existing class logic ...
                                className={`text-sm font-bold px-4 py-2 rounded-full transition-colors ${
                                    activeStatusView === view.id
                                    ? `${view.style.bg} ${view.style.text}`
                                    : 'dark:bg-gray-700 bg-gray-200 dark:hover:bg-gray-600 hover:bg-gray-300'
                                }`}
                            >
                                {view.label} ({view.count})
                            </button>
                        ))}
                        {/* REMOVED P&L BUTTON
                        <button
                            onClick={() => setEmployeePageView('pnl')}
                             // ... existing class logic ...
                            className={`text-sm font-bold px-4 py-2 rounded-full transition-colors ${
                                employeePageView === 'pnl'
                                    ? 'bg-gradient-to-r from-green-500 to-teal-600 text-white shadow-md'
                                    : 'dark:bg-gray-700 bg-gray-200 dark:hover:bg-gray-600 hover:bg-gray-300'
                            }`}
                        >
                            Employee P&L
                        </button>
                        */}
                    </nav>
                    <div className="flex items-center space-x-2 flex-wrap gap-2 justify-end">
                        {/* ... existing search, filter, and action buttons ... */}
                         <div className="relative">
                            <input type="text" placeholder="Search All Fields..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md pl-8 w-full sm:w-auto border dark:border-gray-600 border-gray-300"/>
                            <Search size={18} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                        </div>
                        <div className="relative">
                            <select value={nationalityFilter} onChange={e => setNationalityFilter(e.target.value)} className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md appearance-none pr-8 w-full sm:w-auto border dark:border-gray-600 border-gray-300">
                                <option value="">Nationalities</option>
                                {nationalities.map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                             <Filter size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>
                        <div className="relative">
                             <select value={professionFilter} onChange={e => setProfessionFilter(e.target.value)} className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md appearance-none pr-8 w-full sm:w-auto border dark:border-gray-600 border-gray-300">
                                <option value="">Profession</option>
                                {professions.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                                     <Filter size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>
                        <button onClick={() => setShowPayCardModal(true)} title="View Pay Cards" className="p-2.5 dark:bg-gray-600 bg-gray-200 text-sm rounded-md dark:hover:bg-gray-500 hover:bg-gray-300 no-print border dark:border-gray-600 border-gray-300 dark:text-white text-gray-800">
                            <IdCard size={16}/>
                        </button>
                        <button onClick={handleClearAllEmployees} disabled={isClearingData || isExportingExcel} title="Clear All Employee Data" className="p-2.5 dark:bg-red-700 bg-red-100 text-sm rounded-md dark:hover:bg-red-800 hover:bg-red-200 no-print disabled:bg-gray-500 border dark:border-red-600 border-red-300 dark:text-white text-red-700">
                            {isClearingData ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16}/>}
                        </button>
                        {tickedEmployees.size > 0 && (
                            <button onClick={handleClearTicks} className="flex items-center space-x-2 p-2.5 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors text-sm">
                                <X size={16}/>
                                <span>Clear ({tickedEmployees.size})</span>
                            </button>
                        )}
                        <button onClick={() => { setEditingEmployee(null); setShowModal(true); }} title="Add Employee" className="p-2.5 bg-cyan-500 rounded-md hover:bg-cyan-600 transition-colors">
                            <UserPlus size={18}/>
                        </button>
                    </div>
                </div>

                {/* {employeePageView === 'list' ? ( // REMOVED CONDITIONAL */}
                <section>
                    {activeStatusView === 'Active' && (
                        // ... existing active status header ...
                         <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
                            <div className="font-semibold">
                                Last E.NO: <span className="text-yellow-400 text-lg">{lastEmployeeNumber}</span>
                            </div>
                            <div className="flex items-center space-x-4">
                                <div className="font-semibold">
                                    Male: <span className="text-cyan-400 text-lg">{genderCounts.male}</span>
                                </div>
                                <div className="font-semibold">
                                    Female: <span className="text-pink-400 text-lg">{genderCounts.female}</span>
                                </div>
                            </div>
                        </div>
                    )}
                    
                    {(() => {
                        const currentViewData = activeStatusView === 'Active' 
                            ? { pinned: activeAndVacationPinned, main: activeAndVacationMain } 
                            : groupedAndSortedEmployees[activeStatusView];
                        
                        const hasPinned = currentViewData.pinned.length > 0;
                        const hasMain = currentViewData.main.length > 0;

                        if (!hasPinned && !hasMain) {
                            return <div className="p-4 text-center dark:bg-gray-800/50 bg-white/50 rounded-lg border dark:border-gray-700 border-gray-300">This section is empty.</div>;
                        }

                        return (
                            <>
                                {hasPinned && (
                                    <div className="mb-6">
                                        <h3 className="text-lg font-bold mb-2 flex items-center"><Pin size={18} className="mr-2 text-yellow-400" /> Pinned ({currentViewData.pinned.length})</h3>
                                        <EmployeeTable
                                            title="Pinned"
                                            employees={currentViewData.pinned}
                                            onEdit={handleEdit}
                                            onDelete={onDeleteRequest}
                                            onViewDetails={handleEdit}
                                            headers={headers}
                                            onHeaderSave={handleHeaderSave}
                                            onPayCardCancelRequest={handlePayCardCancelRequest}
                                            tickedEmployees={tickedEmployees}
                                            onToggleTick={handleToggleTick}
                                            onToggleAllTicks={() => handleToggleAllTicks(currentViewData.pinned)}
                                            isPinnedTable={true}
                                            onPin={handlePinEmployee}
                                            onUnpin={handleUnpinEmployee}
                                            docUploadStates={docUploadStates}
                                            onUploadDocument={handleUploadEmployeeDocument}
                                            onOpenDocPreview={handleOpenDocPreview}
                                        />
                                    </div>
                                )}
                                {hasMain && (
                                    <div className={hasPinned ? 'mt-8 pt-8 border-t-2 dark:border-gray-700 border-gray-300' : ''}>
                                        {hasPinned && <h3 className="text-lg font-bold mb-2">Main List ({currentViewData.main.length})</h3>}
                                        <EmployeeTable
                                            title="Main"
                                            employees={currentViewData.main}
                                            onEdit={handleEdit}
                                            onDelete={onDeleteRequest}
                                            onViewDetails={handleEdit}
                                            headers={headers}
                                            onHeaderSave={handleHeaderSave}
                                            onPayCardCancelRequest={handlePayCardCancelRequest}
                                            tickedEmployees={tickedEmployees}
                                            onToggleTick={handleToggleTick}
                                            onToggleAllTicks={() => handleToggleAllTicks(currentViewData.main)}
                                            isPinnedTable={false}
                                            onPin={handlePinEmployee}
                                            onUnpin={handleUnpinEmployee}
                                            docUploadStates={docUploadStates}
                                            onUploadDocument={handleUploadEmployeeDocument}
                                            onOpenDocPreview={handleOpenDocPreview}
                                        />
                                    </div>
                                )}
                            </>
                        );
                    })()}
                </section>
                {/* ) : ( // REMOVED CONDITIONAL
                    <EmployeePnlPage
                        pageTitle={`${pageTitle.replace('Employees Details ', '')} Employee P&L`}
                        collectionPath={pnlCollectionPath}
                        userId={userId}
                        appId={appId}
                        setConfirmAction={setConfirmAction}
                        currency={'QAR'}
                    />
                )} */}
            </div>

            <PayCardModal isOpen={showPayCardModal} onClose={() => setShowPayCardModal(false)} employees={payCardEmployees} />

            {showModal && <AddEditEmployeeModal onSave={handleSave} initialData={editingEmployee} employees={employees} onClose={() => { setShowModal(false); setEditingEmployee(null); }} userId={userId} appId={appId} collectionPath={collectionPath} setConfirmAction={setConfirmAction} />}
            
            {docPreview && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={handleCloseDocPreview}>
                    <div className="dark:bg-gray-800 bg-white rounded-lg shadow-xl w-full max-w-4xl h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-3 border-b dark:border-gray-700 border-gray-300">
                            <h4 className="font-semibold text-sm">{docPreview.type} Document - {docPreview.employeeName}</h4>
                            <button onClick={handleCloseDocPreview} className="p-1 hover:text-red-400" title="Close"><X size={16} /></button>
                        </div>
                        <div className="flex-1 overflow-hidden">
                            <iframe src={docPreview.url} title="Document Preview" className="w-full h-full rounded-b-lg" />
                        </div>
                        <div className="p-2 flex justify-end space-x-2 border-t dark:border-gray-700 border-gray-300">
                            <a href={docPreview.url} target="_blank" rel="noopener noreferrer" className="px-3 py-1 text-xs rounded-md bg-cyan-500 hover:bg-cyan-600" title="Open in new tab">Open Full</a>
                            <button onClick={handleCloseDocPreview} className="px-3 py-1 text-xs rounded-md bg-gray-600 hover:bg-gray-700">Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const ManageSubCategoriesModal = ({ userId, appId, onClose, initialCategories, setConfirmAction }) => {
    const [newSubCategory, setNewSubCategory] = useState({}); // e.g., { Income: 'New Income', Expenses: 'New Expense' }
    const [newMainCategory, setNewMainCategory] = useState('');
    const [localCategories, setLocalCategories] = useState(initialCategories);

    const settingsRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/ledgerSettings/defaultSubCategories`), [appId, userId]);

    const handleAdd = async (mainCategory) => {
        const valueToAdd = newSubCategory[mainCategory]?.trim();
        if (!valueToAdd) return;

        await updateDoc(settingsRef, {
            [mainCategory]: arrayUnion(capitalizeWords(valueToAdd))
        });

        setNewSubCategory(prev => ({ ...prev, [mainCategory]: '' }));
    };

    const handleAddMainCategory = async () => {
        const valueToAdd = newMainCategory.trim();
        if (!valueToAdd) return;
        
        const capitalizedName = capitalizeWords(valueToAdd);
        if (localCategories[capitalizedName]) {
            alert('This main category already exists.');
            return;
        }

        try {
            await setDoc(settingsRef, {
                [capitalizedName]: []
            }, { merge: true });
            
            setLocalCategories(prev => ({ ...prev, [capitalizedName]: [] }));
            setNewMainCategory('');
        } catch (error) {
            console.error('Failed to add main category:', error);
            alert('Failed to add main category. Please try again.');
        }
    };

    const handleDeleteMainCategoryRequest = (mainCategory) => {
        setConfirmAction({
            title: 'Confirm Delete Main Category',
            message: `Are you sure you want to delete the main category "${mainCategory}" and all its sub-categories? This cannot be undone.`,
            confirmText: 'Delete',
            type: 'delete',
            action: async () => {
                try {
                    await updateDoc(settingsRef, {
                        [mainCategory]: arrayRemove(...(localCategories[mainCategory] || []))
                    });
                    
                    const newData = { ...localCategories };
                    delete newData[mainCategory];
                    setLocalCategories(newData);
                } catch (error) {
                    console.error('Failed to delete main category:', error);
                }
            }
        });
    };

    const handleDeleteRequest = (mainCategory, subCategory) => {
        setConfirmAction({
            title: 'Confirm Delete',
            message: `Are you sure you want to delete the sub-category "${subCategory}"? This cannot be undone.`,
            confirmText: 'Delete',
            type: 'delete',
            action: async () => {
                await updateDoc(settingsRef, {
                    [mainCategory]: arrayRemove(subCategory)
                });
            }
        });
    };

    const handleInputChange = (mainCategory, value) => {
        setNewSubCategory(prev => ({ ...prev, [mainCategory]: value }));
    };

    return (
         <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-[101] p-4">
            <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col">
                <div className="flex justify-between items-center mb-4 flex-shrink-0">
                    <h3 className="text-xl font-bold">Manage Chart of Accounts</h3>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700"><X size={20}/></button>
                </div>

                {/* Add Main Category Section */}
                <div className="bg-gradient-to-r from-cyan-900/30 to-blue-900/30 p-4 rounded-lg mb-4 flex-shrink-0 border border-cyan-500/20">
                    <h4 className="font-semibold text-cyan-400 mb-2 flex items-center gap-2">
                        <BookOpen size={18} />
                        Add New Main Category
                    </h4>
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            placeholder="Enter main category name (e.g., Capital)"
                            value={newMainCategory}
                            onChange={(e) => setNewMainCategory(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddMainCategory()}
                            className="flex-grow p-2 bg-gray-700 rounded-md text-sm"
                            style={{textTransform: 'capitalize'}}
                        />
                        <button 
                            onClick={handleAddMainCategory} 
                            className="px-4 py-2 bg-cyan-500 rounded-md hover:bg-cyan-600 font-semibold flex items-center gap-2"
                        >
                            <PlusCircle size={18} />
                            Add Main Category
                        </button>
                    </div>
                </div>

                <div className="overflow-y-auto flex-grow">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {Object.keys(localCategories).map(mainCat => (
                            <div key={mainCat} className="dark:bg-gray-700/50 bg-gray-100/50 p-4 rounded-lg border border-gray-600">
                                <div className="flex justify-between items-center mb-3">
                                    <h4 className="font-bold text-lg text-cyan-400">{mainCat}</h4>
                                    <button 
                                        onClick={() => handleDeleteMainCategoryRequest(mainCat)} 
                                        className="p-1 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded"
                                        title="Delete Main Category"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                                <div className="space-y-2 mb-4 min-h-[50px]">
                                    {localCategories[mainCat]?.sort().map(subCat => (
                                        <div key={subCat} className="flex items-center justify-between bg-gray-600/50 p-2 rounded-md text-sm">
                                            <span>{subCat}</span>
                                            <button onClick={() => handleDeleteRequest(mainCat, subCat)} className="p-1 text-red-400 hover:text-red-300">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        placeholder="Add new default..."
                                        value={newSubCategory[mainCat] || ''}
                                        onChange={(e) => handleInputChange(mainCat, e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleAdd(mainCat)}
                                        className="flex-grow p-2 bg-gray-700 rounded-md text-sm"
                                        style={{textTransform: 'capitalize'}}
                                    />
                                    <button onClick={() => handleAdd(mainCat)} className="p-2 bg-cyan-500 rounded-md hover:bg-cyan-600">
                                        <PlusCircle size={18} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                 <div className="flex justify-end mt-6 flex-shrink-0">
                    <button onClick={onClose} className="px-6 py-2 bg-gray-600 rounded-md hover:bg-gray-500">Close</button>
                </div>
            </div>
        </div>
    );
};

const EditLedgerEntryModal = ({ entry, onSave, onClose, categories, allEmployees = [] }) => {
    const [formData, setFormData] = useState(entry);
    useEffect(() => {
        const vehicleRegex = / \(Vehicle: (.*)\)$/;
        const match = entry.particulars ? entry.particulars.match(vehicleRegex) : null;
        const initialParticulars = match ? entry.particulars.replace(vehicleRegex, '') : entry.particulars;
        const initialVehicleNumber = match ? match[1] : '';

        setFormData({ 
            ...entry, 
            date: formatDate(entry.date),
            particulars: initialParticulars,
            vehicleNumber: initialVehicleNumber,
        });
    }, [entry]);

    const handleChange = (e) => { const { name, value } = e.target; setFormData(prev => { const updatedEntry = { ...prev, [name]: value }; if (name === 'mainCategory') { updatedEntry.subCategory = ''; updatedEntry.debit = ''; updatedEntry.credit = ''; updatedEntry.vehicleNumber = '' } return updatedEntry; }); };
    const handleSave = () => {
        const dateForDb = parseDateForFirestore(formData.date);
        if (!formData.date || !dateForDb) {
             console.error("Invalid date format. Please use dd/mm/yyyy");
             return;
        }
        
        const finalSubCategory = formData.subCategory === 'Others' ? capitalizeWords(formData.customSubCategory || '') : formData.subCategory;
        let finalParticulars = capitalizeWords(formData.particulars);
        if (formData.subCategory === 'Vehicles' && formData.vehicleNumber) {
            finalParticulars = `${finalParticulars} (Vehicle: ${formData.vehicleNumber})`;
        }
        
        const { vehicleNumber, ...dataToSave } = formData;

        onSave({
            ...dataToSave,
            date: dateForDb,
            particulars: finalParticulars,
            subCategory: finalSubCategory,
            debit: Number(formData.debit) || 0,
            credit: Number(formData.credit) || 0,
        });
    };
    const entryType = useMemo(() => { const debitTypes = ['Assets', 'Expenses', 'Current Assets']; const creditTypes = ['Liability', 'Equity', 'Income', 'Current Liabilities']; if (debitTypes.includes(formData.mainCategory)) return 'debit'; if (creditTypes.includes(formData.mainCategory)) return 'credit'; return null; }, [formData.mainCategory]);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4">
            <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-5xl">
                <h3 className="text-xl font-bold mb-4">Edit Ledger Entry</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                    <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Date</label><DateInput value={formData.date} onChange={(val) => setFormData(p => ({...p, date: val}))}/></div>
                    <div className="flex flex-col md:col-span-2 lg:col-span-1">
                        <label className="text-xs mb-1 text-gray-400">Perticulers / Names</label>
                        <input
                            list="edit-employee-names"
                            type="text" name="particulars" placeholder="Perticulers / Names" value={formData.particulars} onChange={handleChange}
                            className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md"
                            style={{textTransform: 'capitalize'}}
                        />
                        <datalist id="edit-employee-names">
                            {allEmployees.map(name => <option key={name} value={name} />)}
                        </datalist>
                    </div>
                    <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Main Category</label><select name="mainCategory" value={formData.mainCategory} onChange={handleChange} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md"> <option value="">Select...</option> {Object.keys(categories).map(cat => <option key={cat} value={cat}>{cat}</option>)} </select></div>
                    <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Sub Category</label><select name="subCategory" value={formData.subCategory} onChange={handleChange} disabled={!formData.mainCategory} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md disabled:opacity-50"> <option value="">Select...</option> {formData.mainCategory && categories[formData.mainCategory].map(subCat => <option key={subCat} value={subCat}>{subCat}</option>)} </select></div>
                    {formData.subCategory === 'Others' && <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Specify Other</label><input type="text" name="customSubCategory" placeholder="Specify" value={formData.customSubCategory || ''} onChange={handleChange} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md" style={{textTransform: 'capitalize'}}/></div>}
                    {formData.subCategory === 'Vehicles' && (
                        <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Vehicle Number</label><input type="text" name="vehicleNumber" placeholder="Vehicle No." value={formData.vehicleNumber || ''} onChange={handleChange} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md" /></div>
                    )}
                    <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Debit</label><input type="number" name="debit" placeholder="Debit" value={formData.debit} onChange={handleChange} disabled={entryType !== 'debit'} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"/></div>
                    <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Credit</label><input type="number" name="credit" placeholder="Credit" value={formData.credit} onChange={handleChange} disabled={entryType !== 'credit'} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"/></div>
                </div>
                <div className="flex justify-end space-x-2 mt-6"> <button onClick={onClose} className="px-4 py-2 bg-gray-600 rounded-md">Cancel</button> <button onClick={handleSave} className="px-4 py-2 bg-cyan-500 rounded-md">Save Changes</button> </div>
            </div>
        </div>
    );
};

const LedgerPage = ({ userId, appId, currency, collectionPath, setConfirmAction }) => {
    const [entries, setEntries] = useState([]);
    const [newEntry, setNewEntry] = useState({ date: formatDate(new Date()), particulars: '', debit: '', credit: '', mainCategory: '', subCategory: '', customSubCategory: '', partnerName: '', vehicleNumber: '' });
    const [editingEntry, setEditingEntry] = useState(null);
    const [showNewEntryModal, setShowNewEntryModal] = useState(false); // New state for the modal
    const [view, setView] = useState('monthly');
    const [activeLedgerView, setActiveLedgerView] = useState('entries');
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
    const [searchTerm, setSearchTerm] = useState('');
    const [mainCategoryFilter, setMainCategoryFilter] = useState('');
    const [subCategoryFilter, setSubCategoryFilter] = useState('');
    const [showManageCategoriesModal, setShowManageCategoriesModal] = useState(false);
    const [pinnedItems, setPinnedItems] = useState([]);
    const [showAddPinnedModal, setShowAddPinnedModal] = useState(false);
    const [tickedEntries, setTickedEntries] = useState(new Set());
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [isClearingData, setIsClearingData] = useState(false); // Add this state
    const [isExportingExcel, setIsExportingExcel] = useState(false); // <-- Add this new state
    const importFileInputRef = useRef(null);

    const [alMarriEmployees, setAlMarriEmployees] = useState([]);
    const [fathoomEmployees, setFathoomEmployees] = useState([]);
    const allEmployees = useMemo(() => [...new Set([...alMarriEmployees, ...fathoomEmployees])].sort(), [alMarriEmployees, fathoomEmployees]);

    const [pinnedEntryIds, setPinnedEntryIds] = useState(new Set()); // State for pinned IDs
    const pinnedEntriesRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/ledgerSettings/pinnedEntries`), [userId, appId]); // Firestore ref for pinned IDs
    const tickedEntriesRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/ledgerSettings/tickedEntries`), [userId, appId]); // Firestore ref for ticked IDs


    const pinnedItemsRef = useMemo(() => collection(db, `artifacts/${appId}/users/${userId}/ledgerFavorites`), [userId, appId]);

    const updateTickedInFirestore = useCallback(async (newSet) => {
        if (!tickedEntriesRef) return;
        try {
            await setDoc(tickedEntriesRef, { ids: Array.from(newSet) });
        } catch (error) {
            console.error("Failed to save ticked ledger entries:", error);
        }
    }, [tickedEntriesRef]);

    // ... existing handleToggleTick, handleToggleAllTicks, handleClearTicks ...
    const handleToggleTick = useCallback((entryId) => {
        setTickedEntries(prev => {
            const newSet = new Set(prev);
            if (newSet.has(entryId)) {
                newSet.delete(entryId);
            } else {
                newSet.add(entryId);
            }
            updateTickedInFirestore(newSet); // Save to Firestore
            return newSet;
        });
    }, [updateTickedInFirestore]);

    const handleToggleAllTicks = (entryList) => {
        const allIds = entryList.map(e => e.id);
        const allAreTicked = allIds.length > 0 && allIds.every(id => tickedEntries.has(e.id));

        setTickedEntries(prev => {
            const newSet = new Set(prev);
            if (allAreTicked) {
                allIds.forEach(id => newSet.delete(id));
            } else {
                allIds.forEach(id => newSet.add(id));
            }
            updateTickedInFirestore(newSet); // Save to Firestore
            return newSet;
        });
    };

    const handleClearTicks = () => {
        const newSet = new Set();
        setTickedEntries(newSet);
        updateTickedInFirestore(newSet); // Save to Firestore
    };

    const defaultCategories = useMemo(() => ({
        // ... existing categories ...
        'Assets': [
            'Cash and Cash Equivalents', 'Accounts Receivable', 'Inventory', 'Prepaid Expenses', 
            'Property, Plant, and Equipment (PP&E)', 'Investments', 'Short-Term Investments', 
            'Long-Term Investments', 'Office Supplies', 'Vehicles', 
            'Bank A/C CBQ Mohamed Al Marri',
            'Bank A/C QIIB-Fathoom Transportation',
            'Credit Card Muhammed Ajmal',
            'Credit Card Riyas Madathil',
            'Commercial Bank-Riyas Madathil',
            'Commercial Bank-Muhammed Ajmal',
            'Others'
        ],
        'Current Assets': ['Sundry Debtors', 'Others'],
        'Liability': ['Accounts Payable', 'Notes Payable', 'Salaries and Wages Payable', 'Taxes Payable', 'Bonds Payable', 'Accrued Expenses', 'Unearned Revenue', 'Others'],
        'Current Liabilities': ['Sundry Creditors', 'Others'],
        'Capital': ['Owner\'s Capital', 'Partner\'s Capital', 'Drawings', 'Others'],
        'Equity': ['Common Stock', 'Retained Earnings', 'Additional Paid-in Capital', 'Others'],
        'Income': ['Sales Revenue', 'Service Revenue', 'Interest Income', 'Rental Income', 'Dividend Income', 'Gain on Sale of Assets', 'Qid Renew', 'Issue Resident Permit', 'Change Passport Details', 'Sponsorship Change', 'Vehicles', 'Others'],
        'Expenses': ['Cost of Goods Sold (COGS)', 'Salaries and Wages', 'Rent Expense', 'Utilities Expense', 'Marketing and Advertising', 'Depreciation Expense', 'Insurance Expense', 'Travel Expense', 'Office Supplies Expense', 'Bank Charges', 'Miscellaneous Expenses', 'Qid Renew', 'Issue Resident Permit', 'Change Passport Details', 'Sponsorship Change', 'Vehicles', 'Others']
    }), []);
    const [categories, setCategories] = useState(defaultCategories);
    const entryType = useMemo(() => { const debitTypes = ['Assets', 'Expenses', 'Current Assets']; const creditTypes = ['Liability', 'Capital', 'Equity', 'Income', 'Current Liabilities']; if (debitTypes.includes(newEntry.mainCategory)) return 'debit'; if (creditTypes.includes(newEntry.mainCategory)) return 'credit'; return null; }, [newEntry.mainCategory]);

    const recentTransactions = useMemo(() => {
        // Entries are sorted ascending by date, slice the last 10 and reverse for most-recent-first view.
        return entries.slice(-10).reverse();
    }, [entries]);

    // ... existing useEffect for employees ...
    useEffect(() => {
        if (!userId || appId === 'default-app-id') return;

        const alMarriRef = collection(db, `artifacts/${appId}/users/${userId}/alMarriData`);
        const fathoomRef = collection(db, `artifacts/${appId}/users/${userId}/fathoomData`);

        const unsubAlMarri = onSnapshot(alMarriRef, (snapshot) => {
            const employeeNames = snapshot.docs.map(doc => doc.data().fullName).filter(Boolean);
            setAlMarriEmployees(employeeNames);
        });
        const unsubFathoom = onSnapshot(fathoomRef, (snapshot) => {
            const employeeNames = snapshot.docs.map(doc => doc.data().fullName).filter(Boolean);
            setFathoomEmployees(employeeNames);
        });

        // Fetch pinned entry IDs
        const unsubPinned = onSnapshot(pinnedEntriesRef, (docSnap) => {
            if (docSnap.exists() && Array.isArray(docSnap.data().ids)) {
                setPinnedEntryIds(new Set(docSnap.data().ids));
            } else {
                setPinnedEntryIds(new Set());
            }
        });

        return () => {
            unsubAlMarri();
            unsubFathoom();
            unsubPinned(); // Unsubscribe from pinned entries listener
        };
    }, [userId, appId, pinnedEntriesRef]); // Added pinnedEntriesRef dependency

    useEffect(() => {
        if (!tickedEntriesRef) return;
        const unsub = onSnapshot(tickedEntriesRef, (docSnap) => {
            if (docSnap.exists() && Array.isArray(docSnap.data().ids)) {
                setTickedEntries(new Set(docSnap.data().ids));
            } else {
                setTickedEntries(new Set());
            }
        }, (error) => {
            console.error("Error fetching ticked ledger entries:", error);
        });
        return () => unsub();
    }, [tickedEntriesRef]);

    // ... existing useEffects for entries, pinnedItems (Quick Entries), categories ...
    useEffect(() => { const ledgerRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`); const unsub = onSnapshot(ledgerRef, (snapshot) => { const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); data.sort((a, b) => (a.date?.toDate ? a.date.toDate() : 0) - (b.date?.toDate ? b.date.toDate() : 0)); setEntries(data); }); return () => unsub(); }, [userId, appId, collectionPath]);

    useEffect(() => {
        if (!pinnedItemsRef) return;
        const unsub = onSnapshot(pinnedItemsRef, snapshot => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setPinnedItems(data);
        });
        return () => unsub();
    }, [pinnedItemsRef]);

    useEffect(() => {
        if (!userId || appId === 'default-app-id') return;
        const settingsRef = doc(db, `artifacts/${appId}/users/${userId}/ledgerSettings/defaultSubCategories`);

        const unsub = onSnapshot(settingsRef, (docSnap) => {
            if (docSnap.exists()) {
                setCategories(docSnap.data());
            } else {
                setDoc(settingsRef, defaultCategories);
                setCategories(defaultCategories);
            }
        });
        return () => unsub();
    }, [userId, appId, defaultCategories]);


    const years = useMemo(() => [...new Set(entries.map(e => {
        const date = e.date?.toDate ? e.date.toDate() : new Date(e.date);
        return isNaN(date.getTime()) ? null : date.getFullYear();
    }))].filter(Boolean).sort((a,b) => b-a), [entries]);
    const months = useMemo(() => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], []);

    const filteredEntries = useMemo(() => {
        let tempEntries = entries;
        if (view === 'recent') {
            const twoMonthsAgo = new Date();
            twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
            twoMonthsAgo.setHours(0, 0, 0, 0);
            tempEntries = tempEntries.filter(e => {
                const date = e.date?.toDate ? e.date.toDate() : new Date(e.date);
                return !isNaN(date.getTime()) && date >= twoMonthsAgo;
            });
        }
        else if (view === 'yearly') {
            tempEntries = tempEntries.filter(e => {
                const date = e.date?.toDate ? e.date.toDate() : new Date(e.date);
                return !isNaN(date.getTime()) && date.getFullYear() === selectedYear;
            });
        }
        if (view === 'monthly') {
            tempEntries = tempEntries.filter(e => {
                const date = e.date?.toDate ? e.date.toDate() : new Date(e.date);
                return !isNaN(date.getTime()) && date.getFullYear() === selectedYear && date.getMonth() === selectedMonth;
            });
        }
        if (mainCategoryFilter) {
            tempEntries = tempEntries.filter(e => e.mainCategory === mainCategoryFilter);
        }
        if (subCategoryFilter) {
            tempEntries = tempEntries.filter(e => e.subCategory === subCategoryFilter);
        }
        if (searchTerm) {
            const lowerSearchTerm = searchTerm.toLowerCase();
            tempEntries = tempEntries.filter(e =>
                (e.particulars && e.particulars.toLowerCase().includes(lowerSearchTerm)) ||
                (e.mainCategory && e.mainCategory.toLowerCase().includes(lowerSearchTerm)) ||
                (e.subCategory && e.subCategory.toLowerCase().includes(lowerSearchTerm)) ||
                (e.debit && String(e.debit).includes(lowerSearchTerm)) ||
                (e.credit && String(e.credit).includes(lowerSearchTerm))
            );
        }
        return tempEntries;
    }, [entries, view, selectedYear, selectedMonth, searchTerm, mainCategoryFilter, subCategoryFilter]);

    // Separate pinned entries from the main filtered list
    const mainLedgerEntries = useMemo(() => filteredEntries.filter(entry => !pinnedEntryIds.has(entry.id)), [filteredEntries, pinnedEntryIds]);
    const pinnedLedgerEntries = useMemo(() => filteredEntries.filter(entry => pinnedEntryIds.has(entry.id)), [filteredEntries, pinnedEntryIds]);


    const totals = useMemo(() => {
        // Calculate totals based on mainLedgerEntries only, as pinned entries are shown separately
        return mainLedgerEntries.reduce((acc, entry) => {
            acc.debit += entry.debit || 0;
            acc.credit += entry.credit || 0;
            return acc;
        }, { debit: 0, credit: 0 });
    }, [mainLedgerEntries]); // Changed dependency


    const openingBalance = useMemo(() => {
        let balance = 0;
        let periodStartDate;

        if (view === 'all') return 0;

        if (view === 'recent') {
            periodStartDate = new Date();
            periodStartDate.setMonth(periodStartDate.getMonth() - 2);
            periodStartDate.setHours(0, 0, 0, 0);
        } else if (view === 'yearly') {
            periodStartDate = new Date(selectedYear, 0, 1);
        } else if (view === 'monthly') {
            periodStartDate = new Date(selectedYear, selectedMonth, 1);
        }

        // Calculate opening balance based on ALL entries before the period start
        entries.forEach(entry => {
            const entryDate = entry.date?.toDate ? entry.date.toDate() : new Date(entry.date);
            if (entryDate < periodStartDate) {
                balance += (entry.debit || 0) - (entry.credit || 0);
            }
        });
        return balance;
    }, [entries, view, selectedYear, selectedMonth]); // Use full 'entries' list here


    const handleNewEntryChange = (e) => { const { name, value } = e.target; setNewEntry(prev => { const updatedEntry = { ...prev, [name]: value }; if (name === 'mainCategory') { updatedEntry.subCategory = ''; updatedEntry.debit = ''; updatedEntry.credit = ''; updatedEntry.partnerName = ''; updatedEntry.vehicleNumber = ''; } return updatedEntry; }); };

    const handleAddEntry = async () => {
        // ... (existing add entry logic remains the same) ...
        const dateForDb = parseDateForFirestore(newEntry.date);
        if (!newEntry.date || !dateForDb) {
            console.error("Invalid date format. Please use dd/mm/yyyy");
            return;
        }
        if (!newEntry.particulars) return;

        const finalSubCategory = newEntry.subCategory === 'Others' ? capitalizeWords(newEntry.customSubCategory || '') : newEntry.subCategory;

        let finalParticulars = capitalizeWords(newEntry.particulars);
        if (newEntry.subCategory === 'Vehicles' && newEntry.vehicleNumber) {
            finalParticulars = `${finalParticulars} (Vehicle: ${newEntry.vehicleNumber})`;
        }

        const { vehicleNumber, ...entryToSave } = newEntry;

        const ledgerRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`);
        await addDoc(ledgerRef, { ...entryToSave, date: dateForDb, particulars: finalParticulars, subCategory: finalSubCategory, debit: Number(newEntry.debit) || 0, credit: Number(newEntry.credit) || 0, customSubCategory: '' });
        setNewEntry({ date: formatDate(new Date()), particulars: '', debit: '', credit: '', mainCategory: '', subCategory: '', customSubCategory: '', partnerName: '', vehicleNumber: '' });
        setShowNewEntryModal(false); // Close modal on save
    };

    const handleClearLedgerData = () => {
        setConfirmAction({
            title: `DANGER: Clear All Ledger Data`,
            message: 'Are you sure you want to delete ALL ledger entries, custom categories, quick entries, and pinned items? This action cannot be undone.',
            confirmText: 'Yes, Delete All',
            type: 'delete',
            action: async () => {
                setIsClearingData(true);
                try {
                    const ledgerRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`);
                    const settingsRef = doc(db, `artifacts/${appId}/users/${userId}/ledgerSettings/defaultSubCategories`);
                    const pinnedRef = doc(db, `artifacts/${appId}/users/${userId}/ledgerSettings/pinnedEntries`);
                    const favoritesRef = collection(db, `artifacts/${appId}/users/${userId}/ledgerFavorites`);
                    const tickedRef = doc(db, `artifacts/${appId}/users/${userId}/ledgerSettings/tickedEntries`);

                    // Get all docs to delete
                    const ledgerSnapshot = await getDocs(ledgerRef);
                    const favoritesSnapshot = await getDocs(favoritesRef);

                    const batch = writeBatch(db);

                    // Delete all ledger entries
                    if (!ledgerSnapshot.empty) {
                        ledgerSnapshot.forEach(doc => batch.delete(doc.ref));
                    }
                    
                    // Delete all ledger favorites
                    if (!favoritesSnapshot.empty) {
                        favoritesSnapshot.forEach(doc => batch.delete(doc.ref));
                    }

                    // Delete settings docs
                    batch.delete(settingsRef);
                    batch.delete(pinnedRef);
                    batch.delete(tickedRef);

                    // Commit the batch
                    await batch.commit();
                    
                    // Reset default categories locally
                    setCategories(defaultCategories);

                    alert('All General Ledger data has been cleared.');
                } catch (err) {
                    console.error("Ledger data clear process failed:", err);
                    alert(`Data clear failed: ${err.message}`);
                } finally {
                    setIsClearingData(false);
                }
            }
        });
    };

    // ... existing handleExportJson, handleImportJsonChange, triggerImport ...
    const handleExportJson = async () => {
        setConfirmAction({
            title: `Export General Ledger Data`,
            message: 'This will export all ledger entries, custom categories, quick entries, and pinned items to a JSON file. Proceed?',
            confirmText: 'Export',
            type: 'save',
            action: async () => {
                setIsExporting(true);
                try {
                    const ledgerRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`);
                    const settingsRef = doc(db, `artifacts/${appId}/users/${userId}/ledgerSettings/defaultSubCategories`);
                    const pinnedRef = doc(db, `artifacts/${appId}/users/${userId}/ledgerSettings/pinnedEntries`); // Include pinned IDs
                    const favoritesRef = collection(db, `artifacts/${appId}/users/${userId}/ledgerFavorites`); // Add favorites ref
                    const tickedRef = doc(db, `artifacts/${appId}/users/${userId}/ledgerSettings/tickedEntries`); // Add ticked ref

                    const ledgerSnapshot = await getDocs(ledgerRef);
                    const settingsSnap = await getDoc(settingsRef);
                    const pinnedSnap = await getDoc(pinnedRef);
                    const favoritesSnapshot = await getDocs(favoritesRef); // Get favorites docs
                    const tickedSnap = await getDoc(tickedRef); // Get ticked doc

                    const dataToExport = {
                        ledgerEntries: ledgerSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
                        ledgerSettings: settingsSnap.exists() ? settingsSnap.data() : null,
                        pinnedEntries: pinnedSnap.exists() ? pinnedSnap.data().ids : [], // Export pinned IDs as an array
                        ledgerFavorites: favoritesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })), // Add favorites data
                        tickedEntries: tickedSnap.exists() ? tickedSnap.data().ids : [] // Add ticked data
                    };

                    const jsonString = JSON.stringify(dataToExport, null, 2);
                    const blob = new Blob([jsonString], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `ledger_backup_${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (error) {
                    console.error("Export failed:", error);
                    alert("An error occurred during export. Check console for details.");
                } finally {
                    setIsExporting(false);
                }
            }
        });
    };

    const handleImportJsonChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);

                const isNewFormat = typeof importedData === 'object' && !Array.isArray(importedData) && importedData.ledgerEntries;
                const entriesToImport = isNewFormat ? importedData.ledgerEntries : importedData;
                const settingsToImport = isNewFormat ? importedData.ledgerSettings : null;
                const pinnedToImport = isNewFormat ? importedData.pinnedEntries : null; // Pinned IDs from new format
                const favoritesToImport = isNewFormat ? importedData.ledgerFavorites : null; // Favorites from new format
                const tickedToImport = isNewFormat ? importedData.tickedEntries : null; // Ticked from new format

                if (!Array.isArray(entriesToImport)) {
                    throw new Error("Invalid file format: Data should contain an array of ledger entries.");
                }

                const message = `This will DELETE ALL current ledger entries ${settingsToImport ? ', custom categories,' : ''} ${pinnedToImport ? 'and pinned entries' : ''} and replace them with data from the file. This action cannot be undone. Are you sure?`;

                setConfirmAction({
                    title: `DANGER: Import Ledger Data`,
                    message: message,
                    confirmText: 'Yes, Delete & Import',
                    type: 'delete',
                    action: async () => {
                        setIsImporting(true);
                        try {
                            const ledgerRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`);
                            const settingsRef = doc(db, `artifacts/${appId}/users/${userId}/ledgerSettings/defaultSubCategories`);
                            const pinnedRef = doc(db, `artifacts/${appId}/users/${userId}/ledgerSettings/pinnedEntries`); // Ref for pinned IDs
                            const favoritesRef = collection(db, `artifacts/${appId}/users/${userId}/ledgerFavorites`); // Add favorites ref
                            const tickedRef = doc(db, `artifacts/${appId}/users/${userId}/ledgerSettings/tickedEntries`); // Add ticked ref

                            // Step 1: Wipe existing data
                            const existingDocsSnapshot = await getDocs(ledgerRef);
                            const favoritesSnapshot = await getDocs(favoritesRef); // Get favorites docs
                            const batch = writeBatch(db);
                            if (!existingDocsSnapshot.empty) {
                                existingDocsSnapshot.forEach(doc => batch.delete(doc.ref));
                            }
                            if (!favoritesSnapshot.empty) { // Add favorites to wipe batch
                                favoritesSnapshot.forEach(doc => batch.delete(doc.ref));
                            }
                            // Delete settings and pinned doc regardless of whether they exist in import, to ensure clean slate
                            batch.delete(settingsRef);
                            batch.delete(pinnedRef);
                            batch.delete(tickedRef); // Add ticked ref to wipe batch

                            // Step 2: Import new entries
                            entriesToImport.forEach(item => {
                                const { id, ...data } = item;
                                const restoredData = restoreTimestamps(data);
                                const docRef = doc(db, ledgerRef.path, id);
                                batch.set(docRef, restoredData);
                            });

                            await batch.commit();

                            // Step 3: Restore settings if they exist
                            if (settingsToImport) {
                                await setDoc(settingsRef, settingsToImport);
                            } else {
                                await setDoc(settingsRef, defaultCategories); // Restore defaults if not in import
                            }
                            // Step 4: Restore pinned entries if they exist
                            if (pinnedToImport && Array.isArray(pinnedToImport)) {
                                await setDoc(pinnedRef, { ids: pinnedToImport });
                            } else {
                                await setDoc(pinnedRef, { ids: [] }); // Set empty array if not in import
                            }
                            // Step 5: Restore favorites if they exist
                            if (favoritesToImport && Array.isArray(favoritesToImport)) {
                                const favBatch = writeBatch(db);
                                favoritesToImport.forEach(item => {
                                    const { id, ...data } = item;
                                    const restoredData = restoreTimestamps(data);
                                    const docRef = doc(db, favoritesRef.path, id);
                                    favBatch.set(docRef, restoredData);
                                });
                                await favBatch.commit();
                            }
                            // Step 6: Restore ticked entries if they exist
                            if (tickedToImport && Array.isArray(tickedToImport)) {
                                await setDoc(tickedRef, { ids: tickedToImport });
                            } else {
                                await setDoc(tickedRef, { ids: [] });
                            }


                            alert('Import successful! The ledger data has been restored.');
                        } catch (err) {
                            console.error("Import process failed:", err);
                            alert(`Import failed: ${err.message}`);
                        } finally {
                            setIsImporting(false);
                        }
                    }
                });

            } catch (err) {
                 alert(`Error reading file: ${err.message}`);
            }
            if(importFileInputRef.current) importFileInputRef.current.value = "";
        };
        reader.readAsText(file);
    };

    const triggerImport = () => {
        importFileInputRef.current?.click();
    };

    // --- NEW EXCEL EXPORT FUNCTION ---
    const handleExportLedgerExcel = async () => {
        if (!window.XLSX) {
            alert("Excel export library is not ready. Please try again in a moment.");
            return;
        }

        setConfirmAction({
            title: 'Export General Ledger to Excel',
            message: `This will export the currently filtered General Ledger entries (${pinnedLedgerEntries.length} pinned, ${mainLedgerEntries.length} main) to an Excel file. Proceed?`,
            confirmText: 'Export',
            type: 'save',
            action: async () => {
                setIsExportingExcel(true);
                try {
                    const wb = window.XLSX.utils.book_new();
                    
                    let runningBalance = openingBalance;

                    // --- Sheet 1: Pinned Entries ---
                    if (pinnedLedgerEntries.length > 0) {
                        const pinnedData = pinnedLedgerEntries.map(entry => {
                            runningBalance += (entry.debit || 0) - (entry.credit || 0);
                            return {
                                "Date": formatDate(entry.date),
                                "Particulars / Names": entry.particulars,
                                "Main Category": entry.mainCategory,
                                "Sub Category": entry.subCategory,
                                "Debit": entry.debit || 0,
                                "Credit": entry.credit || 0,
                                "Balance": runningBalance
                            };
                        });
                        const wsPinned = window.XLSX.utils.json_to_sheet(pinnedData);
                        window.XLSX.utils.book_append_sheet(wb, wsPinned, "Pinned Entries");
                    }

                    // --- Sheet 2: Main Ledger Entries ---
                    const mainData = [];
                    // Add Opening Balance row if not viewing "All Time"
                    if (view !== 'all') {
                        mainData.push({
                            "Date": "Opening Balance",
                            "Balance": openingBalance
                        });
                        // The runningBalance is already initialized to openingBalance
                    } else {
                        runningBalance = 0; // For 'all' view, start balance from 0
                    }

                    mainLedgerEntries.forEach(entry => {
                        runningBalance += (entry.debit || 0) - (entry.credit || 0);
                        mainData.push({
                            "Date": formatDate(entry.date),
                            "Particulars / Names": entry.particulars,
                            "Main Category": entry.mainCategory,
                            "Sub Category": entry.subCategory,
                            "Debit": entry.debit || 0,
                            "Credit": entry.credit || 0,
                            "Balance": runningBalance
                        });
                    });

                    const wsMain = window.XLSX.utils.json_to_sheet(mainData);

                    // Add Totals row at the end
                    window.XLSX.utils.sheet_add_aoa(
                        wsMain, 
                        [[ "Total", "", "", "", totals.debit, totals.credit, runningBalance ]], 
                        { origin: -1 } // Appends to the end of the sheet
                    );

                    window.XLSX.utils.book_append_sheet(wb, wsMain, "General Ledger");

                    // --- Download the file ---
                    const period = view === 'monthly' ? `${selectedYear}-${selectedMonth+1}` : view === 'yearly' ? selectedYear : 'all_time';
                    window.XLSX.writeFile(wb, `general_ledger_export_${period}_${new Date().toISOString().split('T')[0]}.xlsx`);

                } catch (error) {
                    console.error("Ledger Excel Export failed:", error);
                    alert("An error occurred during the Excel export.");
                } finally {
                    setIsExportingExcel(false);
                }
            }
        });
    };
    // --- END NEW EXCEL EXPORT FUNCTION ---

    // --- NEW EXCEL IMPORT FUNCTION ---
    const handleImportLedgerExcel = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!window.XLSX) {
            alert("Excel import library is not ready. Please try again in a moment.");
            return;
        }

        try {
            const data = await file.arrayBuffer();
            const workbook = window.XLSX.read(data);

            setConfirmAction({
                title: 'Import Ledger Data from Excel',
                message: 'This will import ledger entries from Excel and MERGE with existing data. Entries with matching IDs will be updated. Continue?',
                confirmText: 'Yes, Import',
                type: 'import',
                action: async () => {
                    setIsImporting(true);
                    try {
                        const ledgerRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`);
                        let importedCount = 0;

                        // Use batch writes for better performance
                        let batch = writeBatch(db);
                        let batchCount = 0;
                        const BATCH_SIZE = 500;

                        // Import from "General Ledger" sheet
                        if (workbook.SheetNames.includes('General Ledger')) {
                            const worksheet = workbook.Sheets['General Ledger'];
                            const jsonData = window.XLSX.utils.sheet_to_json(worksheet);

                            for (const row of jsonData) {
                                // Skip opening balance and totals rows
                                if (row['Date'] === 'Opening Balance' || row['Date'] === 'Total') continue;
                                
                                const entryData = {
                                    date: parseDateForFirestore(row['Date']) || new Date(),
                                    particulars: row['Particulars / Names'] || '',
                                    mainCategory: row['Main Category'] || '',
                                    subCategory: row['Sub Category'] || '',
                                    debit: Number(row['Debit']) || 0,
                                    credit: Number(row['Credit']) || 0,
                                };

                                // If row has an ID, use it; otherwise create new entry
                                if (row.id) {
                                    batch.set(doc(ledgerRef, row.id), entryData, { merge: true });
                                } else {
                                    batch.set(doc(ledgerRef), entryData);
                                }
                                
                                batchCount++;
                                importedCount++;
                                
                                // Commit batch when reaching limit
                                if (batchCount >= BATCH_SIZE) {
                                    await batch.commit();
                                    batch = writeBatch(db);
                                    batchCount = 0;
                                }
                            }
                        }

                        // Import from "Pinned Entries" sheet if exists
                        if (workbook.SheetNames.includes('Pinned Entries')) {
                            const worksheet = workbook.Sheets['Pinned Entries'];
                            const jsonData = window.XLSX.utils.sheet_to_json(worksheet);

                            for (const row of jsonData) {
                                const entryData = {
                                    date: parseDateForFirestore(row['Date']) || new Date(),
                                    particulars: row['Particulars / Names'] || '',
                                    mainCategory: row['Main Category'] || '',
                                    subCategory: row['Sub Category'] || '',
                                    debit: Number(row['Debit']) || 0,
                                    credit: Number(row['Credit']) || 0,
                                };

                                // Add to ledger entries
                                if (row.id) {
                                    batch.set(doc(ledgerRef, row.id), entryData, { merge: true });
                                } else {
                                    batch.set(doc(ledgerRef), entryData);
                                }
                                
                                batchCount++;
                                importedCount++;
                                
                                // Commit batch when reaching limit
                                if (batchCount >= BATCH_SIZE) {
                                    await batch.commit();
                                    batch = writeBatch(db);
                                    batchCount = 0;
                                }
                            }
                        }

                        // Commit remaining items in batch
                        if (batchCount > 0) {
                            await batch.commit();
                        }

                        alert(`✅ Successfully imported ${importedCount} ledger entries!`);
                    } catch (error) {
                        console.error('Ledger import process failed:', error);
                        alert(`Import failed: ${error.message}`);
                    } finally {
                        setIsImporting(false);
                    }
                }
            });
        } catch (error) {
            console.error('Failed to read Excel file:', error);
            alert(`Failed to read Excel file: ${error.message}`);
        } finally {
            e.target.value = '';
        }
    };

    const triggerLedgerImport = () => {
        importFileInputRef.current?.click();
    };
    // --- END NEW EXCEL IMPORT FUNCTION ---

    // --- Pin/Unpin Logic ---
    const updatePinnedInFirestore = async (newPinnedIdsSet) => {
        try {
            await setDoc(pinnedEntriesRef, { ids: Array.from(newPinnedIdsSet) });
        } catch (error) {
            console.error("Error updating pinned entries in Firestore:", error);
            // Optionally revert local state or show an error message
        }
    };

    const handlePinEntry = (entry) => { // Changed to accept the full entry object
        setConfirmAction({
            title: 'Confirm Pin Entry',
            message: `Are you sure you want to pin this entry for "${entry.particulars}"?`,
            confirmText: 'Pin',
            type: 'save', // Use 'save' style for confirmation
            action: () => {
                const newPinnedIds = new Set(pinnedEntryIds);
                newPinnedIds.add(entry.id);
                setPinnedEntryIds(newPinnedIds);
                updatePinnedInFirestore(newPinnedIds); // Update Firestore
            }
        });
    };

    const handleUnpinEntry = (entry) => { // Changed to accept the full entry object
        setConfirmAction({
            title: 'Confirm Unpin Entry',
            message: `Are you sure you want to unpin this entry for "${entry.particulars}"?`,
            confirmText: 'Unpin',
            type: 'delete', // Use 'delete' style as it's a removal action
            action: () => {
                const newPinnedIds = new Set(pinnedEntryIds);
                newPinnedIds.delete(entry.id);
                setPinnedEntryIds(newPinnedIds);
                updatePinnedInFirestore(newPinnedIds); // Update Firestore
            }
        });
    };


    const handleAddPinnedItem = async (pinnedItemData) => {
        await addDoc(pinnedItemsRef, pinnedItemData);
        setShowAddPinnedModal(false);
    };

    const handleDeletePinnedItem = (id) => {
        setConfirmAction({
            title: 'Delete Pinned Item',
            message: 'Are you sure you want to remove this quick entry item?',
            confirmText: 'Delete',
            type: 'delete',
            action: () => deleteDoc(doc(pinnedItemsRef, id))
        });
    };

    const handleQuickSave = async (quickEntry) => {
        const ledgerRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`);
        await addDoc(ledgerRef, quickEntry);
    };

    const onDeleteRequest = (id) => { setConfirmAction({ title: 'Confirm Deletion', message: 'Are you sure you want to delete this ledger entry?', confirmText: 'Delete', type: 'delete', action: () => deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/${collectionPath}`, id)) }) };
    const onSaveRequest = (updatedEntry) => { setConfirmAction({ title: 'Confirm Save', message: 'Are you sure you want to save these changes?', confirmText: 'Save', type: 'save', action: () => { const { id, ...dataToUpdate } = updatedEntry; const entryRef = doc(db, `artifacts/${appId}/users/${userId}/${collectionPath}`, id); updateDoc(entryRef, dataToUpdate); } }); setEditingEntry(null); };

    let balance = openingBalance;

    const QuickEntryCard = ({ item, onSave, onDelete }) => {
        // ... (existing QuickEntryCard logic remains the same) ...
        const [date, setDate] = useState(formatDate(new Date()));
        const [amount, setAmount] = useState('');
        const [notes, setNotes] = useState('');

        const isDebit = useMemo(() => ['Assets', 'Expenses', 'Current Assets'].includes(item.mainCategory), [item.mainCategory]);

        const handleSave = () => {
            if (!amount || isNaN(parseFloat(amount))) {
                return;
            }
            const dateForDb = parseDateForFirestore(date);
            if (!dateForDb) return;

            onSave({
                date: dateForDb,
                particulars: item.particulars,
                mainCategory: item.mainCategory,
                subCategory: item.subCategory,
                notes: notes,
                debit: isDebit ? parseFloat(amount) : 0,
                credit: !isDebit ? parseFloat(amount) : 0,
            });
            setAmount('');
            setNotes('');
            setDate(formatDate(new Date()));
        };

        return (
            <div className="dark:bg-gray-700/50 bg-gray-100 p-3 rounded-lg flex flex-col space-y-2 relative group">
                 <button onClick={() => onDelete(item.id)} className="absolute top-2 right-2 p-1 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 size={14} />
                </button>
                <div>
                    <p className="font-bold text-sm truncate" title={item.particulars}>{item.particulars}</p>
                    <p className="text-xs text-gray-400">{item.mainCategory} &rarr; {item.subCategory}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                     <DateInput value={date} onChange={setDate} />
                     <input type="number" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md text-sm" />
                </div>
                <input type="text" placeholder="Optional Notes" value={notes} onChange={e => setNotes(e.target.value)} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md text-sm" />
                <button onClick={handleSave} className="px-3 py-1.5 bg-cyan-500 rounded-md text-sm w-full">Save</button>
            </div>
        );
    };

    const AddPinnedItemModal = ({ isOpen, onClose, onSave, categories }) => {
        // ... (existing AddPinnedItemModal logic remains the same) ...
        const [formData, setFormData] = useState({ particulars: '', mainCategory: '', subCategory: '' });

        const handleChange = (e) => {
            const { name, value } = e.target;
            setFormData(prev => {
                const updated = { ...prev, [name]: value };
                if (name === 'mainCategory') updated.subCategory = '';
                return updated;
            });
        };

        const handleSave = () => {
            if (formData.particulars && formData.mainCategory && formData.subCategory) {
                onSave({
                    particulars: capitalizeWords(formData.particulars),
                    mainCategory: formData.mainCategory,
                    subCategory: formData.subCategory
                });
            }
        };

        if(!isOpen) return null;

        return (
             <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-[101] p-4">
                <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg">
                    <h3 className="text-xl font-bold mb-4">Add Quick Entry Item</h3>
                    <div className="space-y-4">
                        <div><label className="text-xs text-gray-400">Particulars / Name</label><input type="text" name="particulars" value={formData.particulars} onChange={handleChange} className="w-full p-2 bg-gray-700 rounded-md" style={{textTransform: 'capitalize'}}/></div>
                        <div><label className="text-xs text-gray-400">Main Category</label><select name="mainCategory" value={formData.mainCategory} onChange={handleChange} className="w-full p-2 bg-gray-700 rounded-md"> <option value="">Select...</option> {Object.keys(categories).map(cat => <option key={cat} value={cat}>{cat}</option>)} </select></div>
                        <div><label className="text-xs text-gray-400">Sub Category</label><select name="subCategory" value={formData.subCategory} onChange={handleChange} disabled={!formData.mainCategory} className="w-full p-2 bg-gray-700 rounded-md disabled:opacity-50"> <option value="">Select...</option> {formData.mainCategory && categories[formData.mainCategory].map(subCat => <option key={subCat} value={subCat}>{subCat}</option>)} </select></div>
                    </div>
                     <div className="flex justify-end space-x-2 mt-6">
                        <button onClick={onClose} className="px-4 py-2 bg-gray-600 rounded-md">Cancel</button>
                        <button onClick={handleSave} className="px-4 py-2 bg-cyan-500 rounded-md">Save Pinned Item</button>
                    </div>
                </div>
            </div>
        );
    };

    // --- Pinned Entries Table Component ---
    const PinnedEntriesTable = () => {
        if (pinnedLedgerEntries.length === 0) return null;

        const pinnedTotals = useMemo(() => {
            return pinnedLedgerEntries.reduce((acc, entry) => {
                acc.debit += entry.debit || 0;
                acc.credit += entry.credit || 0;
                return acc;
            }, { debit: 0, credit: 0 });
        }, [pinnedLedgerEntries]);

        let pinnedBalance = openingBalance; // Start balance calculation specifically for pinned section

        return (
            <section className="mt-8 dark:bg-gray-800/50 bg-white/50 p-4 sm:p-6 rounded-lg border-l-4 border-yellow-500">
                <h2 className="text-xl font-bold mb-4 flex items-center">
                    <Pin size={20} className="mr-3 text-yellow-400"/> Pinned Entries ({pinnedLedgerEntries.length})
                </h2>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase dark:bg-gray-700 bg-gray-50">
                            <tr>
                                <th className="px-4 py-2 text-left">Date</th>
                                <th className="px-4 py-2 text-left">Particulars / Names</th>
                                <th className="px-4 py-2 text-left">Main Category</th>
                                <th className="px-4 py-2 text-left">Sub Category</th>
                                <th className="px-4 py-2 text-right">Debit</th>
                                <th className="px-4 py-2 text-right">Credit</th>
                                <th className="px-4 py-2 text-right">Balance</th>
                                <th className="px-4 py-2 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pinnedLedgerEntries.map(entry => {
                                pinnedBalance += (entry.debit || 0) - (entry.credit || 0);
                                return (
                                    <tr key={entry.id} className="group/row border-b dark:border-yellow-700/30 border-yellow-200/50 dark:bg-yellow-900/10 bg-yellow-50/30">
                                        <td className="p-2">{formatDate(entry.date)}</td>
                                        <td className="p-2">{entry.particulars}</td>
                                        <td className="p-2">{entry.mainCategory}</td>
                                        <td className="p-2">{entry.subCategory}</td>
                                        <td className="p-2 text-right">{formatCurrency(entry.debit, currency)}</td>
                                        <td className="p-2 text-right">{formatCurrency(entry.credit, currency)}</td>
                                        <td className="p-2 text-right font-semibold">{formatCurrency(pinnedBalance, currency)}</td>
                                        <td className="p-2 text-right">
                                            <div className="opacity-0 group-hover/row:opacity-100 flex items-center justify-end space-x-1 no-print">
                                                <button onClick={() => handleUnpinEntry(entry)} className="p-1.5 hover:text-yellow-400" title="Unpin Entry"><PinOff size={14} /></button>
                                                <button onClick={() => setEditingEntry(entry)} className="p-1.5 hover:text-cyan-400"><Edit size={14} /></button>
                                                <button onClick={() => onDeleteRequest(entry.id)} className="p-1.5 hover:text-red-400"><Trash2 size={14} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot className="dark:bg-gray-700 bg-gray-50 font-bold border-t-2 dark:border-gray-600 border-gray-300">
                            <tr>
                                <td colSpan="4" className="px-4 py-2 text-right uppercase">Pinned Total</td>
                                <td className="px-4 py-2 text-right text-green-400">{formatCurrency(pinnedTotals.debit, currency)}</td>
                                <td className="px-4 py-2 text-right text-red-400">{formatCurrency(pinnedTotals.credit, currency)}</td>
                                <td className="px-4 py-2 text-right font-semibold">{formatCurrency(pinnedBalance, currency)}</td>
                                <td className="px-4 py-2 text-right"></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </section>
        );
    };


    return (
        <div className="space-y-8 p-4 sm:p-8">
            {/* ... Navigation remains the same ... */}
            <nav className="flex justify-between items-center space-x-1 sm:space-x-2 flex-wrap no-print border-b-2 dark:border-gray-700 sticky top-[70px] z-40 dark:bg-gray-800/80 bg-white/80 backdrop-blur-sm p-2">
                {/* Left Group */}
                <div className="flex items-center space-x-1 sm:space-x-2">
                    <button
                        onClick={() => setActiveLedgerView('entries')}
                        className={`flex items-center space-x-2 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all duration-200 ${
                            activeLedgerView === 'entries'
                                ? 'bg-cyan-600 text-white shadow-md'
                                : 'dark:text-gray-300 text-gray-600 dark:hover:bg-gray-700 hover:bg-gray-200'
                        }`}
                    >
                        <Edit size={16}/>
                        <span>Entries & Transactions</span>
                    </button>
                    <button
                        onClick={() => setActiveLedgerView('general_ledger')}
                        className={`flex items-center space-x-2 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all duration-200 ${
                            activeLedgerView === 'general_ledger'
                                ? 'bg-cyan-600 text-white shadow-md'
                                : 'dark:text-gray-300 text-gray-600 dark:hover:bg-gray-700 hover:bg-gray-200'
                        }`}
                    >
                        <BookOpen size={16}/>
                        <span>General Ledger</span>
                    </button>
                </div>

                {/* Right Group */}
                <div className="flex items-center space-x-1 sm:space-x-2">
                    <button
                        onClick={() => setActiveLedgerView('quick_entries')}
                        className={`flex items-center space-x-2 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all duration-200 ${
                            activeLedgerView === 'quick_entries'
                                ? 'bg-cyan-600 text-white shadow-md'
                                : 'dark:text-gray-300 text-gray-600 dark:hover:bg-gray-700 hover:bg-gray-200'
                        }`}
                    >
                        <HandCoins size={16}/>
                        <span>Quick Entries</span>
                    </button>
                    {/* Chart of Accounts Button */}
                    <button
                        onClick={() => setShowManageCategoriesModal(true)}
                        className="flex items-center space-x-2 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all duration-200 bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700"
                        title="Manage Chart of Accounts"
                    >
                        <BookOpen size={16}/>
                        <span className="hidden sm:inline">Chart of Accounts</span>
                        <span className="sm:hidden">CoA</span>
                    </button>
                    {/* Add New Entry Button */}
                    <button
                        onClick={() => setShowNewEntryModal(true)}
                        className="flex items-center space-x-2 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all duration-200 bg-cyan-500 text-white hover:bg-cyan-600"
                        title="Add New Ledger Entry"
                    >
                        <PlusCircle size={16}/>
                        <span>New Entry</span>
                    </button>
                    
                    <div className="w-px h-6 bg-gray-300 dark:bg-gray-600"></div>
                    
                    {/* Excel Export Button */}
                    <button
                        onClick={handleExportLedgerExcel}
                        disabled={isExportingExcel || isImporting}
                        className="group flex items-center space-x-2 px-4 py-2 dark:bg-green-700 bg-green-100 rounded-full dark:hover:bg-green-600 hover:bg-green-200 text-sm font-semibold transition-all duration-300 disabled:opacity-50 border dark:border-green-600 border-green-300 dark:text-white text-green-700 shadow-md hover:shadow-lg hover:scale-105"
                        title="Export Ledger to Excel"
                    >
                        {isExportingExcel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        <span>{isExportingExcel ? 'Exporting...' : 'Export Excel'}</span>
                    </button>
                    
                    {/* Hidden File Input for Excel Import */}
                    <input
                        ref={importFileInputRef}
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={handleImportLedgerExcel}
                        className="hidden"
                    />
                    
                    {/* Excel Import Button */}
                    <button
                        onClick={triggerLedgerImport}
                        disabled={isImporting || isExportingExcel}
                        className="group flex items-center space-x-2 px-4 py-2 dark:bg-blue-700 bg-blue-100 rounded-full dark:hover:bg-blue-600 hover:bg-blue-200 text-sm font-semibold transition-all duration-300 disabled:opacity-50 border dark:border-blue-600 border-blue-300 dark:text-white text-blue-700 shadow-md hover:shadow-lg hover:scale-105"
                        title="Import Ledger from Excel"
                    >
                        {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        <span>{isImporting ? 'Importing...' : 'Import Excel'}</span>
                    </button>
                </div>
            </nav>

            {/* ... Existing Entries View sections remain the same ... */}
            {activeLedgerView === 'entries' && (
                <div className="space-y-8">
                    {/* New Entry Section - REMOVED */}
                     
                    {/* === MOVED PINNED ENTRIES TABLE HERE === */}
                    <PinnedEntriesTable />

                    {/* Quick Entries Section - MOVED TO 'quick_entries' VIEW */}
                    
                    {/* Recent Transactions Section */}
                    <section className="dark:bg-gray-800 bg-white p-4 sm:p-6 rounded-lg border-l-4 border-rose-500">
                        {/* ... content ... */}
                         <h2 className="text-xl font-bold mb-4">Recent Transactions</h2>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase dark:bg-gray-700 bg-gray-50">
                                    <tr>
                                        <th className="px-4 py-2 text-left">Date</th>
                                        <th className="px-4 py-2 text-left">Particulars / Names</th>
                                        <th className="px-4 py-2 text-left">Main Category</th>
                                        <th className="px-4 py-2 text-left">Sub Category</th>
                                        <th className="px-4 py-2 text-right">Debit</th>
                                        <th className="px-4 py-2 text-right">Credit</th>
                                        <th className="px-4 py-2 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                     {recentTransactions.length > 0 ? (
                                        recentTransactions.map(entry => (
                                            <tr key={entry.id} className="group/row border-b dark:border-gray-700 border-gray-200">
                                                <td className="p-2">{formatDate(entry.date)}</td>
                                                <td className="p-2">{entry.particulars}</td>
                                                <td className="p-2">{entry.mainCategory}</td>
                                                <td className="p-2">{entry.subCategory}</td>
                                                <td className="p-2 text-right text-green-400">{formatCurrency(entry.debit, currency)}</td>
                                                <td className="p-2 text-right text-red-400">{formatCurrency(entry.credit, currency)}</td>
                                                <td className="p-2 text-right">
                                                    <div className="opacity-0 group-hover/row:opacity-100 flex items-center justify-end space-x-1 no-print">
                                                        <button onClick={() => handlePinEntry(entry)} className="p-1.5 hover:text-yellow-400" title="Pin Entry"><Pin size={14} /></button>
                                                        <button onClick={() => setEditingEntry(entry)} className="p-1.5 hover:text-cyan-400"><Edit size={14}/></button>
                                                        <button onClick={() => onDeleteRequest(entry.id)} className="p-1.5 hover:text-red-400"><Trash2 size={14}/></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan="7" className="text-center py-8 text-gray-500">No recent transactions yet.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>
            )}

            {activeLedgerView === 'general_ledger' && (
                <section className="dark:bg-gray-800 bg-white p-4 sm:p-6 rounded-lg border-l-4 border-rose-500">
                    {/* ... General Ledger Header remains the same ... */}
                     <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 flex-wrap gap-4 sticky top-[122px] z-30 dark:bg-gray-800 bg-white py-4 border-b-2 dark:border-gray-700 -mx-4 sm:-mx-6 px-4 sm:px-6">
                        <h2 className="text-xl font-bold">General Ledger</h2>
                        <div className="flex items-center space-x-2 no-print flex-wrap gap-2">
                            {tickedEntries.size > 0 && (
                                <button onClick={handleClearTicks} className="flex items-center space-x-2 p-2.5 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors text-sm">
                                    <X size={16}/>
                                    <span>Clear ({tickedEntries.size})</span>
                                </button>
                            )}
                            <button onClick={handleClearLedgerData} disabled={isClearingData || isExportingExcel} title="Clear All Ledger Data" className="p-2.5 dark:bg-red-700 bg-red-100 text-sm rounded-md dark:hover:bg-red-800 hover:bg-red-200 no-print disabled:bg-gray-500 border dark:border-red-600 border-red-300 dark:text-white text-red-700">
                                {isClearingData ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16}/>}
                            </button>
                            <div className="relative">
                               <input
                                    type="text"
                                        placeholder="Search..."
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                        className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md pl-8 border dark:border-gray-600 border-gray-300"
                                    />
                                    <Search size={18} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                                </div>
                                <select value={mainCategoryFilter} onChange={e => { setMainCategoryFilter(e.target.value); setSubCategoryFilter(''); }} className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md border dark:border-gray-600 border-gray-300">
                                    <option value="">All Main Categories</option>
                                    {Object.keys(categories).sort().map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                </select>
                                {mainCategoryFilter && (
                                     <select value={subCategoryFilter} onChange={e => setSubCategoryFilter(e.target.value)} className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md border dark:border-gray-600 border-gray-300">
                                        <option value="">All Sub Categories</option>
                                        {categories[mainCategoryFilter].map(subCat => <option key={subCat} value={subCat}>{subCat}</option>)}
                                    </select>
                                )}
                                <div className="flex items-center space-x-1 dark:bg-gray-700 bg-gray-200 p-1 rounded-lg border dark:border-gray-600 border-gray-300">
                                    <button onClick={() => setView('recent')} className={`px-3 py-1 text-sm rounded-md ${view === 'recent' ? 'bg-cyan-600 text-white' : 'dark:text-gray-300 text-gray-700 dark:hover:bg-gray-600 hover:bg-gray-300'}`}>Recent</button>
                                    <button onClick={() => setView('monthly')} className={`px-3 py-1 text-sm rounded-md ${view === 'monthly' ? 'bg-cyan-600 text-white' : 'dark:text-gray-300 text-gray-700 dark:hover:bg-gray-600 hover:bg-gray-300'}`}>Monthly</button>
                                    <button onClick={() => setView('yearly')} className={`px-3 py-1 text-sm rounded-md ${view === 'yearly' ? 'bg-cyan-600 text-white' : 'dark:text-gray-300 text-gray-700 dark:hover:bg-gray-600 hover:bg-gray-300'}`}>Yearly</button>
                                    <button onClick={() => setView('all')} className={`px-3 py-1 text-sm rounded-md ${view === 'all' ? 'bg-cyan-600 text-white' : 'dark:text-gray-300 text-gray-700 dark:hover:bg-gray-600 hover:bg-gray-300'}`}>All Time</button>
                                </div>
                                {(view === 'yearly' || view === 'monthly') && (
                                    <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md border dark:border-gray-600 border-gray-300">
                                        {years.map(y => <option key={y} value={y}>{y}</option>)}
                                    </select>
                                )}
                                {view === 'monthly' && (
                                    <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))} className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md border dark:border-gray-600 border-gray-300">
                                        {months.map((m, i) => <option key={m} value={i}>{m}</option>)}
                                    </select>
                                )}
                            </div>
                    </div>
                    {/* Render Pinned Entries Table - MOVED FROM HERE */}
                    {/* <PinnedEntriesTable /> */}

                    {/* Main Ledger Table (Now uses mainLedgerEntries) */}
                    <div className={`overflow-x-auto ${pinnedLedgerEntries.length > 0 ? 'mt-8 pt-8 border-t-2 dark:border-gray-700' : ''}`}>
                         <h2 className="text-xl font-bold mb-4">Transactions</h2>
                        <table className="w-full text-sm">
                            <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase dark:bg-gray-700 bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 text-left w-12">
                                        <input
                                            type="checkbox"
                                            onChange={() => handleToggleAllTicks(mainLedgerEntries)}
                                            checked={mainLedgerEntries.length > 0 && mainLedgerEntries.every(e => tickedEntries.has(e.id))}
                                            className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                        />
                                    </th>
                                    <th className="px-4 py-2 text-left">Date</th>
                                    <th className="px-4 py-2 text-left">Perticulers / Names</th>
                                    <th className="px-4 py-2 text-left">Main Category</th>
                                    <th className="px-4 py-2 text-left">Sub Category</th>
                                    <th className="px-4 py-2 text-right">Debit</th>
                                    <th className="px-4 py-2 text-right">Credit</th>
                                    <th className="px-4 py-2 text-right">Balance</th>
                                    <th className="px-4 py-2 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {view !== 'all' && (
                                    <tr className="border-b dark:border-gray-700 border-gray-200 bg-gray-50 dark:bg-gray-700/50">
                                        <td colSpan="7" className="p-2 font-bold text-right">Opening Balance</td>
                                        <td className="p-2 text-right font-bold">{formatCurrency(openingBalance, currency)}</td>
                                        <td></td>
                                    </tr>
                                )}
                                {mainLedgerEntries.map(entry => {
                                    const isTicked = tickedEntries.has(entry.id);
                                    balance += (entry.debit || 0) - (entry.credit || 0); return (
                                        <tr key={entry.id} className={`group/row border-b dark:border-gray-700 border-gray-200 ${isTicked ? 'dark:bg-green-800/40 bg-green-100' : ''}`}>
                                            <td className="p-2 text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={isTicked}
                                                    onChange={() => handleToggleTick(entry.id)}
                                                    className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                                />
                                            </td>
                                            <td className="p-2">{formatDate(entry.date)}</td>
                                            <td className="p-2">{entry.particulars}</td>
                                            <td className="p-2">{entry.mainCategory}</td>
                                            <td className="p-2">{entry.subCategory}</td>
                                            <td className="p-2 text-right">{formatCurrency(entry.debit, currency)}</td>
                                            <td className="p-2 text-right">{formatCurrency(entry.credit, currency)}</td>
                                            <td className="p-2 text-right font-semibold">{formatCurrency(balance, currency)}</td>
                                            <td className="p-2 text-right">
                                                <div className="opacity-0 group-hover/row:opacity-100 flex items-center justify-end space-x-1 no-print">
                                                    <button onClick={() => handlePinEntry(entry)} className="p-1.5 hover:text-yellow-400" title="Pin Entry"><Pin size={14} /></button>
                                                    <button onClick={() => setEditingEntry(entry)} className="p-1.5 hover:text-cyan-400"><Edit size={14} /></button>
                                                    <button onClick={() => onDeleteRequest(entry.id)} className="p-1.5 hover:text-red-400"><Trash2 size={14} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot className="dark:bg-gray-700 bg-gray-50 font-bold border-t-2 dark:border-gray-600 border-gray-300">
                                <tr>
                                    <td colSpan="5" className="px-4 py-2 text-right uppercase">Total</td>
                                    <td className="px-4 py-2 text-right text-green-400">{formatCurrency(totals.debit, currency)}</td>
                                    <td className="px-4 py-2 text-right text-red-400">{formatCurrency(totals.credit, currency)}</td>
                                    <td colSpan="2"></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </section>
            )}

            {activeLedgerView === 'quick_entries' && (
                <div className="space-y-8">
                    {/* Quick Entries Section */}
                    <section className="dark:bg-gray-800 bg-white p-4 sm:p-6 rounded-lg no-print border-l-4 border-rose-500">
                         {/* ... content ... */}
                         <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold">Quick Entries</h2>
                            <button onClick={() => setShowAddPinnedModal(true)} className="flex items-center space-x-2 px-3 py-1.5 dark:bg-gray-600 bg-gray-200 text-sm rounded-md dark:hover:bg-gray-500 hover:bg-gray-300 border dark:border-gray-600 border-gray-300 dark:text-white text-gray-800">
                                <PlusCircle size={16}/>
                                <span>Manage Items</span>
                            </button>
                        </div>
                        {pinnedItems.length > 0 ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                {pinnedItems.map(item => (
                                    <QuickEntryCard
                                        key={item.id}
                                        item={item}
                                        onSave={handleQuickSave}
                                        onDelete={handleDeletePinnedItem}
                                    />
                                ))}
                            </div>
                        ) : (
                            <p className="text-center text-gray-500 py-4">No quick entry items pinned yet. Click 'Manage Items' to add some.</p>
                        )}
                    </section>
                </div>
            )}

            {/* ... Modals remain the same ... */}
            {showManageCategoriesModal && <ManageSubCategoriesModal userId={userId} appId={appId} onClose={() => setShowManageCategoriesModal(false)} initialCategories={categories} setConfirmAction={setConfirmAction} />}
            <AddPinnedItemModal
                isOpen={showAddPinnedModal}
                onClose={() => setShowAddPinnedModal(false)}
                onSave={handleAddPinnedItem}
                categories={categories}
            />
            {editingEntry && <EditLedgerEntryModal entry={editingEntry} onSave={onSaveRequest} onClose={() => setEditingEntry(null)} categories={categories} allEmployees={allEmployees} />}

            {/* New Entry Modal */}
            {showNewEntryModal && (
                <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4">
                    <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full w-[95vw] max-w-[1600px]">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold">New Ledger Entry</h3>
                            <button onClick={() => setShowNewEntryModal(false)} className="p-2 rounded-full hover:bg-gray-700"><X size={20}/></button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-8 gap-2 items-end">
                            <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Date</label><DateInput value={newEntry.date} onChange={(val) => setNewEntry(p => ({...p, date: val}))}/></div>
                            <div className="flex flex-col md:col-span-2 lg:col-span-2">
                                <label className="text-xs mb-1 text-gray-400">Perticulers / Names</label>
                                <input
                                    list="employee-names"
                                    type="text" name="particulars" placeholder="Type or select name..." value={newEntry.particulars} onChange={handleNewEntryChange}
                                    className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md w-full"
                                    style={{textTransform: 'capitalize'}}
                                />
                                <datalist id="employee-names">
                                    {allEmployees.map(name => <option key={name} value={name} />)}
                                </datalist>
                            </div>
                            <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Main Category</label><select name="mainCategory" value={newEntry.mainCategory} onChange={handleNewEntryChange} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md"> <option value="">Select...</option> {Object.keys(categories).map(cat => <option key={cat} value={cat}>{cat}</option>)} </select></div>
                            <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Sub Category</label><select name="subCategory" value={newEntry.subCategory} onChange={handleNewEntryChange} disabled={!newEntry.mainCategory} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md disabled:opacity-50"> <option value="">Select...</option> {newEntry.mainCategory && categories[newEntry.mainCategory].map(subCat => <option key={subCat} value={subCat}>{subCat}</option>)} </select></div>
                            {newEntry.subCategory === 'Others' && <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Specify Other</label><input type="text" name="customSubCategory" placeholder="Specify" value={newEntry.customSubCategory} onChange={handleNewEntryChange} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md" style={{textTransform: 'capitalize'}}/></div>}
                            {newEntry.subCategory === 'Vehicles' && (
                                <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Vehicle Number</label><input type="text" name="vehicleNumber" placeholder="Vehicle No." value={newEntry.vehicleNumber || ''} onChange={handleNewEntryChange} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md" /></div>
                            )}
                            <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Debit</label><input type="number" name="debit" placeholder="Debit" value={newEntry.debit} onChange={handleNewEntryChange} disabled={entryType !== 'debit'} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"/></div>
                            <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Credit</label><input type="number" name="credit" placeholder="Credit" value={newEntry.credit} onChange={handleNewEntryChange} disabled={entryType !== 'credit'} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"/></div>
                            
                        </div>
                        <div className="flex justify-end space-x-2 mt-6">
                            <button onClick={() => setShowNewEntryModal(false)} className="px-4 py-2 bg-gray-600 rounded-md">Cancel</button>
                            <button onClick={handleAddEntry} className="px-4 py-2 bg-cyan-500 rounded-md">Add Entry</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const DebtsAndCreditsPage = ({ userId, appId, currency, setConfirmAction }) => {
    const [entries, setEntries] = useState([]);
    const [settledEntries, setSettledEntries] = useState([]);
    const [badDebts, setBadDebts] = useState([]);
    const [newEntry, setNewEntry] = useState({ date: formatDate(new Date()), name: '', nationality: '', description: '', debit: '', credit: '', dueDate: '', customDescription: '', yearRange: '' });
    const [editingEntry, setEditingEntry] = useState(null);
    const [showAddModal, setShowAddModal] = useState(false); // Add this state
    const [view, setView] = useState('all'); // Default view changed to 'all'
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
    const [searchTerm, setSearchTerm] = useState('');
    const [mainCategoryFilter, setMainCategoryFilter] = useState('');
    const [subCategoryFilter, setSubCategoryFilter] = useState('');
    const [nationalityFilter, setNationalityFilter] = useState('');
    const [activeView, setActiveView] = useState('active');
    const [tickedEntries, setTickedEntries] = useState(new Set());
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const importFileInputRef = useRef(null);
    const [descriptionFilter, setDescriptionFilter] = useState(''); // Add state for description filter
    const [settledSearchTerm, setSettledSearchTerm] = useState(''); // Add state for settled search
    const [badDebtsSearchTerm, setBadDebtsSearchTerm] = useState(''); // Add state for bad debts search
    
    const [isExportingExcel, setIsExportingExcel] = useState(false); // Add this state

    const [alMarriEmployees, setAlMarriEmployees] = useState([]);
    const [fathoomEmployees, setFathoomEmployees] = useState([]);
    const allEmployees = useMemo(() => [...new Set([...alMarriEmployees, ...fathoomEmployees])].sort(), [alMarriEmployees, fathoomEmployees]);

    const hasConditionalField = useMemo(() => newEntry.description === 'Others' || newEntry.description === 'Due: QID Renew', [newEntry.description]);

    const debtCreditDescriptionOptions = useMemo(() => [
        'Due: QID Renew', 
        'Due: Recruitment', 
        'Due: Vehicle Registration', 
        'Due: Traffic Violation', 
        'Due: Sponsorship Change', 
        'Transportation Charges', 
        'Salary or Wages', 
        'Others'
    ], []);

    const categories = useMemo(() => ({
        'Current Assets': ['Sundry Debtors', 'Cash Receivables', 'Others'],
        'Current Liabilities': ['Sundry Creditors', 'Cash Payables', 'Others'],
        'Others': ['General', 'Others'],
    }), []);
    
    const pageCollectionPath = 'debts_credits';
    const settledCollectionPath = 'debts_credits_settled';
    const badDebtsCollectionPath = 'bad_debts';

    const pageRef = useMemo(() => collection(db, `artifacts/${appId}/users/${userId}/${pageCollectionPath}`), [userId, appId, pageCollectionPath]);
    const settledEntriesRef = useMemo(() => collection(db, `artifacts/${appId}/users/${userId}/${settledCollectionPath}`), [userId, appId, settledCollectionPath]);
    const badDebtsRef = useMemo(() => collection(db, `artifacts/${appId}/users/${userId}/${badDebtsCollectionPath}`), [userId, appId, badDebtsCollectionPath]);

    const tickedItemsRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/debtCreditSettings/tickedItems`), [userId, appId]);

    const updateTickedInFirestore = useCallback(async (newSet) => {
        if (!tickedItemsRef) return;
        try {
            await setDoc(tickedItemsRef, { tickedEntryIds: Array.from(newSet) }, { merge: true });
        } catch (error) {
            console.error("Failed to save ticked entries:", error);
            // Don't bother the user, just log the error.
        }
    }, [tickedItemsRef]);

    // Effect to load persistent ticked entries
    useEffect(() => {
        if (!tickedItemsRef) return;
        const unsub = onSnapshot(tickedItemsRef, (docSnap) => {
            if (docSnap.exists()) {
                setTickedEntries(new Set(docSnap.data().tickedEntryIds || []));
            } else {
                setTickedEntries(new Set()); // No doc, just use default empty set
            }
        }, (error) => {
            console.error("Error fetching ticked items:", error);
        });
        return () => unsub();
    }, [tickedItemsRef]);


    const handleToggleTick = useCallback((entryId) => {
        setTickedEntries(prev => {
            const newSet = new Set(prev);
            if (newSet.has(entryId)) {
                newSet.delete(entryId);
            } else {
                newSet.add(entryId);
            }
            updateTickedInFirestore(newSet);
            return newSet;
        });
    }, [updateTickedInFirestore]);

    const handleToggleAllTicks = (entryList) => {
        const allIds = entryList.map(e => e.id);
        const allAreTicked = allIds.length > 0 && allIds.every(id => tickedEntries.has(id));

        setTickedEntries(prev => {
            const newSet = new Set(prev);
            if (allAreTicked) {
                allIds.forEach(id => newSet.delete(id));
            } else {
                allIds.forEach(id => newSet.add(id));
            }
            updateTickedInFirestore(newSet);
            return newSet;
        });
    };

    const handleClearTicks = () => {
        const newSet = new Set();
        setTickedEntries(newSet);
        updateTickedInFirestore(newSet);
    };

    const handleExportJson = async () => {
        setConfirmAction({
            title: 'Export Debts & Credits Data',
            message: 'This will export all active, settled, and bad debt entries to a single JSON file. Proceed?',
            confirmText: 'Export',
            type: 'save',
            action: async () => {
                setIsExporting(true);
                try {
                    const dataToExport = {};
                    const collectionsToExport = {
                        debts_credits: pageRef,
                        debts_credits_settled: settledEntriesRef,
                        bad_debts: badDebtsRef,
                    };

                    for (const [key, collRef] of Object.entries(collectionsToExport)) {
                        const snapshot = await getDocs(collRef);
                        dataToExport[key] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    }

                    const jsonString = JSON.stringify(dataToExport, null, 2);
                    const blob = new Blob([jsonString], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `debts_credits_backup_${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (error) {
                    console.error("Export failed:", error);
                    alert("An error occurred during export.");
                } finally {
                    setIsExporting(false);
                }
            }
        });
    };

    const handleExportExcel = () => {
        if (!window.XLSX) {
            alert("Excel export library is not ready. Please try again in a moment.");
            return;
        }

        setConfirmAction({
            title: 'Export Excel Report',
            message: 'This will export all active, settled, and bad debt entries (based on current filters) to a single Excel file, with one sheet per category. Proceed?',
            confirmText: 'Export',
            type: 'save',
            action: async () => {
                setIsExportingExcel(true);
                try {
                    const wb = window.XLSX.utils.book_new();

                    // Sheet 1: Active Debts & Credits
                    if (filteredEntries.length > 0) {
                        let activeBalance = openingBalance;
                        const activeData = [];
                        
                        if (view !== 'all') {
                            activeData.push({
                                "Date": "Opening Balance",
                                "Name": "",
                                "Description": "",
                                "Due Date": "",
                                "Nationality": "",
                                "Debit": "",
                                "Credit": "",
                                "Balance": openingBalance
                            });
                        }

                        filteredEntries.forEach(e => {
                            activeBalance += (e.debit || 0) - (e.credit || 0);
                            activeData.push({
                                "Date": formatDate(e.date),
                                "Name": e.name,
                                "Description": e.description,
                                "Due Date": formatDate(e.dueDate),
                                "Nationality": e.nationality,
                                "Debit": e.debit || 0,
                                "Credit": e.credit || 0,
                                "Balance": activeBalance
                            });
                        });
                        
                        const wsActive = window.XLSX.utils.json_to_sheet(activeData);
                        // Add Totals row
                        window.XLSX.utils.sheet_add_aoa(
                            wsActive, 
                            [[ "Total", "", "", "", "", totals.debit, totals.credit, activeBalance ]], 
                            { origin: -1 }
                        );
                        window.XLSX.utils.book_append_sheet(wb, wsActive, "Active_Debts_Credits");
                    }

                    // Sheet 2: Settled Entries
                    if (filteredSettledEntries.length > 0) {
                        const settledData = filteredSettledEntries.map(e => ({
                            "Date": formatDate(e.date),
                            "Name": e.name,
                            "Nationality": e.nationality,
                            "Description": e.description,
                            "Debit": e.debit || 0,
                            "Credit": e.credit || 0,
                        }));
                        const wsSettled = window.XLSX.utils.json_to_sheet(settledData);
                        window.XLSX.utils.book_append_sheet(wb, wsSettled, "Settled_Entries");
                    }

                    // Sheet 3: Bad Debts
                    if (filteredBadDebts.length > 0) {
                        const badDebtsData = filteredBadDebts.map(e => ({
                            "Date": formatDate(e.date),
                            "Name": e.name,
                            "Nationality": e.nationality,
                            "Description": e.description,
                            "Amount": e.debit || e.credit || 0,
                        }));
                        const wsBadDebts = window.XLSX.utils.json_to_sheet(badDebtsData);
                        window.XLSX.utils.book_append_sheet(wb, wsBadDebts, "Bad_Debts");
                    }
                    
                    // Use a dynamic name based on filters
                    const period = view === 'monthly' ? `${selectedYear}-${selectedMonth+1}` : view === 'yearly' ? selectedYear : 'all_time';
                    window.XLSX.writeFile(wb, `debts_credits_export_${period}_${new Date().toISOString().split('T')[0]}.xlsx`);

                } catch (error) {
                    console.error("Excel Export failed:", error);
                    alert("An error occurred during the Excel export.");
                } finally {
                    setIsExportingExcel(false);
                }
            }
        });
    };

    const handleImportExcel = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const data = await file.arrayBuffer();
            const workbook = window.XLSX.read(data);

            setConfirmAction({
                title: 'Confirm Import',
                message: `This will import debts & credits data from Excel. Existing entries with the same ID will be updated. Continue?`,
                confirmText: 'Import',
                type: 'import',
                action: async () => {
                    setIsImporting(true);
                    try {
                        // Import Active Debts & Credits
                        if (workbook.SheetNames.includes('Active_Debts_Credits')) {
                            const worksheet = workbook.Sheets['Active_Debts_Credits'];
                            const jsonData = window.XLSX.utils.sheet_to_json(worksheet);
                            const collectionRef = collection(db, `artifacts/${appId}/users/${userId}/${pageCollectionPath}`);

                            for (const row of jsonData) {
                                // Skip opening balance and totals rows
                                if (row['Date'] === 'Opening Balance' || row['Date'] === 'Total') continue;
                                
                                const entryData = {
                                    date: parseDateForFirestore(row['Date']) || new Date(),
                                    dueDate: parseDateForFirestore(row['Due Date']) || null,
                                    name: row['Name'] || '',
                                    nationality: row['Nationality'] || '',
                                    description: row['Description'] || '',
                                    debit: Number(row['Debit']) || 0,
                                    credit: Number(row['Credit']) || 0,
                                    mainCategory: row['Main Category'] || '',
                                    subCategory: row['Sub Category'] || ''
                                };

                                if (row.id) {
                                    await setDoc(doc(collectionRef, row.id), entryData, { merge: true });
                                } else {
                                    await addDoc(collectionRef, entryData);
                                }
                            }
                        }

                        // Import Settled Entries
                        if (workbook.SheetNames.includes('Settled_Entries')) {
                            const worksheet = workbook.Sheets['Settled_Entries'];
                            const jsonData = window.XLSX.utils.sheet_to_json(worksheet);
                            const collectionRef = collection(db, `artifacts/${appId}/users/${userId}/${settledCollectionPath}`);

                            for (const row of jsonData) {
                                const entryData = {
                                    date: parseDateForFirestore(row['Date']) || new Date(),
                                    name: row['Name'] || '',
                                    nationality: row['Nationality'] || '',
                                    description: row['Description'] || '',
                                    debit: Number(row['Debit']) || 0,
                                    credit: Number(row['Credit']) || 0,
                                };

                                if (row.id) {
                                    await setDoc(doc(collectionRef, row.id), entryData, { merge: true });
                                } else {
                                    await addDoc(collectionRef, entryData);
                                }
                            }
                        }

                        // Import Bad Debts
                        if (workbook.SheetNames.includes('Bad_Debts')) {
                            const worksheet = workbook.Sheets['Bad_Debts'];
                            const jsonData = window.XLSX.utils.sheet_to_json(worksheet);
                            const collectionRef = collection(db, `artifacts/${appId}/users/${userId}/${badDebtsCollectionPath}`);

                            for (const row of jsonData) {
                                const amount = Number(row['Amount']) || 0;
                                const entryData = {
                                    date: parseDateForFirestore(row['Date']) || new Date(),
                                    name: row['Name'] || '',
                                    nationality: row['Nationality'] || '',
                                    description: row['Description'] || '',
                                    debit: amount,
                                    credit: 0,
                                };

                                if (row.id) {
                                    await setDoc(doc(collectionRef, row.id), entryData, { merge: true });
                                } else {
                                    await addDoc(collectionRef, entryData);
                                }
                            }
                        }

                        alert('Import successful!');
                    } catch (error) {
                        console.error('Import process failed:', error);
                        alert(`Import failed: ${error.message}`);
                    } finally {
                        setIsImporting(false);
                    }
                }
            });
        } catch (error) {
            console.error('Import failed:', error);
            alert(`Failed to read Excel file: ${error.message}`);
        } finally {
            e.target.value = '';
        }
    };

    const handleImportJsonChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                
                setConfirmAction({
                    title: 'DANGER: Import Debts & Credits Data',
                    message: 'This will DELETE ALL current active, settled, and bad debt entries and replace them with data from the file. This action cannot be undone. Are you sure?',
                    confirmText: 'Yes, Delete & Import',
                    type: 'delete',
                    action: async () => {
                        setIsImporting(true);
                        try {
                            const collectionsInFile = ['debts_credits', 'debts_credits_settled', 'bad_debts'];

                            for (const collectionName of collectionsInFile) {
                                 const collRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionName}`);
                                 const existingDocsSnapshot = await getDocs(collRef);
                                 if (!existingDocsSnapshot.empty) {
                                    const batch = writeBatch(db);
                                    existingDocsSnapshot.forEach(doc => batch.delete(doc.ref));
                                    await batch.commit();
                                 }
                            }

                            for (const collectionName of collectionsInFile) {
                                const itemsToImport = importedData[collectionName];
                                if (Array.isArray(itemsToImport) && itemsToImport.length > 0) {
                                    const batch = writeBatch(db);
                                    itemsToImport.forEach(item => {
                                        const { id, ...data } = item;
                                        const restoredData = restoreTimestamps(data);
                                        const docRef = doc(db, `artifacts/${appId}/users/${userId}/${collectionName}`, id);
                                        batch.set(docRef, restoredData);
                                    });
                                    await batch.commit();
                                }
                            }
                            alert('Import successful! The Debts & Credits data has been restored.');
                        } catch (err) {
                            console.error("Import process failed:", err);
                            alert(`Import failed: ${err.message}`);
                        } finally {
                            setIsImporting(false);
                        }
                    }
                });

            } catch (err) {
                 alert(`Error reading file: ${err.message}`);
            }
            if(importFileInputRef.current) importFileInputRef.current.value = "";
        };
        reader.readAsText(file);
    };

    const triggerImport = () => {
        importFileInputRef.current?.click();
    };


    useEffect(() => { 
        if (!userId || appId === 'default-app-id') return;

        const alMarriRef = collection(db, `artifacts/${appId}/users/${userId}/alMarriData`);
        const fathoomRef = collection(db, `artifacts/${appId}/users/${userId}/fathoomData`);

        const unsubAlMarri = onSnapshot(alMarriRef, (snapshot) => {
            setAlMarriEmployees(snapshot.docs.map(doc => doc.data().fullName).filter(Boolean));
        });
        const unsubFathoom = onSnapshot(fathoomRef, (snapshot) => {
            setFathoomEmployees(snapshot.docs.map(doc => doc.data().fullName).filter(Boolean));
        });

        const unsub = onSnapshot(pageRef, (snapshot) => { 
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); 
            data.sort((a, b) => (a.date?.toDate ? a.date.toDate() : 0) - (b.date?.toDate ? b.date.toDate() : 0)); 
            setEntries(data); 
        }); 

        const unsubSettled = onSnapshot(settledEntriesRef, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            data.sort((a, b) => (a.date?.toDate ? a.date.toDate() : 0) - (b.date?.toDate ? b.date.toDate() : 0));
            setSettledEntries(data);
        });

        const unsubBadDebts = onSnapshot(badDebtsRef, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            data.sort((a, b) => (a.date?.toDate ? a.date.toDate() : 0) - (b.date?.toDate ? b.date.toDate() : 0));
            setBadDebts(data);
        });

        return () => { 
            unsub();
            unsubSettled();
            unsubBadDebts();
            unsubAlMarri();
            unsubFathoom();
        }; 
    }, [userId, appId, pageCollectionPath, settledCollectionPath, badDebtsRef]);
    
    const summaryTotals = useMemo(() => {
        return entries.reduce((acc, entry) => {
            if (entry.mainCategory === 'Current Assets') { // Debtors
                acc.debtors += (entry.debit || 0) - (entry.credit || 0);
            } else if (entry.mainCategory === 'Current Liabilities') { // Creditors
                acc.creditors += (entry.credit || 0) - (entry.debit || 0);
            }
            return acc;
        }, { debtors: 0, creditors: 0 });
    }, [entries]);

    const summaryBalance = summaryTotals.debtors - summaryTotals.creditors;

    const years = useMemo(() => [...new Set(entries.map(e => {
        const date = e.date?.toDate ? e.date.toDate() : new Date(e.date);
        return isNaN(date.getTime()) ? null : date.getFullYear();
    }))].filter(Boolean).sort((a,b) => b-a), [entries]);
    const months = useMemo(() => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], []);
    const nationalities = useMemo(() => [...new Set(entries.map(e => e.nationality).filter(Boolean))].sort(), [entries]);
    
    const filteredEntries = useMemo(() => {
        let tempEntries = entries;
        if (view === 'yearly') {
            tempEntries = tempEntries.filter(e => {
                const date = e.date?.toDate ? e.date.toDate() : new Date(e.date);
                return !isNaN(date.getTime()) && date.getFullYear() === selectedYear;
            });
        }
        if (view === 'monthly') {
            tempEntries = tempEntries.filter(e => {
                const date = e.date?.toDate ? e.date.toDate() : new Date(e.date);
                return !isNaN(date.getTime()) && date.getFullYear() === selectedYear && date.getMonth() === selectedMonth;
            });
        }
        if (mainCategoryFilter) {
            tempEntries = tempEntries.filter(e => e.mainCategory === mainCategoryFilter);
        }
        if (subCategoryFilter) {
            tempEntries = tempEntries.filter(e => e.subCategory === subCategoryFilter);
        }
        if (nationalityFilter) {
            tempEntries = tempEntries.filter(e => e.nationality === nationalityFilter);
        }
        if (descriptionFilter) { // Add filtering logic for description
            const lowerDescFilter = descriptionFilter.toLowerCase();
            tempEntries = tempEntries.filter(e => e.description && e.description.toLowerCase().includes(lowerDescFilter));
        }
        if (searchTerm) {
            const lowerSearchTerm = searchTerm.toLowerCase();
            tempEntries = tempEntries.filter(e => 
                (e.name && e.name.toLowerCase().includes(lowerSearchTerm)) ||
                (e.description && e.description.toLowerCase().includes(lowerSearchTerm)) ||
                (e.mainCategory && e.mainCategory.toLowerCase().includes(lowerSearchTerm)) ||
                (e.subCategory && e.subCategory.toLowerCase().includes(lowerSearchTerm)) ||
                (e.debit && String(e.debit).includes(lowerSearchTerm)) ||
                (e.credit && String(e.credit).includes(lowerSearchTerm))
            );
        }
        
        // Sort by due date (soonest first)
        tempEntries.sort((a, b) => {
            const dateA = a.dueDate?.toDate ? a.dueDate.toDate().getTime() : 0;
            const dateB = b.dueDate?.toDate ? b.dueDate.toDate().getTime() : 0;

            // Handle missing dates: put items without a due date at the end
            if (dateA === 0 && dateB === 0) return 0; // both missing, keep original order
            if (dateA === 0) return 1;  // 'a' is missing, send to end
            if (dateB === 0) return -1; // 'b' is missing, send to end

            return dateA - dateB; // ascending order (soonest first)
        });
        
        return tempEntries;
    }, [entries, view, selectedYear, selectedMonth, searchTerm, mainCategoryFilter, subCategoryFilter, nationalityFilter, descriptionFilter]); // Add descriptionFilter to dependency array

    const filteredSettledEntries = useMemo(() => {
        if (!settledSearchTerm) return settledEntries;
        const lowerSearchTerm = settledSearchTerm.toLowerCase();
        return settledEntries.filter(e =>
            (e.name && e.name.toLowerCase().includes(lowerSearchTerm)) ||
            (e.description && e.description.toLowerCase().includes(lowerSearchTerm)) ||
            (e.nationality && e.nationality.toLowerCase().includes(lowerSearchTerm)) ||
            (e.debit && String(e.debit).includes(lowerSearchTerm)) ||
            (e.credit && String(e.credit).includes(lowerSearchTerm))
        );
    }, [settledEntries, settledSearchTerm]);

    const filteredBadDebts = useMemo(() => {
        if (!badDebtsSearchTerm) return badDebts;
        const lowerSearchTerm = badDebtsSearchTerm.toLowerCase();
        return badDebts.filter(e =>
            (e.name && e.name.toLowerCase().includes(lowerSearchTerm)) ||
            (e.description && e.description.toLowerCase().includes(lowerSearchTerm)) ||
            (e.nationality && e.nationality.toLowerCase().includes(lowerSearchTerm)) ||
            (e.debit && String(e.debit).includes(lowerSearchTerm)) ||
            (e.credit && String(e.credit).includes(lowerSearchTerm))
        );
    }, [badDebts, badDebtsSearchTerm]);

    const totals = useMemo(() => {
        return filteredEntries.reduce((acc, entry) => {
            acc.debit += entry.debit || 0;
            acc.credit += entry.credit || 0;
            return acc;
        }, { debit: 0, credit: 0 });
    }, [filteredEntries]);

    const openingBalance = useMemo(() => {
        let balance = 0;
        let periodStartDate;

        if (view === 'all') return 0;

        if (view === 'yearly') {
            periodStartDate = new Date(selectedYear, 0, 1);
        } else if (view === 'monthly') {
            periodStartDate = new Date(selectedYear, selectedMonth, 1);
        }

        entries.forEach(entry => {
            const entryDate = entry.date?.toDate ? entry.date.toDate() : new Date(entry.date);
            if (entryDate < periodStartDate) {
                balance += (entry.debit || 0) - (entry.credit || 0);
            }
        });
        return balance;
    }, [entries, view, selectedYear, selectedMonth]);

    const handleNewEntryChange = (e) => { const { name, value } = e.target; setNewEntry(prev => ({ ...prev, [name]: value })); };
    
    const handleAddEntry = async () => {
        const dateForDb = parseDateForFirestore(newEntry.date);
        if (!newEntry.date || !dateForDb) {
            console.error("Invalid date format. Please use dd/mm/yyyy");
            return;
        }
        if (!newEntry.name || !newEntry.description) {
             alert("Please fill all required fields: Date, Name, and Description.");
             return;
        }
        
        const debit = Number(newEntry.debit) || 0;
        const credit = Number(newEntry.credit) || 0;

        if (debit > 0 && credit > 0) {
            alert("Please enter a value for either Debit or Credit, not both.");
            return;
        }
        if (debit === 0 && credit === 0) {
            alert("Please enter a value for either Debit or Credit.");
            return;
        }

        const mainCategory = debit > 0 ? 'Current Assets' : 'Current Liabilities';
        const subCategory = debit > 0 ? 'Sundry Debtors' : 'Sundry Creditors';

        let finalDescription = newEntry.description === 'Others' ? capitalizeWords(newEntry.customDescription || 'Others') : newEntry.description;
        
        if (newEntry.description === 'Due: QID Renew' && newEntry.yearRange) {
            finalDescription = `${finalDescription} (${newEntry.yearRange})`;
        }

        const { yearRange, customDescription, ...entryToSave } = newEntry;

        await addDoc(pageRef, { 
            date: dateForDb, 
            dueDate: parseDateForFirestore(newEntry.dueDate),
            name: capitalizeWords(entryToSave.name),
            nationality: capitalizeWords(entryToSave.nationality),
            description: finalDescription,
            mainCategory: mainCategory,
            subCategory: subCategory, 
            debit: debit, 
            credit: credit, 
            notes: '', 
        });
        setNewEntry({ date: formatDate(new Date()), name: '', description: '', debit: '', credit: '', dueDate: '', customDescription: '', yearRange: '', nationality: '' });
    };

    const handleAddEntryClick = async () => {
        await handleAddEntry(); // This existing function already resets the form
        setShowAddModal(false); // Close modal after successful add
    };

    const handleSettleRequest = (entryToSettle) => {
        setConfirmAction({
            title: 'Confirm Settlement',
            message: `Are you sure you want to move this entry for "${entryToSettle.name}" to the settled list?`,
            confirmText: 'Settle',
            type: 'save',
            action: async () => {
                const { id, ...dataToMove } = entryToSettle;
                await addDoc(settledEntriesRef, dataToMove);
                await deleteDoc(doc(pageRef, id));
            }
        });
    };

    const handleMarkAsBadDebtRequest = (entryToMark) => {
        setConfirmAction({
            title: 'Confirm Bad Debt',
            message: `Are you sure you want to mark this entry for "${entryToMark.name}" as a bad debt? It will be moved to the bad debts list.`,
            confirmText: 'Mark as Bad Debt',
            type: 'delete', // Use delete style for warning
            action: async () => {
                const { id, ...dataToMove } = entryToMark;
                await addDoc(badDebtsRef, dataToMove);
                await deleteDoc(doc(pageRef, id));
            }
        });
    };
    
    const handleReactivateRequest = (entryToReactivate) => {
        setConfirmAction({
            title: 'Confirm Reactivation',
            message: `Are you sure you want to move this entry for "${entryToReactivate.name}" back to the active list?`,
            confirmText: 'Reactivate',
            type: 'reactivate',
            action: async () => {
                const { id, ...dataToMove } = entryToReactivate;
                await addDoc(pageRef, dataToMove);
                await deleteDoc(doc(badDebtsRef, id));
            }
        });
    };

    const onPermanentDeleteRequest = (id) => {
        setConfirmAction({
            title: 'Confirm Permanent Deletion',
            message: 'This will permanently delete the settled entry. This action cannot be undone.',
            confirmText: 'Delete Permanently',
            type: 'delete',
            action: () => deleteDoc(doc(settledEntriesRef, id))
        });
    };

    const onPermanentDeleteFromBadDebtsRequest = (id) => {
        setConfirmAction({
            title: 'Confirm Permanent Deletion',
            message: 'This will permanently delete this bad debt entry. This action cannot be undone.',
            confirmText: 'Delete Permanently',
            type: 'delete',
            action: () => deleteDoc(doc(badDebtsRef, id))
        });
    };

    const onSaveRequest = (updatedEntry) => {
        setConfirmAction({
            title: 'Confirm Save',
            message: 'Are you sure you want to save these changes?',
            confirmText: 'Save',
            type: 'save',
            action: () => {
                const { id, ...dataToUpdate } = updatedEntry;
                const entryRef = doc(db, `artifacts/${appId}/users/${userId}/${pageCollectionPath}`, id);
                updateDoc(entryRef, dataToUpdate);
            }
        });
        setEditingEntry(null);
    };
    
    let balance = openingBalance;

    return (
        <div className="space-y-8 p-4 sm:p-8">
            <section className="dark:bg-gray-800 bg-white p-4 sm:p-6 rounded-lg group border-l-4 border-rose-500">
                <div className="flex flex-col sm:flex-row justify-between items-center mb-4 flex-wrap gap-4 border-b-2 dark:border-gray-700 pb-4 sticky top-[70px] z-40 dark:bg-gray-800 bg-white -mx-4 sm:-mx-6 px-4 sm:px-6">
                    <nav className="flex justify-start items-center space-x-1 sm:space-x-2 flex-wrap no-print">
                        <button
                            onClick={() => setActiveView('active')}
                            className={`flex items-center space-x-2 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all duration-200 ${
                                activeView === 'active'
                                    ? 'bg-cyan-600 text-white shadow-md'
                                    : 'dark:text-gray-300 text-gray-600 dark:hover:bg-gray-700 hover:bg-gray-200'
                            }`}
                        >
                            <HandCoins size={16}/>
                            <span>Debtors & Creditors ({entries.length})</span>
                        </button>
                        <button
                            onClick={() => setActiveView('settled')}
                            className={`flex items-center space-x-2 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all duration-200 ${
                                activeView === 'settled'
                                    ? 'bg-cyan-600 text-white shadow-md'
                                    : 'dark:text-gray-300 text-gray-600 dark:hover:bg-gray-700 hover:bg-gray-200'
                            }`}
                        >
                            <CheckCircle size={16}/>
                            <span>Settled ({settledEntries.length})</span>
                        </button>
                        <button
                            onClick={() => setActiveView('badDebts')}
                            className={`flex items-center space-x-2 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all duration-200 ${
                                activeView === 'badDebts'
                                    ? 'bg-cyan-600 text-white shadow-md'
                                    : 'dark:text-gray-300 text-gray-600 dark:hover:bg-gray-700 hover:bg-gray-200'
                            }`}
                        >
                            <AlertTriangle size={16}/>
                            <span>Bad Debts ({badDebts.length})</span>
                        </button>
                    </nav>

                    <div className="flex flex-grow justify-center items-center gap-4 px-4 flex-wrap">
                        <div className="dark:bg-gray-700/50 bg-gray-50 px-4 py-1 rounded-lg shadow-sm flex items-center space-x-2">
                            <div className="p-1.5 rounded-full bg-green-500/20">
                                <TrendingUp size={18} className="text-green-400" />
                            </div>
                            <p className="text-xl font-bold text-green-400">
                                {formatCurrency(summaryTotals.debtors, currency)}
                            </p>
                        </div>
                        <div className="dark:bg-gray-700/50 bg-gray-50 px-4 py-1 rounded-lg shadow-sm flex items-center space-x-2">
                            <div className="p-1.5 rounded-full bg-red-500/20">
                                <TrendingDown size={18} className="text-red-400" />
                            </div>
                            <p className="text-xl font-bold text-red-400">
                                {formatCurrency(summaryTotals.creditors, currency)}
                            </p>
                        </div>
                        <div className="dark:bg-gray-700/50 bg-gray-50 px-4 py-1 rounded-lg shadow-sm flex items-center space-x-2">
                            <div className={`p-1.5 rounded-full ${summaryBalance >= 0 ? 'bg-blue-500/20' : 'bg-orange-500/20'}`}>
                                <HandCoins size={18} className={summaryBalance >= 0 ? 'text-blue-400' : 'text-orange-400'} />
                            </div>
                            <p className={`text-xl font-bold ${summaryBalance >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>
                                {formatCurrency(summaryBalance, currency)}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center space-x-2 no-print flex-wrap gap-2 justify-end">
                        <button 
                            onClick={handleExportExcel} 
                            disabled={isExportingExcel || isImporting} 
                            title="Export to Excel" 
                            className="group flex items-center space-x-2 px-4 py-2 dark:bg-green-700 bg-green-100 rounded-full dark:hover:bg-green-600 hover:bg-green-200 text-sm font-semibold transition-all duration-300 disabled:opacity-50 border dark:border-green-600 border-green-300 dark:text-white text-green-700 shadow-md hover:shadow-lg hover:scale-105"
                        >
                            {isExportingExcel ? <Loader2 size={16} className="animate-spin" /> : <FileCheck2 size={16}/>}
                            <span>{isExportingExcel ? 'Exporting...' : 'Export Excel'}</span>
                        </button>
                        <button 
                            onClick={triggerImport} 
                            disabled={isImporting || isExportingExcel} 
                            title="Import from Excel" 
                            className="group flex items-center space-x-2 px-4 py-2 dark:bg-blue-700 bg-blue-100 rounded-full dark:hover:bg-blue-600 hover:bg-blue-200 text-sm font-semibold transition-all duration-300 disabled:opacity-50 border dark:border-blue-600 border-blue-300 dark:text-white text-blue-700 shadow-md hover:shadow-lg hover:scale-105"
                        >
                            {isImporting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16}/>}
                            <span>{isImporting ? 'Importing...' : 'Import Excel'}</span>
                        </button>
                        <input
                            type="file"
                            ref={importFileInputRef}
                            onChange={handleImportExcel}
                            className="hidden"
                            accept=".xlsx,.xls"
                        />
                        <button
                            onClick={() => setShowAddModal(true)}
                            title="Add New Entry"
                            className="p-2.5 bg-cyan-500 rounded-md hover:bg-cyan-600 transition-colors"
                        >
                            <PlusCircle size={18}/>
                        </button>
                        {activeView === 'active' && (
                            <>
                                {tickedEntries.size > 0 && (
                                    <button onClick={handleClearTicks} className="flex items-center space-x-2 p-2.5 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 transition-colors text-sm">
                                        <X size={16}/>
                                        <span>Clear ({tickedEntries.size})</span>
                                    </button>
                                )}
                                <div className="relative">
                                   <input 
                                        type="text" 
                                        placeholder="Search..." 
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                        className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md pl-8 border dark:border-gray-600 border-gray-300 w-32"
                                    />
                                    <Search size={18} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                                </div>
                                <select value={nationalityFilter} onChange={e => setNationalityFilter(e.target.value)} className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md w-full sm:w-40 border dark:border-gray-600 border-gray-300">
                                    <option value="">All Nationalities</option>
                                    {nationalities.map(nat => <option key={nat} value={nat}>{nat}</option>)}
                                </select>
                                {/* ADDED DESCRIPTION FILTER INPUT */}
                                <div className="relative">
                                   <input 
                                        type="text" 
                                        placeholder="Filter by Description..." 
                                        value={descriptionFilter}
                                        onChange={e => setDescriptionFilter(e.target.value)}
                                        className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md pl-8 border dark:border-gray-600 border-gray-300 w-40"
                                    />
                                    <Search size={18} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                                </div>
                                {/* REMOVED Main Category and Sub Category filters */}
                                <select value={view} onChange={e => setView(e.target.value)} className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md border dark:border-gray-600 border-gray-300">
                                    <option value="yearly">Yearly</option>
                                    <option value="monthly">Monthly</option>
                                <option value="all">All Time</option>
                            </select>
                            {(view === 'yearly' || view === 'monthly') && years.length > 0 && (
                                <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md border dark:border-gray-600 border-gray-300">
                                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                            )}
                            {view === 'monthly' && (
                                <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))} className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md border dark:border-gray-600 border-gray-300">
                                        {months.map((m, i) => <option key={m} value={i}>{m}</option>)}
                                    </select>
                                )}
                            </>
                        )}
                    </div>
                </div>

                <div className="mt-6">
                    {activeView === 'active' && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase dark:bg-gray-700 bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 text-left w-12">
                                            <input
                                                type="checkbox"
                                                onChange={() => handleToggleAllTicks(filteredEntries)}
                                                checked={filteredEntries.length > 0 && filteredEntries.every(e => tickedEntries.has(e.id))}
                                                className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                            />
                                        </th>
                                        <th className="px-4 py-2 text-left">Date</th>
                                        <th className="px-4 py-2 text-left w-96">Name</th>
                                        <th className="px-4 py-2 text-left">Description</th>
                                        <th className="px-4 py-2 text-left">Due Date</th>
                                        <th className="px-4 py-2 text-left">Nationality</th>
                                        <th className="px-4 py-2 text-right">Debit</th>
                                        <th className="px-4 py-2 text-right">Credit</th>
                                        <th className="px-4 py-2 text-right">Balance</th>
                                        <th className="px-4 py-2 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {view !== 'all' && (
                                        <tr className="border-b dark:border-gray-700 border-gray-200 bg-gray-50 dark:bg-gray-700/50">
                                            <td colSpan="8" className="p-2 font-bold text-right">Opening Balance</td>
                                            <td className="p-2 text-right font-bold">{formatCurrency(openingBalance, currency)}</td>
                                            <td></td>
                                        </tr>
                                    )}
                                    {filteredEntries.map(entry => { 
                                        const isTicked = tickedEntries.has(entry.id);
                                        balance += (entry.debit || 0) - (entry.credit || 0); 
                                        const expired = isDateExpired(entry.dueDate); // Add this line
                                        return (
                                        <tr key={entry.id} className={`group/row border-b dark:border-gray-700 border-gray-200 ${isTicked ? 'dark:bg-green-800/40 bg-green-100' : ''}`}> 
                                            <td className="p-2 text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={isTicked}
                                                    onChange={() => handleToggleTick(entry.id)}
                                                    className="h-4 w-4 rounded dark:bg-gray-700 bg-gray-300 border-gray-600 focus:ring-cyan-500"
                                                />
                                            </td>
                                            <td className="p-2">{formatDate(entry.date)}</td> 
                                            <td className="p-2">{entry.name}</td> 
                                            <td className="p-2">{entry.description}</td> 
                                            <td className={`p-2 ${expired ? 'text-red-400 font-bold' : ''}`}>{formatDate(entry.dueDate)}</td> 
                                            <td className="p-2">{entry.nationality}</td>
                                            <td className="p-2 text-right">{formatCurrency(entry.debit, currency)}</td> 
                                            <td className="p-2 text-right">{formatCurrency(entry.credit, currency)}</td> 
                                            <td className="p-2 text-right font-semibold">{formatCurrency(balance, currency)}</td> 
                                            <td className="p-2 text-right"> 
                                                <div className="opacity-0 group-hover/row:opacity-100 flex items-center justify-end space-x-1 no-print"> 
                                                    <button onClick={() => setEditingEntry(entry)} className="p-1.5 hover:text-cyan-400"><Edit size={14}/></button> 
                                                    <button onClick={() => handleMarkAsBadDebtRequest(entry)} className="p-1.5 hover:text-orange-400" title="Mark as Bad Debt"><TrendingDown size={14}/></button> 
                                                    <button onClick={() => handleSettleRequest(entry)} className="p-1.5 hover:text-green-400" title="Settle"><CheckCircle size={14}/></button> 
                                                </div> 
                                            </td> 
                                        </tr>
                                        ); 
                                    })}
                                </tbody>
                                <tfoot className="dark:bg-gray-700 bg-gray-50 font-bold border-t-2 dark:border-gray-600 border-gray-300">
                                    <tr>
                                        <td colSpan="6" className="px-4 py-2 text-right uppercase">Total</td>
                                        <td className="px-4 py-2 text-right text-green-400">{formatCurrency(totals.debit, currency)}</td>
                                        <td className="px-4 py-2 text-right text-red-400">{formatCurrency(totals.credit, currency)}</td>
                                        <td colSpan="2"></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}
        
                    {activeView === 'settled' && (
                    <div className="overflow-x-auto">
                        {/* ADDED SEARCH BAR FOR SETTLED */}
                        <div className="flex justify-end mb-4">
                            <div className="relative">
                               <input 
                                    type="text" 
                                    placeholder="Search Settled..." 
                                    value={settledSearchTerm}
                                    onChange={e => setSettledSearchTerm(e.target.value)}
                                    className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md pl-8 border dark:border-gray-600 border-gray-300 w-64"
                                />
                                <Search size={18} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                            </div>
                        </div>
                        <table className="w-full text-sm">
                            <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase dark:bg-gray-700 bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 text-left">Date</th>
                                        <th className="px-4 py-2 text-left w-96">Name</th>
                                        <th className="px-4 py-2 text-left">Nationality</th>
                                        <th className="px-4 py-2 text-left">Description</th>
                                        <th className="px-4 py-2 text-right">Debit</th>
                                        <th className="px-4 py-2 text-right">Credit</th>
                                        <th className="px-4 py-2 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredSettledEntries.map(entry => (
                                        <tr key={entry.id} className="group/row border-b dark:border-gray-700 border-gray-200 opacity-70">
                                            <td className="p-2">{formatDate(entry.date)}</td>
                                            <td className="p-2">{entry.name}</td>
                                            <td className="p-2">{entry.nationality}</td>
                                            <td className="p-2">{entry.description}</td>
                                            <td className="p-2 text-right">{formatCurrency(entry.debit, currency)}</td>
                                            <td className="p-2 text-right">{formatCurrency(entry.credit, currency)}</td>
                                            <td className="p-2 text-right">
                                                <div className="opacity-0 group-hover/row:opacity-100 flex items-center justify-end space-x-1 no-print">
                                                    <button onClick={() => onPermanentDeleteRequest(entry.id)} className="p-1.5 hover:text-red-400" title="Delete Permanently">
                                                        <Trash2 size={14}/>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                             {filteredSettledEntries.length === 0 && <div className="text-center py-8 text-gray-500">No settled entries found.</div>}
                        </div>
                    )}
        
                    {activeView === 'badDebts' && (
                    <div className="overflow-x-auto">
                        {/* ADDED SEARCH BAR FOR BAD DEBTS */}
                        <div className="flex justify-end mb-4">
                            <div className="relative">
                               <input 
                                    type="text" 
                                    placeholder="Search Bad Debts..." 
                                    value={badDebtsSearchTerm}
                                    onChange={e => setBadDebtsSearchTerm(e.target.value)}
                                    className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md pl-8 border dark:border-gray-600 border-gray-300 w-64"
                                />
                                <Search size={18} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                            </div>
                        </div>
                        <table className="w-full text-sm">
                            <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase dark:bg-gray-700 bg-gray-50">
                                <tr>
                                    <th className="px-4 py-2 text-left">Date</th>
                                        <th className="px-4 py-2 text-left w-96">Name</th>
                                        <th className="px-4 py-2 text-left">Nationality</th>
                                        <th className="px-4 py-2 text-left">Description</th>
                                        <th className="px-4 py-2 text-right">Amount</th>
                                        <th className="px-4 py-2 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredBadDebts.map(entry => {
                                        const amount = entry.debit || entry.credit || 0;
                                        return (
                                        <tr key={entry.id} className="group/row border-b dark:border-gray-700 border-gray-200 opacity-70">
                                            <td className="p-2">{formatDate(entry.date)}</td>
                                            <td className="p-2">{entry.name}</td>
                                            <td className="p-2">{entry.nationality}</td>
                                            <td className="p-2">{entry.description}</td>
                                            <td className="p-2 text-right">{formatCurrency(amount, currency)}</td>
                                            <td className="p-2 text-right">
                                                <div className="opacity-0 group-hover/row:opacity-100 flex items-center justify-end space-x-1 no-print">
                                                    <button onClick={() => handleReactivateRequest(entry)} className="p-1.5 hover:text-green-400" title="Reactivate Debt">
                                                        <Undo size={14}/>
                                                    </button>
                                                    <button onClick={() => onPermanentDeleteFromBadDebtsRequest(entry.id)} className="p-1.5 hover:text-red-400" title="Delete Permanently">
                                                        <Trash2 size={14}/>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                             {filteredBadDebts.length === 0 && <div className="text-center py-8 text-gray-500">No bad debts recorded.</div>}
                        </div>
                    )}
                </div>
            </section>
            {editingEntry && <EditDebtCreditModal entry={editingEntry} onSave={onSaveRequest} onClose={() => setEditingEntry(null)} categories={categories} allEmployees={allEmployees} descriptionOptions={debtCreditDescriptionOptions} />}
            {showAddModal && (
                <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4">
                    <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-5xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold">New Debt/Credit Entry</h3>
                            <button onClick={() => setShowAddModal(false)} className="p-2 rounded-full hover:bg-gray-700"><X size={20}/></button>
                        </div>
                        {/* The original form content goes here */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                            <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Date</label><DateInput value={newEntry.date} onChange={(val) => setNewEntry(p => ({...p, date: val}))}/></div>
                            <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Due Date</label><DateInput value={newEntry.dueDate} onChange={(val) => setNewEntry(p => ({...p, dueDate: val}))}/></div>
                            <div className="flex flex-col">
                                <label className="text-xs mb-1 text-gray-400">Name</label>
                                <input list="debts-employee-names" type="text" name="name" placeholder="Name" value={newEntry.name} onChange={handleNewEntryChange} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md" style={{textTransform: 'capitalize'}} />
                                <datalist id="debts-employee-names">{allEmployees.map(name => <option key={name} value={name} />)}</datalist>
                            </div>
                            <div className="flex flex-col">
                                <label className="text-xs mb-1 text-gray-400">Nationality</label>
                                <input type="text" name="nationality" placeholder="Nationality" value={newEntry.nationality} onChange={handleNewEntryChange} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md" style={{textTransform: 'capitalize'}} />
                            </div>
                            <div className="flex flex-col lg:col-span-2">
                                <label className="text-xs mb-1 text-gray-400">Description</label>
                                <select name="description" value={newEntry.description} onChange={handleNewEntryChange} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md">
                                    <option value="">Select...</option>
                                    {debtCreditDescriptionOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                </select>
                            </div>
                             <div className="flex flex-col">
                                <label className="text-xs mb-1 text-gray-400">Debit</label>
                                <input type="number" name="debit" placeholder="Debit" value={newEntry.debit} onChange={handleNewEntryChange} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md"/>
                            </div>
                            <div className="flex flex-col">
                                <label className="text-xs mb-1 text-gray-400">Credit</label>
                                <input type="number" name="credit" placeholder="Credit" value={newEntry.credit} onChange={handleNewEntryChange} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md"/>
                            </div>
                            {newEntry.description === 'Others' && (
                                <div className="flex flex-col lg:col-span-2">
                                    <label className="text-xs mb-1 text-gray-400">Custom Description</label>
                                    <input type="text" name="customDescription" placeholder="Specify..." value={newEntry.customDescription} onChange={handleNewEntryChange} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md" style={{textTransform: 'capitalize'}} />
                                </div>
                            )}
                            {newEntry.description === 'Due: QID Renew' && (
                                 <div className="flex flex-col lg:col-span-2">
                                     <label className="text-xs mb-1 text-gray-400">Year Range</label>
                                     <input type="text" name="yearRange" placeholder="e.g. 2023-2024" value={newEntry.yearRange} onChange={handleNewEntryChange} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md" />
                                </div>
                            )}
                        </div>
                        {/* Add modal-specific action buttons */}
                        <div className="flex justify-end space-x-2 mt-6">
                            <button onClick={() => setShowAddModal(false)} className="px-4 py-2 bg-gray-600 rounded-md">Cancel</button>
                            <button onClick={handleAddEntryClick} className={`px-4 py-2 bg-cyan-500 rounded-md`}>Add Entry</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const EditDebtCreditModal = ({ entry, onSave, onClose, categories, allEmployees = [], descriptionOptions = [] }) => {
    const [formData, setFormData] = useState({});

    useEffect(() => {
        const yearRangeRegex = / \((\d{4}-\d{4})\)$/;
        const match = entry.description ? entry.description.match(yearRangeRegex) : null;

        const initialFormData = {
            ...entry,
            date: formatDate(entry.date),
            dueDate: formatDate(entry.dueDate),
            yearRange: match ? match[1] : '',
        };
        
        if (match) {
            initialFormData.description = entry.description.replace(yearRangeRegex, '');
        } else if (entry.description && !descriptionOptions.includes(entry.description)) {
            initialFormData.customDescription = entry.description;
            initialFormData.description = 'Others';
        }
        
        setFormData(initialFormData);
    }, [entry, descriptionOptions]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => {
            const updatedEntry = { ...prev, [name]: value };
            if (name === 'mainCategory') {
                updatedEntry.subCategory = '';
                updatedEntry.debit = '';
                updatedEntry.credit = '';
            }
            return updatedEntry;
        });
    };

    const handleSave = () => {
        const { id, particulars, yearRange, ...rest } = formData; // Destructure and remove old particulars key
        let finalDescription = formData.description === 'Others' ? capitalizeWords(formData.customDescription || '') : formData.description;
        if (formData.description === 'Due: QID Renew' && formData.yearRange) {
            finalDescription = `${finalDescription} (${formData.yearRange})`;
        }
        
        const dataToSave = {
            ...rest,
            date: parseDateForFirestore(formData.date),
            dueDate: parseDateForFirestore(formData.dueDate),
            name: capitalizeWords(formData.name || ''),
            nationality: capitalizeWords(formData.nationality || ''),
            description: finalDescription,
            // subCategory: formData.subCategory === 'Others' ? capitalizeWords(formData.customSubCategory || '') : formData.subCategory, // Keep subCategory logic if needed, but remove fields
            debit: Number(formData.debit) || 0,
            credit: Number(formData.credit) || 0,
        };
        onSave({id, ...dataToSave});
    };

    const entryType = useMemo(() => {
        // Recalculate based on debit/credit values since mainCategory is removed
        if (formData.debit > 0) return 'debit';
        if (formData.credit > 0) return 'credit';
        // Fallback if both are 0 (e.g., during edit)
        if (entry.debit > 0) return 'debit';
        if (entry.credit > 0) return 'credit';
        return null;
    }, [formData.debit, formData.credit, entry.debit, entry.credit]);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4">
            <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-5xl">
                <h3 className="text-xl font-bold mb-4">Edit Entry</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                    <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Date</label><DateInput value={formData.date || ''} onChange={(val) => setFormData(p => ({...p, date: val}))}/></div>
                    <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Due Date</label><DateInput value={formData.dueDate || ''} onChange={(val) => setFormData(p => ({...p, dueDate: val}))}/></div>
                    <div className="flex flex-col">
                        <label className="text-xs mb-1 text-gray-400">Name</label>
                        <input
                            list="edit-debts-employee-names"
                            type="text"
                            name="name"
                            placeholder="Name"
                            value={formData.name || ''}
                            onChange={handleChange}
                            className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md"
                            style={{textTransform: 'capitalize'}}
                        />
                        <datalist id="edit-debts-employee-names">
                           {allEmployees.map(name => <option key={name} value={name} />)}
                        </datalist>
                    </div>
                    <div className="flex flex-col">
                        <label className="text-xs mb-1 text-gray-400">Nationality</label>
                        <input
                            type="text"
                            name="nationality"
                            placeholder="Nationality"
                            value={formData.nationality || ''}
                            onChange={handleChange}
                            className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md"
                            style={{textTransform: 'capitalize'}}
                        />
                    </div>
                     <div className="flex flex-col">
                        <label className="text-xs mb-1 text-gray-400">Description</label>
                        <select
                            name="description"
                            value={formData.description || ''}
                            onChange={handleChange}
                            className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md"
                        >
                           <option value="">Select...</option>
                            {descriptionOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                    </div>
                    {formData.description === 'Due: QID Renew' && (
                        <div className="flex flex-col">
                            <label className="text-xs mb-1 text-gray-400">Year Range</label>
                             <input
                                type="text"
                                name="yearRange"
                                placeholder="e.g. 2023-2024"
                                value={formData.yearRange || ''}
                                onChange={handleChange}
                                className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md"
                            />
                        </div>
                    )}
                    {formData.description === 'Others' && (
                        <div className="flex flex-col">
                            <label className="text-xs mb-1 text-gray-400">Custom Description</label>
                            <input
                                type="text"
                                name="customDescription"
                                placeholder="Specify..."
                                value={formData.customDescription || ''}
                                onChange={handleChange}
                                className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md"
                                style={{textTransform: 'capitalize'}}
                            />
                        </div>
                    )}
                    
                    {/* REMOVED MainCategory and SubCategory dropdowns */}
                    
                    <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Debit</label><input type="number" name="debit" placeholder="Debit" value={formData.debit || ''} onChange={handleChange} disabled={entryType !== 'debit'} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"/></div>
                    <div className="flex flex-col"><label className="text-xs mb-1 text-gray-400">Credit</label><input type="number" name="credit" placeholder="Credit" value={formData.credit || ''} onChange={handleChange} disabled={entryType !== 'credit'} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"/></div>

                    <div className="flex flex-col md:col-span-4"><label className="text-xs mb-1 text-gray-400">Notes</label><textarea name="notes" placeholder="Notes" value={formData.notes || ''} onChange={handleChange} className="p-2 dark:bg-gray-700 bg-gray-200 rounded-md w-full h-20"/></div>
                </div>
                <div className="flex justify-end space-x-2 mt-6"> <button onClick={onClose} className="px-4 py-2 bg-gray-600 rounded-md">Cancel</button> <button onClick={handleSave} className="px-4 py-2 bg-cyan-500 rounded-md">Save Changes</button> </div>
            </div>
        </div>
    );
};

const ConfirmationModal = ({ details, onConfirm, onCancel }) => {
    const [isProcessing, setIsProcessing] = useState(false);
    const { title, message, confirmText, type, customForm } = details; // Added customForm
    const icons = {
        delete: <AlertTriangle size={48} className="mx-auto text-red-400 mb-4" />,
        save: <Save size={48} className="mx-auto text-cyan-400 mb-4" />,
        reactivate: <CheckCircle size={48} className="mx-auto text-green-400 mb-4" />,
        import: <Upload size={48} className="mx-auto text-blue-400 mb-4" />,
    }
    const buttonColors = {
        delete: 'bg-red-500 hover:bg-red-600',
        save: 'bg-cyan-500 hover:bg-cyan-600',
        reactivate: 'bg-green-500 hover:bg-green-600',
        import: 'bg-blue-500 hover:bg-blue-600',
    }
    
    const handleConfirm = async () => {
        setIsProcessing(true);
        await onConfirm(details);
        // Modal will be closed by parent component after action completes
    };
    
    return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-[200] p-4">
        <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-sm text-center">
            {isProcessing ? (
                <>
                    <Loader2 size={48} className="mx-auto text-blue-400 mb-4 animate-spin" />
                    <h3 className="text-xl font-bold mb-2">Processing...</h3>
                    <p className="text-gray-400 mb-6">Please wait while the operation completes.</p>
                </>
            ) : (
                <>
                    {icons[type] || <AlertTriangle size={48} className="mx-auto text-yellow-400 mb-4" />}
                    <h3 className="text-xl font-bold mb-2">{title || 'Confirm Action'}</h3>
                    <p className="text-gray-400 mb-6">{message || 'Are you sure?'}</p>
                    
                    {/* Render custom form element if provided */}
                    {customForm && (
                        <div className="mb-4 text-left">
                            {customForm}
                        </div>
                    )}

                    <div className="flex justify-center space-x-4">
                        <button onClick={onCancel} className="px-6 py-2 bg-gray-600 rounded-md hover:bg-gray-700">Cancel</button>
                        <button onClick={handleConfirm} className={`px-6 py-2 rounded-md ${buttonColors[type] || 'bg-cyan-500'}`}>{confirmText || 'Confirm'}</button>
                    </div>
                </>
            )}
        </div>
    </div>
)};

const FinancialReportsPage = ({ userId, appId, currency, collectionPath }) => {
    const [ledger, setLedger] = useState([]);
    const [view, setView] = useState('monthly');
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
    const [activeReport, setActiveReport] = useState('pnl');
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const importFileInputRef = useRef(null);

    useEffect(() => { if(!userId || appId === 'default-app-id') return; const q = collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`); const unsub = onSnapshot(q, (snap) => setLedger(snap.docs.map(d => ({id: d.id, ...d.data()})))); return unsub; }, [userId, appId, collectionPath]);

    // This effect updates the 'view' state based on the 'activeReport'
    useEffect(() => {
        if (activeReport === 'pnl') {
            setView('monthly');
        } else {
            setView('all');
        }
    }, [activeReport]); // This runs whenever the activeReport changes

    const filteredLedger = useMemo(() => {
        if (view === 'yearly') {
            return ledger.filter(e => {
                const date = e.date?.toDate ? e.date.toDate() : new Date(e.date);
                return !isNaN(date.getTime()) && date.getFullYear() === selectedYear;
            });
        }
        if (view === 'monthly') {
            return ledger.filter(e => {
                const date = e.date?.toDate ? e.date.toDate() : new Date(e.date);
                return !isNaN(date.getTime()) && date.getFullYear() === selectedYear && date.getMonth() === selectedMonth;
            });
        }
        return ledger;
    }, [ledger, view, selectedYear, selectedMonth]);

    const reportData = useMemo(() => {
        const detailed = {};

        filteredLedger.forEach(e => {
            const category = e.mainCategory;
            const subCategory = e.subCategory || 'Uncategorized';
            if (!detailed[category]) detailed[category] = {};
            if (!detailed[category][subCategory]) detailed[category][subCategory] = { debit: 0, credit: 0, entries: [] };
            
            const debit = e.debit || 0;
            const credit = e.credit || 0;
            detailed[category][subCategory].debit += debit;
            detailed[category][subCategory].credit += credit;
            detailed[category][subCategory].entries.push(e);
        });

        const trialBalanceAccounts = [];
        Object.entries(detailed).forEach(([mainCat, subCats]) => {
            Object.entries(subCats).forEach(([subCat, { debit, credit }]) => {
                const netBalance = debit - credit;
                if (Math.abs(netBalance) > 0.001) { // Avoid floating point issues with zero balances
                    if (netBalance > 0) {
                        trialBalanceAccounts.push({ account: `${subCat} (${mainCat})`, debit: netBalance, credit: 0 });
                    } else {
                        trialBalanceAccounts.push({ account: `${subCat} (${mainCat})`, debit: 0, credit: -netBalance });
                    }
                }
            });
        });

        const totalFinalDebits = trialBalanceAccounts.reduce((sum, acc) => sum + acc.debit, 0);
        const totalFinalCredits = trialBalanceAccounts.reduce((sum, acc) => sum + acc.credit, 0);

        const allIncome = Object.entries(detailed['Income'] || {}).map(([key, val]) => ({ particulars: key, amount: val.credit }));
        const allExpenses = Object.entries(detailed['Expenses'] || {}).map(([key, val]) => ({ particulars: key, amount: val.debit }));
        const allAssets = Object.entries(detailed['Assets'] || {}).map(([key, val]) => ({ particulars: key, amount: val.debit - val.credit }));
        const allCurrentAssets = Object.entries(detailed['Current Assets'] || {}).map(([key, val]) => ({ particulars: key, amount: val.debit - val.credit }));
        const allLiabilities = Object.entries(detailed['Liability'] || {}).map(([key, val]) => ({ particulars: key, amount: val.credit - val.debit }));
        const allCurrentLiabilities = Object.entries(detailed['Current Liabilities'] || {}).map(([key, val]) => ({ particulars: key, amount: val.credit - val.debit }));
        const allEquity = Object.entries(detailed['Equity'] || {}).map(([key, val]) => ({ particulars: key, amount: val.credit - val.debit }));

        const cashFlow = {
            operating: { inflows: [], outflows: [] },
            investing: { inflows: [], outflows: [] },
            financing: { inflows: [], outflows: [] },
        };

        filteredLedger.forEach(e => {
            const particulars = e.subCategory || e.particulars || 'Uncategorized';
            const debit = e.debit || 0;
            const credit = e.credit || 0;

            switch (e.mainCategory) {
                case 'Income':
                    if (credit > 0) cashFlow.operating.inflows.push({ particulars, amount: credit });
                    break;
                case 'Expenses':
                    if (debit > 0) cashFlow.operating.outflows.push({ particulars, amount: debit });
                    break;
                case 'Assets':
                    if (debit > 0) cashFlow.investing.outflows.push({ particulars: `Purchase of ${particulars}`, amount: debit });
                    if (credit > 0) cashFlow.investing.inflows.push({ particulars: `Sale of ${particulars}`, amount: credit });
                    break;
                case 'Liability':
                case 'Equity':
                    if (credit > 0) cashFlow.financing.inflows.push({ particulars: `Increase in ${particulars}`, amount: credit });
                    if (debit > 0) cashFlow.financing.outflows.push({ particulars: `Decrease in ${particulars}`, amount: debit });
                    break;
            }
        });


        return {
            pnl: { income: allIncome, expense: allExpenses },
            balanceSheet: { assets: allAssets, currentAssets: allCurrentAssets, liabilities: allLiabilities, currentLiabilities: allCurrentLiabilities, equity: allEquity },
            trialBalance: { accounts: trialBalanceAccounts.sort((a,b) => a.account.localeCompare(b.account)), totalDebits: totalFinalDebits, totalCredits: totalFinalCredits },
            cashFlow,
        };
    }, [filteredLedger]);

    const { pnl, balanceSheet, trialBalance, cashFlow } = reportData;
    const totalIncome = pnl.income.reduce((sum, item) => sum + item.amount, 0);
    const totalExpense = pnl.expense.reduce((sum, item) => sum + item.amount, 0);
    const netProfit = totalIncome - totalExpense;
    const totalAssets = balanceSheet.assets.reduce((sum, item) => sum + item.amount, 0);
    const totalCurrentAssets = balanceSheet.currentAssets.reduce((sum, item) => sum + item.amount, 0);
    const grandTotalAssets = totalAssets + totalCurrentAssets;
    const totalLiabilities = balanceSheet.liabilities.reduce((sum, item) => sum + item.amount, 0);
    const totalCurrentLiabilities = balanceSheet.currentLiabilities.reduce((sum, item) => sum + item.amount, 0);
    const totalEquity = balanceSheet.equity.reduce((sum, item) => sum + item.amount, 0);
    const grandTotalLiabilitiesAndEquity = totalLiabilities + totalCurrentLiabilities + totalEquity + netProfit;
    const difference = trialBalance.totalDebits - trialBalance.totalCredits;
    const isTrialBalanced = Math.abs(difference) < 0.01;

    // Calculate Cash Flow totals
    const totalOperatingInflows = cashFlow.operating.inflows.reduce((sum, item) => sum + item.amount, 0);
    const totalOperatingOutflows = cashFlow.operating.outflows.reduce((sum, item) => sum + item.amount, 0);
    const netOperatingCash = totalOperatingInflows - totalOperatingOutflows;

    const totalInvestingInflows = cashFlow.investing.inflows.reduce((sum, item) => sum + item.amount, 0);
    const totalInvestingOutflows = cashFlow.investing.outflows.reduce((sum, item) => sum + item.amount, 0);
    const netInvestingCash = totalInvestingInflows - totalInvestingOutflows;

    const totalFinancingInflows = cashFlow.financing.inflows.reduce((sum, item) => sum + item.amount, 0);
    const totalFinancingOutflows = cashFlow.financing.outflows.reduce((sum, item) => sum + item.amount, 0);
    const netFinancingCash = totalFinancingInflows - totalFinancingOutflows;

    const netCashChange = netOperatingCash + netInvestingCash + netFinancingCash;

    const years = [...new Set(ledger.map(e => {
        const date = e.date?.toDate ? e.date.toDate() : new Date(e.date);
        return isNaN(date.getTime()) ? null : date.getFullYear();
    }))].filter(Boolean).sort((a,b) => b-a);
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    const handleExportExcel = async () => {
        setIsExporting(true);
        try {
            const ledgerData = ledger.map(entry => ({
                id: entry.id,
                date: formatDate(entry.date),
                particulars: entry.particulars,
                mainCategory: entry.mainCategory,
                subCategory: entry.subCategory,
                debit: entry.debit || 0,
                credit: entry.credit || 0
            }));

            const workbook = window.XLSX.utils.book_new();
            
            // Main ledger sheet
            const ledgerSheet = window.XLSX.utils.json_to_sheet(ledgerData);
            window.XLSX.utils.book_append_sheet(workbook, ledgerSheet, 'Ledger Entries');
            
            // Export current report data
            if (activeReport === 'pnl') {
                const pnlData = [
                    { Category: 'Revenue', Amount: totalRevenue },
                    { Category: 'Expenses', Amount: totalExpenses },
                    { Category: 'Net Profit', Amount: netProfit }
                ];
                const pnlSheet = window.XLSX.utils.json_to_sheet(pnlData);
                window.XLSX.utils.book_append_sheet(workbook, pnlSheet, 'P&L Summary');
            }

            window.XLSX.writeFile(workbook, `financial_report_${activeReport}_${new Date().toISOString().split('T')[0]}.xlsx`);
        } catch (error) {
            console.error('Export failed:', error);
            alert('Failed to export financial report. Check console for details.');
        } finally {
            setIsExporting(false);
        }
    };

    const handleImportExcel = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsImporting(true);
        try {
            const data = await file.arrayBuffer();
            const workbook = window.XLSX.read(data);
            const worksheet = workbook.Sheets['Ledger Entries'];
            
            if (!worksheet) {
                throw new Error('No "Ledger Entries" sheet found in the Excel file');
            }

            const jsonData = window.XLSX.utils.sheet_to_json(worksheet);
            
            const ledgerRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`);
            
            for (const row of jsonData) {
                const entryData = {
                    date: parseDateForFirestore(row.date) || new Date(),
                    particulars: row.particulars || '',
                    mainCategory: row.mainCategory || '',
                    subCategory: row.subCategory || '',
                    debit: Number(row.debit) || 0,
                    credit: Number(row.credit) || 0
                };

                if (row.id) {
                    await setDoc(doc(ledgerRef, row.id), entryData, { merge: true });
                } else {
                    await addDoc(ledgerRef, entryData);
                }
            }
            
            alert('Import successful!');
        } catch (error) {
            console.error('Import failed:', error);
            alert(`Failed to import ledger data: ${error.message}`);
        } finally {
            setIsImporting(false);
            e.target.value = '';
        }
    };

    const ReportRow = ({ item }) => {
        return (
            <div className={`flex justify-between text-sm py-1`}>
                <p>{item.particulars}</p>
                <p>{formatCurrency(item.amount, currency)}</p>
            </div>
        );
    };

    const ReportSubNav = () => (
        <nav className="dark:bg-gray-800/80 bg-white/80 backdrop-blur-sm p-2 flex justify-center items-center space-x-1 sm:space-x-2 sticky top-[70px] z-40 shadow-sm flex-wrap no-print">
            <div className="flex items-center space-x-1 sm:space-x-2 flex-wrap gap-y-2">
                <button
                    onClick={() => setActiveReport('pnl')}
                    className={`flex items-center space-x-2 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all duration-200 ${
                        activeReport === 'pnl' ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md' : 'dark:text-gray-300 text-gray-600 dark:hover:bg-gray-700 hover:bg-gray-200'
                    }`}
                >
                    <TrendingUp size={16}/>
                    <span>Profit & Loss</span>
                </button>
                <button
                    onClick={() => setActiveReport('trialBalance')}
                    className={`flex items-center space-x-2 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all duration-200 ${
                        activeReport === 'trialBalance' ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md' : 'dark:text-gray-300 text-gray-600 dark:hover:bg-gray-700 hover:bg-gray-200'
                    }`}
                >
                    <Briefcase size={16}/>
                    <span>Trial Balance</span>
                </button>
                 <button
                    onClick={() => setActiveReport('balanceSheet')}
                    className={`flex items-center space-x-2 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all duration-200 ${
                        activeReport === 'balanceSheet' ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md' : 'dark:text-gray-300 text-gray-600 dark:hover:bg-gray-700 hover:bg-gray-200'
                    }`}
                >
                    <BookOpen size={16}/>
                    <span>Balance Sheet</span>
                </button>
                 <button
                    onClick={() => setActiveReport('cashFlow')}
                    className={`flex items-center space-x-2 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all duration-200 ${
                        activeReport === 'cashFlow' ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md' : 'dark:text-gray-300 text-gray-600 dark:hover:bg-gray-700 hover:bg-gray-200'
                    }`}
                >
                    <HandCoins size={16}/>
                    <span>Cash Flow</span>
                </button>
                <div className="flex items-center space-x-2 ml-4">
                    <select value={view} onChange={e => setView(e.target.value)} className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md border dark:border-gray-600 border-gray-300 text-xs">
                        <option value="all">All Time</option>
                        <option value="yearly">Yearly</option>
                        <option value="monthly">Monthly</option>
                    </select>
                    {view !== 'all' && (
                        <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md border dark:border-gray-600 border-gray-300 text-xs">
                            {years.map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                    )}
                    {view === 'monthly' && (
                        <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))} className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md border dark:border-gray-600 border-gray-300 text-xs">
                            {months.map((m, i) => <option key={m} value={i}>{m}</option>)}
                        </select>
                    )}
                    
                    <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-2"></div>
                    
                    <button
                        onClick={handleExportExcel}
                        disabled={isExporting}
                        className="flex items-center space-x-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md text-xs font-semibold transition-colors disabled:opacity-50"
                        title="Export Financial Report to Excel"
                    >
                        <Download className="h-4 w-4" />
                        <span className="hidden sm:inline">Export Excel</span>
                    </button>
                </div>
            </div>
        </nav>
    );

    return (
        <div className="relative group">
            <div className="p-4 sm:p-8 border-b dark:border-gray-700 no-print hidden">
                 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center flex-wrap gap-4">
                    
                    <div className="flex items-center space-x-2 flex-wrap gap-2">
                         <select value={view} onChange={e => setView(e.target.value)} className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md border dark:border-gray-600 border-gray-300">
                            <option value="all">All Time</option>
                            <option value="yearly">Yearly</option>
                            <option value="monthly">Monthly</option>
                        </select>
                        {view !== 'all' && (
                            <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md border dark:border-gray-600 border-gray-300">
                                {years.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                        )}
                        {view === 'monthly' && (
                            <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))} className="p-2 dark:bg-gray-700 bg-gray-200 dark:text-white text-gray-800 rounded-md border dark:border-gray-600 border-gray-300">
                                {months.map((m, i) => <option key={m} value={i}>{m}</option>)}
                            </select>
                        )}
                    </div>
                 </div>
            </div>

            <ReportSubNav />

            <div className="p-4 sm:p-8 space-y-8 max-w-screen-2xl mx-auto">
                {activeReport === 'pnl' && (
                    <section className="dark:bg-gray-800 bg-white p-6 rounded-lg border-l-4 border-amber-500">
                        <h2 className="text-xl font-bold mb-4">Profit & Loss Statement</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div> <h3 className="font-bold text-lg border-b pb-2 mb-2">Income</h3> {pnl.income.map((item, i) => <ReportRow key={i} item={item} />)} <div className="flex justify-between font-bold border-t pt-2 mt-2"><p>Total Income</p><p>{formatCurrency(totalIncome, currency)}</p></div> </div>
                            <div> <h3 className="font-bold text-lg border-b pb-2 mb-2">Expenses</h3> {pnl.expense.map((item, i) => <ReportRow key={i} item={item} />)} <div className="flex justify-between font-bold border-t pt-2 mt-2"><p>Total Expenses</p><p>{formatCurrency(totalExpense, currency)}</p></div> </div>
                        </div>
                        <div className="mt-8 text-center font-bold text-xl border-t pt-4"> Net Profit / (Loss): <span className={netProfit >= 0 ? 'text-green-400' : 'text-red-400'}>{formatCurrency(netProfit, currency)}</span></div>
                    </section>
                )}

                {activeReport === 'trialBalance' && (
                    <section id="trial-balance-section" className="dark:bg-gray-800 bg-white p-6 rounded-lg border-l-4 border-amber-500">
                        <h2 className="text-xl font-bold mb-4">Trial Balance</h2>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="text-xs dark:text-gray-400 text-gray-500 uppercase">
                                    <tr className="border-b dark:border-gray-700">
                                        <th className="px-4 py-2 text-left">Account</th>
                                        <th className="px-4 py-2 text-right">Debit</th>
                                        <th className="px-4 py-2 text-right">Credit</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {trialBalance.accounts.map((acc, index) => (
                                        <tr key={index} className="border-b dark:border-gray-700/50">
                                            <td className="p-2">{acc.account}</td>
                                            <td className="p-2 text-right text-green-400">{acc.debit > 0 ? formatCurrency(acc.debit, currency) : ''}</td>
                                            <td className="p-2 text-right text-red-400">{acc.credit > 0 ? formatCurrency(acc.credit, currency) : ''}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="font-bold border-t-2 dark:border-gray-600">
                                    <tr>
                                        <td className="p-2 text-left font-bold">Total</td>
                                        <td className="p-2 text-right text-green-400">{formatCurrency(trialBalance.totalDebits, currency)}</td>
                                        <td className="p-2 text-right text-red-400">{formatCurrency(trialBalance.totalCredits, currency)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                        <div className="mt-8 text-center font-bold text-xl border-t pt-4">
                            <div>Status: 
                                <span className={isTrialBalanced ? 'text-green-400' : 'text-red-400'}>
                                    {isTrialBalanced ? 'Balanced' : `Unbalanced by ${formatCurrency(Math.abs(difference), currency)}`}
                                </span>
                            </div>
                        </div>
                    </section>
                )}

                {activeReport === 'balanceSheet' && (
                    <section className="dark:bg-gray-800 bg-white p-6 rounded-lg border-l-4 border-amber-500">
                        <h2 className="text-xl font-bold mb-4">Balance Sheet</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div>
                                <h3 className="font-bold text-lg border-b pb-2 mb-2">Non-Current Assets</h3>
                                {balanceSheet.assets.map((item, i) => <ReportRow key={`asset-${i}`} item={item} />)}
                                {balanceSheet.assets.length > 0 && <div className="flex justify-between font-bold border-t pt-2 mt-2"><p>Total Non-Current Assets</p><p>{formatCurrency(totalAssets, currency)}</p></div>}
                                
                                <h3 className="font-bold text-lg border-b pb-2 my-2 mt-6">Current Assets</h3>
                                {balanceSheet.currentAssets.map((item, i) => <ReportRow key={`current-asset-${i}`} item={item} />)}
                                {balanceSheet.currentAssets.length > 0 && <div className="flex justify-between font-bold border-t pt-2 mt-2"><p>Total Current Assets</p><p>{formatCurrency(totalCurrentAssets, currency)}</p></div>}

                                <div className="flex justify-between font-bold border-t-2 border-cyan-500 pt-2 mt-4 text-lg"><p>Grand Total Assets</p><p>{formatCurrency(grandTotalAssets, currency)}</p></div>
                            </div>
                            <div>
                                <h3 className="font-bold text-lg border-b pb-2 mb-2">Non-Current Liabilities</h3>
                                {balanceSheet.liabilities.map((item, i) => <ReportRow key={`liability-${i}`} item={item} />)}
                                {balanceSheet.liabilities.length > 0 && <div className="flex justify-between font-bold border-t pt-2 mt-2"><p>Total Non-Current Liabilities</p><p>{formatCurrency(totalLiabilities, currency)}</p></div>}

                                <h3 className="font-bold text-lg border-b pb-2 my-2 mt-6">Current Liabilities</h3>
                                {balanceSheet.currentLiabilities.map((item, i) => <ReportRow key={`current-liability-${i}`} item={item} />)}
                                {balanceSheet.currentLiabilities.length > 0 && <div className="flex justify-between font-bold border-t pt-2 mt-2"><p>Total Current Liabilities</p><p>{formatCurrency(totalCurrentLiabilities, currency)}</p></div>}

                                <h3 className="font-bold text-lg border-b pb-2 my-2 mt-6">Equity</h3>
                                {balanceSheet.equity.map((item, i) => <ReportRow key={`equity-${i}`} item={item} />)}
                                <div className="flex justify-between text-sm py-1"><p>Retained Earnings (Net Profit)</p><p>{formatCurrency(netProfit, currency)}</p></div>
                                <div className="flex justify-between font-bold border-t pt-2 mt-2"><p>Total Equity</p><p>{formatCurrency(totalEquity + netProfit, currency)}</p></div>
                                
                                <div className="flex justify-between font-bold border-t-2 border-cyan-500 pt-2 mt-4 text-lg"><p>Grand Total Liabilities & Equity</p><p>{formatCurrency(grandTotalLiabilitiesAndEquity, currency)}</p></div>
                            </div>
                        </div>
                    </section>
                )}

                {activeReport === 'cashFlow' && (
                    <section className="dark:bg-gray-800 bg-white p-6 rounded-lg border-l-4 border-amber-500">
                        <h2 className="text-xl font-bold mb-4">Cash Flow Statement</h2>
                        <div className="space-y-4">
                            <div className="flex justify-between py-2 border-b dark:border-gray-700">
                                <p>Net Cash from Operating Activities</p>
                                <p className={`font-semibold ${netOperatingCash >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatCurrency(netOperatingCash, currency)}</p>
                            </div>
                            <div className="flex justify-between py-2 border-b dark:border-gray-700">
                                <p>Net Cash from Investing Activities</p>
                                <p className={`font-semibold ${netInvestingCash >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatCurrency(netInvestingCash, currency)}</p>
                            </div>
                            <div className="flex justify-between py-2 border-b dark:border-gray-700">
                                <p>Net Cash from Financing Activities</p>
                                <p className={`font-semibold ${netFinancingCash >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatCurrency(netFinancingCash, currency)}</p>
                            </div>
                            <div className="flex justify-between py-2 font-bold text-lg border-t-2 dark:border-gray-500 mt-4">
                                <p>Net Increase/(Decrease) in Cash</p>
                                <p className={netCashChange >= 0 ? 'text-green-400' : 'text-red-400'}>{formatCurrency(netCashChange, currency)}</p>
                            </div>
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
};

const EditableText = ({ initialValue, onSave, className }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(initialValue);
    const inputRef = useRef(null);
    useEffect(() => { setValue(initialValue); }, [initialValue]);
    useEffect(() => { if (isEditing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [isEditing]);
    const handleSave = () => { setIsEditing(false); const trimmedValue = value.trim(); if (trimmedValue && trimmedValue !== initialValue) { onSave(trimmedValue); } else { setValue(initialValue); } };
    const handleKeyDown = (e) => { if (e.key === 'Enter') { handleSave(); } else if (e.key === 'Escape') { setValue(initialValue); setIsEditing(false); } };
    return isEditing ? ( <input ref={inputRef} type="text" value={value} onChange={(e) => setValue(e.target.value)} onBlur={handleSave} onKeyDown={handleKeyDown} className={`${className} bg-gray-700 rounded-md px-1 -ml-1 w-full`} /> ) : ( <span className={`${className} cursor-pointer`} onClick={() => setIsEditing(true)}> {value} </span> );
};

const DocumentSection = ({ title, storagePathPrefix, firestoreCollectionRef, setConfirmAction }) => {
    const [documents, setDocuments] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const fileInputRef = useRef(null);

    useEffect(() => {
        if (!firestoreCollectionRef) return;
        const unsub = onSnapshot(firestoreCollectionRef, (snapshot) => {
            const docsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setDocuments(docsData);
        }, (err) => {
            console.error("Error fetching documents:", err);
            setError("Could not load documents.");
        });
        return () => unsub();
    }, [firestoreCollectionRef]);

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setIsLoading(true);
        setError(null);
        try {
            const storagePath = `${storagePathPrefix}/${Date.now()}_${file.name}`;
            const storageRef = ref(storage, storagePath);
            await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(storageRef);
            await addDoc(firestoreCollectionRef, {
                name: file.name,
                url: downloadURL,
                storagePath: storagePath,
                createdAt: new Date(),
            });
        } catch (err) {
            console.error("Error uploading file:", err);
            setError("Upload failed. Please check connection and Firebase Storage rules.");
        } finally {
            setIsLoading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleRename = async (docId, newName) => {
        const docRef = doc(firestoreCollectionRef, docId);
        await updateDoc(docRef, { name: newName });
    };

    const handleDelete = async (docToDelete) => {
        const storageRef = ref(storage, docToDelete.storagePath);
        await deleteObject(storageRef);
        const docRef = doc(firestoreCollectionRef, docToDelete.id);
        await deleteDoc(docRef);
    };

    const onDeleteRequest = (docToDelete) => {
        setConfirmAction({
            title: 'Confirm Deletion',
            message: `Are you sure you want to delete the document "${docToDelete.name}"?`,
            confirmText: 'Delete',
            type: 'delete',
            action: () => handleDelete(docToDelete),
        });
    };

    return (
        <section className="dark:bg-gray-700/50 bg-gray-100/50 p-4 rounded-lg no-print">
            <h3 className="text-xl font-bold mb-4 flex items-center"><FileText className="mr-3 text-cyan-400"/> {title}</h3>
            <div className="mb-4">
                <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                <button onClick={() => fileInputRef.current.click()} disabled={isLoading} className="flex items-center space-x-2 px-4 py-2 bg-cyan-500 rounded-md hover:bg-cyan-600 transition-colors disabled:bg-gray-500">
                    {isLoading ? <Loader2 className="animate-spin" /> : <PlusCircle size={18}/>}
                    <span>{isLoading ? 'Uploading...' : 'Add Document'}</span>
                </button>
                {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
            </div>
            <div className="space-y-2">
                {documents.length === 0 && !isLoading && <p className="text-gray-400">No documents uploaded.</p>}
                {documents.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between dark:bg-gray-700 p-3 rounded-lg">
                        <FileText size={20} className="mr-3 text-gray-400 flex-shrink-0"/>
                        <div className="flex-grow">
                             <EditableText initialValue={doc.name} onSave={(newName) => handleRename(doc.id, newName)} className="font-medium"/>
                        </div>
                        <div className="flex items-center space-x-3">
                            <a href={doc.url} target="_blank" rel="noopener noreferrer" className="p-1.5 hover:text-cyan-400" title="View Document"><Eye size={16}/></a>
                            <a href={doc.url} target="_blank" rel="noopener noreferrer" download={doc.name} className="p-1.5 hover:text-green-400" title="Download Document"><Download size={16}/></a>
                            <button onClick={() => onDeleteRequest(doc)} className="p-1.5 hover:text-red-400" title="Delete Document"><Trash2 size={16}/></button>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
};


const VisionPage = ({ userId, appId, onDownloadReport, setConfirmAction }) => {
    // Helper function to handle different date formats
    const getDateFromField = (dateField) => {
        if (!dateField) return null;
        if (dateField.toDate && typeof dateField.toDate === 'function') {
            return dateField.toDate(); // Firestore Timestamp
        }
        if (dateField instanceof Date) {
            return dateField; // Regular Date
        }
        if (typeof dateField === 'string') {
            const parsed = new Date(dateField);
            return isNaN(parsed.getTime()) ? null : parsed; // Date string
        }
        return null;
    };

    const [aiAnalysis, setAiAnalysis] = useState('');
    const [isLoadingAi, setIsLoadingAi] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [isExportingExcel, setIsExportingExcel] = useState(false);
    const [isClearingData, setIsClearingData] = useState(false); // Add state for clearing
    const importFileInputRef = useRef(null);
    const [activeVisionSubPage, setActiveVisionSubPage] = useState('charts');
    
    const [visionText, setVisionText] = useState('');
    const [isEditingVision, setIsEditingVision] = useState(false);
    const visionDocRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/vision/main`), [appId, userId]);

    const [notes, setNotes] = useState([]);
    const [newNote, setNewNote] = useState('');
    const notesRef = useMemo(() => collection(db, `artifacts/${appId}/users/${userId}/visionNotes`), [appId, userId]);

    const [selectedNote, setSelectedNote] = useState(null);
    const [isEditingNote, setIsEditingNote] = useState(false);
    const [editNoteText, setEditNoteText] = useState('');

    // --- NEW ---
    const [isExportingVision, setIsExportingVision] = useState(false);
    const [isImportingVision, setIsImportingVision] = useState(false);
    const visionImportRef = useRef(null);

    const [isExportingNotes, setIsExportingNotes] = useState(false);
    const [isImportingNotes, setIsImportingNotes] = useState(false);
    const notesImportRef = useRef(null);
    // --- END NEW ---

    const NoteItem = ({ note, onUpdate, onDeleteRequest }) => {
        const [isEditing, setIsEditing] = useState(false);
        const [editText, setEditText] = useState(note.text);
        const textareaRef = useRef(null);
    
        const handleSave = () => {
            onUpdate(note.id, editText);
            setIsEditing(false);
        };
    
        const handleCancel = () => {
            setEditText(note.text);
            setIsEditing(false);
        };
    
        useEffect(() => {
            if (isEditing && textareaRef.current) {
                const textarea = textareaRef.current;
                textarea.style.height = 'auto'; // Reset height
                textarea.style.height = `${textarea.scrollHeight}px`; // Set to scroll height
                textarea.focus();
            }
        }, [isEditing]);
    
        const handleTextChange = (e) => {
            setEditText(e.target.value);
            const textarea = e.target;
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
        };
    
        return (
            <div className="dark:bg-gray-700/50 bg-gray-100/50 p-3 rounded-lg group">
                {isEditing ? (
                    <div className="flex flex-col gap-2">
                        <textarea
                            ref={textareaRef}
                            value={editText}
                            onChange={handleTextChange}
                            className="w-full p-2 bg-gray-700 rounded-md resize-none overflow-hidden"
                            rows="2"
                        />
                        <div className="flex items-center justify-end space-x-2">
                            <button onClick={handleCancel} className="px-3 py-1 bg-gray-600 text-xs rounded-md hover:bg-gray-500">Cancel</button>
                            <button onClick={handleSave} className="px-3 py-1 bg-cyan-500 text-xs rounded-md hover:bg-cyan-600">Save</button>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex-grow cursor-pointer" onClick={() => setIsEditing(true)}>
                            <p className="whitespace-pre-wrap">{note.text}</p>
                            <p className="text-xs text-gray-500 mt-1">{formatDate(note.createdAt)}</p>
                        </div>
                        <div className="flex-shrink-0 flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => setIsEditing(true)} className="p-1.5 hover:text-cyan-400" title="Edit Note"><Edit size={16} /></button>
                            <button onClick={() => onDeleteRequest(note.id)} className="p-1.5 hover:text-red-400" title="Delete Note"><Trash2 size={16} /></button>
                        </div>
                    </div>
                )}
            </div>
        );
    };

     useEffect(() => {
        if (!visionDocRef) return;
        const unsubVision = onSnapshot(visionDocRef, (doc) => {
            if (doc.exists()) {
                setVisionText(doc.data().text || '');
            } else {
                 setVisionText('');
            }
        });

        if (!notesRef) return;
        const q = query(notesRef, orderBy('createdAt', 'desc'));
        const unsubNotes = onSnapshot(q, (snapshot) => {
            setNotes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });

        return () => {
            unsubVision();
            unsubNotes();
        };
    }, [visionDocRef, notesRef]);

    useEffect(() => {
        if (!selectedNote && notes.length > 0) {
            // Select the first note by default (which is the most recent one due to the query)
            setSelectedNote(notes[0]);
        }
    }, [notes, selectedNote]);

    useEffect(() => {
        if (selectedNote) {
            setEditNoteText(selectedNote.text);
            setIsEditingNote(false); // Reset editing state when note changes
        } else {
            setEditNoteText('');
            setIsEditingNote(false);
        }
    }, [selectedNote]);

    const handleSaveVision = async () => {
        await setDoc(visionDocRef, { text: visionText }, { merge: true });
        setIsEditingVision(false);
    };

    const handleDeleteVisionRequest = () => {
        setConfirmAction({
            title: 'Delete Vision & Plans',
            message: 'Are you sure you want to delete this content? This cannot be undone.',
            confirmText: 'Delete',
            type: 'delete',
            action: async () => {
                await setDoc(visionDocRef, { text: '' });
                setVisionText('');
                setIsEditingVision(false);
            }
        });
    };

    // --- NEW VISION IMPORT/EXPORT ---
    const handleExportVision = async () => {
        setConfirmAction({
            title: 'Export Vision & Plans',
            message: 'This will export your "Vision & Plans" content to a JSON file. Proceed?',
            confirmText: 'Export',
            type: 'save',
            action: async () => {
                setIsExportingVision(true);
                try {
                    const dataToExport = { text: visionText };
                    const jsonString = JSON.stringify(dataToExport, null, 2);
                    const blob = new Blob([jsonString], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `vision_plans_backup_${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (error) {
                    console.error("Export failed:", error);
                    alert("An error occurred during export.");
                } finally {
                    setIsExportingVision(false);
                }
            }
        });
    };

    const handleImportVisionChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                if (typeof importedData.text !== 'string') {
                    throw new Error("Invalid JSON format. Expected an object with a 'text' property.");
                }

                setConfirmAction({
                    title: 'DANGER: Import Vision & Plans',
                    message: 'This will replace your current "Vision & Plans" content with the data from the file. This action cannot be undone. Are you sure?',
                    confirmText: 'Yes, Overwrite & Import',
                    type: 'delete',
                    action: async () => {
                        setIsImportingVision(true);
                        try {
                            await setDoc(visionDocRef, { text: importedData.text }, { merge: true });
                            setVisionText(importedData.text); // Update local state
                            alert('Import successful!');
                        } catch (err) {
                            console.error("Import process failed:", err);
                            alert(`Import failed: ${err.message}`);
                        } finally {
                            setIsImportingVision(false);
                        }
                    }
                });

            } catch (err) {
                 alert(`Error reading file: ${err.message}`);
            }
            if (visionImportRef.current) visionImportRef.current.value = "";
        };
        reader.readAsText(file);
    };

    const triggerImportVision = () => {
        visionImportRef.current?.click();
    };
    // --- END NEW VISION IMPORT/EXPORT ---


    const handleAddNote = async () => {
        if (newNote.trim() === '') return;
        const newNoteData = {
            text: newNote,
            createdAt: new Date(),
        };
        const docRef = await addDoc(notesRef, newNoteData);
        setNewNote('');
        // Automatically select the new note
        setSelectedNote({ id: docRef.id, ...newNoteData });
    };

    const handleUpdateNote = async (noteId, text) => {
        const noteRef = doc(db, `artifacts/${appId}/users/${userId}/visionNotes`, noteId);
        await updateDoc(noteRef, { text });
    };

    const handleDeleteNoteRequest = (noteId) => {
        setConfirmAction({
            title: 'Delete Note',
            message: 'Are you sure you want to delete this note?',
            confirmText: 'Delete',
            type: 'delete',
            action: () => deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/visionNotes`, noteId)),
        });
    };

    // --- NEW NOTES IMPORT/EXPORT ---
    const handleExportNotes = async () => {
        setConfirmAction({
            title: 'Export Notes',
            message: 'This will export all your notes to a JSON file. Proceed?',
            confirmText: 'Export',
            type: 'save',
            action: async () => {
                setIsExportingNotes(true);
                try {
                    // Use the 'notes' state which is already sorted and loaded
                    const dataToExport = notes.map(({ id, ...data }) => ({ id, ...data })); // Create a clean copy

                    const jsonString = JSON.stringify(dataToExport, null, 2);
                    const blob = new Blob([jsonString], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `vision_notes_backup_${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (error) {
                    console.error("Export failed:", error);
                    alert("An error occurred during export.");
                } finally {
                    setIsExportingNotes(false);
                }
            }
        });
    };

    const handleImportNotesChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                if (!Array.isArray(importedData)) {
                    throw new Error("Invalid JSON format. Expected an array of note objects.");
                }

                setConfirmAction({
                    title: 'DANGER: Import Notes',
                    message: 'This will DELETE ALL current notes and replace them with data from the file. This action cannot be undone. Are you sure?',
                    confirmText: 'Yes, Delete & Import',
                    type: 'delete',
                    action: async () => {
                        setIsImportingNotes(true);
                        try {
                            const existingDocsSnapshot = await getDocs(notesRef);
                            const batch = writeBatch(db);
                            existingDocsSnapshot.forEach(doc => batch.delete(doc.ref));

                            importedData.forEach(item => {
                                const { id, ...data } = item;
                                const restoredData = restoreTimestamps(data);
                                // For a backup/restore, using the original ID is better.
                                const docRef = doc(db, notesRef.path, id); 
                                batch.set(docRef, restoredData);
                            });
                            await batch.commit();
                            alert('Import successful! Notes have been restored.');
                        } catch (err) {
                            console.error("Import process failed:", err);
                            alert(`Import failed: ${err.message}`);
                        } finally {
                            setIsImportingNotes(false);
                        }
                    }
                });

            } catch (err) {
                 alert(`Error reading file: ${err.message}`);
            }
            if (notesImportRef.current) notesImportRef.current.value = "";
        };
        reader.readAsText(file);
    };

    const triggerImportNotes = () => {
        notesImportRef.current?.click();
    };
    // --- END NEW NOTES IMPORT/EXPORT ---


    const restoreTimestamps = (data) => {
        if (data === null || typeof data !== 'object') {
            return data;
        }
        if (typeof data.seconds === 'number' && typeof data.nanoseconds === 'number' && Object.keys(data).length === 2) {
            return new Date(data.seconds * 1000 + data.nanoseconds / 1000000);
        }
        if (Array.isArray(data)) {
            return data.map(item => restoreTimestamps(item));
        }
        const restoredObject = {};
        for (const key in data) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                restoredObject[key] = restoreTimestamps(data[key]);
            }
        }
        return restoredObject;
    };

    const handleExportExcel = async () => {
        if (!window.XLSX) {
            console.error("XLSX library not loaded.");
            alert("Excel export library is not ready. Please try again in a moment.");
            return;
        }

        setConfirmAction({
            title: 'Confirm Excel Export',
            message: 'This will export your dashboard data into a single Excel file with multiple sheets. This may take a moment.',
            confirmText: 'Export to Excel',
            type: 'save',
            action: async () => {
                setIsExportingExcel(true);
                try {
                    const wb = window.XLSX.utils.book_new();

                    const collectionsToExport = [
                        { name: 'Al Marri Employees', path: 'alMarriData' },
                        { name: 'Al Marri Employee PnL', path: 'alMarriEmployeePnl' },
                        { name: 'Al Marri Vehicles', path: 'alMarriVehicles' },
                        { name: 'Al Marri WPS', path: 'alMarriWps' },
                        { name: 'Al Marri Bank', path: 'alMarriBank' },
                        { name: 'Al Marri Audit', path: 'alMarriAudit' },
                        { name: 'Al Marri Documents', path: 'alMarriDocuments' },
                        { name: 'Al Marri Credentials', path: 'alMarriCredentials' },
                        { name: 'Al Marri Reminders', path: 'alMarriReminders' },
                        { name: 'Al Marri Others', path: 'alMarriOthers' },
                        { name: 'Al Marri Cheques', path: 'alMarriCheques' },
                        { name: 'Fathoom Employees', path: 'fathoomData' },
                        { name: 'Fathoom Employee PnL', path: 'fathoomEmployeePnl' },
                        { name: 'Fathoom Vehicles', path: 'fathoomVehicles' },
                        { name: 'Fathoom WPS', path: 'fathoomWps' },
                        { name: 'Fathoom Bank', path: 'fathoomBank' },
                        { name: 'Fathoom Audit', path: 'fathoomAudit' },
                        { name: 'Fathoom Documents', path: 'fathoomDocuments' },
                        { name: 'Fathoom Credentials', path: 'fathoomCredentials' },
                        { name: 'Fathoom Reminders', path: 'fathoomReminders' },
                        { name: 'Fathoom Others', path: 'fathoomOthers' },
                        { name: 'Fathoom Cheques', path: 'fathoomCheques' },
                        { name: 'Business Al Marri', path: 'business_almarri' },
                        { name: 'Business Fathoom', path: 'business_fathoom' },
                        { name: 'Business Recruitments', path: 'business_recruitments' },
                        { name: 'Business Vehicles', path: 'business_vehicles' },
                        { name: 'Business Transportation', path: 'business_transportation' },
                        { name: 'Ledger', path: 'ledgerQatar' },
                        { name: 'Ledger Favorites', path: 'ledgerFavorites' },
                        { name: 'Debts & Credits', path: 'debts_credits' },
                        { name: 'Settled Debts-Credits', path: 'debts_credits_settled' },
                        { name: 'Bad Debts', path: 'bad_debts' },
                        { name: 'Visa Entries', path: 'visa_entries' },
                        { name: 'Visa PnL', path: 'visa_pnl' },
                        { name: 'Vision Notes', path: 'visionNotes' },
                    ];
                    
                    const customSectionsRef = collection(db, `artifacts/${appId}/users/${userId}/business_sections`);
                    const customSectionsSnapshot = await getDocs(customSectionsRef);
                    customSectionsSnapshot.forEach(doc => {
                        const section = doc.data();
                        if(section.title && section.collectionPath) {
                            collectionsToExport.push({ name: `Business - ${section.title}`, path: section.collectionPath });
                        }
                    });

                    const processAndAddSheet = (data, sheetName) => {
                        if (data.length === 0) return;
                        const formattedData = data.map(item => {
                            const { _subCollections, ...rest } = item;
                            const newItem = { id: rest.id }; // Keep ID as first field
                            for (const key in rest) {
                                if (key === 'id') continue; // Already added
                                const value = rest[key];
                                if (value && typeof value.toDate === 'function') {
                                    newItem[key] = formatDate(value);
                                } else if (Array.isArray(value) || (value !== null && typeof value === 'object' && !value.toDate)) {
                                    newItem[key] = JSON.stringify(value);
                                } else {
                                    newItem[key] = value;
                                }
                            }
                            return newItem;
                        });
                        const ws = window.XLSX.utils.json_to_sheet(formattedData);
                        window.XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));
                    };
                    
                    for (const collInfo of collectionsToExport) {
                        const collRef = collection(db, `artifacts/${appId}/users/${userId}/${collInfo.path}`);
                        const snapshot = await getDocs(collRef);
                        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                        processAndAddSheet(data, collInfo.name);
                    }
                    
                    const statementsRef = collection(db, `artifacts/${appId}/users/${userId}/statements`);
                    const statementsSnapshot = await getDocs(statementsRef);
                    const statementsData = statementsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    if (statementsData.length > 0) {
                        const flattenedItems = [];
                        statementsData.forEach(stmt => {
                            if (stmt.invoiceItems && stmt.invoiceItems.length > 0) {
                                stmt.invoiceItems.forEach(item => {
                                    flattenedItems.push({
                                        statement_id: stmt.id,
                                        statement_to: stmt.to,
                                        statement_subject: stmt.subject,
                                        statement_date: formatDate(stmt.date),
                                        item_date: formatDate(item.date),
                                        item_description: item.description,
                                        item_invoiceNo: item.invoiceNo,
                                        item_debit: item.debit,
                                        item_credit: item.credit
                                    });
                                });
                            } else {
                                 flattenedItems.push({
                                    statement_id: stmt.id,
                                    statement_to: stmt.to,
                                    statement_subject: stmt.subject,
                                    statement_date: formatDate(stmt.date),
                                });
                            }
                        });
                        const ws = window.XLSX.utils.json_to_sheet(flattenedItems);
                        window.XLSX.utils.book_append_sheet(wb, ws, 'Statements');
                    }

                    window.XLSX.writeFile(wb, `qbg_dashboard_export_${new Date().toISOString().split('T')[0]}.xlsx`);

                } catch (error) {
                    console.error("Excel Export failed:", error);
                    alert("An error occurred during the Excel export. Check the console for details.");
                } finally {
                    setIsExportingExcel(false);
                }
            }
        });
    };

    const excelImportRef = useRef(null);
    const [isImportingExcel, setIsImportingExcel] = useState(false);

    const handleImportExcel = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!window.XLSX) {
            alert("Excel import library is not ready. Please try again in a moment.");
            return;
        }

        try {
            const data = await file.arrayBuffer();
            const workbook = window.XLSX.read(data);

            setConfirmAction({
                title: 'Import All Data from Excel',
                message: `This will import data from Excel and MERGE it with existing data. Entries with matching IDs will be updated. Continue?`,
                confirmText: 'Yes, Import & Merge',
                type: 'import',
                action: async () => {
                    setIsImportingExcel(true);
                    try {
                        const collectionMappings = {
                            'Al Marri Employees': 'alMarriData',
                            'Al Marri Employee PnL': 'alMarriEmployeePnl',
                            'Al Marri Vehicles': 'alMarriVehicles',
                            'Al Marri WPS': 'alMarriWps',
                            'Al Marri Bank': 'alMarriBank',
                            'Al Marri Audit': 'alMarriAudit',
                            'Al Marri Documents': 'alMarriDocuments',
                            'Al Marri Credentials': 'alMarriCredentials',
                            'Al Marri Reminders': 'alMarriReminders',
                            'Al Marri Others': 'alMarriOthers',
                            'Al Marri Cheques': 'alMarriCheques',
                            'Fathoom Employees': 'fathoomData',
                            'Fathoom Employee PnL': 'fathoomEmployeePnl',
                            'Fathoom Vehicles': 'fathoomVehicles',
                            'Fathoom WPS': 'fathoomWps',
                            'Fathoom Bank': 'fathoomBank',
                            'Fathoom Audit': 'fathoomAudit',
                            'Fathoom Documents': 'fathoomDocuments',
                            'Fathoom Credentials': 'fathoomCredentials',
                            'Fathoom Reminders': 'fathoomReminders',
                            'Fathoom Others': 'fathoomOthers',
                            'Fathoom Cheques': 'fathoomCheques',
                            'Business Al Marri': 'business_almarri',
                            'Business Fathoom': 'business_fathoom',
                            'Business Recruitments': 'business_recruitments',
                            'Business Vehicles': 'business_vehicles',
                            'Business Transportation': 'business_transportation',
                            'Ledger': 'ledgerQatar',
                            'Ledger Favorites': 'ledgerFavorites',
                            'Debts & Credits': 'debts_credits',
                            'Settled Debts-Credits': 'debts_credits_settled',
                            'Bad Debts': 'bad_debts',
                            'Visa Entries': 'visa_entries',
                            'Visa PnL': 'visa_pnl',
                            'Vision Notes': 'visionNotes',
                            'Statements': 'statements'
                        };

                        for (const [sheetName, collectionPath] of Object.entries(collectionMappings)) {
                            if (!workbook.SheetNames.includes(sheetName)) continue;

                            const worksheet = workbook.Sheets[sheetName];
                            const jsonData = window.XLSX.utils.sheet_to_json(worksheet);
                            
                            if (jsonData.length === 0) continue;

                            const collectionRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionPath}`);

                            // Handle Statements special case (flattened structure in Excel)
                            if (collectionPath === 'statements') {
                                const statementsMap = {};
                                jsonData.forEach(row => {
                                    const stmtId = row['statement_id'];
                                    if (!statementsMap[stmtId]) {
                                        statementsMap[stmtId] = {
                                            to: row['statement_to'] || '',
                                            subject: row['statement_subject'] || '',
                                            date: parseDateForFirestore(row['statement_date']) || new Date(),
                                            invoiceItems: []
                                        };
                                    }
                                    if (row['item_description']) {
                                        statementsMap[stmtId].invoiceItems.push({
                                            date: parseDateForFirestore(row['item_date']) || new Date(),
                                            description: row['item_description'] || '',
                                            invoiceNo: row['item_invoiceNo'] || '',
                                            debit: Number(row['item_debit']) || 0,
                                            credit: Number(row['item_credit']) || 0
                                        });
                                    }
                                });

                                // Use batch writes for statements too
                                const batch = writeBatch(db);
                                for (const [stmtId, stmtData] of Object.entries(statementsMap)) {
                                    batch.set(doc(collectionRef, stmtId), stmtData, { merge: true });
                                }
                                await batch.commit();
                                console.log(`${sheetName}: Imported ${Object.keys(statementsMap).length} entries`);
                            } else {
                                // Standard import for other collections using BATCH WRITES (much faster!)
                                let importedCount = 0;
                                let batch = writeBatch(db);
                                let batchCount = 0;
                                const BATCH_SIZE = 500; // Firestore batch limit
                                
                                for (const row of jsonData) {
                                    const { id, ...rowData } = row;
                                    const processedData = {};
                                    
                                    for (const key in rowData) {
                                        const value = rowData[key];
                                        // Try to parse dates
                                        if (key.toLowerCase().includes('date') || key === 'createdAt') {
                                            processedData[key] = parseDateForFirestore(value) || value;
                                        } else if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
                                            // Try to parse JSON strings back to objects/arrays
                                            try {
                                                processedData[key] = JSON.parse(value);
                                            } catch {
                                                processedData[key] = value;
                                            }
                                        } else {
                                            processedData[key] = value;
                                        }
                                    }

                                    if (id) {
                                        // Update existing entry with this ID
                                        batch.set(doc(collectionRef, id), processedData, { merge: true });
                                    } else {
                                        // Create new entry with auto-generated ID
                                        batch.set(doc(collectionRef), processedData);
                                    }
                                    
                                    batchCount++;
                                    importedCount++;
                                    
                                    // Commit batch when we reach limit
                                    if (batchCount >= BATCH_SIZE) {
                                        await batch.commit();
                                        batch = writeBatch(db);
                                        batchCount = 0;
                                    }
                                }
                                
                                // Commit remaining items in batch
                                if (batchCount > 0) {
                                    await batch.commit();
                                }
                                
                                console.log(`${sheetName}: Imported ${importedCount} entries`);
                            }
                        }

                        alert('Excel import successful! Data has been merged with existing records.');
                    } catch (error) {
                        console.error('Excel import process failed:', error);
                        alert(`Import failed: ${error.message}`);
                    } finally {
                        setIsImportingExcel(false);
                    }
                }
            });
        } catch (error) {
            console.error('Failed to read Excel file:', error);
            alert(`Failed to read Excel file: ${error.message}`);
        } finally {
            e.target.value = '';
        }
    };

    const triggerExcelImport = () => {
        excelImportRef.current?.click();
    };

    // --- Chart Data State ---
    const [allBusinessData, setAllBusinessData] = useState([]);
    const [ledgerData, setLedgerData] = useState([]);
    const [loadingCharts, setLoadingCharts] = useState(true);

    // --- Chart Filters State ---
    const [view, setView] = useState('all');
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());

    // --- Chart Data Fetching ---
    useEffect(() => {
        if (!userId || appId === 'default-app-id') {
            setLoadingCharts(false);
            return;
        }

        const fetchData = async () => {
            setLoadingCharts(true);
            const businessCollections = [
                { name: 'Al Marri', path: 'business_almarri' },
                { name: 'Fathoom', path: 'business_fathoom' },
                { name: 'Recruitments', path: 'business_recruitments' },
                { name: 'Vehicles', path: 'business_vehicles' },
                { name: 'Transportation', path: 'business_transportation' },
            ];

            try {
                // Fetch custom business sections and add them to the list
                const customSectionsRef = collection(db, `artifacts/${appId}/users/${userId}/business_sections`);
                const customSectionsSnapshot = await getDocs(customSectionsRef);
                customSectionsSnapshot.forEach(doc => {
                    const section = doc.data();
                    if(section.title && section.collectionPath) {
                        businessCollections.push({ name: section.title, path: section.collectionPath });
                    }
                });

                const businessPromises = businessCollections.map(async (coll) => {
                    const collRef = collection(db, `artifacts/${appId}/users/${userId}/${coll.path}`);
                    const snapshot = await getDocs(collRef);
                    return snapshot.docs.map(doc => ({ ...doc.data(), business_source: coll.name }));
                });
    
                const ledgerPromise = getDocs(collection(db, `artifacts/${appId}/users/${userId}/ledgerQatar`));
                
                 const [ledgerSnapshot, ...businessResults] = await Promise.all([ledgerPromise, ...businessPromises]);
                setLedgerData(ledgerSnapshot.docs.map(doc => doc.data()));
                setAllBusinessData(businessResults.flat());
            } catch (error) {
                console.error("Error fetching chart data:", error);
            }

            setLoadingCharts(false);
        };

        fetchData();
    }, [userId, appId]);

    // --- Memoized Calculations for Filtered Data ---
    const { filteredBusinessData, filteredLedgerData, availableYears } = useMemo(() => {
        const allData = [...allBusinessData, ...ledgerData];
        const years = [...new Set(allData.map(e => getDateFromField(e.date)?.getFullYear()))].filter(Boolean).sort((a,b) => b-a);

        const filterFunction = (e) => {
            const date = getDateFromField(e.date);
            if (!date) return false;
            if (view === 'yearly' && date.getFullYear() !== selectedYear) return false;
            if (view === 'monthly' && (date.getFullYear() !== selectedYear || date.getMonth() !== selectedMonth)) return false;
            return true;
        };
        
        return {
            filteredBusinessData: allBusinessData.filter(filterFunction),
            filteredLedgerData: ledgerData.filter(filterFunction),
            availableYears: years,
        };
    }, [allBusinessData, ledgerData, view, selectedYear, selectedMonth]);

    // --- Chart-Specific Data Processing ---

    // Chart 1: Business Comparison Data
    const businessComparisonData = useMemo(() => {
        const profitByBusiness = filteredBusinessData.reduce((acc, entry) => {
            const source = entry.business_source || 'Unknown';
            if (!acc[source]) acc[source] = 0;
            acc[source] += (entry.income || 0) - (entry.expense || 0);
            return acc;
        }, {});

        return {
            labels: Object.keys(profitByBusiness),
            datasets: [{
                label: 'Net Profit (QAR)',
                data: Object.values(profitByBusiness),
                backgroundColor: ['#14B8A6', '#3B82F6', '#8B5CF6', '#FBBF24', '#EF4444', '#EC4899'],
                borderRadius: 4,
            }]
        };
    }, [filteredBusinessData]);

    // Chart 2: Company Growth Data
    const companyGrowthData = useMemo(() => {
        const monthlyProfit = { 'Al Marri': {}, 'Fathoom': {} };
        const dataToProcess = allBusinessData.filter(e => e.business_source === 'Al Marri' || e.business_source === 'Fathoom');

        dataToProcess.forEach(entry => {
            const date = getDateFromField(entry.date);
            if (!date) return;
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (!monthlyProfit[entry.business_source][key]) monthlyProfit[entry.business_source][key] = 0;
            monthlyProfit[entry.business_source][key] += (entry.income || 0) - (entry.expense || 0);
        });

        const allMonths = [...new Set([...Object.keys(monthlyProfit['Al Marri']), ...Object.keys(monthlyProfit['Fathoom'])])].sort();
        
        const labels = allMonths.filter(key => {
             if (view === 'all') return true;
             if(view === 'yearly' && key.startsWith(selectedYear)) return true;
             if(view === 'monthly') {
                 const monthKey = `${selectedYear}-${String(selectedMonth + 1).padStart(2,'0')}`;
                 return key === monthKey;
             }
             return false;
        });

        return {
            labels,
            datasets: [
                { label: 'Al Marri', data: labels.map(label => monthlyProfit['Al Marri'][label] || 0), borderColor: '#14B8A6', backgroundColor: '#14B8A620', tension: 0.2, fill: true },
                { label: 'Fathoom', data: labels.map(label => monthlyProfit['Fathoom'][label] || 0), borderColor: '#3B82F6', backgroundColor: '#3B82F620', tension: 0.2, fill: true }
            ]
        };
    }, [allBusinessData, view, selectedYear, selectedMonth]);

    // Chart 3: Income vs Expense Pie Chart
    const incomeExpenseData = useMemo(() => {
        const totals = filteredLedgerData.reduce((acc, entry) => {
            if (entry.mainCategory === 'Income') acc.income += entry.credit || 0;
            if (entry.mainCategory === 'Expenses') acc.expense += entry.debit || 0;
            return acc;
        }, { income: 0, expense: 0 });

        return {
            labels: ['Total Income', 'Total Expenses'],
            datasets: [{ data: [totals.income, totals.expense], backgroundColor: ['#10B981', '#EF4444'], borderColor: '#1f2937', borderWidth: 2 }]
        };
    }, [filteredLedgerData]);

    // Chart 4: Expense Breakdown Donut Chart
    const expenseBreakdownData = useMemo(() => {
        const expenseByCategory = filteredLedgerData
            .filter(e => e.mainCategory === 'Expenses' && e.debit > 0)
            .reduce((acc, entry) => {
                const subCat = entry.subCategory || 'Uncategorized';
                if (!acc[subCat]) acc[subCat] = 0;
                acc[subCat] += entry.debit || 0;
                return acc;
            }, {});
        
        return {
            labels: Object.keys(expenseByCategory),
            datasets: [{ data: Object.values(expenseByCategory), backgroundColor: ['#EF4444', '#F97316', '#F59E0B', '#84CC16', '#22C55E', '#14B8A6', '#06B6D4', '#3B82F6', '#8B5CF6', '#D946EF'], borderColor: '#1f2937', borderWidth: 2 }]
        };
    }, [filteredLedgerData]);

    const ChartFilters = () => (
        <div className="flex items-center space-x-2 flex-wrap gap-2">
            <div className="flex items-center space-x-1 dark:bg-gray-700 bg-gray-200 p-1 rounded-lg border dark:border-gray-600 border-gray-300">
                <button onClick={() => setView('all')} className={`px-3 py-1 text-xs rounded-md ${view === 'all' ? 'bg-cyan-600 text-white' : 'dark:text-gray-300 text-gray-700 dark:hover:bg-gray-600 hover:bg-gray-300'}`}>All</button>
                <button onClick={() => setView('yearly')} className={`px-3 py-1 text-xs rounded-md ${view === 'yearly' ? 'bg-cyan-600 text-white' : 'dark:text-gray-300 text-gray-700 dark:hover:bg-gray-600 hover:bg-gray-300'}`}>Yearly</button>
                <button onClick={() => setView('monthly')} className={`px-3 py-1 text-xs rounded-md ${view === 'monthly' ? 'bg-cyan-600 text-white' : 'dark:text-gray-300 text-gray-700 dark:hover:bg-gray-600 hover:bg-gray-300'}`}>Monthly</button>
            </div>
            {view !== 'all' && (
                <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} className="p-1 dark:bg-gray-700 bg-gray-200 rounded-md text-xs dark:text-white text-gray-800 border dark:border-gray-600 border-gray-300">
                    {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
            )}
            {view === 'monthly' && (
                 <select value={selectedMonth} onChange={e => setSelectedMonth(Number(e.target.value))} className="p-1 dark:bg-gray-700 bg-gray-200 rounded-md text-xs dark:text-white text-gray-800 border dark:border-gray-600 border-gray-300">
                    {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => <option key={m} value={i}>{m}</option>)}
                </select>
            )}
        </div>
    );

    const ChartCard = ({ title, children }) => (
        <div className="dark:bg-gray-800 bg-white p-4 sm:p-6 rounded-lg border-l-4 border-yellow-500">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-4 gap-2">
                <h3 className="text-lg sm:text-xl font-bold whitespace-nowrap">{title}</h3>
                <ChartFilters />
            </div>
            <div className="h-80 relative">
                {loadingCharts ? <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin mr-2" /> Loading Chart Data...</div> : children}
            </div>
        </div>
    );
    
    const commonChartOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#e5e7eb' } } } };
    const axisChartOptions = { ...commonChartOptions, scales: { y: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } }, x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } } } };

    const handleGenerateAnalysis = async () => { setIsLoadingAi(true); setTimeout(() => { setAiAnalysis("AI analysis indicates strong growth in the mutual fund sector. Consider diversifying into real estate to mitigate risks. Company cash flow appears healthy, showing high confidence. Next steps should involve exploring new markets in the GCC region."); setIsLoadingAi(false); }, 2000); };
    
    const handleDownloadPdfClick = async () => {
        setIsDownloading(true);
        await onDownloadReport();
        setIsDownloading(false);
    };

    const handleExportAllData = async () => {
        setConfirmAction({
            title: 'Confirm Data Export',
            message: 'This will export all your dashboard data into a single JSON file. This process may take a moment. Please keep this file safe.',
            confirmText: 'Export',
            type: 'save',
            action: async () => {
                setIsExporting(true);
                // Define all collections and single documents to be part of the export
                const collectionsToExport = [
                    // Al Marri
                    'alMarriData', 'alMarriVehicles', 'alMarriWps', 'alMarriBank', 'alMarriAudit', 'alMarriDocuments', 'alMarriCredentials', 'alMarriReminders', 'alMarriOthers', 'alMarriEmployeePnl', 'alMarriCheques',
                    // Fathoom
                    'fathoomData', 'fathoomVehicles', 'fathoomWps', 'fathoomBank', 'fathoomAudit', 'fathoomDocuments', 'fathoomCredentials', 'fathoomReminders', 'fathoomOthers', 'fathoomEmployeePnl', 'fathoomCheques',
                    // Business (predefined)
                    'business_almarri', 'business_fathoom', 'business_recruitments', 'business_vehicles', 'business_transportation', 'business_sections',
                    // Ledger & Debts
                    'ledgerQatar', 'ledgerFavorites',
                    'debts_credits', 'debts_credits_settled', 'bad_debts',
                    // Other main pages
                    'statements',
                    'visionNotes',
                    'visa_entries', 'visa_pnl',
                ];
                const singleDocsToExport = [
                    { path: `settings/app_settings` },
                    { path: `settings/passcode` },
                    { path: `settings/businessDescriptions` },
                    { path: `ledgerSettings/defaultSubCategories` },
                    { path: `vision/main` },
                    // --- ADDED MISSING SETTINGS DOCS ---
                    { path: `employeeSettings/alMarriData` },
                    { path: `employeeSettings/fathoomData` },
                    { path: `visaSettings/tickedItems` },
                    { path: `businessSettings/tickedEntries` },
                    { path: `ledgerSettings/pinnedEntries` },
                    { path: `ledgerSettings/tickedEntries` },
                    // --- END OF ADDITIONS ---
                ];
    
                const allData = {};
    
                try {
                    // Dynamically add custom business section collections to the export list
                    const customSectionsRef = collection(db, `artifacts/${appId}/users/${userId}/business_sections`);
                    const customSectionsSnapshot = await getDocs(customSectionsRef);
                    customSectionsSnapshot.forEach(doc => {
                        const sectionData = doc.data();
                        if (sectionData.collectionPath && !collectionsToExport.includes(sectionData.collectionPath)) {
                            collectionsToExport.push(sectionData.collectionPath);
                        }
                    });

                    // Export main collections
                    for (const collectionName of collectionsToExport) {
                        const collRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionName}`);
                        const snapshot = await getDocs(collRef);
                        allData[collectionName] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
                        // Special handling for employee document sub-collections
                        if (collectionName === 'alMarriData' || collectionName === 'fathoomData') {
                            for (const empDoc of allData[collectionName]) {
                                const subCollRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionName}/${empDoc.id}/documents`);
                                const subSnapshot = await getDocs(subCollRef);
                                if (!subSnapshot.empty) {
                                    if (!empDoc._subCollections) empDoc._subCollections = {};
                                    empDoc._subCollections.documents = subSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                                }
                            }
                        }
                    }
                    
                    // Export standalone setting documents
                    for (const docInfo of singleDocsToExport) {
                         const docRef = doc(db, `artifacts/${appId}/users/${userId}/${docInfo.path}`);
                         const docSnap = await getDoc(docRef);
                         if (docSnap.exists()) {
                             const key = docInfo.path.replace(/\//g, '_'); // Create a flat key for the JSON object
                             allData[key] = { id: docSnap.id, ...docSnap.data() };
                         }
                    }
    
                    // Create a downloadable JSON file from the collected data
                    const jsonString = JSON.stringify(allData, null, 2);
                    const blob = new Blob([jsonString], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `qbg_dashboard_backup_${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    console.log("Export successful!");
    
                } catch (error) {
                    console.error("Export failed:", error);
                } finally {
                    setIsExporting(false);
                }
            }
        });
    };

    const handleImportFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
    
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                
                setConfirmAction({
                    title: 'DANGER: Confirm Data Import',
                    message: 'This will DELETE ALL current dashboard data and replace it with data from the file. This action cannot be undone. Are you absolutely sure you want to proceed?',
                    confirmText: 'Yes, Delete & Import',
                    type: 'delete',
                    action: async () => {
                        setIsImporting(true);
                        console.log("Starting import process...");
                        try {
                            // --- Step 1: Wipe existing data for collections and docs present in the import file ---
                            for (const key in importedData) {
                                if (Object.prototype.hasOwnProperty.call(importedData, key)) {
                                    if (Array.isArray(importedData[key])) { // It's a collection
                                        const collectionName = key;
                    const collRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionName}`);
                                        const snapshot = await getDocs(collRef);
                                        if (!snapshot.empty) {
                                            console.log(`Wiping ${snapshot.size} docs from ${collectionName}...`);
                                            // Handle wiping subcollections first if they exist (e.g., employee documents)
                                            if (collectionName === 'alMarriData' || collectionName === 'fathoomData') {
                                                for (const empDoc of snapshot.docs) {
                                                    const subCollRef = collection(db, empDoc.ref.path, 'documents');
                                                    const subSnapshot = await getDocs(subCollRef);
                                                    if(!subSnapshot.empty) {
                                                        const subBatch = writeBatch(db);
                                                        subSnapshot.forEach(subDoc => subBatch.delete(subDoc.ref));
                                                        await subBatch.commit();
                                                    }
                                                }
                                            }
                                            const batch = writeBatch(db);
                                            snapshot.docs.forEach(doc => batch.delete(doc.ref));
                                            await batch.commit();
                                        }
                                    } else { // It's a single document (e.g., settings)
                                        const docPath = key.replace(/_/g, '/');
                                        const docRef = doc(db, `artifacts/${appId}/users/${userId}/${docPath}`);
                                        await deleteDoc(docRef).catch(() => {}); // Ignore error if doc doesn't exist
                                    }
                                }
                            }
    
                            // --- Step 2: Import new data from the file ---
                            for (const key in importedData) {
                                const dataItems = importedData[key];
                                if (Array.isArray(dataItems)) { // This is a collection
                                    const collectionName = key;
                                    const batch = writeBatch(db);
                                    dataItems.forEach(item => {
                                        const { id, _subCollections, ...data } = item;
                                        const restoredData = restoreTimestamps(data);
                                        const docRef = doc(db, `artifacts/${appId}/users/${userId}/${collectionName}`, id);
                                        batch.set(docRef, restoredData);
                                    });
                                    await batch.commit();
    
                                    // Handle subcollections separately after main docs are created
                                    for(const item of dataItems) {
                                        if (item._subCollections) {
                                            for(const subCollName in item._subCollections) {
                                                const subCollItems = item._subCollections[subCollName];
                                                const subCollBatch = writeBatch(db);
                                                subCollItems.forEach(subItem => {
                                                    const { id: subId, ...subData } = subItem;
                                                    const restoredSubData = restoreTimestamps(subData);
                                                    const subDocRef = doc(db, `artifacts/${appId}/users/${userId}/${collectionName}/${item.id}/${subCollName}`, subId);
                                                    subCollBatch.set(subDocRef, restoredSubData);
                                                });
                                                await subCollBatch.commit();
                                            }
                                        }
                                    }
                                } else { // This is a single document
                                    const { id, ...data } = dataItems;
                                    const restoredData = restoreTimestamps(data);
                                    const docPath = key.replace(/_/g, '/');
                                    const docRef = doc(db, `artifacts/${appId}/users/${userId}/${docPath}`);
                                    await setDoc(docRef, restoredData);
                                }
                            }
                            
                            console.log("Import successful! Please reload the page to see the changes.");
                            alert("Import successful! The page will now reload.");
                            window.location.reload();
    
                        } catch (importError) {
                            console.error("Import failed:", importError);
                            alert("An error occurred during the import process. Check the console for details.");
                        } finally {
                            setIsImporting(false);
                        }
                    }
                });
    
            } catch (parseError) {
                console.error("Error parsing JSON file:", parseError);
                alert("The selected file is not a valid JSON file.");
            }
            
            if (importFileInputRef.current) importFileInputRef.current.value = "";
        };
        reader.readAsText(file);
    };

    const triggerImport = () => {
        importFileInputRef.current?.click();
    };

    const handleClearAllData = () => {
        setConfirmAction({
            title: 'DANGER: CLEAR ALL DASHBOARD DATA',
            message: 'Are you absolutely, 100% sure? This will permanently delete ALL data from the entire dashboard (Employees, Vehicles, Ledger, Business, Visas, Settings, etc.). This action CANNOT BE UNDONE.',
            confirmText: 'Yes, Delete Everything',
            type: 'delete',
            action: async () => {
                setIsClearingData(true);
                console.log("Starting data wipe...");

                // Base collections
                const collectionsToWipe = [
                    'alMarriData', 'alMarriVehicles', 'alMarriWps', 'alMarriBank', 'alMarriAudit', 'alMarriDocuments', 'alMarriCredentials', 'alMarriCheques', 'alMarriReminders', 'alMarriOthers', 'alMarriEmployeePnl',
                    'fathoomData', 'fathoomVehicles', 'fathoomWps', 'fathoomBank', 'fathoomAudit', 'fathoomDocuments', 'fathoomCredentials', 'fathoomCheques', 'fathoomReminders', 'fathoomOthers', 'fathoomEmployeePnl',
                    'business_almarri', 'business_fathoom', 'business_recruitments', 'business_vehicles', 'business_transportation',
                    'ledgerQatar', 'ledgerFavorites',
                    'debts_credits', 'debts_credits_settled', 'bad_debts',
                    'statements',
                    'visionNotes',
                    'visa_entries', 'visa_pnl',
                ];
                
                // Single documents
                const singleDocsToWipe = [
                    'settings/app_settings',
                    'settings/passcode',
                    'settings/businessDescriptions',
                    'ledgerSettings/defaultSubCategories',
                    'vision/main'
                ];

                try {
                    // 1. Get and add custom business collections
                    const customSectionsRef = collection(db, `artifacts/${appId}/users/${userId}/business_sections`);
                    const customSectionsSnapshot = await getDocs(customSectionsRef);
                    customSectionsSnapshot.forEach(doc => {
                        const sectionData = doc.data();
                        if (sectionData.collectionPath) {
                            collectionsToWipe.push(sectionData.collectionPath);
                        }
                    });
                    collectionsToWipe.push('business_sections'); // Add the definition collection itself

                    // 2. Iterate and delete all docs in all collections
                    for (const collectionName of collectionsToWipe) {
                        if (!collectionName) continue; // Safety check for dynamic paths
                        const collRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionName}`);
                        const snapshot = await getDocs(collRef);
                        if (snapshot.empty) continue;
                        
                        console.log(`Wiping ${snapshot.size} docs from ${collectionName}...`);
                        
                        // Handle employee subcollections
                        if (collectionName === 'alMarriData' || collectionName === 'fathoomData') {
                            for (const empDoc of snapshot.docs) {
                                const subCollRef = collection(db, empDoc.ref.path, 'documents');
                                const subSnapshot = await getDocs(subCollRef);
                                if (!subSnapshot.empty) {
                                    const subBatch = writeBatch(db);
                                    subSnapshot.forEach(subDoc => subBatch.delete(subDoc.ref));
                                    await subBatch.commit();
                                }
                            }
                        }
                        
                        // Delete main collection docs in batches
                        const mainBatch = writeBatch(db);
                        snapshot.docs.forEach(doc => mainBatch.delete(doc.ref));
                        await mainBatch.commit();
                    }

                    // 3. Delete single setting documents
                    console.log("Wiping settings documents...");
                    for (const docPath of singleDocsToWipe) {
                        const docRef = doc(db, `artifacts/${appId}/users/${userId}/${docPath}`);
                        await deleteDoc(docRef).catch(e => console.warn(`Could not delete doc ${docPath}: ${e.message}`));
                    }

                    console.log("Data wipe complete.");
                    alert("All dashboard data has been permanently deleted. The page will now reload.");
                    window.location.reload();

                } catch (error) {
                    console.error("Data wipe failed:", error);
                    alert("An error occurred while clearing data. Check the console for details.");
                } finally {
                    setIsClearingData(false);
                }
            }
        });
    };

    return (
        <div className="space-y-8 p-4 sm:p-8 relative group">
            <nav className="dark:bg-gray-800/80 bg-white/80 backdrop-blur-sm p-2 flex justify-center items-center space-x-1 sm:space-x-2 sticky top-[70px] z-40 shadow-sm flex-wrap no-print">
                <button
                    onClick={() => setActiveVisionSubPage('charts')}
                    className={`flex items-center space-x-2 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all duration-200 ${
                        activeVisionSubPage === 'charts' ? 'bg-gradient-to-r from-green-500 to-yellow-500 text-white shadow-md' : 'dark:text-gray-300 text-gray-600 dark:hover:bg-gray-700 hover:bg-gray-200'
                    }`}
                >
                    <TrendingUp size={16}/>
                    <span>Charts</span>
                </button>
                <button
                    onClick={() => setActiveVisionSubPage('notes')}
                    className={`flex items-center space-x-2 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all duration-200 ${
                        activeVisionSubPage === 'notes' ? 'bg-gradient-to-r from-green-500 to-yellow-500 text-white shadow-md' : 'dark:text-gray-300 text-gray-600 dark:hover:bg-gray-700 hover:bg-gray-200'
                    }`}
                >
                    <BookOpen size={16}/>
                    <span>Notes</span>
                </button>
                 <button
                    onClick={() => setActiveVisionSubPage('insights')}
                    className={`flex items-center space-x-2 px-3 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all duration-200 ${
                        activeVisionSubPage === 'insights' ? 'bg-gradient-to-r from-green-500 to-yellow-500 text-white shadow-md' : 'dark:text-gray-300 text-gray-600 dark:hover:bg-gray-700 hover:bg-gray-200'
                    }`}
                >
                    <Settings size={16}/>
                    <span>Insights & Data</span>
                </button>
            </nav>

            {activeVisionSubPage === 'charts' && (
            <section>
                 <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                     <ChartCard title="Business Comparison (Profit)">
                         <Bar data={businessComparisonData} options={axisChartOptions} />
                     </ChartCard>
                     <ChartCard title="Company Growth (Profit)">
                          <Line data={companyGrowthData} options={axisChartOptions} />
                     </ChartCard>
                     <ChartCard title="Income vs Expense">
                         <Pie data={incomeExpenseData} options={commonChartOptions} />
                     </ChartCard>
                     <ChartCard title="Expense Breakdown">
                         <Doughnut data={expenseBreakdownData} options={commonChartOptions} />
                     </ChartCard>
                 </div>
            </section>
            )}

            {activeVisionSubPage === 'notes' && (
            <section className="dark:bg-gray-800 bg-white p-6 rounded-lg border-l-4 border-yellow-500">
                {/* --- MODIFIED H2 TO FLEX --- */}
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold">Notes</h2>
                    {/* --- NEW BUTTONS & FILE INPUT --- */}
                    <div className="flex items-center space-x-2 no-print">
                        <input
                            type="file"
                            ref={notesImportRef}
                            onChange={handleImportNotesChange}
                            className="hidden"
                            accept=".json,application/json"
                        />
                        <button onClick={handleExportNotes} disabled={isExportingNotes} title="Export Notes" className="group flex items-center space-x-2 px-4 py-2 dark:bg-green-700 bg-green-100 rounded-full dark:hover:bg-green-600 hover:bg-green-200 text-sm font-semibold transition-all duration-300 disabled:opacity-50 border dark:border-green-600 border-green-300 dark:text-white text-green-700 shadow-md hover:shadow-lg hover:scale-105">
                            {isExportingNotes ? <Loader2 size={16} className="animate-spin" /> : <Download size={16}/>}
                            <span>{isExportingNotes ? 'Exporting...' : 'Export Notes'}</span>
                        </button>
                        <button onClick={triggerImportNotes} disabled={isImportingNotes} title="Import Notes" className="group flex items-center space-x-2 px-4 py-2 dark:bg-blue-700 bg-blue-100 rounded-full dark:hover:bg-blue-600 hover:bg-blue-200 text-sm font-semibold transition-all duration-300 disabled:opacity-50 border dark:border-blue-600 border-blue-300 dark:text-white text-blue-700 shadow-md hover:shadow-lg hover:scale-105">
                            {isImportingNotes ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16}/>}
                            <span>{isImportingNotes ? 'Importing...' : 'Import Notes'}</span>
                        </button>
                    </div>
                    {/* --- END NEW --- */}
                </div>
                {/* --- END MODIFICATION --- */}
                <div className="flex flex-col md:flex-row gap-6">
                    
                    {/* Left Column: Add Note & Note List */}
                    <div className="w-full md:w-1/3 lg:w-1/4 flex-shrink-0">
                        {/* Add Note Form */}
                        <div className="mb-6">
                            <textarea
                                value={newNote}
                                onChange={(e) => setNewNote(e.target.value)}
                                placeholder="Add a new note..."
                                rows="3"
                                className="w-full p-2 dark:bg-gray-700 bg-gray-200 rounded-md dark:text-white text-gray-800 border dark:border-gray-600 border-gray-300"
                            />
                            <button onClick={handleAddNote} className="w-full mt-2 px-4 py-2 bg-cyan-500 rounded-md text-white hover:bg-cyan-600">
                                Add Note
                            </button>
                        </div>
                        
                        {/* Note List */}
                        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                            {notes.length === 0 && (
                                <p className="text-gray-500 text-sm text-center p-4">No notes yet.</p>
                            )}
                            {notes.map(note => (
                                <button
                                    key={note.id}
                                    onClick={() => setSelectedNote(note)}
                                    className={`w-full text-left p-3 rounded-lg transition-colors ${selectedNote?.id === note.id ? 'bg-cyan-600 text-white shadow-lg' : 'dark:bg-gray-700/50 bg-gray-100/50 dark:hover:bg-gray-700 hover:bg-gray-200'}`}
                                >
                                    <p className="font-semibold truncate">{note.text.split('\n')[0] || 'Untitled Note'}</p>
                                    <p className={`text-xs ${selectedNote?.id === note.id ? 'text-cyan-100' : 'text-gray-500'}`}>{formatDate(note.createdAt)}</p>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Right Column: Note Content */}
                    <div className="flex-grow">
                        {selectedNote ? (
                            <div className="dark:bg-gray-700/50 bg-gray-100/50 p-4 rounded-lg min-h-[50vh]">
                                {isEditingNote ? (
                                    <div className="flex flex-col gap-2 h-full">
                                        <textarea
                                            value={editNoteText}
                                            onChange={(e) => setEditNoteText(e.target.value)}
                                            className="w-full flex-grow p-2 bg-gray-700 rounded-md resize-none min-h-[200px]"
                                        />
                                        <div className="flex items-center justify-end space-x-2">
                                            <button onClick={() => setIsEditingNote(false)} className="px-4 py-2 bg-gray-600 text-sm rounded-md hover:bg-gray-500">Cancel</button>
                                            <button onClick={() => { handleUpdateNote(selectedNote.id, editNoteText); setIsEditingNote(false); }} className="px-4 py-2 bg-cyan-500 text-sm rounded-md hover:bg-cyan-600">Save</button>
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <div className="flex justify-between items-center mb-2">
                                            <p className="text-sm text-gray-400">{formatDate(selectedNote.createdAt)}</p>
                                            <div className="flex items-center space-x-2">
                                                <button onClick={() => setIsEditingNote(true)} className="p-2 hover:text-cyan-400" title="Edit Note"><Edit size={16} /></button>
                                                <button onClick={() => {handleDeleteNoteRequest(selectedNote.id); setSelectedNote(null);}} className="p-2 hover:text-red-400" title="Delete Note"><Trash2 size={16} /></button>
                                            </div>
                                        </div>
                                        <div className="prose prose-invert max-w-none whitespace-pre-wrap">
                                            {selectedNote.text}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-full min-h-[50vh] text-gray-500">
                                <p>Select a note from the left to view or edit.</p>
                            </div>
                        )}
                    </div>
                </div>
            </section>
            )}

            {activeVisionSubPage === 'insights' && (
            <section className="dark:bg-gray-800 bg-white p-6 rounded-lg no-print border-l-4 border-yellow-500">
                <h2 className="text-2xl font-bold mb-6">Data Management</h2>
                
                {/* Bulk Export/Import (Excel) */}
                <div className="mb-8">
                    <h3 className="text-lg font-semibold mb-2 text-cyan-400">Bulk Export/Import (Excel)</h3>
                    <p className="text-gray-400 mb-4 text-sm">Export all dashboard data to Excel or import from Excel. This includes all pages and sections (Employees, Vehicles, Business, Ledger, etc.).</p>
                    <div className="flex items-center gap-4 flex-wrap">
                        <button onClick={handleExportExcel} disabled={isExportingExcel || isExporting || isImporting || isImportingExcel || isClearingData} className="group flex items-center space-x-2 px-5 py-2.5 dark:bg-green-700 bg-green-100 rounded-full dark:hover:bg-green-600 hover:bg-green-200 transition-all duration-300 disabled:opacity-50 border dark:border-green-600 border-green-300 dark:text-white text-green-700 shadow-md hover:shadow-lg hover:scale-105 font-semibold">
                            {isExportingExcel ? <Loader2 size={18} className="animate-spin" /> : <FileCheck2 size={18}/>}
                            <span>{isExportingExcel ? 'Exporting to Excel...' : 'Export All as Excel'}</span>
                        </button>
                        <button onClick={triggerExcelImport} disabled={isImportingExcel || isExportingExcel || isExporting || isImporting || isClearingData} className="group flex items-center space-x-2 px-5 py-2.5 dark:bg-blue-700 bg-blue-100 rounded-full dark:hover:bg-blue-600 hover:bg-blue-200 transition-all duration-300 disabled:opacity-50 border dark:border-blue-600 border-blue-300 dark:text-white text-blue-700 shadow-md hover:shadow-lg hover:scale-105 font-semibold">
                            {isImportingExcel ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18}/>}
                            <span>{isImportingExcel ? 'Importing from Excel...' : 'Import from Excel'}</span>
                        </button>
                        <input
                            type="file"
                            ref={excelImportRef}
                            onChange={handleImportExcel}
                            className="hidden"
                            accept=".xlsx,.xls"
                        />
                    </div>
                </div>

                {/* Separator */}
                <div className="border-t dark:border-gray-700 border-gray-300 my-6"></div>

                {/* Other Actions */}
                <div>
                    <h3 className="text-lg font-semibold mb-2 text-orange-400">Other Actions</h3>
                    <div className="flex items-center gap-4 flex-wrap">
                        <button onClick={handleDownloadPdfClick} disabled={isDownloading || isClearingData} className="flex items-center space-x-2 px-4 py-2 dark:bg-red-600 bg-red-100 rounded-md dark:hover:bg-red-700 hover:bg-red-200 transition-colors disabled:bg-gray-500 border dark:border-red-600 border-red-300 dark:text-white text-red-700">
                            {isDownloading ? <Loader2 className="animate-spin" /> : <FileText size={18} />}
                            <span>{isDownloading ? 'Generating PDF...' : 'Download PDF Report'}</span>
                        </button>
                        <button onClick={handleClearAllData} disabled={isClearingData || isImporting || isExporting || isImportingExcel || isExportingExcel} className="flex items-center space-x-2 px-4 py-2 dark:bg-red-700 bg-red-100 rounded-md dark:hover:bg-red-800 hover:bg-red-200 transition-colors disabled:bg-gray-500 border dark:border-red-600 border-red-300 dark:text-white text-red-700">
                            {isClearingData ? <Loader2 className="animate-spin" /> : <AlertTriangle size={18}/>}
                            <span>{isClearingData ? 'Clearing Data...' : 'Clear All Data'}</span>
                        </button>
                    </div>
                </div>
            </section>
            )}
            
        </div>
    );
};

const NavigationSettingsModal = ({ userId, appId, onClose }) => {
    const [settings, setSettings] = useState({ navLinks: {}, subNavLinks: {} });
    const settingsRef = useMemo(() => doc(db, `artifacts/${appId}/users/${userId}/settings/app_settings`), [appId, userId]);

    const defaultNavs = {
        navLinks: [
            { id: 'al_marri', title: 'CO1' },
            { id: 'fathoom', title: 'CO2' },
            { id: 'visa', title: 'RCRT' },
            { id: 'business', title: 'BS1' },
            { id: 'ledger', title: 'Ledger' },
            { id: 'finReport', title: 'Financial Report' },
            { id: 'debts_credits', title: 'DB6' },
            { id: 'statements', title: 'Statements' },
            { id: 'vision', title: 'Vision' },
            { id: 'notification', title: 'Notification' }
        ],
        subNavLinks: [ { id: 'employees', title: 'Employees' }, { id: 'vehicles', title: 'Vehicles' }, { id: 'wps', title: 'WPS Status' }, { id: 'bank', title: 'Bank' }, { id: 'audit', title: 'Audit Reports' }, { id: 'credentials', title: 'Credentials' }, { id: 'others', title: 'Others' } ]
    };

    useEffect(() => {
        const unsub = onSnapshot(settingsRef, (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                setSettings({
                    navLinks: data.navLinks || {},
                    subNavLinks: data.subNavLinks || {}
                });
            }
        });
        return unsub;
    }, [settingsRef]);

    const handleSave = async () => {
        await setDoc(settingsRef, {
            navLinks: settings.navLinks,
            subNavLinks: settings.subNavLinks
        }, { merge: true });
        onClose();
    };

    const handleNavChange = (id, newTitle) => {
        setSettings(prev => ({
            ...prev,
            navLinks: { ...prev.navLinks, [id]: { title: newTitle } }
        }));
    };

    const handleSubNavChange = (id, newTitle) => {
        setSettings(prev => ({
            ...prev,
            subNavLinks: { ...prev.subNavLinks, [id]: { title: newTitle } }
        }));
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-[101] p-4">
            <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-2xl font-bold">Navigation Settings</h3>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700"><X/></button>
                </div>
                <div className="overflow-y-auto space-y-6">
                    <section>
                        <h4 className="text-xl font-semibold mb-3 text-cyan-400">Main Navigation</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {defaultNavs.navLinks.map(link => (
                                <div key={link.id}>
                                    <label className="text-sm text-gray-400">{link.title} (Default)</label>
                                    <input type="text" value={settings.navLinks[link.id]?.title || ''} onChange={(e) => handleNavChange(link.id, e.target.value)} placeholder={link.title} className="w-full p-2 bg-gray-700 rounded-md"/>
                                </div>
                            ))}
                        </div>
                    </section>
                     <section>
                        <h4 className="text-xl font-semibold mb-3 text-cyan-400">Sub Navigation</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                           {defaultNavs.subNavLinks.map(link => (
                                <div key={link.id}>
                                    <label className="text-sm text-gray-400">{link.title} (Default)</label>
                                    <input type="text" value={settings.subNavLinks[link.id]?.title || ''} onChange={(e) => handleSubNavChange(link.id, e.target.value)} placeholder={link.title} className="w-full p-2 bg-gray-700 rounded-md"/>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
                <div className="flex justify-end space-x-2 mt-6 pt-4 border-t border-gray-700">
                    <button onClick={onClose} className="px-6 py-2 bg-gray-600 rounded-md">Cancel</button>
                    <button onClick={handleSave} className="px-6 py-2 bg-cyan-500 rounded-md">Save Settings</button>
                </div>
            </div>
        </div>
    );
};

const UniversalSearchModal = ({ userId, appId, onClose }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [results, setResults] = useState({});
    const [isLoading, setIsLoading] = useState(false);

    // This can be expanded. For now, it searches a few key collections.
    const searchConfig = useMemo(() => [
        { name: 'Al Marri Employees', path: `alMarriData`, fields: ['fullName', 'profession', 'qid', 'contact1'] },
        { name: 'Fathoom Employees', path: `fathoomData`, fields: ['fullName', 'profession', 'qid', 'contact1'] },
        { name: 'Visa Entries', path: `visa_entries`, fields: ['name', 'notes'] },
        { name: 'Ledger Entries', path: `ledgerQatar`, fields: ['particulars', 'subCategory'] }
    ], []);

    useEffect(() => {
        if (searchTerm.length < 3) {
            setResults({});
            return;
        }

        const debounce = setTimeout(() => {
            const performSearch = async () => {
                setIsLoading(true);
                const allResults = {};
                const searchTermLower = searchTerm.toLowerCase();

                for (const config of searchConfig) {
                    const collRef = collection(db, `artifacts/${appId}/users/${userId}/${config.path}`);
                    const q = query(collRef, limit(10)); // Simple query for now, can be expanded.
                    const snapshot = await getDocs(q);
                    
                    const collectionResults = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()})).filter(item => {
                        return config.fields.some(field => 
                            item[field] && String(item[field]).toLowerCase().includes(searchTermLower)
                        );
                    });

                    if(collectionResults.length > 0) {
                        allResults[config.name] = collectionResults;
                    }
                }
                setResults(allResults);
                setIsLoading(false);
            };
            performSearch();
        }, 500);

        return () => clearTimeout(debounce);
    }, [searchTerm, userId, appId, searchConfig]);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-start z-[101] p-4 pt-20">
            <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col">
                 <div className="flex justify-between items-center mb-6 flex-shrink-0">
                    <h3 className="text-2xl font-bold">Universal Search</h3>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-700"><X/></button>
                </div>
                <div className="relative mb-4 flex-shrink-0">
                    <input 
                        type="text" 
                        value={searchTerm} 
                        onChange={(e) => setSearchTerm(e.target.value)} 
                        placeholder="Search across all data..."
                        className="w-full p-3 pl-10 bg-gray-700 rounded-md text-lg"
                        autoFocus
                    />
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                </div>
                <div className="overflow-y-auto">
                    {isLoading && <div className="text-center p-8"><Loader2 className="animate-spin inline-block" /></div>}
                    {!isLoading && Object.keys(results).length === 0 && searchTerm.length >= 3 && (
                        <div className="text-center p-8 text-gray-500">No results found for "{searchTerm}".</div>
                    )}
                    {Object.entries(results).map(([category, items]) => (
                        <div key={category} className="mb-6">
                            <h4 className="text-lg font-semibold text-cyan-400 border-b border-gray-700 pb-2 mb-2">{category}</h4>
                            <ul className="space-y-2">
                                {items.map(item => (
                                    <li key={item.id} className="p-3 bg-gray-700/50 rounded-md">
                                        <p className="font-bold">{item.fullName || item.particulars || item.name}</p>
                                        <p className="text-sm text-gray-400">
                                            {item.profession && `Profession: ${item.profession} | `}
                                            {item.qid && `QID: ${item.qid} | `}
                                            {item.subCategory && `Category: ${item.subCategory}`}
                                            {item.notes && `Notes: ${item.notes}`}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

















































































































































































































































































































































// Register Chart.js components (Keep registration here, after imports but before use)
ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, Title, BarElement);

// ... rest of the code remains the same ...