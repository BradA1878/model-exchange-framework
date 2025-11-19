# MXF Dashboard

> ⚠️ **Status: In Development** - The MXF Dashboard is currently under active development. Some features may be incomplete or subject to change.

## Overview

The MXF Dashboard is a modern, responsive web application built with Vue 3, TypeScript, and Vuetify. It provides a comprehensive management interface for the Model Exchange Framework (MXF), enabling users to manage channels, agents, documents, analytics, and context data through an intuitive dashboard interface.

## 🚀 Features

### Core Functionality
- **Channel Management**: Create, view, and manage channels with real-time metrics
- **Agent Monitoring**: View agent performance and lifecycle management
- **Document Management**: Upload, organize, and manage documents across channels
- **Context Management**: Handle channel context data with full CRUD operations
- **Analytics Dashboard**: Real-time analytics with charts, metrics, and data export
- **User Account Management**: Profile management with magic link authentication
- **Validation Analytics**: Monitor validation success rates, error prevention, and system health
- **Auto-Correction Dashboard**: Track correction attempts, success patterns, and learning progress
- **Performance Optimization**: View bottlenecks, optimization recommendations, and system tuning
- **Error Prediction Monitoring**: ML model accuracy, prediction effectiveness, and risk assessment

### Technical Highlights
- **Full Backend Integration**: Complete backend API integration with zero mock data
- **Real-time Data**: Live updates from backend analytics and metrics
- **Error Handling**: Comprehensive error handling with user-friendly feedback
- **Loading States**: Professional loading indicators and skeleton loaders
- **Responsive Design**: Mobile-first responsive design with Vuetify components
- **Type Safety**: Full TypeScript integration throughout the application

## 🏗️ Architecture

### Frontend Stack
- **Vue 3**: Composition API with `<script setup>` pattern
- **TypeScript**: Full type safety and modern JavaScript features
- **Vuetify 3**: Material Design component library
- **Pinia**: State management for reactive data handling
- **Vue Router**: Client-side routing and navigation
- **Axios**: HTTP client for API communication
- **Vite**: Fast development server and build tool

### Project Structure
```
dashboard/
├── src/
│   ├── components/          # Reusable Vue components
│   ├── layouts/            # Layout components
│   ├── plugins/            # Vuetify and other plugin configurations
│   ├── router/             # Vue Router configuration
│   ├── stores/             # Pinia stores for state management
│   │   ├── analytics.ts    # Analytics data and charts
│   │   ├── auth.ts         # Authentication state
│   │   ├── channels.ts     # Channel management
│   │   ├── context.ts      # Context data management
│   │   ├── documents.ts    # Document management
│   │   ├── validation.ts   # Validation system monitoring
│   │   ├── correction.ts   # Auto-correction analytics
│   │   └── optimization.ts # Performance optimization data
│   ├── views/              # Page components
│   │   ├── analytics/      # Analytics pages (Data, Charts)
│   │   ├── channels/       # Channel pages (Context, Docs, Overview)
│   │   ├── validation/     # Validation monitoring pages
│   │   ├── correction/     # Auto-correction analytics pages
│   │   ├── optimization/   # Performance optimization pages
│   │   ├── Account.vue     # User account management
│   │   ├── Analytics.vue   # Analytics main page
│   │   ├── Channels.vue    # Channels main page
│   │   ├── Validation.vue  # Validation system dashboard
│   │   └── Dashboard.vue   # Main dashboard page
│   ├── App.vue             # Root application component
│   └── main.ts             # Application entry point
├── public/                 # Static assets
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── vite.config.ts          # Vite build configuration
└── README.md              # This documentation
```

## 🔧 Development

### Prerequisites
- Node.js >= 18.0.0
- npm or yarn

### Getting Started

1. **Install Dependencies**
   ```bash
   cd dashboard
   npm install
   ```

2. **Environment Configuration**
   Create `.env` file with:
   ```env
   VITE_API_BASE_URL=http://localhost:3001
   ```

3. **Development Server**
   ```bash
   npm run dev
   ```
   The dashboard will be available at `http://localhost:5173`

4. **Build for Production**
   ```bash
   npm run build
   ```

5. **Type Checking**
   ```bash
   npm run type-check
   ```

6. **Linting**
   ```bash
   npm run lint
   ```

