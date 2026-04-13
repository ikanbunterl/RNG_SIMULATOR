let state = {};
let config = {};
let itemsDB = {};
let autoInterval = null;
let activeSpecialEvent = null;
let logPaused = false;
let activeBanner = null;
const ui = {};

// 📜 Data Changelog (Edit ini untuk update riwayat versi game)
const changelogData = [
  { version: '1.2.0', date: '2026-04-14', changes: ['+ Limited Banner System (Rate-Up)', '+ Temporary Luck Buff (+Luck untuk X spin)', '+ Dynamic Economy Scaling (Early/Mid/Late)', '+ Drop Effects (Flash & Particles untuk Epic+)', '+ Milestone Tracker & Auto Reward', '+ Event Countdown & Web Notifications', '+ Changelog Modal', '~ Optimasi UI & Save System'] },
  { version: '1.1.0', date: '2026-04-05', changes: ['+ Special Events (April Fools, NY, Halloween)', '+ Auto Spin & Pause Log', '+ Export/Import Save'] },
  { version: '1.0.0', date: '2026-04-01', changes: ['🎮 Rilis Awal: Gacha RNG, Pity System, Inventory, Luck Crate'] }
];

async function init() {
  cacheDOM();
  try {
    const [configRes, itemsRes] = await Promise.all([fetch('config.json'), fetch('RnG.json')]);
    if (!configRes.ok || !itemsRes.ok) throw new Error('Failed to load JSON');
    config = await configRes.json();
    itemsDB = await itemsRes.json();
  } catch (err) {
    console.error('⚠️ Gagal memuat JSON. Jalankan via Local Server!', err);
    alert('Error: Gunakan Live Server atau python -m http.server');
    return;
  }
  loadLocal();
  if (!state.gems) resetState();

  // Inisialisasi fitur baru
  state.tempLuck = state.tempLuck || { level: 0, spinsLeft: 0 };
  state.economyTier = state.economyTier || 'early';
  state.epicCount = state.epicCount || 0;
  state.legendaryCount = state.legendaryCount || 0;
  state.mythicCount = state.mythicCount || 0;
  state.divineCount = state.divineCount || 0;
  state.milestones = config.milestones.map(m => ({ ...m, completed: state.milestones?.find(x=>x.id===m.id)?.completed || false, progress: 0 }));

  activeSpecialEvent = checkSpecialEvent();
  updateSpecialBanner();
  updateActiveBanner();
  renderChangelog();
  updateUI();
  renderInventory();
  renderMilestones();
  setupEventListeners();

  log('✅ Game siap. Tekan SPIN atau [Spasi]');
  if (activeSpecialEvent) log(`🎉 SPECIAL EVENT AKTIF: ${activeSpecialEvent.name}`);

  setInterval(updateEventCountdown, 60000);
  updateEventCountdown();
}

function resetState() {
  state = {
    gems: config.initialGems, luckLevel: 0, pityCounter: 0,
    pityThreshold: config.pityThreshold, inventory: {}, totalSpins: 0,
    event: null, autoSpin: false,
    tempLuck: { level: 0, spinsLeft: 0 },
    economyTier: 'early', epicCount: 0, legendaryCount: 0,
    mythicCount: 0, divineCount: 0,
    milestones: config.milestones.map(m => ({ ...m, completed: false, progress: 0 }))
  };
}

function cacheDOM() {
  ui.gems = document.getElementById('ui-gems');
  ui.luck = document.getElementById('ui-luck');
  ui.tempLuck = document.getElementById('ui-temp-luck');
  ui.pity = document.getElementById('ui-pity');
  ui.spins = document.getElementById('ui-spins');
  ui.tier = document.getElementById('ui-economy-tier');
  ui.result = document.getElementById('result-display');
  ui.inventory = document.getElementById('inventory-grid');
  ui.pityBar = document.getElementById('pity-bar');
  ui.log = document.getElementById('log-box');
  ui.eventBanner = document.getElementById('event-banner');
  ui.eventName = document.getElementById('event-name');
  ui.eventTimer = document.getElementById('event-timer');
  ui.nextLuck = document.getElementById('next-luck');
  ui.crateCost = document.getElementById('crate-cost');
  ui.saveInput = document.getElementById('save-input');
  ui.milestoneList = document.getElementById('milestone-list');
  ui.changelogModal = document.getElementById('changelog-modal');
  ui.changelogList = document.getElementById('changelog-list');
  ui.btnClearLog = document.getElementById('btn-clear-log');
  ui.btnToggleLog = document.getElementById('btn-toggle-log');
  ui.btnScrollLog = document.getElementById('btn-scroll-log');
}

