const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests() {
  console.log("Running Phase 2 Schema tests...");

  const schemaPath = path.join(__dirname, '..', 'supabase', 'schema.sql');
  assert(fs.existsSync(schemaPath), "supabase/schema.sql must exist");

  const sql = fs.readFileSync(schemaPath, 'utf8');

  // Verify key fields
  const requiredFields = [
    'id', 'user_id', 'brand', 'code', 'discount_text', 'min_order_value',
    'category', 'source_app', 'expiry_date', 'redeem_url', 'notes',
    'reusable', 'used', 'used_at', 'created_at', 'updated_at'
  ];

  requiredFields.forEach(field => {
    assert(sql.includes(field), `SQL schema must contain field: ${field}`);
  });

  // Verify RLS policies
  assert(sql.includes("ENABLE ROW LEVEL SECURITY"), "Must enable RLS");
  assert(sql.includes("auth.uid() = user_id"), "RLS policies must enforce auth.uid() == user_id");

  console.log("✅ All Phase 2 Schema tests passed!");
}

runTests();
