// ======================== GLOBAL STATE ========================
let game = {
  gems: 0, totalSpins: 0, inventory: {}, luckMultiplier: 1,
  luckSpinsLeft: 0, luckTimeEnd: 0, bestRarity: null, log: [],
  eventData: null, pityCounter: 0, streak: 0, mainEventInventory: {},
  equippedItem: null, rebirthCount: 0, rebirthLuckBonus: 0,
  completedSets: []
};
let autoSpinInterval = null;
let luckTimerInterval = null;
let CONFIG = {};
let RNG_DATA = {};
let audioCtx = null;
let soundEnabled = true;
let gemDisplayVal = 0;

// 🔒 LOCK SYSTEM CONFIG
const UNLOCK_REQS = {
  bulk10:   { spins: 500,  msg: "🔒 Butuh 500 Total Spins" },
  bulk100:  { spins: 5000, msg: "🔒 Butuh 5.000 Total Spins" },
  fastSpin: { spins: 2000, rebirth: 1, msg: "🔒 Butuh 2.000 Spins & 1 Rebirth" },
  autoSpin: { spins: 1000, msg: "🔒 Butuh 1.000 Total Spins" }
};
let prevLockState = { bulk10: true, bulk100: true, fastSpin: true, autoSpin: true };

function isLocked(key) {
  const r = UNLOCK_REQS[key];
  if (!r) return false;
  const spinOk = game.totalSpins >= r.spins;
  const rebirthOk = r.rebirth ? game.rebirthCount >= r.rebirth : true;
  return !(spinOk && rebirthOk);
}

function updateFeatureLocks() {
  const locks = [
    { id: 'btnBulk10',   key: 'bulk10',   name: 'x10 Spin' },
    { id: 'btnBulk100',  key: 'bulk100',  name: 'x100 Spin' },
    { id: 'btnFastToggle', key: 'fastSpin', name: 'Fast Spin' },
    { id: 'btnAuto',     key: 'autoSpin', name: 'Auto Spin' }
  ];

  locks.forEach(l => {
    const btn = document.getElementById(l.id);
    if (!btn) return;
    const currentlyLocked = isLocked(l.key);

    if (currentlyLocked) {
      btn.classList.add('locked');
      btn.disabled = true;
      btn.setAttribute('data-lock-msg', UNLOCK_REQS[l.key].msg);
    } else {
      if (prevLockState[l.key]) notify(`✨ ${l.name} telah terbuka! Selamat bermain!`);
      btn.classList.remove('locked');
      btn.disabled = false;
      btn.removeAttribute('data-lock-msg');
    }
    prevLockState[l.key] = currentlyLocked;
  });
}