function checkSpecialEvent() {
  const now = new Date(); const m = now.getMonth() + 1; const d = now.getDate();
  for (const key in config.specialEvents) {
    const ev = config.specialEvents[key];
    let inRange = false;
    if (ev.start.month === ev.end.month) inRange = m === ev.start.month && d === ev.start.day;
    else {
      const s = ev.start.month * 100 + ev.start.day, e = ev.end.month * 100 + ev.end.day, nowVal = m * 100 + d;
      inRange = s > e ? (nowVal >= s || nowVal <= e) : (nowVal >= s && nowVal <= e);
    }
    if (inRange) return ev;
  }
  return null;
}

function updateSpecialBanner() {
  const banner = document.getElementById('special-event-banner');
  if (activeSpecialEvent) {
    banner.style.display = 'block';
    banner.innerHTML = `🎊 <b>${activeSpecialEvent.name}</b><br><span style="font-size:0.85rem;opacity:0.9">${activeSpecialEvent.description}</span>`;
    document.body.style.setProperty('--bg', '#0a0f1a');
  } else {
    banner.style.display = 'none';
    document.body.style.setProperty('--bg', '#0b0e11');
  }
}

function updateActiveBanner() {
  const now = new Date(); const m = now.getMonth() + 1, d = now.getDate();
  activeBanner = config.banners.find(b => (m === b.startMonth && d >= b.startDay) || (m === b.endMonth && d <= b.endDay)) || null;
  const el = document.getElementById('active-banner');
  if (activeBanner) {
    el.style.display = 'block';
    el.textContent = `🎪 ${activeBanner.name} (Rate-up: ${activeBanner.rateUp.join(', ')})`;
  } else el.style.display = 'none';
}

function updateEconomyTier() {
  state.economyTier = state.totalSpins < 200 ? 'early' : state.totalSpins < 800 ? 'mid' : 'late';
  if (ui.tier) ui.tier.textContent = state.economyTier.charAt(0).toUpperCase() + state.economyTier.slice(1);
}

function calculateThresholds() {
  const effectiveLuck = state.luckLevel + state.tempLuck.level;
  const luckMod = effectiveLuck * 0.8;
  const tierMult = state.economyTier === 'late' ? 1.25 : state.economyTier === 'mid' ? 1.1 : 1.0;

  let adjusted = config.rarityRules.map((r, i) => {
    let chance = r.baseChance * tierMult;
    if (r.id === 'common') chance = Math.max(10, chance - luckMod * 1.5);
    else if (r.id === 'uncommon') chance = Math.max(5, chance - luckMod * 0.8);
    else chance += luckMod * 0.4 * i;
    if (state.pityCounter >= state.pityThreshold && i < 2) chance = 0;
    return { id: r.id, chance };
  });

  if (activeBanner) {
    activeBanner.rateUp.forEach(rId => {
      const idx = adjusted.findIndex(a => a.id === rId);
      if (idx > -1) adjusted[idx].chance += activeBanner.bonusChance;
    });
  }

  const sum = adjusted.reduce((a, b) => a + b.chance, 0);
  let thresholds = [], cum = 0;
  adjusted.forEach(a => {
    const norm = (a.chance / sum) * 100;
    cum += norm; thresholds.push(cum);
  });
  return thresholds;
}

function rollRNG() {
  const thresholds = calculateThresholds();
  const roll = Math.random() * 100;
  let rarityIdx = 0;
  for (let i = 0; i < thresholds.length; i++) { if (roll <= thresholds[i]) { rarityIdx = i; break; } }
  const rarity = config.rarityRules[rarityIdx];
  const pool = itemsDB[rarity.id] || [];
  return { item: pool[Math.floor(Math.random() * pool.length)], rarity, roll: roll.toFixed(2) };
}

function getRandomExclusiveItem(eventId) {
  const pool = itemsDB.exclusive.filter(i => i.event === eventId);
  return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : pool[0];
}

function triggerDropEffect(rarityId) {
  const highTiers = ['epic','legendary','mythic','divine'];
  if (!highTiers.includes(rarityId)) return;
  const flash = document.createElement('div');
  flash.className = 'flash-overlay';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 500);
  for(let i=0; i<12; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = `${50 + (Math.random()-0.5)*20}%`; p.style.top = '40%';
    const color = getComputedStyle(document.documentElement).getPropertyValue(`--r-${rarityId}`);
    p.style.background = color || 'var(--r-epic)';
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1000);
  }
}

