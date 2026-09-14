> **SUPERSEDED 2026-09-13.** This document describes a design that is no longer in use. See [PROJECT_STATUS.md](PROJECT_STATUS.md).

# Frontend Development Guide

## Quick Start

The frontend is fully built and ready to run locally with **mock data** (no backend needed yet).

### Installation

```bash
cd frontend
npm install
```

### Run Development Server

```bash
npm run dev
```

The app will open at `http://localhost:5173`.

### Login

**Email:** Any email (e.g., `test@ascotwm.com`)  
**Password:** Any password with 6+ characters

(Mock auth - no real credentials needed)

---

## What's Included

### Mock Data
- 5 sample trusts with various statuses
- Documents with versioning
- Status history
- Mock audit logs (generated from trust changes)

### Features Implemented

✅ **Authentication**
- Login page with form validation
- Session persistence (localStorage)
- Protected routes

✅ **Dashboard**
- Summary statistics (by status and jurisdiction)
- Overdue registrations alert
- Pending documents alert
- Real-time updates as data changes

✅ **Trust Management**
- Create new trusts
- List all trusts with filtering
- Advanced search (by name, insightly ID)
- Filter by status and jurisdiction
- Pagination (25 per page)
- Delete trusts with confirmation

✅ **Trust Detail**
- Full trust information
- Status badge with color coding
- Status update modal (state machine enforced)
- Document upload interface
- Document versioning with download buttons
- Status history timeline
- Simulated audit trail

✅ **Audit Log**
- View all changes across all trusts
- Search by trust, user, or action
- Filter by action type
- Date range filtering
- Expandable detail view showing before/after values

### Local State Management

**Hook:** `useTrusts()`
- Stores trusts in localStorage (persists across page refreshes)
- Provides CRUD operations
- Simulates API responses

**Hook:** `useAuth()`
- Mock authentication
- Session state
- Logout functionality

---

## State Machine

Status transitions are enforced:
```
not_started → in_progress, archived
in_progress → completed, not_started, archived
completed → archived
archived → (no transitions)
```

If you try an invalid transition, the button won't appear in the modal.

---

## File Structure

```
frontend/src/
├── App.jsx                    # Main router
├── main.jsx                   # Entry point
├── index.css                  # Tailwind styles
│
├── context/
│   └── AuthContext.jsx        # Auth state (mock)
│
├── hooks/
│   ├── useAuth.js            # Auth hook (deprecated, use context)
│   ├── useTrusts.js          # Trust management (mock with localStorage)
│   └── useLocalStorage.js    # localStorage helper
│
├── lib/
│   ├── supabase.js           # Placeholder for Supabase client
│   └── api.js                # Placeholder for API calls
│
├── components/
│   ├── Layout.jsx            # App shell
│   ├── ProtectedRoute.jsx    # Auth guard
│
└── pages/
    ├── Login.jsx             # Login
    ├── Dashboard.jsx         # Dashboard
    ├── TrustList.jsx         # List with filters
    ├── CreateTrust.jsx       # New trust form
    ├── TrustDetail.jsx       # Full details + modals
    └── AuditLog.jsx          # Audit viewer
```

---

## Key Hooks

### `useTrusts()`
Returns trust management functions and state.

```javascript
const { 
  trusts,                          // All trusts
  getTrust,                        // Get by ID
  createTrust,                     // Create new
  updateTrust,                     // Update fields
  updateTrustStatus,              // Change status
  deleteTrust,                     // Delete
  addDocument                      // Add document
} = useTrusts()
```

Example:
```javascript
const trust = getTrust('1')
updateTrustStatus('1', 'in_progress', 'Registration started')
addDocument('1', { 
  document_type: 'trs_certificate', 
  file_name: 'cert.pdf' 
})
```

### `useLocalStorage(key, initialValue)`
Persist state to localStorage.

```javascript
const [value, setValue] = useLocalStorage('my_key', defaultValue)
```

---

## Testing Locally

### Create a Trust
1. Go to `/trusts/new`
2. Fill in form (all fields required)
3. Submit → redirect to detail page

### Update Status
1. On trust detail page
2. Click "Update Status" button
3. Select new status (only valid transitions shown)
4. Enter reason (required)
5. Click "Update Status"

### Upload Document
1. On trust detail page
2. Click "Upload Document"
3. Select file and document type
4. Click "Upload"
5. Document appears in list immediately

### Check Audit Log
1. Go to `/audit`
2. See all changes: creations, status changes, document uploads
3. Search or filter by action
4. Expand entries to see before/after values

---

## Styling

Uses **Tailwind CSS** with custom color scheme:
- Primary: Blue (#2563eb)
- Secondary: Gray (#64748b)
- Status colors:
  - Not Started: Gray
  - In Progress: Yellow
  - Completed: Green
  - Archived: Gray

All components use Tailwind classes. No CSS files needed (see `src/index.css` for Tailwind directives).

---

## Building for Production

```bash
npm run build
```

Creates optimized build in `dist/` folder.

```bash
npm run preview
```

Test the production build locally.

---

## Next Steps: Backend Integration

When you're ready to connect to the backend:

1. **Remove mock data:** Delete `useTrusts()` hook, replace with API calls
2. **Update AuthContext:** Connect to Supabase Auth
3. **Update API client:** Use real Supabase and backend endpoints
4. **Add loading states:** Show spinners during API calls
5. **Add error handling:** Toast notifications for errors
6. **Update queries:** Use React Query for server state

The component structure is already designed for this. Each page uses the same hooks pattern, so it's a clean swap from localStorage to API calls.

---

## Troubleshooting

### App not loading
- Clear localStorage: `localStorage.clear()` in console
- Restart dev server: `npm run dev`

### Styles not applied
- Tailwind not compiling: Run `npm install` again
- Browser cache: Hard refresh (Ctrl+Shift+R)

### State not persisting
- Check browser localStorage (DevTools → Application)
- Ensure localStorage is enabled

### Form validation errors
- Check browser console for error messages
- All required fields must be filled

---

## Performance Tips

- Dashboard calculates stats on every render (using `useMemo`, so it's optimized)
- List filtering uses `useMemo` to avoid recalculation
- Documents are versioned per type (only latest marked as "current")
- Audit logs generated from trust changes (no separate API call)

---

## Contact & Support

Questions about the frontend? Check:
1. Component comments in source files
2. Hook definitions in `src/hooks/`
3. The component structure in `src/pages/`

All components are well-organized and ready for backend integration when you're ready!

---

**Happy building!** 🎉
