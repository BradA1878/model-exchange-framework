/**
 * MXF Desktop — Application Entry Point
 *
 * Renders the root React component into the DOM. Applies the
 * default dark theme on load.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