## 🔌 API Integration

The dashboard integrates with the MXF backend API running on port 3001. All stores use real backend endpoints:

### Analytics API
- `GET /api/analytics/stats` - Analytics summary statistics  
- `GET /api/analytics/events` - Event data with filtering
- `GET /api/analytics/performance` - Performance metrics
- `GET /api/analytics/channels` - Channel activity data
- `GET /api/analytics/agents` - Agent metrics
- `GET /api/analytics/export/{type}` - Data export functionality

### Channels API  
- `GET /api/channels` - List all channels
- `POST /api/channels` - Create new channel
- `GET /api/channels/:id` - Get channel details
- `GET /api/analytics/channels/:id/activity` - Channel metrics

### Context API
- `GET /api/channels/:id/context` - Channel context data
- `POST /api/channels/:id/context` - Create context entry
- `PATCH /api/channels/:id/context` - Update/archive context

### Documents API
- `GET /api/documents` - List documents
- `POST /api/documents/upload` - Upload documents
- `GET /api/documents/:id` - Get document details

### Validation API
- `GET /api/validation/stats` - Validation system statistics
- `GET /api/validation/metrics` - Real-time validation metrics
- `GET /api/validation/performance` - Validation performance data
- `GET /api/validation/errors` - Error prevention analytics
- `POST /api/validation/config` - Update validation configuration

### Auto-Correction API
- `GET /api/correction/stats` - Auto-correction statistics
- `GET /api/correction/attempts` - Correction attempt history
- `GET /api/correction/patterns` - Learned correction patterns
- `GET /api/correction/success-rates` - Correction success analytics

### Optimization API
- `GET /api/optimization/bottlenecks` - Performance bottleneck analysis
- `GET /api/optimization/recommendations` - Optimization recommendations
- `GET /api/optimization/metrics` - Performance optimization metrics
- `POST /api/optimization/auto-tune` - Enable/configure auto-tuning

### Prediction API
- `GET /api/prediction/accuracy` - ML model accuracy metrics
- `GET /api/prediction/errors` - Error prediction analytics
- `GET /api/prediction/risk-scores` - Risk assessment data
- `GET /api/prediction/anomalies` - Anomaly detection results

### Authentication
- JWT tokens handled automatically via Axios interceptors
- Magic link authentication (no password management)

## 🎨 UI/UX Features

### Design System
- **Material Design 3**: Modern Google Material Design principles
- **Consistent Theming**: Unified color scheme and typography
- **Responsive Layout**: Adapts to mobile, tablet, and desktop
- **Dark/Light Mode**: Theme switching support

### User Experience
- **Loading States**: Skeleton loaders and progress indicators
- **Error Handling**: User-friendly error messages with snackbar notifications
- **Data Export**: CSV export functionality for analytics data
- **Real-time Updates**: Auto-refresh capabilities for live data
- **Form Validation**: Client-side validation with clear error feedback

## 📊 State Management

### Pinia Stores

1. **Analytics Store** (`stores/analytics.ts`)
   - Analytics stats, events, and chart data
   - Data export functionality
   - Auto-refresh capabilities

2. **Channels Store** (`stores/channels.ts`) 
   - Channel listing and management
   - Channel metrics and activity
   - Channel creation workflow

3. **Context Store** (`stores/context.ts`)
   - Context entry management
   - CRUD operations for context data
   - Context statistics and filtering

4. **Documents Store** (`stores/documents.ts`)
   - Document upload and management
   - File processing status
   - Document organization

5. **Auth Store** (`stores/auth.ts`)
   - User authentication state
   - Profile management
   - JWT token handling

6. **Validation Store** (`stores/validation.ts`)
   - Validation system health monitoring
   - Error prevention metrics
   - Validation performance analytics
   - Configuration management

7. **Correction Store** (`stores/correction.ts`)
   - Auto-correction attempt tracking
   - Pattern learning progress
   - Correction success analytics
   - Error recovery insights

8. **Optimization Store** (`stores/optimization.ts`)
   - Performance bottleneck analysis  
   - Optimization recommendation management
   - Auto-tuning configuration
   - System performance metrics

## 🔒 Security

### Authentication
- **Magic Link Authentication**: Secure, passwordless authentication
- **JWT Tokens**: Automatic token handling and refresh
- **Route Protection**: Protected routes requiring authentication
- **Session Management**: Automatic logout on token expiration