// ======================== SOUND ENGINE ========================
function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
function toggleSound() {
  soundEnabled = !soundEnabled;
  document.getElementById('soundToggle').textContent = soundEnabled ? '🔊' : '🔇';
}
function playSound(type, isTick=false) {
  if (!soundEnabled || !audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  if(isTick) {
    osc.frequency.setValueAtTime(200 + (Math.random()*1000), now);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
    osc.start(now); osc.stop(now + 0.05);
    return;
  }
  switch(type) {
    case 'common': osc.frequency.setValueAtTime(300, now); gain.gain.setValueAtTime(0.1, now); break;
    case 'uncommon': osc.frequency.setValueAtTime(400, now); gain.gain.setValueAtTime(0.15, now); break;
    case 'rare': osc.type='triangle'; osc.frequency.setValueAtTime(600, now); gain.gain.setValueAtTime(0.2, now); break;
    case 'epic': osc.type='sine'; osc.frequency.setValueAtTime(800, now); gain.gain.setValueAtTime(0.3, now); break;
    case 'legendary': osc.type='square'; osc.frequency.setValueAtTime(1000, now); gain.gain.setValueAtTime(0.4, now); break;
    case 'mythic': osc.type='sawtooth'; osc.frequency.setValueAtTime(1200, now); gain.gain.setValueAtTime(0.5, now); break;
    case 'diamond': osc.type='sine'; osc.frequency.setValueAtTime(1500, now); gain.gain.setValueAtTime(0.6, now); break;
    case 'divine': osc.type='sine'; osc.frequency.setValueAtTime(1800, now); gain.gain.setValueAtTime(0.7, now); break;
    case 'ethereal': osc.type='sine'; osc.frequency.setValueAtTime(2000, now); gain.gain.setValueAtTime(0.8, now); break;
    case 'secret':
      osc.type='sine'; osc.frequency.setValueAtTime(800, now); osc.frequency.linearRampToValueAtTime(2400, now + 0.3);
      gain.gain.setValueAtTime(0.6, now); break;
    case 'transcendent':
      osc.type='sine'; osc.frequency.setValueAtTime(1200, now); osc.frequency.linearRampToValueAtTime(3000, now + 0.5);
      gain.gain.setValueAtTime(0.9, now); break;
    default: osc.frequency.setValueAtTime(500, now); gain.gain.setValueAtTime(0.1, now);
  }
  gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
  osc.start(now); osc.stop(now + 0.3);
}

// ======================== LOAD JSON DATA ========================
async function loadGameData() {
  try {
    const [configRes, rngRes] = await Promise.all([fetch('config.json'), fetch('RNG.json')]);
    CONFIG = await configRes.json(); RNG_DATA = await rngRes.json();
    CONFIG.settings.pityThreshold = CONFIG.settings.pityThreshold || 50;
    CONFIG.settings.pityGuarantee = CONFIG.settings.pityGuarantee || 'rare';
    CONFIG.settings.streakInterval = CONFIG.settings.streakInterval || 10;
    CONFIG.settings.streakLuckBonus = CONFIG.settings.streakLuckBonus || 0.2;
    init();
  } catch (err) { console.error('❌ Gagal load data game:', err); init(); }
}

// ======================== INIT ========================
function init() {
  loadFromStorage();
  renderShop(); renderUpdateLog(); renderInventory();
  updateUI(); updatePityUI(); startLuckTimer(); checkSetBonus();
}

// ======================== PAGE NAVIGATION ========================
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`.nav button[onclick="showPage('${page}')"]`);
  if(btn) btn.classList.add('active');
  if (page === 'inventory') { renderInventory(); checkSetBonus(); }
  if (page === 'log') renderLog();
  if (page === 'event') { renderEventInventory(); updateEventUI(); }
}

// ======================== RNG ENGINE & PITTY ========================
function getEffectiveLuck() {
  let luck = game.luckMultiplier + game.rebirthLuckBonus;
  if (game.completedSets.includes('april_complete')) luck += 0.3;
  if (game.equippedItem === 'spring_crown') luck += 0.2;
  return luck;
}
function rollRarity(rarityTable) {
  let luck = getEffectiveLuck();
  let totalWeight = 0; let weights = {};
  for (let key in rarityTable) {
    let r = rarityTable[key];
    if(r.rebirthReq && game.rebirthCount < r.rebirthReq) continue;
    let weight = (1 / r.odds) * (key === 'common' ? 1 : luck);
    weights[key] = weight; totalWeight += weight;
  }
  if (game.pityCounter >= CONFIG.settings.pityThreshold) {
    game.pityCounter = 0; updatePityUI(); return CONFIG.settings.pityGuarantee;
  }
  let rand = Math.random() * totalWeight; let cumulative = 0;
  for (let key in weights) {
    cumulative += weights[key];
    if (rand <= cumulative) return key;
  }
  return 'common';
}
function triggerVisuals(rarityKey) {
  const flash = document.getElementById('flashOverlay');
  const body = document.body;
  flash.classList.add('active');
  setTimeout(() => flash.classList.remove('active'), 600);
  if (['mythic', 'secret', 'diamond', 'divine', 'ethereal', 'transcendent'].includes(rarityKey)) {
    body.classList.add('shake');
    setTimeout(() => body.classList.remove('shake'), 400);
    if (navigator.vibrate) navigator.vibrate([100, 30, 100]);
  }
  playSound(rarityKey);
}
function updateStreak() {
  game.streak++;
  const display = document.getElementById('streakDisplay');
  display.textContent = `🔥 STREAK: ${game.streak}`;
  if (game.streak % CONFIG.settings.streakInterval === 0) {
    game.luckMultiplier += CONFIG.settings.streakLuckBonus;
    notify(`🔥 STREAK x${game.streak}! Luck +${CONFIG.settings.streakLuckBonus}x!`);
    display.classList.add('streak-high');
    setTimeout(() => display.classList.remove('streak-high'), 1500);
  }
}
function updatePityUI() {
  const pct = Math.min((game.pityCounter / CONFIG.settings.pityThreshold) * 100, 100);
  document.getElementById('pityFill').style.width = pct + '%';
  document.getElementById('pityCount').textContent = `${game.pityCounter}/${CONFIG.settings.pityThreshold}`;
}