function checkMilestones() {
  state.milestones.forEach(m => {
    if (m.completed) return;
    let current = 0;
    if (m.type === 'spins') current = state.totalSpins;
    else if (m.type === 'epic') current = state.epicCount;
    else if (m.type === 'legendary') current = state.legendaryCount;
    m.progress = Math.min(current, m.target);
    if (current >= m.target) {
      m.completed = true;
      state.gems += m.reward.gems || 0;
      if (m.reward.luck) state.luckLevel += m.reward.luck;
      log(`🏆 Milestone tercapai: ${m.name}! +${m.reward.gems||0}💎`);
    }
  });
  renderMilestones();
}

function renderMilestones() {
  if (!ui.milestoneList) return;
  ui.milestoneList.innerHTML = state.milestones.map(m => {
    const pct = Math.min((m.progress / m.target) * 100, 100);
    return `<div class="milestone-item ${m.completed?'completed':''}">
      <b>${m.name}</b> (${m.progress}/${m.target}) ${m.completed?'✅':'⏳'}
      <div class="milestone-progress"><div class="milestone-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function spin() {
  activeSpecialEvent = checkSpecialEvent();
  if (activeSpecialEvent) updateSpecialBanner();
  
  // Decrement Temp Luck
  if (state.tempLuck.spinsLeft > 0) state.tempLuck.spinsLeft--;
  else state.tempLuck.level = 0;
  updateEconomyTier();

  if (state.event) {
    state.event.spinsLeft--;
    if (state.event.spinsLeft <= 0) { log(`🔚 Event "${state.event.name}" berakhir.`); state.event = null; }
  }
  if (!state.event && Math.random() < config.eventTriggerChance) {
    const evT = config.events[Math.floor(Math.random() * config.events.length)];
    state.event = { ...evT, spinsLeft: evT.duration };
    ui.eventBanner.style.display = 'block';
    ui.eventName.textContent = evT.name; ui.eventTimer.textContent = evT.duration;
    log(`🎉 Event aktif: ${evT.name}`);
  }

  let drop = rollRNG();
  let gemReward = drop.item.gems;
  const isNew = !state.inventory[drop.item.id];
  if (!isNew) gemReward = Math.ceil(gemReward * config.gemMultipliers.duplicate);
  if (isNew) gemReward = Math.ceil(gemReward * config.gemMultipliers.newItemBonus);
  if (state.economyTier === 'late') gemReward = Math.ceil(gemReward * 1.1);

  if (activeSpecialEvent) {
    if (activeSpecialEvent.gemMult) gemReward *= activeSpecialEvent.gemMult;
    if (activeSpecialEvent.pityMod) state.pityCounter = Math.max(0, state.pityCounter + activeSpecialEvent.pityMod);
    if (activeSpecialEvent.customLogic === 'chaos_mode') {
      gemReward *= Math.floor(Math.random() * 11);
      if (Math.random() < 0.1) { const exc = getRandomExclusiveItem('april_fools'); drop = { item: exc, rarity: { name: '🤡 CHAOS', colorVar: '--r-mythic', id: 'exclusive' }, roll: 'CHAOS' }; gemReward = drop.item.gems; }
    } else if (activeSpecialEvent.customLogic === 'curse_bless') {
      if (Math.random() < 0.5) { gemReward = Math.ceil(gemReward * 0.5); log('💀 KUTUKAN: Gems berkurang setengah!'); }
      else { gemReward *= 2; if (['common','uncommon'].includes(drop.rarity.id)) { drop = rollRNG(); log('👻 BERKAH: Upgrade otomatis ke rarity lebih tinggi!'); } }
    }
    if (Math.random() < 0.05 && itemsDB.exclusive) { const exc = getRandomExclusiveItem(activeSpecialEvent.id); drop = { item: exc, rarity: { name: '🌟 EXCLUSIVE', colorVar: '--r-legendary', id: 'exclusive' }, roll: 'EVENT' }; gemReward = drop.item.gems; }
  }

  state.gems += gemReward;
  state.inventory[drop.item.id] = (state.inventory[drop.item.id] || 0) + 1;
  state.totalSpins++;

  if (drop.rarity.id === 'epic') state.epicCount++;
  if (drop.rarity.id === 'legendary') state.legendaryCount++;
  if (drop.rarity.id === 'mythic') state.mythicCount++;
  if (drop.rarity.id === 'divine') state.divineCount++;

  const pityMod = state.event?.effectType === 'pity_mod' ? state.event.value : 0;
  const rarityIdx = config.rarityRules.findIndex(r => r.id === drop.rarity.id);
  if (rarityIdx < 2) state.pityCounter++;
  else { state.pityCounter = Math.max(0, state.pityCounter + pityMod); if (state.pityCounter >= state.pityThreshold) state.pityCounter = 0; }

  triggerDropEffect(drop.rarity.id);
  checkMilestones();

  const isNewTag = isNew ? `<span style="color:var(--success); font-size:0.75rem; margin-left:4px;">BARU!</span>` : '';
  ui.result.innerHTML = `${drop.item.name} ${isNewTag} <div style="font-size:0.85rem; color:var(--${drop.rarity.colorVar.replace('--','')})">${drop.rarity.name}</div> <div style="font-size:0.8rem; margin-top:4px;">+${gemReward} 💎 | RNG: ${drop.roll}</div>`;
  ui.result.classList.remove('pop'); void ui.result.offsetWidth; ui.result.classList.add('pop');
  log(`🎲 [${drop.rarity.name}] ${drop.item.name} (+${gemReward}💎)`);
  updateUI(); renderInventory(); saveLocal();
}

function getCrateCost() {
  let base = config.crateBaseCost + (state.luckLevel * config.crateCostMultiplier);
  if (state.economyTier === 'mid') base = Math.ceil(base * 0.9);
  if (state.economyTier === 'late') base = Math.ceil(base * 0.8);
  return base;
}

function buyLuckCrate() {
  const cost = getCrateCost();
  if (state.gems < cost || state.luckLevel >= config.maxLuckLevel) return;
  state.gems -= cost; state.luckLevel++; log(`📦 Luck Crate dibeli! Lv. ${state.luckLevel}`); updateUI();
}

function toggleAuto() {
  state.autoSpin = !state.autoSpin;
  const btn = document.getElementById('btn-auto');
  btn.textContent = state.autoSpin ? '⏸️ Stop' : '▶️ Auto';
  btn.classList.toggle('btn-success', state.autoSpin); btn.classList.toggle('btn-outline', !state.autoSpin);
  clearInterval(autoInterval);
  if (state.autoSpin) autoInterval = setInterval(() => spin(), config.autoSpinInterval);
}

function updateUI() {
  ui.gems.textContent = state.gems.toLocaleString(); ui.luck.textContent = state.luckLevel;
  ui.tempLuck.textContent = state.tempLuck.level > 0 ? `+${state.tempLuck.level} (${state.tempLuck.spinsLeft})` : '+0';
  ui.pity.textContent = `${state.pityCounter}/${state.pityThreshold}`; ui.spins.textContent = state.totalSpins;
  ui.pityBar.style.width = `${(state.pityCounter / state.pityThreshold) * 100}%`;
  ui.nextLuck.textContent = state.luckLevel + 1; ui.crateCost.textContent = getCrateCost().toLocaleString();
  document.getElementById('btn-buy-crate').disabled = state.luckLevel >= config.maxLuckLevel || state.gems < getCrateCost();
  if (state.event) ui.eventTimer.textContent = state.event.spinsLeft;
  if (!state.event) ui.eventBanner.style.display = 'none';
  renderMilestones();
}

function renderInventory() {
  ui.inventory.innerHTML = '';
  const sorted = Object.entries(state.inventory).sort((a, b) => {
    const getIdx = id => { for (const r of config.rarityRules) if (itemsDB[r.id]?.some(i => i.id === id)) return config.rarityRules.indexOf(r); if (itemsDB.exclusive?.some(i => i.id === id)) return 100; return 99; };
    return getIdx(b[0]) - getIdx(a[0]) || b[1] - a[1];
  });
  sorted.forEach(([id, count]) => {
    let rName = 'common', colorVar = '--r-common';
    for (const r of config.rarityRules) if (itemsDB[r.id]?.some(i => i.id === id)) { rName = r.id; colorVar = r.colorVar; break; }
    if (itemsDB.exclusive?.some(i => i.id === id)) { rName = 'exclusive'; colorVar = '--r-legendary'; }
    const item = (itemsDB[rName] || itemsDB.exclusive)?.find(i => i.id === id);
    const isNew = count === 1 && state.totalSpins <= 150;
    const el = document.createElement('div');
    el.className = `inv-item border-${rName} ${isNew ? 'new' : ''}`;
    el.innerHTML = `<div class="inv-name" style="color:var(${colorVar})">${item?.name || 'Unknown'}</div> <div class="inv-count">x${count}</div> <div class="inv-gems">💎${item?.gems || 0}</div>`;
    ui.inventory.appendChild(el);
  });
}

function updateEventCountdown() {
  const now = new Date(); const m = now.getMonth()+1, d = now.getDate();
  const next = Object.values(config.specialEvents).find(ev => {
    const s = ev.start.month*100 + ev.start.day, e = ev.end.month*100 + ev.end.day, cur = m*100 + d;
    return cur < s || cur > e;
  });
  const el = document.getElementById('event-countdown');
  if (!next) { el.style.display = 'none'; return; }
  const targetDate = new Date(now.getFullYear(), next.start.month-1, next.start.day);
  if (targetDate < now) targetDate.setFullYear(targetDate.getFullYear() + 1);
  const diff = Math.ceil((targetDate - now) / (1000*60*60*24));
  el.style.display = 'block';
  el.textContent = `📅 ${next.name} dimulai dalam ${diff} hari`;
  if (Notification.permission === 'granted' && diff <= 1) {
    new Notification('🎉 Event Segera!', { body: `${next.name} akan segera datang!` });
  }
}

function log(msg) {
  if (logPaused) return;
  const el = document.createElement('div');
  el.className = 'log-entry';
  el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  ui.log.prepend(el);
  if (ui.log.children.length > 100) ui.log.lastChild.remove();
}

function clearLog() { ui.log.innerHTML = ''; log('🧹 History log dibersihkan.'); }
function toggleLogPause() { logPaused = !logPaused; ui.btnToggleLog.textContent = logPaused ? '▶️ Resume Log' : '⏸️ Pause Log'; ui.btnToggleLog.classList.toggle('btn-success', logPaused); }
function scrollLogToTop() { ui.log.scrollTo({ top: 0, behavior: 'smooth' }); }
function renderChangelog() {
  if (!ui.changelogList) return;
  ui.changelogList.innerHTML = changelogData.map(v => 
    `<div class="changelog-entry"><h4>v${v.version} <span style="color:var(--text-muted); font-weight:normal; font-size:0.8em">(${v.date})</span></h4><ul>${v.changes.map(c=>`<li>${c}</li>`).join('')}</ul></div>`
  ).join('');
}
function saveLocal() { localStorage.setItem('gacha_save', JSON.stringify(state)); }
function loadLocal() { const d = localStorage.getItem('gacha_save'); if (d) try { state = { ...state, ...JSON.parse(d) } } catch(e){} }
function exportSave() { ui.saveInput.value = btoa(JSON.stringify(state)); log('📤 Save diekspor.'); }
function importSave() {
  const raw = ui.saveInput.value.trim(); if (!raw) return alert('Tempel kode!');
  try { const p = JSON.parse(atob(raw)); if (p.gems!==undefined) { state = { ...state, ...p }; updateUI(); renderInventory(); saveLocal(); log('📥 Import berhasil!'); } }
  catch(e) { alert('Kode invalid!'); }
}
function resetSave() { if (confirm('Reset semua progress?')) { localStorage.removeItem('gacha_save'); location.reload(); } }
function setupEventListeners() {
  document.getElementById('btn-spin').addEventListener('click', spin);
  document.getElementById('btn-auto').addEventListener('click', toggleAuto);
  document.getElementById('btn-buy-crate').addEventListener('click', buyLuckCrate);
  document.getElementById('btn-export').addEventListener('click', exportSave);
  document.getElementById('btn-import').addEventListener('click', importSave);
  document.getElementById('btn-clear').addEventListener('click', resetSave);
  ui.btnClearLog.addEventListener('click', clearLog);
  ui.btnToggleLog.addEventListener('click', toggleLogPause);
  ui.btnScrollLog.addEventListener('click', scrollLogToTop);
  document.getElementById('btn-notif-perm')?.addEventListener('click', () => Notification.requestPermission());
  document.getElementById('btn-changelog')?.addEventListener('click', () => ui.changelogModal?.classList.add('show'));
  document.querySelector('.close-modal')?.addEventListener('click', () => ui.changelogModal?.classList.remove('show'));
  ui.changelogModal?.addEventListener('click', e => { if(e.target===ui.changelogModal) ui.changelogModal.classList.remove('show'); });
  document.addEventListener('keydown', e => { if (e.code === 'Space' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); spin(); } });
}
document.addEventListener('DOMContentLoaded', init);