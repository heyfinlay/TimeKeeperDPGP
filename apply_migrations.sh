#!/bin/bash

# Apply migrations using psql directly
# This bypasses the Supabase CLI connection issues

echo "🚀 Applying migrations to Supabase database..."
echo ""

# Get database password
read -sp "Enter your Supabase database password (postgres role): " DB_PASSWORD
echo ""

# Connection string (using direct connection, not pooler)
DB_URL="postgresql://postgres:${DB_PASSWORD}@db.kcutwtjpsupmdixynyoh.supabase.co:5432/postgres"

# Function to apply a migration
apply_migration() {
    local file=$1
    echo "📝 Applying: $(basename $file)"

    if psql "$DB_URL" -f "$file" 2>&1; then
        echo "✅ Success: $(basename $file)"
        return 0
    else
        echo "❌ Failed: $(basename $file)"
        return 1
    fi
}

echo ""
echo "Applying migrations in order..."
echo "================================"
echo ""

# Apply the three new migrations
apply_migration "supabase/migrations/20251111_critical_performance_indexes.sql"
echo ""

apply_migration "supabase/migrations/20251111_idempotent_place_wager.sql"
echo ""

apply_migration "supabase/migrations/20251111_idempotent_settle_market.sql"
echo ""

echo "================================"
echo "✨ Migration process complete!"
echo ""
echo "To verify, run:"
echo "  psql \"$DB_URL\" -c \"SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%' ORDER BY tablename;\""