// ======================== UI & UTILS ========================
function animateValue(id, start, end, duration) {
  const obj = document.getElementById(id);
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const val = Math.floor(progress * (end - start) + start);
    obj.textContent = val.toLocaleString();
    if (progress < 1) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}
function showFloatingGems(amount) {
  const el = document.createElement('div');
  el.className = 'float-gem';
  el.textContent = `+${amount} 💎`;
  el.style.left = '50%'; el.style.top = '40%';
  el.style.transform = 'translateX(-50%)';
  document.getElementById('floatContainer').appendChild(el);
  setTimeout(() => el.remove(), 1000);
}
function updateUI() {
  animateValue('stat-gems', gemDisplayVal, game.gems, 800);
  gemDisplayVal = game.gems;
  document.getElementById('stat-spins').textContent = game.totalSpins.toLocaleString();
  document.getElementById('stat-luck').textContent = getEffectiveLuck().toFixed(1) + 'x';
  document.getElementById('stat-rebirth').textContent = game.rebirthCount;
  document.getElementById('totalSpinsDisplay').textContent = 'Total Spins: ' + game.totalSpins;
  if (game.bestRarity && RNG_DATA.rarities[game.bestRarity]) {
    let br = RNG_DATA.rarities[game.bestRarity];
    let bestEl = document.getElementById('stat-best');
    bestEl.textContent = br.name; bestEl.className = 'value ' + br.cssClass;
  }
  renderShop();
  updateFeatureLocks(); // ⬅️ UPDATE LOCKS SETIAP UI REFRESH
}
function notify(msg) {
  let el = document.getElementById('notification');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), CONFIG.settings.notificationDuration);
}
function renderUpdateLog() {
  let container = document.getElementById('updateLog');
  container.innerHTML = ''; 
  CONFIG.updateEntries.forEach(entry => {
    let div = document.createElement('div'); div.className = 'update-entry';
    div.innerHTML = `<div class="update-date">${entry.date}</div><div class="update-text">${entry.text}</div>`;
    container.appendChild(div);
  });
}

// ======================== MAIN SPIN ========================
function toggleFastSpin() {
  if (isLocked('fastSpin')) { notify("🔒 Fitur Fast Spin masih terkunci!"); return; }
  CONFIG.settings.fastSpinMode = !CONFIG.settings.fastSpinMode;
  document.getElementById('btnFastToggle').textContent = CONFIG.settings.fastSpinMode ? '⚡ Fast Spin ON' : '⚡ Fast Spin OFF';
  document.querySelector('.spin-area').classList.toggle('fast-spin', CONFIG.settings.fastSpinMode);
  notify(CONFIG.settings.fastSpinMode ? '⚡ Fast Spin ON' : '⏸ Fast Spin OFF');
}

function doSpin(isAuto=false) {
  initAudio();
  let display = document.getElementById('spinDisplay');
  let resultEl = document.getElementById('spinResult');
  let labelEl = document.getElementById('spinRarityLabel');
  if(CONFIG.settings.fastSpinMode || isAuto) {
    finishSpin(RNG_DATA.rarities, resultEl, labelEl, display);
    return;
  }
  display.classList.add('spinning');
  document.getElementById('btnSpin').disabled = true;
  let count = 0;
  let tickInterval = setInterval(() => {
    let keys = Object.keys(RNG_DATA.rarities).filter(k => !RNG_DATA.rarities[k].rebirthReq || game.rebirthCount >= RNG_DATA.rarities[k].rebirthReq);
    let randomR = keys[Math.floor(Math.random() * keys.length)];
    resultEl.textContent = RNG_DATA.rarities[randomR].name;
    resultEl.className = 'spin-result ' + RNG_DATA.rarities[randomR].cssClass;
    playSound('tick', true);
    count++;
    if (count > CONFIG.settings.flickerCount) {
      clearInterval(tickInterval);
      finishSpin(RNG_DATA.rarities, resultEl, labelEl, display);
    }
  }, CONFIG.settings.flickerInterval);
}

function finishSpin(rarityTable, resultEl, labelEl, display) {
  let rolled = rollRarity(rarityTable);
  let rarity = rarityTable[rolled];
  if (['common', 'uncommon'].includes(rolled)) game.pityCounter++;
  else game.pityCounter = 0;
  updatePityUI(); updateStreak();
  if (game.luckSpinsLeft > 0) game.luckSpinsLeft--;
  game.gems += rarity.gems; game.totalSpins++;
  if (!game.inventory[rolled]) game.inventory[rolled] = 0;
  game.inventory[rolled]++;
  updateBestRarity(rolled);
  addLog(rolled, rarity);
  display.classList.remove('spinning');
  resultEl.textContent = rarity.name;
  resultEl.className = 'spin-result ' + rarity.cssClass;
  labelEl.textContent = `1 in ${rarity.odds} | +${rarity.gems} Gems`;
  labelEl.className = 'spin-rarity-label ' + rarity.cssClass;
  showFloatingGems(rarity.gems);
  triggerVisuals(rolled);
  document.getElementById('btnSpin').disabled = false;
  updateUI(); saveToStorage();
}

