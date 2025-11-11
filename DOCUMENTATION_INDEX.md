# TimeKeeperDPGP Documentation Index

## Quick Navigation

### Start Here
- **New to the project?** Read [DOCUMENTATION_SUMMARY.md](DOCUMENTATION_SUMMARY.md) (5 min read)
- **Want full details?** Read [COMPREHENSIVE_DOCUMENTATION.md](COMPREHENSIVE_DOCUMENTATION.md) (30 min read)
- **Setting up locally?** Jump to [Section 10: Development Setup](COMPREHENSIVE_DOCUMENTATION.md#10-development-setup)

### By Role

**Race Control Admin/Marshal**
1. [Section 4.4: Race Control Panel](COMPREHENSIVE_DOCUMENTATION.md#44-race-control-panel) - How to use the control interface
2. [Section 2.1: Race Timing & Lap Logging](COMPREHENSIVE_DOCUMENTATION.md#21-race-timing--lap-logging) - Technical overview of timing
3. [Section 5: Database Schema](COMPREHENSIVE_DOCUMENTATION.md#5-database-schema) - Understand the data model

**Spectator/Public User**
1. [Section 1: Application Overview](COMPREHENSIVE_DOCUMENTATION.md#1-application-overview--purpose) - What is the app
2. [Section 4.5: Live Timing Board](COMPREHENSIVE_DOCUMENTATION.md#45-live-timing-board) - How to view live timing
3. [Section 4.6: Markets Page](COMPREHENSIVE_DOCUMENTATION.md#46-markets-page) - How to place bets

**Developer/Engineer**
1. [Section 3: Technical Architecture](COMPREHENSIVE_DOCUMENTATION.md#3-technical-architecture) - System design
2. [Section 5: Database Schema](COMPREHENSIVE_DOCUMENTATION.md#5-database-schema) - Data model reference
3. [Section 6: Key Services & Utilities](COMPREHENSIVE_DOCUMENTATION.md#6-key-services--utilities) - Code reference
4. [Section 7: Components Structure](COMPREHENSIVE_DOCUMENTATION.md#7-components-structure) - UI component reference
5. [Section 10: Development Setup](COMPREHENSIVE_DOCUMENTATION.md#10-development-setup) - Getting started locally

**DevOps/Infrastructure**
1. [Section 3.2: Backend Infrastructure](COMPREHENSIVE_DOCUMENTATION.md#32-backend-infrastructure) - Supabase setup
2. [Section 10: Development Setup](COMPREHENSIVE_DOCUMENTATION.md#10-development-setup) - Deployment instructions
3. [Environment Configuration](COMPREHENSIVE_DOCUMENTATION.md#35-environment-configuration) - Required env vars

### By Feature

**Race Control**
- [Race Timing & Lap Logging](COMPREHENSIVE_DOCUMENTATION.md#21-race-timing--lap-logging)
- [Live Timing Display](COMPREHENSIVE_DOCUMENTATION.md#22-live-timing-display)
- [Session Management](COMPREHENSIVE_DOCUMENTATION.md#23-session-management)
- [Track Status & Flag Control](COMPREHENSIVE_DOCUMENTATION.md#25-track-status--flag-control)
- [Race Control Panel Route](COMPREHENSIVE_DOCUMENTATION.md#44-race-control-panel)

**Betting**
- [Betting/Parimutuel Markets](COMPREHENSIVE_DOCUMENTATION.md#24-bettingparimutuel-markets)
- [Markets Page Route](COMPREHENSIVE_DOCUMENTATION.md#46-markets-page)
- [Admin Markets Page Route](COMPREHENSIVE_DOCUMENTATION.md#47-admin-markets-page)

**Authentication**
- [User Authentication & Authorization](COMPREHENSIVE_DOCUMENTATION.md#25-user-authentication--authorization)
- [Authentication & Authorization (detailed)](COMPREHENSIVE_DOCUMENTATION.md#8-authentication--authorization)
- [Protected Routes](COMPREHENSIVE_DOCUMENTATION.md#83-protected-routes)

**Real-time**
- [Real-time Features](COMPREHENSIVE_DOCUMENTATION.md#9-real-time-features)
- [Real-time Subscriptions](COMPREHENSIVE_DOCUMENTATION.md#91-real-time-subscriptions)

### By Technology

**React/Components**
- [Components Structure](COMPREHENSIVE_DOCUMENTATION.md#7-components-structure)
- [State Management](COMPREHENSIVE_DOCUMENTATION.md#33-state-management)
- [Custom Hooks](COMPREHENSIVE_DOCUMENTATION.md#64-custom-hooks)

**Database/Supabase**
- [Database Schema](COMPREHENSIVE_DOCUMENTATION.md#5-database-schema)
- [RLS Policies](COMPREHENSIVE_DOCUMENTATION.md#55-rls-policies-row-level-security)
- [RPC Functions](COMPREHENSIVE_DOCUMENTATION.md#56-rpc-functions)
- [Real-time Subscriptions](COMPREHENSIVE_DOCUMENTATION.md#91-real-time-subscriptions)

**Backend Services**
- [Key Services & Utilities](COMPREHENSIVE_DOCUMENTATION.md#6-key-services--utilities)
- [Service Files](COMPREHENSIVE_DOCUMENTATION.md#61-services)
- [Library Files](COMPREHENSIVE_DOCUMENTATION.md#62-library-files)

## Document Structure

### COMPREHENSIVE_DOCUMENTATION.md (Main Document)

```
1. Application Overview & Purpose
   - What is TimeKeeperDPGP?
   - Primary Use Cases
   - Target Users (Roles)

2. Core Features & Modules
   2.1 Race Timing & Lap Logging
   2.2 Live Timing Display
   2.3 Session Management
   2.4 Betting/Parimutuel Markets
   2.5 Track Status & Flag Control
   2.6 User Authentication & Authorization

3. Technical Architecture
   3.1 Frontend Stack
   3.2 Backend Infrastructure
   3.3 State Management
   3.4 Data Flow
   3.5 Environment Configuration

4. All Pages & Routes
   4.1 Welcome Page
   4.2 Dashboard Page
   4.3 Session Management Pages
   4.4 Race Control Panel
   4.5 Live Timing Board
   4.6 Markets Page
   4.7 Admin Markets Page

5. Database Schema
   5.1 Core Timing Tables
   5.2 Session Access & Membership Tables
   5.3 Control & Logging Tables
   5.4 Betting Tables
   5.5 RLS Policies
   5.6 RPC Functions

6. Key Services & Utilities
   6.1 Services
   6.2 Library Files
   6.3 Utility Functions
   6.4 Custom Hooks

7. Components Structure
   7.1 Layout & Page Components
   7.2 Race Control Components
   7.3 Live Timing Components
   7.4 Authentication Components
   7.5 Betting Components
   7.6 Admin Components
   7.7 Other Components

8. Authentication & Authorization
   8.1 Authentication Flow
   8.2 Role-Based Access Control
   8.3 Protected Routes
   8.4 Session-Based Access

9. Real-time Features
   9.1 Real-time Subscriptions
   9.2 Real-time Use Cases
   9.3 Connection Management

10. Development Setup
    10.1 Prerequisites
    10.2 Installation & Configuration
    10.3 Running Locally
    10.4 Project Structure
    10.5 Key Development Commands
    10.6 Common Development Tasks
    10.7 Environment-Specific Setup
    10.8 Troubleshooting
```

### DOCUMENTATION_SUMMARY.md (Quick Reference)

- Overview of all 10 sections
- Key insights from codebase
- File statistics
- Terminology reference
- How to use the documentation

### DOCUMENTATION_INDEX.md (This File)

- Navigation by role
- Navigation by feature
- Navigation by technology
- Cross-references to sections

## File Locations

| File | Purpose | Size |
|------|---------|------|
| [COMPREHENSIVE_DOCUMENTATION.md](COMPREHENSIVE_DOCUMENTATION.md) | Full technical documentation | 42 KB, 1,331 lines |
| [DOCUMENTATION_SUMMARY.md](DOCUMENTATION_SUMMARY.md) | Executive summary | 8 KB, 200 lines |
| [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md) | This navigation guide | 4 KB, 150 lines |

## Key Concepts & Terminology

| Term | Definition | Section |
|------|-----------|---------|
| **DPGP** | DayBreak Grand Prix racing event | 1 |
| **RPC** | Remote Procedure Call (Postgres function) | 3.2, 5.6 |
| **RLS** | Row-Level Security (table access control) | 5.5 |
| **Armed Timestamp** | Stored lap timer start time in localStorage | 2.1, 3.4 |
| **Parimutuel** | Betting with odds based on pool distribution | 2.4, 6.3 |
| **Rake** | Commission percentage (e.g., 500 bps = 5%) | 2.4 |
| **Denormalized** | Cached computed values on table | 2.1, 5 |
| **Realtime** | WebSocket-based subscription to changes | 9 |
| **Session** | Independent race with drivers, laps, timing | 2.3, 5.1 |
| **Procedure Phase** | Race state (setup → warmup → grid → race) | 2.5, 5.2 |

## Quick Command Reference

```bash
# Development
npm run dev              # Start local dev server
npm run build            # Build for production
npm run test             # Run test suite

# Database
supabase db push         # Apply pending migrations
supabase db reset        # Reset to clean state
supabase db pull         # Pull remote changes

# Utilities
npm run create:marshal   # Create default marshal account
```

## File Structure Reference

```
TimeKeeperDPGP/
├── src/
│   ├── components/      # React UI components
│   ├── pages/           # Page views
│   ├── routes/          # Route entry points
│   ├── services/        # Business logic
│   ├── lib/             # Utilities
│   ├── hooks/           # Custom React hooks
│   ├── context/         # Context providers
│   ├── state/           # State management
│   ├── constants/       # Constants
│   └── utils/           # Helper functions
├── supabase/
│   ├── migrations/      # SQL schema files (22 files)
│   └── functions/       # Edge functions (Deno)
├── COMPREHENSIVE_DOCUMENTATION.md
├── DOCUMENTATION_SUMMARY.md
├── DOCUMENTATION_INDEX.md
└── README.md
```

## Common Search Queries

Looking for... | Section
---|---
How to log a lap | 2.1, 4.4, 6.1
How live timing works | 2.2, 4.5, 9
How betting works | 2.4, 4.6, 5.4
How authentication works | 2.6, 8
Database tables | 5
API endpoints/RPCs | 5.6
React components | 7
Setup instructions | 10

## Contributing to Documentation

When updating TimeKeeperDPGP, please update corresponding sections:

- **New feature?** Update Section 2 (Core Features) and Section 6 (Services)
- **New route?** Update Section 4 (All Pages & Routes)
- **Schema change?** Update Section 5 (Database Schema)
- **New component?** Update Section 7 (Components Structure)
- **Auth changes?** Update Section 8 (Authentication)
- **New hook?** Update Section 6.4 (Custom Hooks)

---

**Last Updated:** November 2025  
**Documentation Version:** 1.0

For questions or suggestions, refer to the README.md or contact the development team.
