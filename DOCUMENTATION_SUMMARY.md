# TimeKeeperDPGP Documentation - Executive Summary

## Overview

A comprehensive **1,300+ line documentation** has been created for the TimeKeeperDPGP application. The full document is available in `/COMPREHENSIVE_DOCUMENTATION.md`.

## What Was Documented

### 1. Application Overview & Purpose (Section 1)
- **Core Purpose**: Formula V race timing and parimutuel betting platform for DayBreak Grand Prix
- **Key Users**: Race Control (admins), Marshals, Spectators, Public viewers
- **Use Cases**: Race management, live timing, in-game betting, multi-session support

### 2. Core Features & Modules (Section 2)
- **Race Timing & Lap Logging**: Armed timestamp system, atomic RPC transactions, denormalized driver stats
- **Live Timing Display**: Authoritative clock from DB timestamp, real-time spectator dashboard, gap calculations
- **Session Management**: Multi-session support, atomic creation flow, lifecycle states (draft→scheduled→active→completed)
- **Betting/Parimutuel**: Diamond Sports Book with rake percentage, odds calculation, wager settlement
- **Track Status & Flag Control**: Green/Yellow/VSC/SC/Red/Checkered flags with real-time broadcast
- **Authentication**: Discord OAuth (primary), deprecated admin credentials system

### 3. Technical Architecture (Section 3)
- **Frontend Stack**: React 18, Vite 7, Tailwind CSS, Lucide icons, Supabase JS client
- **Backend**: Supabase (Postgres) with RLS policies, RPC functions, Realtime subscriptions
- **State Management**: Three-tier architecture (Global Context, Session-Level, Component-Level)
- **Data Flow**: Detailed diagrams of timing flow and betting flow
- **Environment Configuration**: Required `.env.local` variables and build process

### 4. All Pages & Routes (Section 4)
Complete mapping of **12 routes** with features and access control:
- `/` - Welcome (public landing, Discord auth)
- `/dashboard` - User hub (authenticated users)
- `/dashboard/admin` - Admin dashboard (admins only)
- `/sessions` - Session list (auth required)
- `/sessions/new` - 4-step session creation wizard
- `/control/:sessionId` - Race control panel (race management UI)
- `/live/:sessionId` - Live timing board (public spectator view)
- `/markets` - Betting interface (public)
- `/admin/markets` - Market management (admins)
- `/admin/sessions` - Admin session oversight
- `/account/setup` - Account configuration
- `/auth/callback` - Discord OAuth redirect

### 5. Database Schema (Section 5)
Comprehensive schema documentation for **~20 tables**:

**Core Timing Tables**:
- `sessions` - Race container with timing defaults
- `session_state` - Dynamic race state (clock, flags, phase)
- `drivers` - Per-session driver records with denormalized stats
- `laps` - Individual lap times
- `race_events` - Audit trail of flag/status changes

**Session Access**:
- `session_members` - User-session membership with roles
- `profiles` - User records with roles and assignments

**Control & Logging**:
- `control_logs` - Audit trail of race control actions
- `penalties` - Time penalties applied to drivers
- `pit_events` - Pit in/out records
- `results_final` - Published final results with classification

**Betting Tables**:
- `events`, `markets`, `outcomes` - Betting market structure
- `wagers` - Individual bets
- `wallet_accounts`, `wallet_transactions` - User balances
- `withdrawals` - Cash-out requests

**RLS Policies**: Admin access control, session-based restrictions, spectator view-only

**RPC Functions**: 6 major functions documented
- `create_session_atomic()` - Transactional session creation
- `log_lap_atomic()` - Atomic lap logging
- `invalidate_last_lap_atomic()` - Lap invalidation with recalculation
- `finalize_session_results()` - Post-race result finalization
- `place_wager()` - Bet placement with validation
- `session_has_access()` - Access control check

### 6. Key Services & Utilities (Section 6)
**Service Files** (business logic):
- `laps.js` - Lap logging with RPC fallback
- `admin.js` - Session/marshal management
- `penalties.js` - Penalty application
- `pitEvents.js` - Pit stop tracking
- `results.js` - Results finalization and export
- `adminAuth.js` - Deprecated admin login

**Library Files** (client utilities):
- `supabaseClient.js` - Supabase wrapper with error handling
- `auth.js` - Discord OAuth and user management
- `profile.js` - User profile resolution

**Utility Functions**:
- `time.js` - Lap time (M:SS.mmm) and race clock (MM:SS) formatting
- `raceData.js` - Race state normalization, lap grouping, driver hydration
- `betting.js` - Odds and probability calculations

**Custom Hooks** (5 documented):
- `useSessionDrivers()` - Driver list subscription
- `useControlLogs()` - Audit log fetching
- `usePenalties()` - Penalty management
- `usePitEvents()` - Pit event tracking
- `useWagers()` - User wagers and wagering history

### 7. Components Structure (Section 7)
**Component Hierarchy** (organized by function):