// ======================== BULK SPIN ========================
function doBulkSpin(amount) {
  const key = amount === 10 ? 'bulk10' : 'bulk100';
  if (isLocked(key)) { notify(`🔒 Spin x${amount} masih terkunci!`); return; }
  initAudio();
  let summary = {};
  for(let i=0; i<amount; i++) {
    let rolled = rollRarity(RNG_DATA.rarities);
    let rarity = RNG_DATA.rarities[rolled];
    game.gems += rarity.gems; game.totalSpins++;
    if(!game.inventory[rolled]) game.inventory[rolled]=0;
    game.inventory[rolled]++;
    updateBestRarity(rolled);
    summary[rolled] = (summary[rolled] || 0) + 1;
    if (['legendary','mythic','diamond','divine','ethereal','secret','transcendent'].includes(rolled)) {
      addLog(rolled, rarity);
    }
  }
  let msg = `📦 Bulk x${amount}:` + Object.entries(summary).map(([r,c]) => `${RNG_DATA.rarities[r].name} x${c}`).join(', ');
  notify(msg);
  updateUI(); renderInventory(); updatePityUI(); saveToStorage();
}

// ======================== AUTO SPIN ========================
function toggleAutoSpin() {
  if (isLocked('autoSpin')) { notify("🔒 Fitur Auto Spin masih terkunci!"); return; }
  let btn = document.getElementById('btnAuto');
  if (autoSpinInterval) {
    clearInterval(autoSpinInterval); autoSpinInterval = null;
    btn.textContent = '▶ AUTO'; btn.classList.remove('active');
  } else {
    btn.textContent = '⏹ STOP'; btn.classList.add('active');
    doSpin(true);
    autoSpinInterval = setInterval(() => doSpin(true), CONFIG.settings.autoSpinInterval);
  }
}

function updateBestRarity(rolled) {
  const order = ['common','uncommon','rare','epic','legendary','mythic','diamond','divine','secret','ethereal','transcendent'];
  let currentIdx = order.indexOf(game.bestRarity);
  let newIdx = order.indexOf(rolled);
  if (newIdx > currentIdx) game.bestRarity = rolled;
}

// ======================== LOG ========================
function addLog(rolled, rarity, isEvent = false) {
  let now = new Date();
  let entry = { time: now.toLocaleTimeString(), rarity: rolled, rarityName: rarity.name, cssClass: rarity.cssClass, gems: rarity.gems, isEvent };
  game.log.unshift(entry);
  if (game.log.length > CONFIG.settings.logMaxEntries) game.log.pop();
}
function renderLog() {
  let container = document.getElementById('logContainer'); container.innerHTML = '';
  if (game.log.length === 0) { container.innerHTML = '<p style="text-align:center;color:var(--text-dim)">Belum ada log spin.</p>'; return; }
  game.log.forEach(entry => {
    let div = document.createElement('div'); div.className = 'log-entry';
    div.innerHTML = `<span class="log-time">[${entry.time}]</span> <span class="log-rarity ${entry.cssClass}">${entry.rarityName}</span> <span style="color:var(--text-dim)">+${entry.gems} gems</span> ${entry.isEvent ? '<span style="color:#4CAF50">[EVENT]</span>' : ''}`;
    container.appendChild(div);
  });
}
function clearLog() { game.log = []; renderLog(); notify('📜 Log dibersihkan!'); }