### Data Security
- **Input Validation**: Client-side validation for all forms
- **XSS Protection**: Vue.js built-in XSS protection
- **HTTPS Ready**: Production builds support HTTPS deployment
- **Environment Variables**: Sensitive configuration via environment variables

## 🚀 Deployment

### Production Build
```bash
npm run build
```

### Environment Variables
Set the following for production:
```env
VITE_API_BASE_URL=https://your-api-domain.com
```

### Hosting
The built application in `dist/` can be deployed to:
- Static hosting services (Netlify, Vercel, GitHub Pages)
- CDN + Object Storage (AWS S3 + CloudFront)
- Traditional web servers (Apache, Nginx)

## 🧪 Testing

### Development Testing
- Use the development server with `npm run dev`
- Test against local backend API on port 3001
- Browser developer tools for debugging
- Vue DevTools browser extension recommended

### Production Testing
- Build and serve with `npm run build && npm run preview`
- Test all API integrations with production backend
- Verify responsive design across devices
- Test authentication flows end-to-end

## 📝 Contributing

### Code Style
- **TypeScript**: All code uses TypeScript with strict typing
- **Vue 3 Composition API**: `<script setup>` pattern preferred
- **ESLint**: Automated linting with TypeScript rules
- **Arrow Functions**: Required for all function declarations
- **4-Space Indentation**: Consistent indentation throughout

### Component Structure
Vue components should follow this order:
```vue
<script setup>
// Component logic
</script>

<template>
  <!-- Component template -->
</template>

<style>
/* Component styles */
</style>
```

### Git Workflow
- Commit changes with descriptive messages
- Run `git add .` and `git commit -m "message"` after changes
- Ensure TypeScript compilation passes before commits

## 🐛 Troubleshooting

### Common Issues

1. **API Connection Errors**
   - Verify backend server is running on port 3001
   - Check `VITE_API_BASE_URL` in `.env` file
   - Verify network connectivity

2. **Authentication Issues**
   - Clear browser localStorage/sessionStorage
   - Check JWT token expiration
   - Verify magic link authentication setup

3. **Build Errors**
   - Run `npm run type-check` for TypeScript errors
   - Ensure all dependencies are installed
   - Check for ESLint errors with `npm run lint`

4. **Performance Issues**
   - Check browser developer tools Network tab
   - Verify API response times
   - Check for JavaScript errors in console

## 📞 Support

For issues and questions:
1. Check the troubleshooting section above
2. Review the main project README at repository root
3. Check the CHANGELOG.md for recent updates
4. Review API documentation for backend integration

## 📚 Key Features Explained

### Channel Management
Create and manage communication channels where agents collaborate:
- Channel creation with custom settings
- Real-time channel metrics and activity
- Context data management per channel
- Document organization by channel

### Agent Monitoring
Track and manage AI agents across the framework:
- Agent lifecycle status (online, offline, idle)
- Performance metrics per agent
- Agent configuration and capabilities
- Tool usage analytics

### Analytics Dashboard
Comprehensive analytics with multiple views:
- **Overview**: System-wide statistics and trends
- **Charts**: Visual representation of metrics
- **Data Export**: CSV export for external analysis
- **Real-time Updates**: Live data refresh capabilities

### Validation System Monitoring
Track validation system health and effectiveness:
- Validation success rates
- Error prevention metrics
- Configuration management
- Performance analytics

### Auto-Correction Analytics
Monitor auto-correction attempts and learning:
- Correction success patterns
- Pattern learning progress
- Error recovery insights
- Effectiveness tracking

### Performance Optimization
System performance monitoring and tuning:
- Bottleneck identification
- Optimization recommendations
- Auto-tuning configuration
- Performance metrics

## 🔗 Related Documentation

- [Main Project Documentation](../docs/index.md) - Complete MXF documentation
- [Getting Started Guide](../docs/getting-started.md) - Quick start tutorial
- [Dashboard Documentation](../docs/dashboard/index.md) - Detailed dashboard guide
- [API Documentation](../docs/api/index.md) - Backend API reference
- [SDK Documentation](../docs/sdk/index.md) - TypeScript SDK reference
- [CHANGELOG](../CHANGELOG.md) - Project change history