**Layout & Page Components**:
- `AppLayout` - Main layout wrapper
- `ControlPanel` - Race control master component

**Race Control Components**:
- `DriverTimingPanel` - Grid of lap timers with hotkey bindings
- `SingleMarshalBoard` - Large timer for single-driver mode
- `MarshalDriverCard` - Individual driver card

**Live Timing Components**:
- `LiveTimingBoard` - Spectator dashboard with standings, gaps, lap feed

**Authentication Components**:
- `AuthGuard` - Requires authentication + optional admin check
- `ProtectedRoute` - Route protection wrapper
- `SessionAccessGuard` - Session membership verification
- `AuthGate` - Conditional rendering based on auth status

**Betting Components**:
- `Betslip` - Bet placement modal
- `MarketCard` - Market preview with outcomes

**Admin Components**:
- `AdminMarketWizard` - Market creation interface
- `SessionMarshalAssignments` - Marshal assignment UI

**Other Components**:
- `TopUpModal` - Wallet top-up interface

### 8. Authentication & Authorization (Section 8)
- **Current System**: Discord OAuth with profile auto-creation
- **Three Roles**: admin (full access), marshal (session-specific), spectator (view-only)
- **Protected Routes**: AuthGuard, ProtectedRoute, SessionAccessGuard patterns
- **Session-Based Access**: RPC verification via `session_has_access()`

### 9. Real-time Features (Section 9)
- **Subscription Pattern**: WebSocket-based Supabase Realtime
- **Use Cases**: Lap logging broadcast, flag changes, wager placement
- **Connection Management**: Retry logic with exponential backoff
- **Cleanup**: Proper unsubscribe on component unmount

### 10. Development Setup (Section 10)
- **Prerequisites**: Node.js 18+, Supabase CLI, Discord OAuth app
- **Installation Steps**: Clone, install deps, link Supabase, apply migrations, configure env vars
- **Commands**: `npm run dev`, `npm run build`, `npm run test`
- **Project Structure**: Detailed directory tree
- **Common Tasks**: Adding routes, services, hooks, migrations
- **Troubleshooting**: 6 common issues with solutions
- **Offline Mode**: Graceful degradation without Supabase

## Key Insights from Codebase Exploration

### Architecture Highlights
1. **Atomic Transactions**: RPC functions ensure consistency for critical operations (lap logging, session creation)
2. **Fallback Strategy**: RPC functions have SQL fallback if Postgres function unavailable
3. **Real-time First**: All data subscriptions use websockets for instant updates
4. **Offline Graceful**: App works offline with localStorage persistence and fallback UI
5. **Three-Tier State**: Global → Session → Component state hierarchy prevents prop drilling

### Notable Patterns
- **Armed Timestamps**: Clever mechanism to handle pause/resume without losing precision
- **Denormalized Stats**: Driver table caches lap count, best lap, total time for fast queries
- **Parimutuel Store**: Custom reducer with localStorage persistence for market state
- **Token Refresh**: Supabase handles JWT refresh transparently

### Security Measures
- **RLS Policies**: All table access gated by user role and session membership
- **Session Access Check**: RPC function validates before allowing operations
- **No Client-side Secrets**: Anon key only (service_role key on backend only)
- **CORS Headers**: Proper CORS configuration on edge functions

## File Statistics

- **Total Lines of Code**: ~10,000+ across React components and services
- **Migrations**: 22 SQL migration files tracking schema evolution
- **Services**: 6 service modules for business logic
- **Custom Hooks**: 5 hooks for data fetching and subscriptions
- **Components**: 15+ React components organized by feature
- **Context Providers**: 4 global context providers
- **Tables**: ~20 database tables with RLS policies

## Terminology Reference

- **DPGP**: DayBreak Grand Prix (racing event)
- **RPC**: Remote Procedure Call (Postgres function called from client)
- **RLS**: Row-Level Security (Postgres table-level access control)
- **Parimutuel**: Betting where odds are determined by pool distribution
- **Rake**: Commission percentage taken by the house (500 bps = 5%)
- **Armed Timestamp**: Stored start time for lap timer (persisted in localStorage)
- **Denormalized**: Data duplicated on table for faster queries
- **Realtime**: WebSocket-based subscription to table changes

## How to Use This Documentation

1. **Read Section 1-2** for business understanding
2. **Read Section 3** for technical overview
3. **Read Sections 4-5** for feature/schema reference
4. **Use Section 6-7** as API reference when modifying features
5. **Refer to Section 8-9** for security and real-time patterns
6. **Follow Section 10** for local development setup

## Document Location

**Full Documentation**: `/Users/finlaysturzaker/Desktop/FormulaV/TimeKeeperDPGP/COMPREHENSIVE_DOCUMENTATION.md` (42 KB, 1,331 lines)

This document is self-contained and includes:
- Code examples and SQL snippets
- Data flow diagrams (ASCII)
- RPC function signatures
- Component hierarchy trees
- Environment variable listings
- Troubleshooting guide