// ======================== SHOP ========================
function renderShop() {
  let container = document.getElementById('shopList'); container.innerHTML = '';
  let categories = {};
  let shopDiscount = (game.equippedItem === 'april_badge') ? 0.95 : 1;
  CONFIG.shopItems.forEach(item => {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push(item);
  });
  for (let cat in categories) {
    let header = document.createElement('div'); header.className = 'shop-category'; header.textContent = cat.toUpperCase();
    container.appendChild(header);
    categories[cat].forEach(item => {
      let finalCost = Math.floor(item.cost * shopDiscount);
      let div = document.createElement('div'); div.className = 'shop-item';
      div.innerHTML = `<div class="shop-item-info"><div class="shop-item-name">${item.name}</div><div class="shop-item-desc">${item.desc}</div></div><div class="shop-item-cost">💎 ${finalCost} Gems</div><button class="btn btn-buy" onclick="buyLuck('${item.id}')" ${game.gems < finalCost ? 'disabled' : ''}>BELI</button>`;
      container.appendChild(div);
    });
  }
}
function buyLuck(id) {
  let item = CONFIG.shopItems.find(i => i.id === id);
  let shopDiscount = (game.equippedItem === 'april_badge') ? 0.95 : 1;
  let cost = Math.floor(item.cost * shopDiscount);
  if (!item || game.gems < cost) { notify('⚠️ Gems tidak cukup!'); return; }
  game.gems -= cost;
  if (item.type === 'utility') {
    if (id === 'pity_skip') { game.pityCounter = 0; game.gems += 50; notify('✅ Pity direset & +50 Gems!'); }
    else if (id === 'pity_reduce_25') { game.pityCounter = Math.max(0, game.pityCounter - 25); notify('✅ Pity counter dikurangi 25!'); }
    else if (id === 'auto_speed_boost') { CONFIG.settings.autoSpinInterval = 600; notify('⚡ Auto Spin dipercepat!'); }
  } else {
    game.luckMultiplier = Math.max(game.luckMultiplier, item.multiplier);
    if (item.type === 'spin') { game.luckSpinsLeft += item.amount; notify(`🍀 ${item.name} aktif! (${item.amount} spin tersisa)`); }
    else if (item.type === 'time') { let endTime = Date.now() + (item.duration * 1000); if (game.luckTimeEnd < endTime) game.luckTimeEnd = endTime; notify(`🍀 ${item.name} aktif! (${item.duration/60} menit)`); }
  }
  renderShop(); updateUI(); saveToStorage();
}
function startLuckTimer() {
  if (luckTimerInterval) clearInterval(luckTimerInterval);
  luckTimerInterval = setInterval(() => {
    let now = Date.now(); let timerEl = document.getElementById('luckTimer');
    if (game.luckSpinsLeft > 0 || game.luckTimeEnd > now) {
      let info = [];
      if (game.luckSpinsLeft > 0) info.push(`${game.luckSpinsLeft} spin tersisa`);
      if (game.luckTimeEnd > now) {
        let remaining = Math.ceil((game.luckTimeEnd - now) / 1000);
        info.push(`${Math.floor(remaining/60)}:${(remaining%60).toString().padStart(2,'0')} tersisa`);
      }
      timerEl.textContent = `🍀 Luck ${game.luckMultiplier}x aktif! | ${info.join(', ')}`;
    } else {
      if (game.luckMultiplier > 1) { game.luckMultiplier = 1; timerEl.textContent = ''; updateUI(); }
      else timerEl.textContent = '';
    }
  }, 1000);
}

