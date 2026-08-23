/* Options: connects the extension to the signed-in web app.
   The web app keeps its Supabase URL/key and session in localStorage; we
   read them from a wallet tab via chrome.scripting and hand the session to
   the background worker. Magic-link auth can't complete inside an
   extension, so reusing the app's session is the least-moving-parts path. */

const APP_ORIGINS = ['https://coupoun.netlify.app/*', 'http://localhost:8000/*'];
const DEFAULT_APP_URL = 'https://coupoun.netlify.app';

const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const connState = document.getElementById('connState');
const userLine = document.getElementById('userLine');
const msgEl = document.getElementById('msg');

function say(text, kind) {
  msgEl.textContent = text;
  msgEl.className = 'msg' + (kind ? ' ' + kind : '');
}

async function paintStatus() {
  const res = await chrome.runtime.sendMessage({ type: 'getMatches' });
  const on = !!res.connected;
  connState.textContent = on ? 'connected' : 'not connected';
  connState.className = 'state ' + (on ? 'on' : 'off');
  userLine.textContent = res.user_email ? `Signed in as ${res.user_email}` : '';
  disconnectBtn.hidden = !on;
}

function findWalletTab() {
  return chrome.tabs.query({ url: APP_ORIGINS }).then(tabs => tabs[0] || null);
}

function waitForLoad(tabId) {
  return new Promise(resolve => {
    chrome.tabs.onUpdated.addListener(function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

// Runs in the wallet page's isolated world — reads only what the app
// itself put in localStorage.
function scrapeSession() {
  let url = null, key = null, session = null;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k === 'cw_supabase_url') url = localStorage.getItem(k);
    else if (k === 'cw_supabase_key') key = localStorage.getItem(k);
    else if (/^sb-.*-auth-token$/.test(k)) {
      try { session = JSON.parse(localStorage.getItem(k)); } catch (_e) {}
    }
  }
  if (!session || !session.access_token || !session.refresh_token) return null;
  return {
    url,
    key,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at || Math.floor(Date.now() / 1000) + (session.expires_in || 3600),
    user_email: session.user?.email || null
  };
}

async function pollForSession(tabId, attempts, delayMs) {
  for (let i = 0; i < attempts; i++) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: scrapeSession
    });
    if (result?.result?.access_token) return result.result;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return null;
}

connectBtn.addEventListener('click', async () => {
  say('Looking for your Coupon Wallet tab…');
  connectBtn.disabled = true;

  try {
    let tab = await findWalletTab();
    if (!tab) {
      tab = await chrome.tabs.create({ url: DEFAULT_APP_URL, active: true });
      await waitForLoad(tab.id);
    }

    say('Reading session from the wallet… (make sure you are signed in there)');
    const session = await pollForSession(tab.id, 10, 3000);

    if (!session?.url || !session.key) {
      say('No session found. Open the wallet tab, sign in via ☁️ Sync (Sign In), then click Connect again.', 'err');
      return;
    }
    if (!/^https:\/\/.+\.supabase\.co\/?$/.test(session.url.replace(/\/$/, ''))) {
      say(`Unexpected Supabase URL (${session.url}) — refusing to save it.`, 'err');
      return;
    }

    await chrome.runtime.sendMessage({
      type: 'saveSession',
      session: {
        ...session,
        url: session.url.replace(/\/$/, ''),
      }
    });
    say('Connected! Visit any retailer with unused coupons to see the badge.', 'ok');
    await paintStatus();
  } catch (err) {
    say('Connect failed: ' + err.message, 'err');
  } finally {
    connectBtn.disabled = false;
  }
});

disconnectBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'disconnect' });
  say('Disconnected. Badges cleared.');
  await paintStatus();
});

paintStatus().catch(() => say('Could not read extension state.', 'err'));
