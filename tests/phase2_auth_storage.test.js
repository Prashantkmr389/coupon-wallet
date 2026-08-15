const assert = require('assert');

// Mock Supabase Client for testing
class MockSupabaseClient {
  constructor() {
    this.tableData = [];
    this.user = null;
  }

  setUser(user) {
    this.user = user;
  }

  from(tableName) {
    assert.strictEqual(tableName, 'coupons');
    return {
      select: () => ({
        order: (col, { ascending }) => Promise.resolve({
          data: [...this.tableData],
          error: null
        })
      }),
      upsert: (item) => {
        const idx = this.tableData.findIndex(c => c.id === item.id);
        if (idx !== -1) {
          this.tableData[idx] = { ...item };
        } else {
          this.tableData.push({ ...item, user_id: this.user ? this.user.id : 'mock-user' });
        }
        return Promise.resolve({ data: item, error: null });
      },
      delete: () => ({
        eq: (col, val) => {
          assert.strictEqual(col, 'id');
          this.tableData = this.tableData.filter(c => c.id !== val);
          return Promise.resolve({ error: null });
        }
      })
    };
  }
}

// Storage Adapter logic
class HybridStorageAdapter {
  constructor(localStore, supabaseClient) {
    this.localStore = localStore;
    this.supabaseClient = supabaseClient;
    this.currentUser = null;
  }

  setSession(user) {
    this.currentUser = user;
    if (this.supabaseClient) {
      this.supabaseClient.setUser(user);
    }
  }

  async getAll() {
    if (this.currentUser && this.supabaseClient) {
      const res = await this.supabaseClient.from('coupons').select().order('expiry_date', { ascending: true });
      return res.data || [];
    }
    return this.localStore.getAll();
  }

  async put(coupon) {
    if (this.currentUser && this.supabaseClient) {
      coupon.id = coupon.id || `coupon-${Date.now()}`;
      coupon.created_at = coupon.created_at || new Date().toISOString();
      coupon.updated_at = new Date().toISOString();
      await this.supabaseClient.from('coupons').upsert(coupon);
      return coupon.id;
    }
    return this.localStore.put(coupon);
  }

  async delete(id) {
    if (this.currentUser && this.supabaseClient) {
      await this.supabaseClient.from('coupons').delete().eq('id', id);
      return;
    }
    return this.localStore.delete(id);
  }

  async migrateLocalToCloud() {
    if (!this.currentUser || !this.supabaseClient) return { migrated: 0 };
    const localCoupons = await this.localStore.getAll();
    let count = 0;
    for (const c of localCoupons) {
      await this.put(c);
      count++;
    }
    return { migrated: count };
  }
}

// Mock IndexedDB Store
class MockLocalStore {
  constructor() {
    this.data = [];
  }
  async getAll() { return [...this.data]; }
  async put(c) {
    c.id = c.id || `local-${Date.now()}`;
    const i = this.data.findIndex(x => x.id === c.id);
    if (i !== -1) this.data[i] = c; else this.data.push(c);
    return c.id;
  }
  async delete(id) { this.data = this.data.filter(x => x.id !== id); }
}

async function runTests() {
  console.log("Running Phase 2 Hybrid Storage Adapter tests...");

  const localStore = new MockLocalStore();
  const supabaseClient = new MockSupabaseClient();
  const adapter = new HybridStorageAdapter(localStore, supabaseClient);

  // 1. When unauthenticated, uses local storage
  await adapter.put({ id: "loc-1", brand: "LocalBrand", code: "LOC1", expiry_date: "2026-09-01" });
  const localItems = await adapter.getAll();
  assert.strictEqual(localItems.length, 1);
  assert.strictEqual(localItems[0].brand, "LocalBrand");
  assert.strictEqual(supabaseClient.tableData.length, 0, "Cloud storage must be empty when unauthenticated");

  // 2. Authenticate user
  adapter.setSession({ id: "usr-123", email: "user@example.com" });

  // 3. Migrate local storage to cloud
  const migRes = await adapter.migrateLocalToCloud();
  assert.strictEqual(migRes.migrated, 1, "Should migrate 1 item to cloud");
  assert.strictEqual(supabaseClient.tableData.length, 1, "Cloud store now has 1 item");
  assert.strictEqual(supabaseClient.tableData[0].brand, "LocalBrand");

  // 4. Put new item when authenticated writes directly to cloud
  await adapter.put({ id: "cloud-1", brand: "CloudBrand", code: "CLOUD1", expiry_date: "2026-09-10" });
  const cloudItems = await adapter.getAll();
  assert.strictEqual(cloudItems.length, 2);

  // 5. Delete item when authenticated deletes from cloud
  await adapter.delete("cloud-1");
  const cloudItemsPostDel = await adapter.getAll();
  assert.strictEqual(cloudItemsPostDel.length, 1);

  console.log("✅ All Phase 2 Hybrid Storage Adapter tests passed!");
}

runTests().catch(err => {
  console.error("❌ Phase 2 Hybrid Storage Adapter tests failed:", err);
  process.exit(1);
});