// ======================== INVENTORY & SETS ========================
function toggleEquip(itemId) {
  if (game.equippedItem === itemId) {
    game.equippedItem = null; notify('🔓 Item di-unequip.');
  } else {
    if (!game.inventory[itemId] || game.inventory[itemId] <= 0) { notify('⚠️ Kamu tidak punya item ini!'); return; }
    game.equippedItem = itemId; notify('👑 ' + (RNG_DATA.eventItems.find(i => i.id===itemId)?.name || itemId) + ' di-equip!');
  }
  renderInventory(); updateUI(); saveToStorage();
}
function checkSetBonus() {
  for(let setId in CONFIG.sets) {
    if(game.completedSets.includes(setId)) continue;
    let set = CONFIG.sets[setId];
    let complete = set.items.every(id => game.inventory[id] > 0 || game.mainEventInventory[id] > 0);
    if(complete) {
      game.completedSets.push(setId);
      notify(`🏆 Set "${set.name}" Completed! Bonus +0.3x Luck Permanent!`);
      updateUI(); saveToStorage();
    }
  }
  let panel = document.getElementById('setProgress'); panel.innerHTML = '';
  if(game.completedSets.length > 0) {
    panel.innerHTML = `<div class="set-badge">✅ ${game.completedSets.length} Set Selesai</div>`;
  } else {
    panel.innerHTML = `<div style="font-size:11px;color:var(--text-dim);text-align:center;">Kumpulkan semua item untuk membuka Set Bonus!</div>`;
  }
}
function renderInventory() {
  let grid = document.getElementById('invGrid'); grid.innerHTML = '';
  let hasItems = false;
  for (let key in RNG_DATA.rarities) {
    let count = game.inventory[key] || 0;
    if (count > 0) {
      hasItems = true;
      let r = RNG_DATA.rarities[key];
      let div = document.createElement('div');
      let isEquipped = (game.equippedItem === key) ? 'equipped-aura' : '';
      div.className = `inv-item glow-${key} ${isEquipped}`;
      div.innerHTML = `<div class="item-name ${r.cssClass}">${r.name}</div><div class="item-count">x${count}</div><div class="item-odds">1 in ${r.odds}</div>`;
      grid.appendChild(div);
    }
  }
  if (game.mainEventInventory) {
    for (let key in game.mainEventInventory) {
      if (game.mainEventInventory[key] > 0) {
        hasItems = true;
        let evItem = RNG_DATA.eventItems.find(i => i.id === key);
        if (evItem) {
          let r = RNG_DATA.eventRarities[evItem.rarity] || RNG_DATA.eventRarities.blossom;
          let div = document.createElement('div');
          let isEquipped = (game.equippedItem === key) ? 'equipped-aura' : '';
          div.className = `inv-item glow-${evItem.rarity} ${isEquipped}`;
          div.innerHTML = `<div class="item-name ${r.cssClass}">🌸 ${evItem.name}</div><div class="item-count">x${game.mainEventInventory[key]}</div><div class="item-odds">${evItem.desc}</div>`;
          let btn = document.createElement('button');
          btn.className = `equip-btn ${isEquipped ? 'active' : ''}`;
          btn.textContent = game.equippedItem === key ? 'EQUIPPED' : 'EQUIP';
          btn.onclick = () => toggleEquip(key);
          div.appendChild(btn);
          grid.appendChild(div);
        }
      }
    }
  }
  if (!hasItems) grid.innerHTML = '<p style="text-align:center;color:var(--text-dim)">Belum ada item. Mulai spin!</p>';
}

// ======================== REBIRTH ========================
function doRebirth() {
  if(game.gems < CONFIG.settings.rebirthGems || game.totalSpins < CONFIG.settings.rebirthSpins) {
    notify(`⚠️ Syarat: ${CONFIG.settings.rebirthGems.toLocaleString()} Gems & ${CONFIG.settings.rebirthSpins.toLocaleString()} Spins!`); return;
  }
  if(!confirm('⚠️ REBIRTH akan mereset Gems & Inventory, tapi memberikan +0.5x Luck Permanent & membuka Rarity Transcendent! Lanjut?')) return;
  game.gems = 0; game.inventory = {}; game.pityCounter = 0; game.streak = 0;
  game.rebirthCount++; game.rebirthLuckBonus += 0.5;
  notify(`👑 Rebirth ${game.rebirthCount} berhasil! +0.5x Luck Permanent.`);
  updateUI(); renderInventory(); saveToStorage();
}

