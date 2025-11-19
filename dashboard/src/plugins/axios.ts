import axios from 'axios';

// Configure axios defaults
const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3001';

// Set the base URL for all axios requests
axios.defaults.baseURL = API_BASE_URL;

// Request interceptor to add auth token
axios.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('mxf_token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Response interceptor for error handling
axios.interceptors.response.use(
    (response) => response,
    (error) => {
        // Let the auth store handle 401 errors and logout logic
        // Don't automatically clear tokens or redirect here
        return Promise.reject(error);
    }
);

export default axios;
