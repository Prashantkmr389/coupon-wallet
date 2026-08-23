/* Popup: shows spendable coupons matching the current tab's site. */

const listEl = document.getElementById('list');
const hostEl = document.getElementById('host');
const statusEl = document.getElementById('status');

function daysLabel(c) {
  const p = String(c.expiry_date).split('-').map(Number);
  const exp = Date.UTC(p[0], p[1] - 1, p[2]);
  const n = new Date();
  const today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
  const d = Math.round((exp - today) / 86400000);
  if (d < 0) return 'expired';
  if (d === 0) return 'today!';
  if (d === 1) return '1 day';
  return d + ' days';
}

// Coupons come from the API — build nodes via DOM APIs only so no
// field can inject markup.
function couponNode(c) {
  const box = document.createElement('div');
  box.className = 'coupon';

  const top = document.createElement('div');
  top.className = 'top';
  const brand = document.createElement('span');
  brand.className = 'brand';
  brand.textContent = c.brand || 'Coupon';
  const days = document.createElement('span');
  days.className = 'days';
  days.textContent = `${daysLabel(c)} left`;
  top.append(brand, days);
  box.append(top);

  if (c.discount_text) {
    const d = document.createElement('p');
    d.className = 'discount';
    d.textContent = c.discount_text;
    box.append(d);
  }

  const bottom = document.createElement('div');
  bottom.className = 'bottom';
  const codeBtn = document.createElement('button');
  codeBtn.className = 'code-btn';
  codeBtn.dataset.code = c.code || '';
  codeBtn.textContent = `${c.code} ⧉`;
  bottom.append(codeBtn);

  if (c.redeem_url) {
    const link = document.createElement('a');
    link.className = 'use-link';
    // Only http(s) links — block javascript: URLs from data.
    if (/^https?:\/\//i.test(c.redeem_url)) {
      link.href = c.redeem_url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Use →';
      bottom.append(link);
    }
  }
  box.append(bottom);
  return box;
}

// Empty states are compile-time constants — never interpolate data here.
const EMPTY_WAKING = 'Extension is waking up — reopen this popup.';
const EMPTY_NOT_CONNECTED = 'Not connected yet.<br>Click Settings below to link your Coupon Wallet.';
const EMPTY_NO_TAB = 'Open a retailer tab to see matching coupons.';

function renderEmpty(htmlConstant) {
  listEl.innerHTML = htmlConstant;
}

async function load() {
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'getMatches' });
  } catch (_e) {
    renderEmpty(EMPTY_WAKING);
    return;
  }

  statusEl.textContent = res.connected
    ? (res.user_email || 'connected')
    : 'not connected';
  hostEl.textContent = res.host || '';

  if (!res.connected) {
    renderEmpty(EMPTY_NOT_CONNECTED);
    return;
  }
  if (!res.matches.length) {
    const strong = document.createElement('div');
    if (res.host) {
      strong.textContent = 'No unused coupons for ';
      const b = document.createElement('strong');
      b.textContent = res.host;
      strong.append(b);
    } else {
      strong.textContent = EMPTY_NO_TAB;
    }
    listEl.replaceChildren(strong);
    return;
  }

  listEl.replaceChildren(...res.matches.map(couponNode));

  listEl.querySelectorAll('.code-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(btn.dataset.code);
      const original = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(() => { btn.textContent = original; }, 1200);
    });
  });
}

document.getElementById('syncBtn').addEventListener('click', async () => {
  statusEl.textContent = 'syncing…';
  await chrome.runtime.sendMessage({ type: 'syncNow' });
  await load();
});
document.getElementById('optionsLink').addEventListener('click', () => chrome.runtime.openOptionsPage());

load();