// ======================== EVENT SYSTEM ========================
function transferEventToMain() {
  if (!game.eventData) { notify('⚠️ Tidak ada data event!'); return; }
  if (!game.mainEventInventory) game.mainEventInventory = {};
  let count = 0;
  for (let key in game.eventData.inventory) {
    if (game.eventData.inventory[key] > 0) {
      game.mainEventInventory[key] = (game.mainEventInventory[key] || 0) + game.eventData.inventory[key];
      count += game.eventData.inventory[key];
    }
  }
  if (game.eventData.eventItems) {
    for (let key in game.eventData.eventItems) {
      if (game.eventData.eventItems[key] > 0) {
        game.mainEventInventory[key] = (game.mainEventInventory[key] || 0) + game.eventData.eventItems[key];
        count += game.eventData.eventItems[key];
      }
    }
  }
  if (count > 0) notify(`✅ ${count} item event berhasil ditransfer ke Main Save!`);
  else notify('⚠️ Tidak ada item event untuk ditransfer.');
  renderInventory(); checkSetBonus(); saveToStorage();
}
function eventImport() {
  initAudio();
  let textarea = document.getElementById('eventImportTextarea');
  let text = textarea.value.trim();
  if (!text) { notify('⚠️ Paste save data terlebih dahulu!'); return; }
  try {
    let data = JSON.parse(atob(text));
    game.eventData = { gems: data.gems || 0, totalSpins: data.totalSpins || 0, inventory: data.inventory || {}, luckMultiplier: data.luckMultiplier || 1, luckSpinsLeft: data.luckSpinsLeft || 0, luckTimeEnd: data.luckTimeEnd || 0, bestRarity: data.bestRarity || null, eventItems: data.eventItems || {} };
    notify('✅ Save data berhasil diimport ke Event!'); updateEventUI(); renderEventInventory();
  } catch(e) { notify('❌ Save data tidak valid!'); }
}
function eventExport() {
  if (!game.eventData) { notify('⚠️ Belum ada data event!'); return; } 
  let exportData = { gems: game.eventData.gems, totalSpins: game.eventData.totalSpins, inventory: game.eventData.inventory, luckMultiplier: game.eventData.luckMultiplier, luckSpinsLeft: game.eventData.luckSpinsLeft || 0, luckTimeEnd: game.eventData.luckTimeEnd, bestRarity: game.eventData.bestRarity, eventItems: game.eventData.eventItems || {} };
  document.getElementById('eventImportTextarea').value = btoa(JSON.stringify(exportData));
  notify('📤 Event data berhasil diexport!');
}
function doEventSpin() {
  initAudio();
  if (!game.eventData) { notify('⚠️ Import save data dari main page terlebih dahulu!'); return; }
  let display = document.getElementById('eventSpinDisplay');
  let resultEl = document.getElementById('eventSpinResult');
  let labelEl = document.getElementById('eventSpinRarityLabel');
  display.classList.add('spinning'); document.getElementById('eventBtnSpin').disabled = true;
  let count = 0;
  let tickInterval = setInterval(() => {
    let keys = Object.keys(RNG_DATA.eventRarities);
    let randomR = keys[Math.floor(Math.random() * keys.length)];
    resultEl.textContent = RNG_DATA.eventRarities[randomR].name;
    resultEl.className = 'spin-result ' + RNG_DATA.eventRarities[randomR].cssClass;
    playSound('tick', true);
    count++;
    if (count > CONFIG.settings.flickerCount) {
      clearInterval(tickInterval); finishEventSpin(RNG_DATA.eventRarities, resultEl, labelEl, display);
    }
  }, CONFIG.settings.flickerInterval);
}
function finishEventSpin(rarityTable, resultEl, labelEl, display) {
  let rolled = rollRarity(rarityTable);
  let rarity = rarityTable[rolled];
  game.eventData.gems += rarity.gems; game.eventData.totalSpins++;
  if (!game.eventData.inventory[rolled]) game.eventData.inventory[rolled] = 0;
  game.eventData.inventory[rolled]++;
  if (Math.random() < CONFIG.settings.eventExclusiveChance) {
    let eventItem = RNG_DATA.eventItems[Math.floor(Math.random() * RNG_DATA.eventItems.length)];
    if (!game.eventData.eventItems) game.eventData.eventItems = {};
    if (!game.eventData.eventItems[eventItem.id]) game.eventData.eventItems[eventItem.id] = 0;
    game.eventData.eventItems[eventItem.id]++;
    notify('🌸 Dapat item eksklusif: ' + eventItem.name + '!');
  }
  addLog(rolled, rarity, true); display.classList.remove('spinning');
  resultEl.textContent = rarity.name; resultEl.className = 'spin-result ' + rarity.cssClass;
  labelEl.textContent = `1 in ${rarity.odds} | +${rarity.gems} Gems`; labelEl.className = 'spin-rarity-label ' + rarity.cssClass;
  triggerVisuals(rolled); document.getElementById('eventBtnSpin').disabled = false;
  updateEventUI(); renderEventInventory(); saveToStorage();
}
function renderEventInventory() {
  let grid = document.getElementById('eventInvGrid'); grid.innerHTML = '';
  if (!game.eventData) { grid.innerHTML = '<p style="text-align:center;color:var(--text-dim)">Import save data untuk melihat inventory event.</p>'; return; }
  let hasItems = false;
  for (let key in RNG_DATA.eventRarities) {
    let count = game.eventData.inventory[key] || 0;
    if (count > 0) {
      hasItems = true;
      let r = RNG_DATA.eventRarities[key];
      let div = document.createElement('div'); div.className = 'inv-item event-exclusive';
      div.innerHTML = `<div class="item-name ${r.cssClass}">${r.name}</div><div class="item-count">x${count}</div><div class="item-odds">1 in ${r.odds}</div>`;
      grid.appendChild(div);
    }
  }
  if (game.eventData.eventItems) {
    for (let key in game.eventData.eventItems) {
      let count = game.eventData.eventItems[key];
      if (count > 0) {
        hasItems = true;
        let evItem = RNG_DATA.eventItems.find(i => i.id === key);
        if (evItem) {
          let r = RNG_DATA.eventRarities[evItem.rarity] || RNG_DATA.eventRarities.blossom;
          let div = document.createElement('div'); div.className = 'inv-item event-exclusive';
          div.innerHTML = `<div class="item-name ${r.cssClass}">🌸 ${evItem.name}</div><div class="item-count">x${count}</div><div class="item-odds">${evItem.desc}</div>`;
          grid.appendChild(div);
        }
      }
    }
  }
  if (!hasItems) grid.innerHTML = '<p style="text-align:center;color:var(--text-dim)">Belum ada item event. Mulai spin!</p>';
}
function updateEventUI() {
  if (game.eventData) {
    document.getElementById('eventStatGems').textContent = game.eventData.gems.toLocaleString();
    document.getElementById('eventStatSpins').textContent = game.eventData.totalSpins.toLocaleString();
    document.getElementById('eventStatLuck').textContent = game.eventData.luckMultiplier + 'x';
  } else {
    document.getElementById('eventStatGems').textContent = '0';
    document.getElementById('eventStatSpins').textContent = '0';
    document.getElementById('eventStatLuck').textContent = '1x';
  }
}

