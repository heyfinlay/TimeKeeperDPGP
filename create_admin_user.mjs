// ============================================================================
// CREATE ADMIN AUTH USER - Step 1 of 2
// ============================================================================
// This script creates the Supabase Auth user using the Admin API.
// Run this FIRST, then run the SQL script to promote to admin.
//
// Prerequisites:
// npm install @supabase/supabase-js
//
// Usage:
// SUPABASE_URL="https://kcutwtjpsupmdixynyoh.supabase.co" \
// SUPABASE_SERVICE_ROLE="<your-service-role-key>" \
// node create_admin_user.mjs
// ============================================================================

import { createClient } from '@supabase/supabase-js';

// Configuration - CHANGE THESE
const email = 'admin@diamondsportsbook.local';
const password = 'ChangeThisPassword123!'; // Use a strong password!

// Get from environment variables
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE;

if (!url || !serviceKey) {
  console.error('❌ Missing environment variables!');
  console.error('Please set:');
  console.error('  SUPABASE_URL - Your Supabase project URL');
  console.error('  SUPABASE_SERVICE_ROLE - Your service role key');
  console.error('');
  console.error('Get these from:');
  console.error('  https://supabase.com/dashboard/project/kcutwtjpsupmdixynyoh/settings/api');
  process.exit(1);
}

console.log('🔧 Creating admin auth user...');
console.log('Email:', email);
console.log('');

// Create Supabase client with service role key
const supabase = createClient(url, serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Create the auth user via Admin API
const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true, // Skip email verification
  user_metadata: {
    created_by: 'admin-seed-script',
    created_at: new Date().toISOString(),
  },
});

if (error) {
  console.error('❌ Failed to create admin user:', error.message);
  console.error('');
  if (error.message.includes('already registered')) {
    console.error('ℹ️  User already exists. You can either:');
    console.error('   1. Use a different email address');
    console.error('   2. Skip to step 2 (run the SQL script to promote existing user)');
  }
  process.exit(1);
}

console.log('✅ Admin auth user created successfully!');
console.log('');
console.log('User ID:', data.user.id);
console.log('Email:', data.user.email);
console.log('Email confirmed:', data.user.email_confirmed_at ? 'Yes' : 'No');
console.log('');
console.log('📋 Next steps:');
console.log('1. Copy the SQL from PROMOTE_TO_ADMIN.sql');
console.log('2. Open Supabase SQL Editor:');
console.log('   https://supabase.com/dashboard/project/kcutwtjpsupmdixynyoh/sql');
console.log('3. Paste and run the SQL to promote this user to admin');
console.log('4. Test login at /admin/login');
