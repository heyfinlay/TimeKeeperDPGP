# 🔑 Admin Account Setup Guide

This guide will help you create your first admin account for the Diamond Sports Book.

## Quick Start (Recommended - 2 Steps)

### Step 1: Create Auth User via Node Script

This uses Supabase's official Admin API (the supported way).

1. **Install Dependencies**
   ```bash
   npm install @supabase/supabase-js
   ```

2. **Get Your Service Role Key**
   - Go to: https://supabase.com/dashboard/project/kcutwtjpsupmdixynyoh/settings/api
   - Copy your `service_role` key (⚠️ Keep this secret!)

3. **Edit Credentials**
   - Open `create_admin_user.mjs` in your code editor
   - **Line 18**: Change email to your admin email
   - **Line 19**: Set a **strong password** (save this in your password manager!)

4. **Run the Script**
   ```bash
   SUPABASE_URL="https://kcutwtjpsupmdixynyoh.supabase.co" \
   SUPABASE_SERVICE_ROLE="your-service-role-key-here" \
   node create_admin_user.mjs
   ```

5. **Success!**
   - You should see: "✅ Admin auth user created successfully!"
   - Copy the User ID - you'll need it for verification

### Step 2: Promote to Admin via SQL

This creates the admin profile and credentials.

1. **Open SQL Editor**
   - Go to: https://supabase.com/dashboard/project/kcutwtjpsupmdixynyoh/sql

2. **Edit Credentials**
   - Open `PROMOTE_TO_ADMIN.sql` in your code editor
   - **Line 20**: MUST match the email from Step 1
   - **Line 21**: MUST match the password from Step 1
   - **Line 22**: Choose an admin username (for /admin/login)

3. **Run the Script**
   - Copy the entire contents of `PROMOTE_TO_ADMIN.sql`
   - Paste into Supabase SQL Editor
   - Click "Run" button
   - You should see: "✅ Promoted email@example.com to admin"

4. **Verify**
   - Scroll down in the SQL Editor
   - Run the verification queries at the bottom
   - You should see your admin user with `role = 'admin'`

5. **Sign In**
   - Go to: http://localhost:5173/admin/login
   - Username: `race-control-admin` (or whatever you set in Step 2)
   - Password: (the password you set in Step 1)
   - You'll be redirected to /admin/markets with full admin access!

---

## Alternative: Using psql (Advanced)

If you prefer using psql, follow the original instructions:

### Prerequisites
- PostgreSQL client (`psql`) installed
- Supabase database connection string

### Get Your Connection String

1. Go to: https://supabase.com/dashboard/project/kcutwtjpsupmdixynyoh/settings/database
2. Scroll to "Connection string"
3. Select "URI" format
4. Copy the connection string (starts with `postgresql://`)
5. Replace `[YOUR-PASSWORD]` with your database password

### Run the Seed Script

```bash
# Set your database connection string
export SUPABASE_DB_URL="postgresql://postgres.[YOUR-PROJECT]:[PASSWORD]@aws-0-us-west-1.pooler.supabase.com:6543/postgres"

# Run the seed script
psql \
  -v admin_username='race-control-root' \
  -v admin_password='YourStrongPasswordHere123!' \
  -f supabase/seed_initial_admin.sql \
  "$SUPABASE_DB_URL"
```

### Create User Profile

After running the seed script, you need to:

1. Sign up via your app UI with the same email
2. Or create the auth user and profile manually:

```sql
-- In Supabase SQL Editor:
-- 1. Create auth user (via app sign-up is easier)
-- 2. Then update their profile:
UPDATE public.profiles
SET role = 'admin'
WHERE email = 'your-admin-email@example.com';
```

---

## What Gets Created

The setup creates:

1. **Auth User** (`auth.users`)
   - Email/password authentication
   - Email confirmed (no verification needed)
   - Standard authenticated role

2. **Profile** (`public.profiles`)
   - Links to auth user by ID
   - `role = 'admin'` ← This is critical!
   - Display name set

3. **Admin Credentials** (`public.admin_credentials`)
   - Username for API authentication
   - Bcrypt hashed password
   - Rotation timestamp

---

## Verify Admin Access

### Check in Database

Run these queries in Supabase SQL Editor:

```sql
-- Check profile has admin role
SELECT id, email, role FROM public.profiles WHERE role = 'admin';

-- Test is_admin() function (must be logged in as this user)
SELECT public.is_admin();

-- Check admin credentials
SELECT username, rotated_at FROM public.admin_credentials;
```

### Check in Application

1. Go to `/admin/login` and sign in with your admin username and password
2. You should be redirected to `/admin/markets` automatically
3. Navigate to `/dashboard/admin` - should work!
4. Try to approve a withdrawal - should work!

If you get "403 Forbidden" or "Admin access required", the `role = 'admin'` might not be set correctly.

---

## Troubleshooting

### Issue: Can't access /admin/markets

**Solution**: Check profile role
```sql
SELECT id, email, role FROM public.profiles WHERE email = 'your-email@example.com';

-- If role is not 'admin', update it:
UPDATE public.profiles SET role = 'admin' WHERE email = 'your-email@example.com';
```

### Issue: is_admin() returns false

**Cause**: Profile doesn't have `role = 'admin'` or you're not signed in as that user

**Solution**:
1. Sign out and sign back in (refreshes JWT token)
2. Verify role is set in database
3. Check browser console for auth errors

### Issue: "User already exists"

**Solution**: The email is already registered. Either:
1. Use a different email, or
2. Update the existing user's role:
```sql
UPDATE public.profiles SET role = 'admin' WHERE email = 'existing@email.com';
```

### Issue: Password doesn't work

**Solution**: Re-run the CREATE_FIRST_ADMIN.sql script with a new password. The `ON CONFLICT` clause will update the existing user.

---

## Security Best Practices

### ✅ Do's
- Use a **strong, unique password** (16+ characters)
- Store credentials in a **password manager**
- Rotate passwords **every 90 days**
- Use **different passwords** for each admin
- Enable **2FA** if available (Supabase feature)

### ❌ Don'ts
- Don't use default passwords
- Don't share credentials via email/chat
- Don't commit credentials to git
- Don't reuse passwords from other services
- Don't give admin access unnecessarily

---

## Next Steps

After creating your admin account:

1. **Test Admin Features**
   - Visit `/admin/markets`
   - Create a test market
   - Place a test wager
   - Approve/reject withdrawals

2. **Add More Admins** (if needed)
   - Run `CREATE_FIRST_ADMIN.sql` again with different email/username
   - Or update existing user:
     ```sql
     UPDATE public.profiles SET role = 'admin' WHERE email = 'new-admin@example.com';
     ```

3. **Set Up Production**
   - Use environment-specific credentials
   - Enable Supabase Auth email verification
   - Configure password recovery
   - Set up admin access logging

4. **Regular Maintenance**
   - Review admin access monthly
   - Rotate credentials quarterly
   - Audit admin actions via `admin_actions_log` table

---

## Related Files

- `CREATE_FIRST_ADMIN.sql` - Main setup script
- `supabase/seed_initial_admin.sql` - Alternative psql method
- `docs/ADMIN_CREDENTIAL_ROTATION.md` - Password rotation guide
- `src/pages/admin/AdminMarketsPage.jsx` - Admin UI

---

**Need Help?** Check the troubleshooting section or review the QA verification report at `docs/QA_VERIFICATION_REPORT.md`