// ======================== SAVE / LOAD ========================
function saveToStorage() { try { localStorage.setItem('rngGameSave', JSON.stringify(game)); } catch(e) {} }
function loadFromStorage() { try { let data = localStorage.getItem('rngGameSave'); if (data) { game = { ...game, ...JSON.parse(data) }; updateUI(); updatePityUI(); } } catch(e) {} }
function saveGame() { saveToStorage(); notify('💾 Game tersimpan!'); }
function exportSave() {
  let exportData = { gems: game.gems, totalSpins: game.totalSpins, inventory: game.inventory , luckMultiplier: game.luckMultiplier, luckSpinsLeft: game.luckSpinsLeft, luckTimeEnd: game.luckTimeEnd, bestRarity: game.bestRarity, eventItems: game.eventData ? game.eventData.eventItems : {}, mainEventInventory: game.mainEventInventory || {}, equippedItem: game.equippedItem, rebirthCount: game.rebirthCount, rebirthLuckBonus: game.rebirthLuckBonus, completedSets: game.completedSets };
  document.getElementById('saveTextarea').value = btoa(JSON.stringify(exportData));
  notify('📤 Save data berhasil diexport!');
}
function importSave() { 
  initAudio();
  let text = document.getElementById('saveTextarea').value.trim();
  if (!text) { notify('⚠️ Paste save data terlebih dahulu!'); return; }
  try {
    let data = JSON.parse(atob(text));
    game.gems = data.gems || 0; game.totalSpins = data.totalSpins || 0; game.inventory = data.inventory || {};
    game.luckMultiplier = data.luckMultiplier || 1; game.luckSpinsLeft = data.luckSpinsLeft || 0;
    game.luckTimeEnd = data.luckTimeEnd || 0; game.bestRarity = data.bestRarity || null;
    game.mainEventInventory = data.mainEventInventory || {};
    game.equippedItem = data.equippedItem || null;
    game.rebirthCount = data.rebirthCount || 0; game.rebirthLuckBonus = data.rebirthLuckBonus || 0;
    game.completedSets = data.completedSets || [];
    if (data.eventItems) { if (!game.eventData) game.eventData = { eventItems: {} }; game.eventData.eventItems = data.eventItems; }
    saveToStorage(); updateUI(); updatePityUI(); checkSetBonus(); notify('✅ Save data berhasil diimport!');
  } catch(e) { notify('❌ Save data tidak valid!'); }
}
function resetGame() {
  if (confirm('Yakin ingin mereset semua progress? (Rebirth akan hilang)')) {
    localStorage.removeItem('rngGameSave');
    game = { gems:0, totalSpins:0, inventory:{}, luckMultiplier:1, luckSpinsLeft:0, luckTimeEnd:0, bestRarity:null, log:[], eventData:null, pityCounter:0, streak:0, mainEventInventory:{}, equippedItem:null, rebirthCount:0, rebirthLuckBonus:0, completedSets:[] };
    updateUI(); renderShop(); renderInventory(); updatePityUI(); checkSetBonus();
    document.getElementById('spinResult').textContent = 'Tekan SPIN untuk mulai!';
    document.getElementById('spinResult').className = 'spin-result rarity-common';
    document.getElementById('spinRarityLabel').textContent = '';
    notify('🗑 Game telah direset!');
  }
}

// ======================== START ========================
loadGameData();
